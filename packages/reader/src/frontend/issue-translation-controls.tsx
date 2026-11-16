import { useEffect, useRef, useState } from "react";
import { isListeningTranslationEngine, loadListeningTranslationEngine } from "./chinese-translation-reuse";
import {
  initialIssueTranslationProgress, loadIssueArticleTitles, planIssueTranslation, runIssueTranslation, savedIssueTranslationEngine, saveIssueTranslationEngine,
  type IssueTranslationProgress,
} from "./issue-translation";
import type { ReaderIssue } from "./reader-model";
import { getReaderStorage } from "./reader-storage";

type IssueJob = {
  engineId: string;
  label: string;
  phase: "running" | "paused" | "complete" | "partial";
  progress: IssueTranslationProgress;
  error?: string;
};

type EngineChoice = { id: string; label: string };
type Plan = Awaited<ReturnType<typeof planIssueTranslation>>;

function message(error: unknown) {
  return error instanceof Error ? error.message : "整期翻译中断，请重试";
}

export function useIssueTranslationQueue() {
  const [jobs, setJobs] = useState(() => new Map<string, IssueJob>());
  const [activeId, setActiveId] = useState<string>();
  const active = useRef<{ issueId: string; controller: AbortController }>(null);

  useEffect(() => () => active.current?.controller.abort(), []);

  function pause(issueId: string) {
    if (active.current?.issueId === issueId) active.current.controller.abort();
  }

  async function start(issue: ReaderIssue, engine: EngineChoice, plan: Plan) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = { issueId: issue.id, controller };
    setActiveId(issue.id);
    let latest: IssueJob = { engineId: engine.id, label: engine.label, phase: "running", progress: initialIssueTranslationProgress(plan) };
    const update = (next: Partial<IssueJob>) => {
      latest = { ...latest, ...next };
      const snapshot = latest;
      setJobs(current => new Map(current).set(issue.id, snapshot));
    };
    update({});
    try {
      saveIssueTranslationEngine(issue.id, engine.id);
      const freshPlan = await planIssueTranslation(issue, engine.id);
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

export function IssueTranslationControls({ issue, queue }: { issue: ReaderIssue; queue: IssueQueue }) {
  const job = queue.jobs.get(issue.id);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<EngineChoice[]>([]);
  const [engineId, setEngineId] = useState("");
  const [plan, setPlan] = useState<Plan>();
  const [listError, setListError] = useState("");
  const [planError, setPlanError] = useState("");
  const [loading, setLoading] = useState(false);
  const saved = savedIssueTranslationEngine(issue.id);
  const selected = list.find(item => item.id === engineId);
  const running = job?.phase === "running";
  const occupied = !!queue.activeId && queue.activeId !== issue.id;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setListError("");
    fetch("/api/vantilo-translation/engines", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("无法读取翻译模型列表");
      const data: { engines: EngineChoice[]; defaultId?: string } = await response.json();
      if (controller.signal.aborted) return;
      const available = data.engines.filter(engine => isListeningTranslationEngine(engine.id));
      const readingEngine = loadListeningTranslationEngine(getReaderStorage());
      setList(available);
      setEngineId(current => current || saved || ([readingEngine, data.defaultId].find(id => available.some(engine => engine.id === id)) ?? available[0]?.id ?? ""));
    }).catch(error => {
      if (!controller.signal.aborted) setListError(message(error));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [open, saved]);

  useEffect(() => {
    if (!open || !selected) return;
    let current = true;
    setPlan(undefined);
    setPlanError("");
    void planIssueTranslation(issue, engineId).then(value => {
      if (current) setPlan(value);
    }, error => {
      if (current) setPlanError(message(error));
    });
    return () => { current = false; };
  }, [open, engineId, issue, selected]);

  function toggle() {
    setPlan(undefined);
    setOpen(value => !value);
  }

  return <div className="issue-translation-controls">
    <div className="issue-translation-actions">
      {running
        ? <button type="button" className="toolbar-button" onClick={() => queue.pause(issue.id)}>暂停整期翻译</button>
        : <button type="button" className="toolbar-button" aria-expanded={open} onClick={toggle}>
          {open ? "收起整期翻译" : job?.phase === "partial" ? "重试未完成" : job?.phase === "complete" ? "翻译整期…" : saved ? "继续翻译整期" : "翻译整期"}
        </button>}
    </div>
    {job && <div className="issue-translation-progress">
      <strong role="status">
        {running ? (job.progress.waiting ? "等待阅读或听书翻译" : "整期翻译中")
          : job.phase === "paused" ? "已暂停"
          : job.phase === "partial" ? "部分译文待补齐" : "整期译文已就绪"}
        {" · "}{job.progress.completedArticles}/{job.progress.articles} 篇
      </strong>
      <small>{job.progress.translated}/{job.progress.total} 项 · {job.label}{running && job.progress.currentTitle ? ` · ${job.progress.currentTitle}` : ""}</small>
      {job.progress.total > 0 && <progress aria-label="整期翻译进度" max={job.progress.total} value={job.progress.translated} />}
      {job.error && <small role="alert">{job.error}</small>}
      {!running && job.progress.failedArticles.length > 0 && <details>
        <summary>{job.progress.failedArticles.length} 篇有失败段落</summary>
        <ul>{job.progress.failedArticles.map((failure, index) => <li key={index}>{failure.title} · {failure.error}</li>)}</ul>
      </details>}
    </div>}
    {open && !running && <div className="issue-translation-options">
      <label>整期正文翻译模型
        <select value={engineId} onChange={event => { setPlan(undefined); setEngineId(event.target.value); }} disabled={loading || !list.length}>
          {!selected && <option value={engineId}>{loading ? "正在读取模型…" : engineId ? "原选模型不可用，请重新选择" : "无可用模型"}</option>}
          {list.map(engine => <option key={engine.id} value={engine.id}>{engine.label}</option>)}
        </select>
      </label>
      {(listError || planError) && <small role="alert">{listError || planError}</small>}
      {selected && !plan && !planError && <small role="status">正在检查已有译文…</small>}
      {plan && <small role="status">{plan.remainingArticles
        ? `待翻译 ${plan.remainingArticles} 篇、约 ${plan.remainingCharacters.toLocaleString("zh-CN")} 字符`
        : "该模型的本期译文已齐全"}</small>}
      {occupied && <small role="status">另一期正在翻译，暂停或完成后可开始本期任务。</small>}
      <button
        type="button" className="primary-button" disabled={loading || occupied || !selected || !plan?.remainingArticles}
        onClick={() => {
          if (!selected || !plan) return;
          setOpen(false);
          void queue.start(issue, selected, plan);
        }}
      >{job?.phase === "partial" ? "重试缺失译文" : "开始翻译"}</button>
    </div>}
  </div>;
}
