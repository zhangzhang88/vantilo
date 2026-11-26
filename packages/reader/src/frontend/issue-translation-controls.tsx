import { useEffect, useMemo, useRef, useState } from "react";
import { BookExportPanel, type BookExportSource } from "./book-export-controls";
import { isListeningTranslationEngine, loadListeningTranslationEngine } from "./chinese-translation-reuse";
import {
  ensureBookChineseCatalog, initialIssueTranslationProgress, loadIssueArticleTitles, planIssueTranslation, runIssueTranslation, savedIssueTranslationEngine, saveIssueTranslationEngine,
  translationBatchId, type IssueTranslationProgress, type TranslationBatchSource,
} from "./issue-translation";
import type { ReaderIssue } from "./reader-model";
import { getReaderStorage } from "./reader-storage";

type IssueJob = {
  engineId: string;
  label: string;
  book?: { id: string; title: string };
  phase: "running" | "paused" | "complete" | "partial";
  progress: IssueTranslationProgress;
  error?: string;
};

type EngineChoice = { id: string; label: string };
type Plan = Awaited<ReturnType<typeof planIssueTranslation>>;

function message(error: unknown) {
  return error instanceof Error ? error.message : "翻译中断，请重试";
}

export function useIssueTranslationQueue() {
  const [jobs, setJobs] = useState(() => new Map<string, IssueJob>());
  const [activeId, setActiveId] = useState<string>();
  const active = useRef<{ issueId: string; controller: AbortController }>(null);

  useEffect(() => () => active.current?.controller.abort(), []);

  function pause(issueId: string) {
    if (active.current?.issueId === issueId) active.current.controller.abort();
  }

  async function start(source: TranslationBatchSource, engine: EngineChoice, plan: Plan) {
    const id = translationBatchId(source);
    if (active.current) return;
    const controller = new AbortController();
    active.current = { issueId: id, controller };
    setActiveId(id);
    let latest: IssueJob = {
      engineId: engine.id, label: engine.label, phase: "running", progress: initialIssueTranslationProgress(plan),
      book: source.kind === "book" ? { id: source.collection.id, title: source.collection.displayLabel } : undefined,
    };
    const update = (next: Partial<IssueJob>) => {
      latest = { ...latest, ...next };
      const snapshot = latest;
      setJobs(current => new Map(current).set(id, snapshot));
    };
    update({});
    try {
      saveIssueTranslationEngine(id, engine.id);
      let effectiveSource = source;
      if (source.kind === "book") {
        const chapterTitles = await ensureBookChineseCatalog(
          source.collection.id,
          engine.id,
          controller.signal,
          (done, total) => update({
            progress: {
              ...latest.progress,
              currentTitle: total > 0 ? `生成中文目录 ${done}/${total}` : "生成中文目录中…",
            },
          }),
        );
        if (chapterTitles && Object.keys(chapterTitles).length > 0) {
          effectiveSource = {
            ...source,
            collection: {
              ...source.collection,
              documents: source.collection.documents.map(doc =>
                doc.titleZh || !Object.hasOwn(chapterTitles, doc.id)
                  ? doc
                  : { ...doc, titleZh: chapterTitles[doc.id], tocTitleZh: chapterTitles[doc.id] },
              ),
            },
          };
        }
      }
      const freshPlan = await planIssueTranslation(effectiveSource, engine.id);
      update({ progress: initialIssueTranslationProgress(freshPlan) });
      const progress = await runIssueTranslation(freshPlan, engine.id, controller.signal, progress => update({ progress }));
      update({ phase: progress.failedArticles.length ? "partial" : "complete", progress });
    } catch (error) {
      update(controller.signal.aborted ? { phase: "paused" } : { phase: "partial", error: message(error) });
    } finally {
      active.current = null;
      setActiveId(undefined);
    }
  }

  return { jobs, activeId, pause, start };
}

export function useIssueArticleTitles(issue: ReaderIssue, phase?: IssueJob["phase"]) {
  const engineId = savedIssueTranslationEngine(issue.id);
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    let current = true;
    if (engineId) {
      void loadIssueArticleTitles(issue, engineId).then(value => {
        if (current) setTitles(value);
      }, () => {
        if (current) setTitles({});
      });
    } else {
      setTitles({});
    }
    return () => { current = false; };
  }, [issue, engineId, phase]);
  return titles;
}

type IssueQueue = ReturnType<typeof useIssueTranslationQueue>;

