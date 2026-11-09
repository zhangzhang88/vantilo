import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { renderBookLayout, tableParagraphIndexes } from "./book-table";
import type { ReaderDocumentView } from "./reading-document-view";
import { fetchActiveTranslationProfile, translateParagraph } from "./api";
import { getReaderStorage } from "./reader-storage";
import { headingTranslationTarget, titleTranslationTarget, paragraphTranslationTarget, saveParagraphTranslations, translationCacheMetadata, upsertParagraphTranslation, type ParagraphTranslationRecord, type ParagraphTranslationTarget } from "./paragraph-translation-state";
import { chineseTranslationStorage, findListeningTranslation, loadListeningTranslations, restoredListeningTranslations, translateMissingListeningText } from "./chinese-translation-reuse";
import { isChapterNumberParagraph, isTranslatableText } from "../shared/translation-text";
import type { SpeechCursor, SpeechPhase } from "./chinese-audio-types";
import { ChineseStreamingAudioPlayer } from "./chinese-streaming-audio-player";
import { recordChineseAudioDiagnostic } from "./chinese-audio-diagnostics";
import { streamChineseListeningTts } from "./chinese-listening-tts";
import { DEFAULT_QWEN_TTS_VOICE, isChineseAudiobookVoice, isQwenTtsVoice, CHINESE_AUDIOBOOK_VOICES, saveQwenTtsVoice, type ChineseAudiobookVoice } from "../shared/qwen-tts-voices";
import { loadChineseListeningRecords, resolveChineseListeningPosition, saveChineseListeningPosition, splitChineseSpeech, type ChineseListeningPosition } from "./chinese-listening-state";
import { loadChineseAudiobookPreferences, saveChineseAudiobookPreferences } from "./chinese-audiobook-preferences";
import { ChineseListeningPrebuffer } from "./chinese-listening-prebuffer";

