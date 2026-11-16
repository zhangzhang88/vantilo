import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import type { BookLanguage } from "../shared/book-language";
import type { BookRecord } from "../shared/book-data-contract";
import { ChineseReader, firstNarratableParagraph, narratableParagraphIndexes, type ChineseReaderControls } from "./chinese-reader";
import { CHINESE_LISTENING_KEY, loadChineseListeningRecords, resolveChineseListeningPosition } from "./chinese-listening-state";
import { bookReaderCollection, type ReaderDocumentView } from "./reading-document-view";
import { getReaderStorage } from "./reader-storage";
import type { AudiobookAction, AudiobookControlsState, AudiobookMode, AudiobookSnapshot } from "../shared/audiobook-bridge";
import { isListeningTranslationEngine, loadListeningTranslationEngine } from "./chinese-translation-reuse";
import { renderBookLayout } from "./book-table";
import { bookCoverUrl, issueCoverUrl } from "./api";
import { loadChineseAudiobookPreferences } from "./chinese-audiobook-preferences";

export function bookAudiobookMode(language: BookLanguage): AudiobookMode {
  return language === "zh" ? "original" : "translation";
}

function listeningKey(book: Pick<BookRecord, "id">, mode: AudiobookMode) {
  const prefix = mode === "original" ? "vantilo-book-audiobook-v1:" : "vantilo-book-translated-audiobook-v1:";
  return prefix + book.id;
}

function mostRecentPosition(book: Pick<BookRecord, "id">, mode: AudiobookMode) {
  const storage = getReaderStorage();
  return loadChineseListeningRecords(storage, listeningKey(book, mode))[0]
    ?? (mode === "translation" ? loadChineseListeningRecords(storage).find(record => record.documentId.startsWith(`reading:book:${book.id}:`)) : undefined);
}

export function hasBookListeningPosition(book: Pick<BookRecord, "id">, mode: AudiobookMode) {
  return Boolean(mostRecentPosition(book, mode));
}

export function bookListeningActivity(book: Pick<BookRecord, "id">, mode: AudiobookMode): number | undefined {
  const position = mostRecentPosition(book, mode);
  return position ? position.updatedAt ?? 0 : undefined;
}

export interface AudiobookStart {
  chapterId: string;
  paragraphIndex: number;
  preferSavedPosition?: boolean;
}

export type AudiobookCommand = AudiobookAction | { type: "play-from"; position: AudiobookStart };

export type AudiobookSource =
  | { kind: "book"; book: BookRecord }
  | { kind: "magazine"; issueId: string; label: string; article: ReaderDocumentView; translationEngineId?: string };

