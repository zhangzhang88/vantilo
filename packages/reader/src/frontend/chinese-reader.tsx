import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { renderBookLayout, tableParagraphIndexes } from "./book-table";
import type { ReaderDocumentView } from "./reading-document-view";
import { translateParagraph } from "./api";
import { getReaderStorage } from "./reader-storage";
import { findParagraphTranslation, headingTranslationTarget, loadParagraphTranslations, paragraphTranslationTarget, saveParagraphTranslations, upsertParagraphTranslation, type ParagraphTranslationRecord, type ParagraphTranslationTarget } from "./paragraph-translation-state";
import { isChapterNumberParagraph, isTranslatableText } from "../shared/translation-text";
import { ChineseAudioPlayer, type SpeechCursor, type SpeechPhase } from "./chinese-audio-player";
import { loadChineseListeningRecords, resolveChineseListeningPosition, saveChineseListeningPosition, type ChineseListeningPosition } from "./chinese-listening-state";

interface Entry { target: ParagraphTranslationTarget; kind: "title" | "heading" | "paragraph"; index: number; level?: number; }
function entriesFor(article: ReaderDocumentView): Entry[] {
  const entries: Entry[] = [];
  const inTable = new Set((article.tables ?? []).flatMap(tableParagraphIndexes));
  const originalOnly = new Set((article.visuals ?? []).flatMap(visual => [...visual.coveredParagraphIndexes, ...visual.captionParagraphIndexes]));
  let headingIndex = 0;
  const before = new Map<number, Entry[]>();
  let pending: Entry[] = [];
  for (const block of article.blocks) {
    if (block.kind === "heading") {
      pending.push({ target: headingTranslationTarget({ document: article.identity, headingIndex: headingIndex++, sourceText: block.text }), kind: "heading", index: -1, level: block.level });
    } else if (pending.length) { before.set(block.paragraphIndex, pending); pending = []; }
  }
  entries.push({ target: headingTranslationTarget({ document: article.identity, headingIndex, sourceText: article.title }), kind: "title", index: -1 });
  article.paragraphs.forEach((sourceText, index) => {
    entries.push(...before.get(index) ?? []);
    if (originalOnly.has(index)) return;
    if (!inTable.has(index) && (!isTranslatableText(sourceText) || isChapterNumberParagraph(sourceText, index, article.title, article.paragraphs[index + 1]))) return;
    entries.push({ target: paragraphTranslationTarget({ document: article.identity, paragraphIndex: index, sourceText }), kind: "paragraph", index });
  });
  entries.push(...pending);
  return entries;
}
function message(error: unknown) {
  const raw = error instanceof Error ? error.message : "准备失败，请重试。";
  try { const value = JSON.parse(raw); return typeof value.error === "string" ? value.error : raw; } catch { return raw; }
}