interface Entry { target: ParagraphTranslationTarget; kind: "title" | "heading" | "paragraph"; index: number; level?: number; }
function entriesFor(article: ReaderDocumentView): Entry[] {
  const entries: Entry[] = [];
  const inTable = new Set((article.tables ?? []).flatMap(tableParagraphIndexes));
  const originalOnly = new Set((article.visuals ?? []).flatMap(visual => [...visual.coveredParagraphIndexes, ...visual.captionParagraphIndexes]));
  let headingIndex = 0;
  const titleTarget = titleTranslationTarget({ document: article.identity, sourceText: article.title });
  const before = new Map<number, Entry[]>();
  let pending: Entry[] = [];
  for (const block of article.blocks) {
    if (block.kind === "heading") {
      const target = block.text.trim() === article.title.trim() ? titleTarget : headingTranslationTarget({ document: article.identity, headingIndex, sourceText: block.text });
      pending.push({ target, kind: "heading", index: -1, level: block.level });
      headingIndex++;
    } else if (pending.length) { before.set(block.paragraphIndex, pending); pending = []; }
  }
  entries.push({ target: titleTarget, kind: "title", index: -1 });
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

export function ChineseReader({ article, initialParagraph, onPosition, onTranslation, onComplete, beforeFirstParagraph, afterParagraph, translationRecords, translationEngineId }: {
  article: ReaderDocumentView;
  initialParagraph: number;
  onPosition: (paragraphIndex: number) => void;
  onTranslation: (record: ParagraphTranslationRecord) => void;
  onComplete: () => void;
  translationRecords?: ParagraphTranslationRecord[];
  translationEngineId?: string;
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
    const defaults = Object.fromEntries(entries.flatMap(entry => {
      const text = entry.kind === "title" ? article.titleZh : undefined;
      const ready = text || (!/\p{Script=Latin}/u.test(entry.target.sourceText) ? entry.target.sourceText : "");
      return ready ? [[entry.target.key, ready]] : [];
    }));
    if (!translationEngineId) return defaults;
    // Hydrate every already translated paragraph synchronously before the first render.
    // A slow network or missing title cannot hide the completed article behind 0/N.
    const stored = loadListeningTranslations(getReaderStorage(), translationEngineId);
    const cached = restoredListeningTranslations(
      [...(translationRecords ?? []), ...stored],
      entries.map(entry => ({ target: entry.target, contextBefore: entry.kind === "paragraph" ? article.paragraphs[entry.index - 1] : undefined,
        contextAfter: entry.kind === "paragraph" ? article.paragraphs[entry.index + 1] : undefined })),
      true,
    );
    return { ...defaults, ...cached };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<SpeechPhase>("idle");
  const [audioError, setAudioError] = useState("");
  const [selected, setSelected] = useState(initialIndex);
  const [rate, setRate] = useState(() => loadChineseAudiobookPreferences(getReaderStorage()).rate);
  const [voice, setVoice] = useState<ChineseAudiobookVoice>(() => {
    const saved = loadChineseAudiobookPreferences(getReaderStorage()).voice;
    return isChineseAudiobookVoice(saved) ? saved : DEFAULT_QWEN_TTS_VOICE;
  });
  const callbacks = useRef({ onPosition, onTranslation, onComplete }); callbacks.current = { onPosition, onTranslation, onComplete };
  const textsRef = useRef(texts); textsRef.current = texts;
  const rateRef = useRef(rate); rateRef.current = rate;
  const voiceRef = useRef(voice); voiceRef.current = voice;
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const cursor = useRef<SpeechCursor>(saved ?? { paragraphIndex: initialIndex, chunkIndex: 0 });
  const player = useRef<ChineseStreamingAudioPlayer | null>(null);
  const root = useRef<HTMLElement>(null);
  const ensureText = useRef<(entry: Entry) => Promise<string>>(async () => "");
  const persisted = useRef<ChineseListeningPosition | undefined>(saved);
  const lastWrite = useRef(0);
  const completed = useRef(saved?.completed ?? false);
  const explicitParagraph = useRef<number | null>(null);
  const prebuffer = useRef<ChineseListeningPrebuffer | null>(null);
  const warmAheadRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => { const pause = () => player.current?.pause(); window.addEventListener("magazine-reader:pause-chinese-audio", pause); return () => window.removeEventListener("magazine-reader:pause-chinese-audio", pause); }, []);

  useEffect(() => {
    const lifetime = new AbortController();
    const storage = chineseTranslationStorage(getReaderStorage(), translationEngineId);
    const activeProfile = translationEngineId ? undefined : fetchActiveTranslationProfile();
    const pending = new Map<string, Promise<string>>();
    const ensure = async (entry: Entry): Promise<string> => {
      const key = entry.target.key;
      if (textsRef.current[key]) return Promise.resolve(textsRef.current[key]);
      const contextBefore = entry.kind === "paragraph" ? article.paragraphs[entry.index - 1] : undefined;
      const contextAfter = entry.kind === "paragraph" ? article.paragraphs[entry.index + 1] : undefined;
      const config = translationEngineId ? undefined : await activeProfile;
      const cacheContext = { ...config, provider: "easycliproxy", targetLanguage: "zh-CN", promptVersion: "paragraph-translation-v1", contextBefore, contextAfter };
      const cached = findListeningTranslation(loadListeningTranslations(getReaderStorage(), translationEngineId), entry.target, cacheContext, Boolean(translationEngineId));
      if (cached) { textsRef.current = { ...textsRef.current, [key]: cached.translationZh }; setTexts(textsRef.current); return Promise.resolve(cached.translationZh); }
      if (pending.has(key)) return pending.get(key)!;
      const request = (async () => {
        try {
          setErrors(current => { const next = { ...current }; delete next[key]; return next; });
          const result = translationEngineId
            ? await translateMissingListeningText(entry.target.sourceText, translationEngineId, lifetime.signal)
            : await translateParagraph({ text: entry.target.sourceText,
                ...(entry.kind === "paragraph" ? { contextBefore, contextAfter } : {}) }, lifetime.signal, config);
          if (lifetime.signal.aborted) throw new DOMException("Cancelled", "AbortError");
          if (!result.translation.trim()) throw new Error("这段译文为空，请重试。");
          // For a genuinely missing paragraph, use the same active cache-identity
          // metadata as the full-translation path. Existing hits never fetch it.
          const metadataProfile = translationEngineId ? await fetchActiveTranslationProfile() : config;
          if (lifetime.signal.aborted) throw new DOMException("Cancelled", "AbortError");
          const record: ParagraphTranslationRecord = { ...entry.target, translationZh: result.translation, model: result.model, provider: result.provider, profileId: result.profileId,
            ...translationCacheMetadata({ ...metadataProfile, provider: translationEngineId ? "easycliproxy" : result.provider, targetLanguage: "zh-CN", promptVersion: "paragraph-translation-v1", contextBefore, contextAfter }),
            generatedAt: new Date().toISOString() };
          saveParagraphTranslations(storage, upsertParagraphTranslation(loadListeningTranslations(getReaderStorage(), translationEngineId), record));
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
        // Refill the bounded lookahead window as each narrated chunk or
        // paragraph becomes current, instead of warming only at page entry.
        void warmAheadRef.current().catch(() => {});
        root.current?.querySelector(`[data-chinese-paragraph="${position.paragraphIndex}"]`)?.scrollIntoView({ block: "center", behavior: "auto" });
      }
    };
    const warm = new ChineseListeningPrebuffer();
    prebuffer.current = warm;
    // Continuously fill up to four complete, consecutive TTS chunks from the
    // *current* cursor, crossing paragraph boundaries as needed. Keep the
    // window bounded, retire stale voice/seek chunks, and reuse translation
    // and TTS deduplication rather than competing with background translation.
    let warmingVersion = 0;
    const warmFromCursor = async () => {
      const version = ++warmingVersion;
      const chosenVoice = voiceRef.current;
      const selected = { ...cursor.current };
      const stillCurrent = () => !lifetime.signal.aborted && prebuffer.current === warm
        && chosenVoice === voiceRef.current && version === warmingVersion;
      const start = paragraphs.findIndex(entry => entry.index === selected.paragraphIndex);
      if (start < 0) return;
      const queue: Array<{ text: string; voice: ChineseAudiobookVoice }> = [];
      for (let i = start; i < paragraphs.length && queue.length < 4; i++) {
        const entry = paragraphs[i];
        const translated = textsRef.current[entry.target.key];
        if (!translated) {
          // Fetch a missing paragraph without blocking already translated
          // chunks. A successful translation triggers a new full-window pass.
          void ensure(entry).catch(() => {});
          break;
        }
        const chunks = splitChineseSpeech(translated);
        const from = i === start
          ? selected.chunkText && chunks[selected.chunkIndex] !== selected.chunkText ? 0 : selected.chunkIndex
          : 0;
        for (const text of chunks.slice(from)) {
          queue.push({ text, voice: chosenVoice });
          if (queue.length === 4) break;
        }
      }
      if (!stillCurrent()) return;
      // Compute the full lookahead window first. Incrementally retaining
      // [first], [first, second], etc. cancelled active in-flight audio when
      // translations and position updates raced with each other.
      warm.retainWindow(queue);
      for (const item of queue) {
        if (!stillCurrent()) return;
        await warm.prefetch(item.text, item.voice);
        // If a backend was temporarily unavailable, do not immediately flood
        // it with lookahead requests while the player is retrying the current
        // speech unit. Another cursor/translation update can warm the rest.
        if (!warm.isComplete(item.text, item.voice)) return;
      }
    };
    warmAheadRef.current = warmFromCursor;
    void warmFromCursor().catch(() => {});
    const audio = new ChineseStreamingAudioPlayer({ indices: paragraphs.map(entry => entry.index),
      getText: index => ensure(paragraphs.find(entry => entry.index === index)!),
      synthesize: (text, signal) => warm.stream(text, signal, voiceRef.current),
      generationRtf: text => warm.generationRtf(text, voiceRef.current),
      generationFirstFrameMs: text => warm.firstFrameMs(text, voiceRef.current),
      diagnostic: recordChineseAudioDiagnostic,
      phase: (next, error) => { if (!lifetime.signal.aborted) { setPhase(next); phaseRef.current = next; setAudioError(error ?? ""); if (next === "complete") callbacks.current.onComplete(); } },
      position: publish });
    audio.setRate(rateRef.current); player.current = audio;
    const pauseForReply = () => audio.pause();
    window.addEventListener("magazine-reader:pause-chinese-audio", pauseForReply);
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
      warmingVersion++;
      warmAheadRef.current = async () => {};
      audio.stop(); flush(); lifetime.abort(); warm.dispose();
      if (prebuffer.current === warm) prebuffer.current = null;
      cancelAnimationFrame(frame); cancelAnimationFrame(scrollFrame);
      window.removeEventListener("magazine-reader:pause-chinese-audio", pauseForReply);
      window.removeEventListener("scroll", capture);
      window.removeEventListener("wheel", unlock); window.removeEventListener("touchstart", unlock); window.removeEventListener("keydown", unlockKey);
      window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", visibility);
      if (player.current === audio) player.current = null;
    };
  }, [article.identity.documentId, translationEngineId]);

  // A translation may arrive after initial background prewarming failed or
  // after the listener navigated to another paragraph. Prime its PCM as soon
  // as the *current* source text is ready, without waiting for the entire book.
  useEffect(() => {
    void warmAheadRef.current().catch(() => {});
  }, [texts, selected, voice, article.identity.documentId]);

  const hasTranslatedParagraph = (index: number): boolean => {
    const target = paragraphs.find(entry => entry.index === index);
    const translated = target ? textsRef.current[target.target.key] : undefined;
    return Boolean(translated?.trim() && splitChineseSpeech(translated).length);
  };

  function seek(index: number, play = phaseRef.current === "playing" || phaseRef.current === "loading") {
    player.current?.stop();
    prebuffer.current?.reset();
    explicitParagraph.current = index;
    cursor.current = { paragraphIndex: index, chunkIndex: 0, seconds: 0 }; completed.current = false; setSelected(index);
    callbacks.current.onPosition(index);
    void warmAheadRef.current().catch(() => {});
    persisted.current = { documentId: article.identity.documentId, paragraphIndex: index, sourceText: article.paragraphs[index], chunkIndex: 0, chunkText: "", seconds: 0, rate, completed: false };
    saveChineseListeningPosition(getReaderStorage(), persisted.current);
    root.current?.querySelector(`[data-chinese-paragraph="${index}"]`)?.scrollIntoView({ block: "center", behavior: "auto" });
    if (play && hasTranslatedParagraph(index)) {
      window.dispatchEvent(new Event("magazine-reader:stop-word-audio"));
      window.dispatchEvent(new Event("magazine-reader:stop-selection-speech"));
      window.dispatchEvent(new Event("magazine-reader:stop-reply-audio"));
      void player.current?.start(cursor.current);
    } else { setPhase("idle"); phaseRef.current = "idle"; setAudioError(""); }
  }
  function toggle() {
    const startIndex = completed.current ? paragraphs[0]?.index : cursor.current.paragraphIndex;
    if (phase !== "playing" && phase !== "loading" && phase !== "paused" && !hasTranslatedParagraph(startIndex)) return;
    if (phase !== "playing" && phase !== "loading") { window.dispatchEvent(new Event("magazine-reader:stop-word-audio")); window.dispatchEvent(new Event("magazine-reader:stop-selection-speech")); window.dispatchEvent(new Event("magazine-reader:stop-reply-audio")); }
    if (phase === "playing" || phase === "loading") player.current?.pause();
    else if (phase === "paused") player.current?.resume();
    else { if (completed.current) cursor.current = { paragraphIndex: paragraphs[0].index, chunkIndex: 0 }; void player.current?.start(cursor.current); }
  }
  function changeVoice(value: string) {
    if (!isChineseAudiobookVoice(value) || value === voiceRef.current) return;
    const wasPlaying = phaseRef.current === "playing" || phaseRef.current === "loading";
    // Kill the old speaker's queued PCM before starting any new synthesis.
    player.current?.stop();
    prebuffer.current?.reset();
    voiceRef.current = value;
    setVoice(value);
    void warmAheadRef.current().catch(() => {});
    try {
      saveChineseAudiobookPreferences(getReaderStorage(), { version: 1, voice: value, rate: rateRef.current });
      if (isQwenTtsVoice(value)) saveQwenTtsVoice(getReaderStorage(), value);
    } catch { /* Keep current selection usable. */ }
    setAudioError("");
    if (wasPlaying && hasTranslatedParagraph(cursor.current.paragraphIndex)) {
      // Different voices have different timing; start the current chunk from its
      // beginning instead of seeking to an offset in a different speaker's PCM.
      cursor.current = { ...cursor.current, seconds: 0 };
      window.dispatchEvent(new Event("magazine-reader:stop-word-audio"));
      window.dispatchEvent(new Event("magazine-reader:stop-selection-speech"));
      window.dispatchEvent(new Event("magazine-reader:stop-reply-audio"));
      void player.current?.start(cursor.current);
    } else {
      setPhase("idle");
      phaseRef.current = "idle";
    }
  }
  const ordinal = paragraphs.findIndex(entry => entry.index === selected);
  const readyCount = paragraphs.filter(entry => texts[entry.target.key]).length;
  const startIndex = completed.current ? paragraphs[0]?.index : cursor.current.paragraphIndex;
  const startEntry = paragraphs.find(entry => entry.index === startIndex);
  const startText = startEntry ? texts[startEntry.target.key] : undefined;
  const startReady = Boolean(startText?.trim() && splitChineseSpeech(startText).length);
  const canControlPlayback = phase === "playing" || phase === "loading" || phase === "paused";
  const waitingForTranslation = !canControlPlayback && !startReady;
  const translationError = waitingForTranslation && startEntry ? errors[startEntry.target.key] : undefined;
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
      <button className="chinese-paragraph-play" aria-label={`从第 ${entry.index + 1} 段开始朗读`}
        disabled={!Boolean(text?.trim() && splitChineseSpeech(text).length)} onClick={() => seek(entry.index, true)}>▶</button>
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
      <button className="chinese-player-toggle" aria-label={phase === "playing" || phase === "loading" ? "暂停朗读" : phase === "paused" ? "继续朗读" : phase === "complete" ? "重新朗读" : "播放中文"}
        disabled={!paragraphs.length || waitingForTranslation} onClick={toggle}>{phase === "playing" || phase === "loading" ? "Ⅱ" : "▶"}</button>
      <button aria-label="下一段" disabled={ordinal >= paragraphs.length - 1} onClick={() => seek(paragraphs[ordinal + 1].index)}>›</button>
      <span role="status">{phase === "loading" ? "正在准备朗读…"
        : phase === "paused" ? "已暂停" : phase === "complete" ? "已听完" : phase === "playing" ? "正在朗读"
          : waitingForTranslation ? translationError ? "当前段译文准备失败" : "正在准备当前段译文…" : "听书"}
        <small>第 {ordinal + 1}/{paragraphs.length} 段</small></span>
      <details><summary aria-label="朗读设置">⚙</summary><div className="chinese-player-settings"><label>语速<select aria-label="朗读语速" value={rate} onChange={event => {
        const value = Number(event.target.value); setRate(value); rateRef.current = value; player.current?.setRate(value);
        try { saveChineseAudiobookPreferences(getReaderStorage(), { version: 1, voice: voiceRef.current, rate: value }); } catch { /* Still apply rate locally. */ }
        const position = persisted.current ?? { documentId: article.identity.documentId, paragraphIndex: selected, sourceText: article.paragraphs[selected], chunkIndex: 0, chunkText: "", seconds: 0, rate: value, completed: false };
        if (position.sourceText !== undefined) { persisted.current = { ...position, rate: value }; saveChineseListeningPosition(getReaderStorage(), persisted.current); }
      }}>{[.75, 1, 1.25, 1.5].map(value => <option value={value} key={value}>{value}×</option>)}</select></label>
      <label>音色<select aria-label="朗读音色" value={voice} onChange={event => changeVoice(event.target.value)}>
        {CHINESE_AUDIOBOOK_VOICES.map(item =>
          <option key={item.id} value={item.id}>{item.name} · {item.description.split(" · ")[0]}</option>)}
      </select></label>
      <small>本地 Qwen3-TTS · {CHINESE_AUDIOBOOK_VOICES.find(item => item.id === voice)?.name ?? DEFAULT_QWEN_TTS_VOICE}<br />「我的声音」使用独立 bf16 API；切换时从当前句重新播放。</small></div></details>
    </div>
    {translationError && startEntry && <div className="chinese-reading-error" role="alert">
      当前段译文准备失败：{translationError}
      <button type="button" aria-label="重试当前段译文"
        onClick={() => void ensureText.current(startEntry).catch(() => {})}>重试当前段</button>
    </div>}
    {audioError && <p role="alert" className="chinese-reading-error">{audioError} 点击播放可重试。</p>}
    {beforeFirstParagraph}
    {renderBookLayout(article, index => <Fragment key={index}>{paragraphByIndex.has(index) ? renderEntry(paragraphByIndex.get(index)!) : null}{afterParagraph?.(index)}</Fragment>,
      index => <Fragment key={index}>{(beforeParagraph.get(index) ?? []).map(renderEntry)}</Fragment>,
      index => <p data-paragraph-index={index} key={index}>{article.paragraphs[index]}</p>)}
    {pendingHeadings.map(renderEntry)}
  </section>;
}