export function ReaderAudiobook({ source, mode, start, sessionId, controlsRef, onState, onTranscript, onReturn, onClose }: {
  source: AudiobookSource;
  mode: AudiobookMode;
  start?: AudiobookStart;
  sessionId: number;
  controlsRef: Ref<(action: AudiobookCommand) => void>;
  onState: (snapshot: AudiobookSnapshot) => void;
  onTranscript: (value: AudiobookTranscript) => void;
  onReturn: (source: AudiobookSource, position: AudiobookStart, destination: AudiobookMode) => void;
  onClose: () => void;
}) {
  const chapters = useMemo(() => {
    if (source.kind === "magazine") {
      const first = firstNarratableParagraph(source.article);
      return first === undefined ? [] : [{ document: source.article, first, role: undefined }];
    }
    const { book } = source;
    const documents = bookReaderCollection(book).documents;
    const roles = new Map(book.chapters.map(chapter => [chapter.id, chapter.role]));
    return documents.flatMap(document => {
      const first = firstNarratableParagraph(document);
      return first === undefined ? [] : [{ document, first, role: roles.get(document.id) }];
    });
  }, [source]);
  const story = chapters.filter(({ document, role }) =>
    role !== "frontmatter" &&
    !/^(?:封面|版权(?:页|信息|声明)?|版權(?:頁|資訊|聲明)?|目[录錄]|目录页|目錄頁|扉页|扉頁|cover|copyright|table of contents|title page)$/i.test(document.title.trim()));
  const playlist = story.length ? story : chapters;
  const storageKey = source.kind === "book" ? listeningKey(source.book, mode) : CHINESE_LISTENING_KEY;
  const [selection, setSelection] = useState(() => {
    const requested = start && chapters.find(chapter => chapter.document.id === start.chapterId);
    if (requested && start && !start.preferSavedPosition) {
      return { id: requested.document.id, startAt: firstNarratableParagraph(requested.document, start.paragraphIndex) ?? requested.first, autoplay: true };
    }
    const storage = getReaderStorage();
    const records = loadChineseListeningRecords(storage, storageKey);
    const chapterRecords = records.length || mode === "original" ? records : loadChineseListeningRecords(storage);
    for (const record of chapterRecords) {
      const match = chapters.find(chapter => chapter.document.identity.documentId === record.documentId);
      if (!match) continue;
      const resolved = resolveChineseListeningPosition([record], record.documentId, match.document.paragraphs);
      if (!resolved || firstNarratableParagraph(match.document, resolved.paragraphIndex) !== resolved.paragraphIndex) continue;
      if (!record.completed) return { id: match.document.id, startAt: undefined, autoplay: true, resumePosition: resolved };
      const next = playlist.find(chapter => chapter.document.id === match.document.id);
      const following = next && playlist[playlist.indexOf(next) + 1];
      if (following) return { id: following.document.id, startAt: following.first, autoplay: true };
      return { id: match.document.id, startAt: undefined, autoplay: source.kind === "magazine", resumePosition: resolved };
    }
    const first = playlist[0];
    return { id: first?.document.id,
      startAt: first && start ? firstNarratableParagraph(first.document, start.paragraphIndex) ?? first.first : first?.first,
      autoplay: true };
  });
  const [engineId, setEngineId] = useState(() => mode === "translation"
    ? (source.kind === "magazine" ? source.translationEngineId : undefined) ?? loadListeningTranslationEngine(getReaderStorage())
    : undefined);
  const [engineError, setEngineError] = useState("");
  const [engineAttempt, setEngineAttempt] = useState(0);
  useEffect(() => {
    if (mode !== "translation" || engineId || !chapters.length) return;
    const cancel = new AbortController();
    setEngineError("");
    void (async () => {
      const response = await fetch("/api/vantilo-translation/engines", { signal: cancel.signal });
      if (!response.ok) throw new Error("无法读取翻译模型，请重试。");
      const value = await response.json();
      if (cancel.signal.aborted) return;
      if (!isListeningTranslationEngine(value?.defaultId)) throw new Error("请先在阅读设置中配置翻译模型，再重试。");
      setEngineId(value.defaultId);
    })().catch(error => {
      if (!cancel.signal.aborted) setEngineError(error instanceof Error ? error.message : "无法读取翻译模型。");
    });
    return () => cancel.abort();
  }, [mode, engineId, engineAttempt, chapters.length]);
  const coverUrl = source.kind === "magazine" ? issueCoverUrl(source.issueId) : source.book.cover ? bookCoverUrl(source.book.id) : undefined;
  const [cover, setCover] = useState<string>();
  useEffect(() => {
    if (!coverUrl) return;
    const cancel = new AbortController();
    void (async () => {
      const response = await fetch(coverUrl, { signal: cancel.signal });
      if (!response.ok || Number(response.headers.get("Content-Length")) > 2_000_000) return;
      const blob = await response.blob();
      if (cancel.signal.aborted || blob.size > 2_000_000) return;
      const image = await createImageBitmap(blob, { resizeWidth: 48, resizeHeight: 60 });
      try {
        if (cancel.signal.aborted) return;
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        if (context) {
          context.drawImage(image, 0, 0);
          setCover(canvas.toDataURL());
        }
      } finally { image.close(); }
    })().catch(() => {});
    return () => cancel.abort();
  }, [coverUrl]);

  const [sleepAt, setSleepAt] = useState<number | null>(null);
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const [playback, setPlayback] = useState<{ chapterId: string; state: AudiobookControlsState }>();
  const player = useRef<ChineseReaderControls>(null);
  const [initialActivity] = useState(Date.now);
  const lastActivity = useRef(initialActivity);
  const activityAt = useCallback(() => lastActivity.current, []);
  const current = chapters.find(chapter => chapter.document.id === selection.id);
  const chapterId = current?.document.id ?? "";
  const currentPlayback = playback?.chapterId === chapterId ? playback.state : undefined;
  const initialParagraph = selection.startAt ?? selection.resumePosition?.paragraphIndex ?? current?.first ?? 0;
  const [translated, setTranslated] = useState<{ chapterId: string; paragraphs: Readonly<Record<number, string>> }>();
  const reportTexts = useCallback((paragraphs: Readonly<Record<number, string>>) => setTranslated({ chapterId, paragraphs }), [chapterId]);
  const reportState = useCallback((state: AudiobookControlsState) => setPlayback({ chapterId, state }), [chapterId]);

  useImperativeHandle(controlsRef, () => action => {
    switch (action.type) {
      case "toggle":
        if (playback?.state.phase !== "playing" && playback?.state.phase !== "loading") lastActivity.current = Date.now();
        if (player.current) player.current.toggle();
        else if (engineError) setEngineAttempt(attempt => attempt + 1);
        else if (current && mode === "translation") setSelection(selection => ({ ...selection, autoplay: !selection.autoplay }));
        break;
      case "jump": player.current?.jumpBy(action.seconds); break;
      case "rate": player.current?.changeRate(action.value); break;
      case "voice": player.current?.changeVoice(action.value); break;
      case "play-from": {
        const chapter = chapters.find(item => item.document.id === action.position.chapterId);
        if (!chapter) break;
        const startAt = firstNarratableParagraph(chapter.document, action.position.paragraphIndex) ?? chapter.first;
        lastActivity.current = Date.now();
        if (chapter === current && player.current) player.current.playFrom(startAt);
        else setSelection({ id: chapter.document.id, startAt, autoplay: true });
        if (engineError) setEngineAttempt(attempt => attempt + 1);
        break;
      }
      case "return":
      case "return-original": {
        const destination = action.type === "return-original" ? "original" : mode;
        if (current) onReturn(source, { chapterId, paragraphIndex: player.current?.paragraphIndex() ?? currentPlayback?.paragraphIndex ?? initialParagraph }, destination);
        break;
      }
      case "close": onClose(); break;
      case "chapter": {
        const chapter = chapters.find(item => item.document.id === action.id);
        if (chapter && chapter !== current) {
          lastActivity.current = Date.now();
          const autoplay = !player.current || playback?.state.phase === "playing" || playback?.state.phase === "loading";
          setSelection({ id: chapter.document.id, startAt: chapter.first, autoplay });
        }
        break;
      }
      case "sleep":
        setSleepMinutes(action.minutes);
        setSleepAt(action.minutes ? Date.now() + action.minutes * 60_000 : null);
        break;
    }
  });

  useEffect(() => {
    const state = currentPlayback;
    const preferences = state ?? loadChineseAudiobookPreferences(getReaderStorage());
    const failure = !current ? "当前内容没有可朗读的正文。" : engineError;
    onState({
      ...(state ? { ...state, error: state.error.slice(0, 512) } : { phase: failure ? "error" : !engineId && mode === "translation" && !selection.autoplay ? "paused" : "loading", rate: preferences.rate, voice: preferences.voice,
        error: failure, paragraphIndex: initialParagraph,
        paragraphNumber: 0, paragraphCount: 0 }),
      sessionId, mode, sourceId: (source.kind === "magazine" ? source.article.identity.documentId : source.book.id).slice(0, 512),
      title: (source.kind === "magazine" ? source.article.titleZh || source.article.title : source.book.title).slice(0, 1024),
      sourceLabel: source.kind === "magazine" ? source.label.slice(0, 1024) : undefined, cover, chapterId, sleepMinutes,
      chapters: chapters.map(({ document }) => ({ id: document.id, title: document.title.slice(0, 1024) })),
    });
  }, [source, chapterId, chapters, cover, current, currentPlayback, engineId, engineError, initialParagraph, mode, onState, selection.autoplay, sessionId, sleepMinutes]);

  useEffect(() => {
    if (mode !== "translation" || !current) return;
    const state = currentPlayback;
    onTranscript({ sessionId, sourceTitle: source.kind === "magazine" ? source.label : source.book.title, article: current.document,
      error: state?.error || engineError, paragraphIndex: state?.paragraphIndex ?? initialParagraph,
      paragraphs: translated?.chapterId === chapterId ? translated.paragraphs : {},
    });
  }, [mode, current, chapterId, currentPlayback, initialParagraph, onTranscript, source, sessionId, translated, engineError]);

  if (!current || (mode === "translation" && !engineId)) return null;
  return <ChineseReader key={chapterId} article={current.document} initialParagraph={current.first} translationEngineId={engineId}
    onComplete={() => {
      const index = playlist.indexOf(current);
      const next = index >= 0 ? playlist[index + 1] : playlist.find(chapter => chapters.indexOf(chapter) > chapters.indexOf(current));
      if (next) setSelection({ id: next.document.id, startAt: next.first, autoplay: !sleepAt || sleepAt > Date.now() });
    }}
    audiobook={{ mode, storageKey, activityAt, legacyPosition: selection.resumePosition, onTexts: mode === "translation" ? reportTexts : undefined, startAt: selection.startAt, autoplay: selection.autoplay, sleepAt,
      onSleep: () => { setSleepAt(null); setSleepMinutes(0); }, controlsRef: player, onState: reportState,
    }} />;
}