export function ChineseReader({ article, initialParagraph, onPosition, onTranslation, onComplete, beforeFirstParagraph, afterParagraph }: {
  article: ReaderDocumentView;
  initialParagraph: number;
  onPosition: (paragraphIndex: number) => void;
  onTranslation: (record: ParagraphTranslationRecord) => void;
  onComplete: () => void;
  beforeFirstParagraph?: ReactNode;
  afterParagraph?: (index: number) => ReactNode;
}) {
  const entries = useMemo(() => entriesFor(article), [article]);
  const paragraphs = entries.filter(entry => entry.kind === "paragraph");
  const saved = useMemo(() => {
    const position = resolveChineseListeningPosition(loadChineseListeningRecords(getReaderStorage()), article.identity.documentId, article.paragraphs);
    return position && paragraphs.some(entry => entry.index === position.paragraphIndex) ? position : undefined;
  }, [article.identity.documentId]);
  const initialIndex = saved?.paragraphIndex ?? (paragraphs.some(entry => entry.index === initialParagraph) ? initialParagraph : paragraphs[0]?.index ?? 0);
  const entryIndex = paragraphs.some(entry => entry.index === initialParagraph) ? initialParagraph : initialIndex;
  const [texts, setTexts] = useState<Record<string, string>>(() => {
    const records = loadParagraphTranslations(getReaderStorage());
    return Object.fromEntries(entries.flatMap(entry => {
      const text = entry.kind === "title" ? article.titleZh : undefined;
      const cached = findParagraphTranslation(records, entry.target)?.translationZh;
      const ready = text || cached || (!/\p{Script=Latin}/u.test(entry.target.sourceText) ? entry.target.sourceText : "");
      return ready ? [[entry.target.key, ready]] : [];
    }));
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<SpeechPhase>("idle");
  const [audioError, setAudioError] = useState("");
  const [selected, setSelected] = useState(initialIndex);
  const [rate, setRate] = useState(saved?.rate ?? 1);
  const callbacks = useRef({ onPosition, onTranslation, onComplete }); callbacks.current = { onPosition, onTranslation, onComplete };
  const textsRef = useRef(texts); textsRef.current = texts;
  const rateRef = useRef(rate); rateRef.current = rate;
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const cursor = useRef<SpeechCursor>(saved ?? { paragraphIndex: initialIndex, chunkIndex: 0 });
  const player = useRef<ChineseAudioPlayer | null>(null);
  const root = useRef<HTMLElement>(null);
  const ensureText = useRef<(entry: Entry) => Promise<string>>(async () => "");
  const persisted = useRef<ChineseListeningPosition | undefined>(saved);
  const lastWrite = useRef(0);
  const completed = useRef(saved?.completed ?? false);
  const explicitParagraph = useRef<number | null>(null);
  useEffect(() => { const pause = () => player.current?.pause(); window.addEventListener("magazine-reader:pause-chinese-audio", pause); return () => window.removeEventListener("magazine-reader:pause-chinese-audio", pause); }, []);

  useEffect(() => {
    const lifetime = new AbortController();
    const pending = new Map<string, Promise<string>>();
    const ensure = (entry: Entry): Promise<string> => {
      const key = entry.target.key;
      if (textsRef.current[key]) return Promise.resolve(textsRef.current[key]);
      const cached = findParagraphTranslation(loadParagraphTranslations(getReaderStorage()), entry.target);
      if (cached) { textsRef.current = { ...textsRef.current, [key]: cached.translationZh }; setTexts(textsRef.current); return Promise.resolve(cached.translationZh); }
      if (pending.has(key)) return pending.get(key)!;
      const request = (async () => {
        try {
          setErrors(current => { const next = { ...current }; delete next[key]; return next; });
          const result = await translateParagraph({ text: entry.target.sourceText,
            ...(entry.kind === "paragraph" ? { contextBefore: article.paragraphs[entry.index - 1], contextAfter: article.paragraphs[entry.index + 1] } : {}) }, lifetime.signal);
          if (lifetime.signal.aborted) throw new DOMException("Cancelled", "AbortError");
          if (!result.translation.trim()) throw new Error("这段译文为空，请重试。");
          const record: ParagraphTranslationRecord = { ...entry.target, translationZh: result.translation, model: result.model, provider: result.provider, profileId: result.profileId, generatedAt: new Date().toISOString() };
          saveParagraphTranslations(getReaderStorage(), upsertParagraphTranslation(loadParagraphTranslations(getReaderStorage()), record));
          textsRef.current = { ...textsRef.current, [key]: record.translationZh }; setTexts(textsRef.current);
          callbacks.current.onTranslation(record);
          return record.translationZh;
        } catch (error) {
          if (!lifetime.signal.aborted) setErrors(current => ({ ...current, [key]: message(error) }));
          throw error;
        } finally { pending.delete(key); }
      })();
      pending.set(key, request);
      return request;
    };
    ensureText.current = ensure;
    const publish = (position: SpeechCursor, seconds: number, finished: boolean) => {
      if (lifetime.signal.aborted) return;
      const changed = cursor.current.paragraphIndex !== position.paragraphIndex || cursor.current.chunkIndex !== position.chunkIndex;
      cursor.current = { ...position, seconds };
      const record: ChineseListeningPosition = { documentId: article.identity.documentId, paragraphIndex: position.paragraphIndex,
        sourceText: article.paragraphs[position.paragraphIndex], chunkIndex: position.chunkIndex, chunkText: position.chunkText ?? "", seconds, rate: rateRef.current, completed: finished };
      completed.current = finished; persisted.current = record;
      if (changed || finished || Date.now() - lastWrite.current > 1000) { saveChineseListeningPosition(getReaderStorage(), record); lastWrite.current = Date.now(); }
      setSelected(position.paragraphIndex);
      if (changed) callbacks.current.onPosition(position.paragraphIndex);
      if (changed) {
        explicitParagraph.current = position.paragraphIndex;
        root.current?.querySelector(`[data-chinese-paragraph="${position.paragraphIndex}"]`)?.scrollIntoView({ block: "center", behavior: "auto" });
      }
    };
    const audio = new ChineseAudioPlayer({ indices: paragraphs.map(entry => entry.index),
      getText: index => ensure(paragraphs.find(entry => entry.index === index)!),
      synthesize: async (text, signal) => {
        const response = await fetch("/api/prep/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, language: "zh-CN" }), signal });
        if (!response.ok) throw new Error(message(new Error(await response.text())));
        if (!response.headers.get("content-type")?.includes("audio/mpeg")) throw new Error("语音服务未返回有效音频，请重试。");
        return response.blob();
      },
      phase: (next, error) => { if (!lifetime.signal.aborted) { setPhase(next); phaseRef.current = next; setAudioError(error ?? ""); if (next === "complete") callbacks.current.onComplete(); } }, position: publish });
    audio.setRate(rateRef.current); player.current = audio;
    // Reading prepares text sequentially. Playback can prioritize its paragraph via the same deduplicated requests.
    void Promise.resolve().then(async () => {
      for (const entry of entries) {
        if (lifetime.signal.aborted) return;
        try { await ensure(entry); } catch { if (lifetime.signal.aborted) return; }
      }
    });
    callbacks.current.onPosition(entryIndex);
    const frame = requestAnimationFrame(() => root.current?.querySelector(`[data-chinese-paragraph="${entryIndex}"]`)?.scrollIntoView({ block: "center" }));
    let scrollFrame = 0, visibleIndex = entryIndex;
    const capture = () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        if (explicitParagraph.current !== null) return;
        const blocks = [...root.current?.querySelectorAll<HTMLElement>("[data-chinese-paragraph]") ?? []];
        const atEnd = (root.current?.getBoundingClientRect().bottom ?? Infinity) <= innerHeight + 2;
        const block = atEnd ? blocks.at(-1) : blocks.find(node => node.getBoundingClientRect().bottom >= 180 && node.getBoundingClientRect().top < innerHeight);
        if (!block) return;
        const index = Number(block.dataset.chineseParagraph);
        const entry = paragraphs.find(item => item.index === index);
        if (index !== visibleIndex && entry && textsRef.current[entry.target.key]) { visibleIndex = index; callbacks.current.onPosition(index); }
        if (atEnd && paragraphs.every(item => textsRef.current[item.target.key])) callbacks.current.onComplete();
      });
    };
    window.addEventListener("scroll", capture, { passive: true });
    const unlock = () => { explicitParagraph.current = null; };
    const unlockKey = (event: KeyboardEvent) => { if (["PageDown", "PageUp", "Home", "End", "ArrowUp", "ArrowDown"].includes(event.key)) unlock(); };
    window.addEventListener("wheel", unlock, { passive: true }); window.addEventListener("touchstart", unlock, { passive: true }); window.addEventListener("keydown", unlockKey);
    const flush = () => { if (persisted.current) saveChineseListeningPosition(getReaderStorage(), { ...persisted.current, rate: rateRef.current }); };
    window.addEventListener("pagehide", flush);
    const visibility = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      audio.stop(); flush(); lifetime.abort(); cancelAnimationFrame(frame); cancelAnimationFrame(scrollFrame);
      window.removeEventListener("scroll", capture);
      window.removeEventListener("wheel", unlock); window.removeEventListener("touchstart", unlock); window.removeEventListener("keydown", unlockKey);
      window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", visibility);
      if (player.current === audio) player.current = null;
    };
  }, [article.identity.documentId]);

  function seek(index: number, play = phaseRef.current === "playing" || phaseRef.current === "loading") {
    player.current?.stop();
    explicitParagraph.current = index;
    cursor.current = { paragraphIndex: index, chunkIndex: 0, seconds: 0 }; completed.current = false; setSelected(index);
    callbacks.current.onPosition(index);
    persisted.current = { documentId: article.identity.documentId, paragraphIndex: index, sourceText: article.paragraphs[index], chunkIndex: 0, chunkText: "", seconds: 0, rate, completed: false };
    saveChineseListeningPosition(getReaderStorage(), persisted.current);
    root.current?.querySelector(`[data-chinese-paragraph="${index}"]`)?.scrollIntoView({ block: "center", behavior: "auto" });
    if (play) { window.dispatchEvent(new Event("magazine-reader:stop-reply-audio")); void player.current?.start(cursor.current); } else { setPhase("idle"); phaseRef.current = "idle"; setAudioError(""); }
  }
  function toggle() {
    if (phase !== "playing" && phase !== "loading") window.dispatchEvent(new Event("magazine-reader:stop-reply-audio"));
    if (phase === "playing" || phase === "loading") player.current?.pause();
    else if (phase === "paused") player.current?.resume();
    else { if (completed.current) cursor.current = { paragraphIndex: paragraphs[0].index, chunkIndex: 0 }; void player.current?.start(cursor.current); }
  }
  const ordinal = paragraphs.findIndex(entry => entry.index === selected);
  const readyCount = paragraphs.filter(entry => texts[entry.target.key]).length;
  const titleEntry = entries.find(entry => entry.kind === "title")!;
  const beforeParagraph = new Map<number, Entry[]>();
  let pendingHeadings: Entry[] = [];
  for (const entry of entries) {
    if (entry.kind === "heading") pendingHeadings.push(entry);
    else if (entry.kind === "paragraph") { beforeParagraph.set(entry.index, pendingHeadings); pendingHeadings = []; }
  }
  const paragraphByIndex = new Map(paragraphs.map(entry => [entry.index, entry]));
  const renderEntry = (entry: Entry) => {
    const text = texts[entry.target.key], error = errors[entry.target.key];
    if (entry.kind === "heading") return <h2 className={`chinese-reading-subheading level-${entry.level}`} key={entry.target.key}>{text || (error ? "标题翻译暂不可用" : "正在准备标题…")}{error && <button onClick={() => void ensureText.current(entry).catch(() => {})}>重试</button>}</h2>;
    return <div className={`chinese-reading-paragraph ${selected === entry.index ? "is-current" : ""} ${phase === "playing" && selected === entry.index ? "is-speaking" : ""}`} data-chinese-paragraph={entry.index} data-paragraph-index={entry.index} key={entry.target.key}>
      <button className="chinese-paragraph-play" aria-label={`从第 ${entry.index + 1} 段开始朗读`} onClick={() => seek(entry.index, true)}>▶</button>
      {text ? <p onClick={() => seek(entry.index)}>{text}</p> : error ? <div className="chinese-reading-error" role="alert">这一段暂未译出：{error}<button onClick={() => void ensureText.current(entry).catch(() => {})}>重试本段</button></div> : <p className="chinese-reading-placeholder">正在准备这一段的中文…</p>}
    </div>;
  };
  return <section ref={root} className="chinese-reading" lang="zh-CN" aria-label="中文阅读">
    <header className="chinese-reading-heading"><span>中文阅读</span><h1>{texts[titleEntry.target.key] || "正在准备中文标题…"}</h1>
      <small role="status">{readyCount < paragraphs.length ? `译文准备中 · ${readyCount}/${paragraphs.length} 段` : "正文译文已就绪"}</small>
      {errors[titleEntry.target.key] && <button onClick={() => void ensureText.current(titleEntry).catch(() => {})}>重试标题翻译</button>}
    </header>
    <div className="chinese-player" role="region" aria-label="中文听书播放器">
      <button aria-label="上一段" disabled={ordinal <= 0} onClick={() => seek(paragraphs[ordinal - 1].index)}>‹</button>
      <button className="chinese-player-toggle" aria-label={phase === "playing" || phase === "loading" ? "暂停朗读" : phase === "paused" ? "继续朗读" : phase === "complete" ? "重新朗读" : "播放中文"} disabled={!paragraphs.length} onClick={toggle}>{phase === "playing" || phase === "loading" ? "Ⅱ" : "▶"}</button>
      <button aria-label="下一段" disabled={ordinal >= paragraphs.length - 1} onClick={() => seek(paragraphs[ordinal + 1].index)}>›</button>
      <span role="status">{phase === "loading" ? "正在准备音频…" : phase === "paused" ? "已暂停" : phase === "complete" ? "已听完" : phase === "playing" ? "正在朗读" : "听书"}<small>第 {ordinal + 1}/{paragraphs.length} 段</small></span>
      <details><summary aria-label="朗读设置">⚙</summary><div className="chinese-player-settings"><label>语速<select aria-label="朗读语速" value={rate} onChange={event => {
        const value = Number(event.target.value); setRate(value); rateRef.current = value; player.current?.setRate(value);
        const position = persisted.current ?? { documentId: article.identity.documentId, paragraphIndex: selected, sourceText: article.paragraphs[selected], chunkIndex: 0, chunkText: "", seconds: 0, rate: value, completed: false };
        if (position.sourceText !== undefined) { persisted.current = { ...position, rate: value }; saveChineseListeningPosition(getReaderStorage(), persisted.current); }
      }}>{[.75, 1, 1.25, 1.5].map(value => <option value={value} key={value}>{value}×</option>)}</select></label><small>Ciallo TTS · 晓辰多语言<br />音频仅临时播放，退出后释放。</small></div></details>
    </div>
    {audioError && <p role="alert" className="chinese-reading-error">{audioError} 点击播放可重试。</p>}
    {beforeFirstParagraph}
    {renderBookLayout(article, index => <Fragment key={index}>{paragraphByIndex.has(index) ? renderEntry(paragraphByIndex.get(index)!) : null}{afterParagraph?.(index)}</Fragment>,
      index => <Fragment key={index}>{(beforeParagraph.get(index) ?? []).map(renderEntry)}</Fragment>,
      index => <p data-paragraph-index={index} key={index}>{article.paragraphs[index]}</p>)}
    {pendingHeadings.map(renderEntry)}
  </section>;
}