export function BackgroundBookTranslation({ queue, detailBookId, onOpenBook }: {
  queue: IssueQueue; detailBookId?: string; onOpenBook: (bookId: string) => void;
}) {
  const id = queue.activeId;
  const job = id ? queue.jobs.get(id) : undefined;
  const book = job?.book;
  const running = Boolean(id && book && job?.phase === "running");
  const itemText = running && job && job.progress.total > 0 ? ` · ${job.progress.translated}/${job.progress.total} 项` : "";
  const statusText = running && job
    ? `${job.progress.retrying ? "全书翻译正在重试" : job.progress.waiting ? "全书翻译等待模型" : "后台翻译全书中"} · ${job.progress.completedArticles}/${job.progress.articles} 章${itemText}`
    : "";

  useEffect(() => {
    if (window.parent === window) return;
    window.parent.postMessage({
      type: "vantilo:bg-translation-state",
      state: running && id && book
        ? { id, bookId: book.id, bookTitle: book.title, statusText }
        : null,
    }, "*");
  }, [running, id, book?.id, book?.title, statusText]);

  useEffect(() => {
    if (window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
      const data = event.data as { type?: unknown; action?: unknown; bookId?: unknown; jobId?: unknown };
      if (data.type !== "vantilo:bg-translation-action") return;
      if (data.action === "open" && typeof data.bookId === "string" && data.bookId) {
        onOpenBook(data.bookId);
      } else if (data.action === "pause" && typeof data.jobId === "string" && data.jobId) {
        queue.pause(data.jobId);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onOpenBook, queue]);

  if (!running || !id || !book || book.id === detailBookId) return null;
  return <aside className="background-book-translation" aria-label="后台全书翻译">
    <span className="background-book-translation-dot" aria-hidden="true" />
    <span role="status" className="background-book-translation-status">{statusText}</span>
    <span className="background-book-translation-actions">
      <button type="button" className="text-button background-book-translation-open" onClick={() => onOpenBook(book.id)} title={book.title}>查看《{book.title}》</button>
      <button type="button" className="text-button background-book-translation-pause" onClick={() => queue.pause(id)}>暂停全书翻译</button>
    </span>
  </aside>;
}

export function IssueTranslationControls({ issue, queue }: { issue: ReaderIssue; queue: IssueQueue }) {
  const source = useMemo<TranslationBatchSource>(() => ({ kind: "issue", issue }), [issue]);
  return <TranslationBatchControls source={source} queue={queue} />;
}

export function TranslationBatchControls({ source, queue, bookExport }: { source: TranslationBatchSource; queue: IssueQueue; bookExport?: BookExportSource }) {
  const id = translationBatchId(source);
  const book = source.kind === "book";
  const scope = book ? "全书" : "整期";
  const unit = book ? "章" : "篇";
  const job = queue.jobs.get(id);
  const [open, setOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [list, setList] = useState<EngineChoice[]>([]);
  const [engineId, setEngineId] = useState("");
  const [plan, setPlan] = useState<Plan>();
  const [listError, setListError] = useState("");
  const [planError, setPlanError] = useState("");
  const [loading, setLoading] = useState(false);
  const saved = savedIssueTranslationEngine(id);
  const selected = list.find(item => item.id === engineId);
  const running = job?.phase === "running";
  const occupied = !!queue.activeId && queue.activeId !== id;

  useEffect(() => {
    if (!open) return;
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      const nextController = new AbortController();
      controller = nextController;
      setLoading(true);
      setListError("");
      fetch("/api/vantilo-translation/engines", { cache: "no-store", signal: nextController.signal }).then(async response => {
        if (!response.ok) throw new Error("无法读取翻译模型列表");
        const data: { engines: EngineChoice[]; defaultId?: string } = await response.json();
        if (nextController.signal.aborted) return;
        const available = data.engines.filter(engine => isListeningTranslationEngine(engine.id));
        const readingEngine = loadListeningTranslationEngine(getReaderStorage());
        setList(available);
        setEngineId(current => {
          if (current && available.some(engine => engine.id === current)) return current;
          if (saved && available.some(engine => engine.id === saved)) return saved;
          return [readingEngine, data.defaultId].find(item => item && available.some(engine => engine.id === item)) ?? available[0]?.id ?? "";
        });
      }).catch(error => {
        if (!nextController.signal.aborted) setListError(message(error));
      }).finally(() => {
        if (!nextController.signal.aborted) setLoading(false);
      });
    };
    load();
    window.addEventListener("vantilo-custom-api-updated", load);
    return () => {
      controller?.abort();
      window.removeEventListener("vantilo-custom-api-updated", load);
    };
  }, [open, saved]);

  useEffect(() => {
    if (!open || !selected) return;
    let current = true;
    setPlan(undefined);
    setPlanError("");
    void planIssueTranslation(source, engineId).then(value => {
      if (current) setPlan(value);
    }, error => {
      if (current) setPlanError(message(error));
    });
    return () => { current = false; };
  }, [open, engineId, source, selected]);

  function toggle() {
    setPlan(undefined);
    setExportOpen(false);
    setOpen(value => !value);
  }

  function toggleExport() {
    setOpen(false);
    setExportOpen(value => !value);
  }

  const exportRefreshKey = `${job?.phase ?? "none"}:${job?.progress.completedArticles ?? 0}:${job?.progress.translated ?? 0}`;

  return <div className="issue-translation-controls">
    <div className="issue-translation-actions">
      {running
        ? <button type="button" className="toolbar-button" onClick={() => queue.pause(id)}>暂停{scope}翻译</button>
        : <button type="button" className="toolbar-button" aria-expanded={open} onClick={toggle}>
          {open ? `收起${scope}翻译` : job?.phase === "partial" ? "重试未完成" : job?.phase === "complete" ? `翻译${scope}…` : saved ? `继续翻译${scope}` : `翻译${scope}`}
        </button>}
      {bookExport && <button type="button" className="toolbar-button" aria-expanded={exportOpen} onClick={toggleExport}>
        {exportOpen ? "收起导出" : "导出译文 EPUB"}
      </button>}
    </div>
    {job && <div className="issue-translation-progress">
      <strong role="status">
        {running ? (job.progress.retrying ? "正在重试译文" : job.progress.waiting ? "等待阅读或听书翻译" : `${scope}翻译中`)
          : job.phase === "paused" ? "已暂停"
          : job.phase === "partial" ? "部分译文待补齐" : `${scope}译文已就绪`}
        {" · "}{job.progress.completedArticles}/{job.progress.articles} {unit}
      </strong>
      <small>{job.progress.translated}/{job.progress.total} 项 · {job.label}{running && job.progress.currentTitle ? ` · ${job.progress.currentTitle}` : ""}</small>
      {job.progress.total > 0 && <progress aria-label={`${scope}翻译进度`} max={job.progress.total} value={job.progress.translated} />}
      {job.progress.timings && <details>
        <summary>批次耗时（平均）</summary>
        <small>{(() => {
          const { count, queueMs, preparationMs, modelMs } = job.progress.timings;
          const seconds = (ms: number) => (ms / count / 1000).toFixed(1);
          return `${count} 批 · 等待 ${seconds(queueMs)} 秒 · 会话准备 ${seconds(preparationMs)} 秒 · 模型响应 ${seconds(modelMs)} 秒`;
        })()}</small>
      </details>}
      {job.error && <small role="alert">{job.error}</small>}
      {!running && job.progress.failedArticles.length > 0 && <details>
        <summary>{job.progress.failedArticles.length} {unit}有失败段落</summary>
        <ul>{job.progress.failedArticles.map((failure, index) => <li key={index}>{failure.title} · {failure.error}</li>)}</ul>
      </details>}
    </div>}
    {open && !running && <div className="issue-translation-options">
      <label>{scope}正文翻译模型
        <select value={engineId} onChange={event => {
          if (event.target.value === engineId) return;
          setPlan(undefined);
          setEngineId(event.target.value);
        }} disabled={loading || !list.length}>
          {!selected && <option value={engineId}>{loading ? "正在读取模型…" : engineId ? "原选模型不可用，请重新选择" : "无可用模型"}</option>}
          {list.map(engine => <option key={engine.id} value={engine.id}>{engine.label}</option>)}
        </select>
      </label>
      {(listError || planError) && <small role="alert">{listError || planError}</small>}
      {selected && !plan && !planError && <small role="status">正在检查已有译文…</small>}
      {plan && <small role="status">{plan.remainingArticles
        ? `待翻译 ${plan.remainingArticles} ${unit}、约 ${plan.remainingCharacters.toLocaleString("zh-CN")} 字符`
        : book ? "该模型的全书译文已齐全" : "该模型的本期译文已齐全"}</small>}
      {book && <small>尚未生成中文目录时，将自动使用所选模型先生成中文目录。</small>}
      {occupied && <small role="status">已有翻译任务在运行，暂停或完成后可开始。</small>}
      <button
        type="button" className="primary-button" disabled={loading || occupied || !selected || !plan?.remainingArticles}
        onClick={() => {
          if (!selected || !plan) return;
          setOpen(false);
          void queue.start(source, selected, plan);
        }}
      >{job?.phase === "partial" ? "重试缺失译文" : "开始翻译"}</button>
    </div>}
    {exportOpen && bookExport && <BookExportPanel
      book={bookExport.book}
      collection={bookExport.collection}
      tocTitles={bookExport.tocTitles}
      refreshKey={exportRefreshKey}
    />}
  </div>;
}