export interface AudiobookTranscript {
  sessionId: number;
  sourceTitle: string;
  article: ReaderDocumentView;
  error: string;
  paragraphIndex: number;
  paragraphs: Readonly<Record<number, string>>;
}

export function ReaderAudiobookTranscript({ transcript, scrollSequence, active, following, onBack, onPlayFrom }: {
  transcript: AudiobookTranscript;
  scrollSequence: number;
  active: boolean;
  following: boolean;
  onBack: () => void;
  onPlayFrom: (paragraphIndex: number) => void;
}) {
  const root = useRef<HTMLElement>(null);
  const lastLocation = useRef<{ documentId: string; sequence: number }>(null);
  const { paragraphIndex } = transcript;
  const documentId = transcript.article.identity.documentId;
  const followParagraphIndex = following ? paragraphIndex : undefined;
  const magazine = transcript.article.identity.kind === "article";
  const playable = useMemo(() => new Set(narratableParagraphIndexes(transcript.article)), [transcript.article]);
  useLayoutEffect(() => {
    const shouldLocate = lastLocation.current?.documentId !== documentId || lastLocation.current.sequence !== scrollSequence;
    if (!shouldLocate && followParagraphIndex === undefined) return;
    const target = root.current?.querySelector<HTMLElement>(".is-audiobook-source");
    if (!target) return;
    lastLocation.current = { documentId, sequence: scrollSequence };
    const block = target.offsetHeight > window.innerHeight - 160 ? "start" : "center";
    target.scrollIntoView({ block, inline: "nearest", behavior: "auto" });
  }, [documentId, scrollSequence, followParagraphIndex]);

  return <section ref={root} className="page audiobook-transcript" lang="zh-CN" data-testid="audiobook-transcript">
    <button type="button" className="text-button" onClick={onBack}>{magazine ? "← 返回本期目录" : "← 返回书籍"}</button>
    <header className="chinese-reading-heading">
      <span>{transcript.sourceTitle} · 中文译文</span>
      <h1>{magazine ? transcript.article.titleZh || transcript.article.title : transcript.article.title}</h1>
    </header>
    <div className="chinese-reading">
      {renderBookLayout(transcript.article, index => {
        const highlighted = index === paragraphIndex;
        const text = transcript.paragraphs[index];
        return <div key={index} data-transcript-paragraph={index}
          className={`chinese-reading-paragraph ${highlighted ? "is-audiobook-source" : ""}`}>
          {text ? <p>{text}</p> : <p className="chinese-reading-placeholder">{highlighted && active
            ? transcript.error || "正在准备本段译文…" : "待翻译"}</p>}
          {playable.has(index) && <button type="button" className="paragraph-listen-button"
            aria-label={`从第 ${index + 1} 段开始听`} onClick={() => onPlayFrom(index)}>▶ 从本段听</button>}
        </div>;
      })}
    </div>
  </section>;
}
