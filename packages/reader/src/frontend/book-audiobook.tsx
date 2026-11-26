import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { bookChapterReadingDocumentId } from "../shared/reading-document-identity";
import type { BookLanguage } from "../shared/book-language";
import type { BookRecord } from "../shared/book-data-contract";
import { ChineseReader, type ChineseReaderControls } from "./chinese-reader";
import { CHINESE_LISTENING_KEY, loadChineseListeningRecords, narratableParagraphIndexes, resolveChineseListeningPosition } from "./chinese-listening-state";
import { bookReaderCollection, type ReaderDocumentView } from "./reading-document-view";
import { getReaderStorage } from "./reader-storage";
import type { AudiobookAction, AudiobookControlsState, AudiobookMode, AudiobookPhase, AudiobookSmartSkip, AudiobookSnapshot } from "../shared/audiobook-bridge";
import { loadAudiobookSmartSkip, saveAudiobookSmartSkip } from "./audiobook-smart-skip";
import { isListeningTranslationEngine, loadListeningTranslationEngine } from "./chinese-translation-reuse";
import { renderBookLayout } from "./book-table";
import { bookCoverUrl, issueCoverUrl } from "./api";
import { buildAudiobookBookMetrics, calculateAudiobookProgress } from "./audiobook-progress";
import { HighlightedSpeechText } from "./highlighted-speech-text";
import { resolveSpeechChunkForOffset, type SpeechChunkTarget } from "./audiobook-sync-highlight";
import { copyTextToClipboard } from "./clipboard";
import { loadChineseAudiobookPreferences } from "./chinese-audiobook-preferences";
import { PaginatedReadingFrame, type PaginatedReadingHandle } from "./paginated-reading-frame";
import { ReaderAppearanceDrawer } from "./reader-appearance-drawer";
import { DEFAULT_READER_PREFERENCES, type ReaderPreferences } from "./reader-preferences";

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

export function bookListeningLocation(
  book: Pick<BookRecord, "id">,
  mode: AudiobookMode,
): { chapterId: string; completed: boolean; updatedAt: number } | undefined {
  const position = mostRecentPosition(book, mode);
  if (!position) return undefined;
  const prefix = `reading:book:${book.id}:`;
  if (!position.documentId.startsWith(prefix)) return undefined;
  const chapterId = position.documentId.slice(prefix.length);
  if (!chapterId) return undefined;
  return {
    chapterId,
    completed: Boolean(position.completed),
    updatedAt: position.updatedAt ?? 0,
  };
}

export function bookListeningChapterId(book: BookRecord) {
  const position = mostRecentPosition(book, "translation");
  return position && book.chapters.find(chapter => bookChapterReadingDocumentId(book.id, chapter.id) === position.documentId)?.id;
}

export function bookListeningActivity(book: Pick<BookRecord, "id">, mode: AudiobookMode): number | undefined {
  const position = mostRecentPosition(book, mode);
  return position ? position.updatedAt ?? 0 : undefined;
}

export interface AudiobookStart {
  chapterId: string;
  paragraphIndex: number;
  chunkIndex?: number;
  chunkText?: string;
  speechOffset?: number;
  preferSavedPosition?: boolean;
}

function startChunkFrom(position?: AudiobookStart): SpeechChunkTarget | undefined {
  if (!position) return undefined;
  if (position.chunkIndex === undefined && !position.chunkText && !position.speechOffset) return undefined;
  return {
    chunkIndex: position.chunkIndex ?? 0,
    chunkText: position.chunkText ?? "",
    speechOffset: position.speechOffset ?? 0,
  };
}

export type AudiobookCommand = AudiobookAction | { type: "play-from"; position: AudiobookStart };

export type AudiobookSource =
  | { kind: "book"; book: BookRecord; translationEngineId?: string }
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
  const [smartSkip, setSmartSkip] = useState<AudiobookSmartSkip>(() => loadAudiobookSmartSkip(getReaderStorage()));
  const chapters = useMemo(() => {
    if (source.kind === "magazine") {
      const playable = narratableParagraphIndexes(source.article, { skipTables: smartSkip.tables });
      return playable.length ? [{ document: source.article, first: playable[0], playable, role: undefined }] : [];
    }
    const { book } = source;
    const documents = bookReaderCollection(book).documents;
    const roles = new Map(book.chapters.map(chapter => [chapter.id, chapter.role]));
    return documents.flatMap(document => {
      const playable = narratableParagraphIndexes(document, { skipTables: smartSkip.tables });
      return playable.length ? [{ document, first: playable[0], playable, role: roles.get(document.id) }] : [];
    });
  }, [source, smartSkip.tables]);
  const playlist = useMemo(() => {
    const story = chapters.filter(({ document, role }) =>
      role !== "frontmatter" &&
      !/^(?:封面|版权(?:页|信息|声明)?|版權(?:頁|資訊|聲明)?|目[录錄]|目录页|目錄頁|扉页|扉頁|cover|copyright|table of contents|title page)$/i.test(document.title.trim()));
    return story.length ? story : chapters;
  }, [chapters]);
  const bookMetrics = useMemo(
    () => buildAudiobookBookMetrics(
      chapters.map(({ document, playable }) => ({ id: document.id, paragraphs: document.paragraphs, playable })),
      playlist.map(({ document, playable }) => ({ id: document.id, paragraphs: document.paragraphs, playable })),
    ),
    [chapters, playlist],
  );
  const storageKey = source.kind === "book" ? listeningKey(source.book, mode) : CHINESE_LISTENING_KEY;
  const [selection, setSelection] = useState<{
    id?: string;
    startAt?: number;
    startChunk?: SpeechChunkTarget;
    autoplay: boolean;
    resumePosition?: ReturnType<typeof resolveChineseListeningPosition>;
  }>(() => {
    const requested = start && chapters.find(chapter => chapter.document.id === start.chapterId);
    if (start && !start.preferSavedPosition) {
      const startAt = requested?.playable.find(index => index >= start.paragraphIndex);
      const startChunk = startAt === start.paragraphIndex ? startChunkFrom(start) : undefined;
      return { id: startAt === undefined ? undefined : requested?.document.id, startAt, startChunk, autoplay: startAt !== undefined };
    }
    const storage = getReaderStorage();
    const records = loadChineseListeningRecords(storage, storageKey);
    const chapterRecords = records.length || mode === "original" ? records : loadChineseListeningRecords(storage);
    for (const record of chapterRecords) {
      const match = chapters.find(chapter => chapter.document.identity.documentId === record.documentId);
      if (!match) continue;
      const resolved = resolveChineseListeningPosition([record], record.documentId, match.document.paragraphs);
      if (!resolved) continue;
      const startAt = match.playable.find(index => index >= resolved.paragraphIndex);
      if (!resolved.completed && startAt !== undefined) {
        if (startAt === resolved.paragraphIndex) return { id: match.document.id, startAt: undefined, autoplay: true, resumePosition: resolved };
        return { id: match.document.id, startAt, autoplay: true };
      }
      const next = playlist.find(chapter => chapter.document.id === match.document.id);
      const following = next && playlist[playlist.indexOf(next) + 1];
      if (following) return { id: following.document.id, startAt: following.first, autoplay: true };
      if (startAt !== resolved.paragraphIndex) return { id: undefined, startAt: undefined, autoplay: false };
      return { id: match.document.id, startAt: undefined, autoplay: source.kind === "magazine", resumePosition: resolved };
    }
    const first = requested ?? playlist[0];
    const startAt = requested && start ? requested.playable.find(index => index >= start.paragraphIndex) : first?.first;
    return { id: startAt === undefined ? undefined : first?.document.id, startAt, autoplay: startAt !== undefined };
  });
  const [engineId, setEngineId] = useState(() => mode === "translation"
    ? source.translationEngineId ?? loadListeningTranslationEngine(getReaderStorage())
    : undefined);
  const [engineError, setEngineError] = useState("");
  const [engineAttempt, setEngineAttempt] = useState(0);
  useEffect(() => {
    if (mode !== "translation" || engineId || !chapters.length) return;
    const cancel = new AbortController();
    setEngineError("");
    void (async () => {
      const response = await fetch("/api/vantilo-translation/engines", { cache: "no-store", signal: cancel.signal });
      if (!response.ok) throw new Error("无法读取翻译模型，请重试。");
      const value = await response.json();
      if (cancel.signal.aborted) return;
      if (!isListeningTranslationEngine(value?.defaultId)) throw new Error("请先在阅读设置中配置翻译模型，再重试。");
      setEngineId(value.defaultId);
    })().catch(error => {
      if (!cancel.signal.aborted) setEngineError(error instanceof Error ? error.message : "无法读取翻译模型。");
    });
    const onApiUpdated = () => setEngineAttempt(attempt => attempt + 1);
    window.addEventListener("vantilo-custom-api-updated", onApiUpdated);
    return () => {
      cancel.abort();
      window.removeEventListener("vantilo-custom-api-updated", onApiUpdated);
    };
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
        const startAt = chapter.playable.find(index => index >= action.position.paragraphIndex);
        if (startAt === undefined) break;
        const startChunk = startAt === action.position.paragraphIndex ? startChunkFrom(action.position) : undefined;
        lastActivity.current = Date.now();
        if (chapter === current && player.current) player.current.playFrom(startAt, startChunk);
        else setSelection({ id: chapter.document.id, startAt, startChunk, autoplay: true });
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
      case "smart-skip":
        try { saveAudiobookSmartSkip(getReaderStorage(), action.settings); } catch { /* Still apply for this session. */ }
        setSmartSkip(action.settings);
        player.current?.changeSmartSkip(action.settings);
        break;
    }
  });

  useEffect(() => {
    const state = currentPlayback;
    const preferences = state ?? loadChineseAudiobookPreferences(getReaderStorage());
    const failure = !current ? "当前内容没有可朗读的正文。" : engineError;
    const phase = state?.phase ?? (failure ? "error" : !engineId && mode === "translation" && !selection.autoplay ? "paused" : "loading");
    const activeParagraph = state?.paragraphIndex ?? initialParagraph;
    const progressPercent = calculateAudiobookProgress(bookMetrics, chapterId, activeParagraph, phase);
    const progressScope = progressPercent === undefined ? undefined : (source.kind === "magazine" ? "article" : "book");
    onState({
      ...(state ? { ...state, error: state.error.slice(0, 512) } : { phase, rate: preferences.rate, voice: preferences.voice,
        error: failure, paragraphIndex: initialParagraph,
        paragraphNumber: 0, paragraphCount: 0 }),
      sessionId, mode, sourceId: (source.kind === "magazine" ? source.article.identity.documentId : source.book.id).slice(0, 512),
      title: (source.kind === "magazine" ? source.article.titleZh || source.article.title : source.book.title).slice(0, 1024),
      sourceLabel: source.kind === "magazine" ? source.label.slice(0, 1024) : undefined, cover, chapterId, sleepMinutes,
      smartSkip, progressPercent, progressScope,
      chapters: chapters.map(({ document }) => ({ id: document.id, title: document.title.slice(0, 1024) })),
    });
  }, [source, bookMetrics, chapterId, chapters, cover, current, currentPlayback, engineId, engineError, initialParagraph, mode, onState, selection.autoplay, sessionId, sleepMinutes, smartSkip]);

  useEffect(() => {
    if (mode !== "translation" || !current) return;
    const state = currentPlayback;
    const phase: AudiobookPhase = state?.phase ?? (engineError ? "error" : !engineId && !selection.autoplay ? "paused" : "loading");
    onTranscript({ sessionId, sourceTitle: source.kind === "magazine" ? source.label : source.book.title, article: current.document,
      error: state?.error || engineError, phase, paragraphIndex: state?.paragraphIndex ?? initialParagraph,
      chunkIndex: state?.chunkIndex, chunkText: state?.chunkText,
      chunkSeconds: state?.chunkSeconds, chunkDuration: state?.chunkDuration,
      paragraphs: translated?.chapterId === chapterId ? translated.paragraphs : {},
    });
  }, [mode, current, chapterId, currentPlayback, initialParagraph, onTranscript, source, sessionId, translated, engineError, engineId, selection.autoplay]);

  if (!current || (mode === "translation" && !engineId)) return null;
  return <ChineseReader key={chapterId} article={current.document} initialParagraph={current.first} translationEngineId={engineId}
    onComplete={() => {
      const index = playlist.indexOf(current);
      const next = index >= 0 ? playlist[index + 1] : playlist.find(chapter => chapters.indexOf(chapter) > chapters.indexOf(current));
      if (next) setSelection({ id: next.document.id, startAt: next.first, autoplay: !sleepAt || sleepAt > Date.now() });
    }}
    audiobook={{ mode, storageKey, activityAt, legacyPosition: selection.resumePosition, onTexts: mode === "translation" ? reportTexts : undefined, startAt: selection.startAt, startChunk: selection.startChunk, smartSkip, autoplay: selection.autoplay, sleepAt,
      onSleep: () => { setSleepAt(null); setSleepMinutes(0); }, controlsRef: player, onState: reportState,
    }} />;
}

export interface AudiobookTranscript {
  sessionId: number;
  sourceTitle: string;
  article: ReaderDocumentView;
  error: string;
  phase?: AudiobookPhase;
  paragraphIndex: number;
  chunkIndex?: number;
  chunkText?: string;
  chunkSeconds?: number;
  chunkDuration?: number;
  paragraphs: Readonly<Record<number, string>>;
}

interface TranscriptSelectionMenuState {
  paragraphIndex: number;
  selectedText: string;
  chunk?: SpeechChunkTarget;
  left: number;
  top: number;
  placement: "below" | "above";
}

function closestElementFromNode(node: Node | null): Element | null {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

export interface TranscriptChapterItem {
  id: string;
  title: string;
  titleZh?: string;
  weight?: number;
}

export function ReaderAudiobookTranscript({
  transcript,
  scrollSequence,
  active,
  following,
  onBack,
  onPlayFrom,
  chapters,
  onSelectChapter,
  preferences = DEFAULT_READER_PREFERENCES,
  onPreferencesChange,
  progressPercent,
  globalNavigation,
}: {
  transcript: AudiobookTranscript;
  scrollSequence: number;
  active: boolean;
  following: boolean;
  onBack: () => void;
  onPlayFrom: (paragraphIndex: number, chunk?: SpeechChunkTarget) => void;
  chapters?: TranscriptChapterItem[];
  onSelectChapter?: (chapterId: string) => void;
  preferences?: ReaderPreferences;
  onPreferencesChange?: (patch: Partial<ReaderPreferences>) => void;
  progressPercent?: number;
  globalNavigation?: ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const paginationRef = useRef<PaginatedReadingHandle | null>(null);
  const lastLocation = useRef<{ documentId: string; sequence: number }>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [selectionMenu, setSelectionMenu] = useState<TranscriptSelectionMenuState | null>(null);
  const { paragraphIndex } = transcript;
  const documentId = transcript.article.identity.documentId;
  const followParagraphIndex = following ? paragraphIndex : undefined;
  const followChunkIndex = following ? transcript.chunkIndex : undefined;
  const magazine = transcript.article.identity.kind === "article";
  const playable = useMemo(() => new Set(narratableParagraphIndexes(transcript.article)), [transcript.article]);
  const paginatedActive = preferences.layoutMode !== "scroll";
  const translatedCount = Object.keys(transcript.paragraphs).length;
  const isPlaying = active && (transcript.phase ? (transcript.phase === "playing" || transcript.phase === "loading") : true);
  const hasToc = Boolean(chapters && chapters.length > 0 && onSelectChapter);
  const bookPaginationChapters = useMemo(() => {
    if (magazine || !chapters || chapters.length <= 1) return undefined;
    if (!chapters.every((chapter) => typeof chapter.weight === "number" && chapter.weight > 0)) return undefined;
    return chapters.map((chapter) => ({ id: chapter.id, weight: chapter.weight! }));
  }, [magazine, chapters]);

  const captureTranscriptSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectionMenu(null);
      return;
    }
    const selectedText = selection.toString().trim();
    if (!selectedText) {
      setSelectionMenu(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const startBlock = closestElementFromNode(range.startContainer)?.closest<HTMLElement>("[data-transcript-paragraph]");
    if (!startBlock || !root.current?.contains(startBlock)) {
      setSelectionMenu(null);
      return;
    }
    const index = Number(startBlock.dataset.transcriptParagraph);
    if (!Number.isInteger(index) || !playable.has(index)) {
      setSelectionMenu(null);
      return;
    }
    const paragraphText = transcript.paragraphs[index];
    let chunk: SpeechChunkTarget | undefined;
    if (paragraphText) {
      const paragraphElement = startBlock.querySelector("p");
      let charOffset = -1;
      if (paragraphElement && paragraphElement.contains(range.startContainer)) {
        try {
          const prefix = document.createRange();
          prefix.selectNodeContents(paragraphElement);
          prefix.setEnd(range.startContainer, range.startOffset);
          charOffset = prefix.toString().length;
        } catch {
          charOffset = -1;
        }
      }
      chunk = resolveSpeechChunkForOffset(paragraphText, charOffset, selectedText, loadAudiobookSmartSkip(getReaderStorage()));
    }

    const rangeRect = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : undefined;
    const hasRect = Boolean(rangeRect && (rangeRect.width > 0 || rangeRect.height > 0 || rangeRect.top !== 0 || rangeRect.left !== 0));
    const anchorRect = hasRect && rangeRect ? rangeRect : startBlock.getBoundingClientRect();
    const menuWidth = 152;
    const menuHeight = 96;
    const margin = 12;
    const viewportWidth = window.innerWidth || 1280;
    const viewportHeight = window.innerHeight || 800;
    const rawLeft = anchorRect.left + Math.min(anchorRect.width * 0.65, Math.max(0, anchorRect.width - 12));
    const left = Math.round(Math.max(margin, Math.min(viewportWidth - menuWidth - margin, rawLeft)));
    const placeAbove = anchorRect.bottom + 8 + menuHeight > viewportHeight - 84 && anchorRect.top - menuHeight - 8 >= margin;
    const top = Math.round(
      placeAbove
        ? Math.max(margin, anchorRect.top - menuHeight - 8)
        : Math.min(viewportHeight - menuHeight - margin, anchorRect.bottom + 8),
    );

    setSelectionMenu({
      paragraphIndex: index,
      selectedText,
      chunk,
      left,
      top,
      placement: placeAbove ? "above" : "below",
    });
  }, [playable, transcript.paragraphs]);

  useEffect(() => {
    setSelectionMenu(null);
  }, [documentId, preferences.layoutMode]);

  useEffect(() => {
    if (!selectionMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setSelectionMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectionMenu(null);
    };
    const handleSelectionChange = () => {
      const current = window.getSelection();
      if (!current || current.isCollapsed || !current.toString().trim()) {
        setSelectionMenu(null);
      }
    };
    const handleScroll = () => setSelectionMenu(null);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("selectionchange", handleSelectionChange);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("selectionchange", handleSelectionChange);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [selectionMenu]);

  useLayoutEffect(() => {
    const shouldLocate = lastLocation.current?.documentId !== documentId || lastLocation.current.sequence !== scrollSequence;
    if (!shouldLocate && followParagraphIndex === undefined) return;
    const paragraphNode = root.current?.querySelector<HTMLElement>(".is-audiobook-source");
    const target = paragraphNode?.querySelector<HTMLElement>(".audiobook-active-sentence") ?? paragraphNode;
    if (!target) return;
    lastLocation.current = { documentId, sequence: scrollSequence };
    if (!paginationRef.current?.revealElement(target)) {
      const block = target.offsetHeight > window.innerHeight - 160 ? "start" : "center";
      target.scrollIntoView?.({ block, inline: "nearest", behavior: "auto" });
    }
  }, [documentId, scrollSequence, followParagraphIndex, followChunkIndex, paginatedActive]);

  return (
    <div
      className="reader-page-shell is-transcript-page"
      data-theme={preferences.theme}
      lang="zh-CN"
    >
      <div className={`reader-toolbar-hover-dock ${appearanceOpen || tocOpen ? "is-pinned" : ""}`}>
        <div className="reader-toolbar-hover-trigger" aria-hidden="true" />
        <div className="reader-toolbar-hover-panel">
      <div className="reader-toolbar">
        <div className="reader-toolbar-left">
          <button type="button" className="text-button" onClick={onBack}>{magazine ? "← 返回本期目录" : "← 返回书籍"}</button>
          {hasToc && (
            <button
              type="button"
              className={`toolbar-button reader-icon-square-button reader-toc-button ${tocOpen ? "is-active" : ""}`}
              aria-label="目录"
              aria-pressed={tocOpen}
              data-tooltip="目录"
              onClick={() => setTocOpen(current => !current)}
            >
              <svg className="reader-toc-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3.5 5.5H16.5M3.5 10H12.5M3.5 14.5H16.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <div className="reader-toolbar-center">
          <div className="reader-toolbar-title-pill" title={`${transcript.sourceTitle} · 中文译文`}>
            <span className="reader-toolbar-title-text">{transcript.sourceTitle} · 中文译文</span>
            {progressPercent !== undefined && (
              <span className="reader-toolbar-percent-pill" aria-label={magazine ? `本篇进度 ${progressPercent}%` : `全书进度 ${progressPercent}%`}>
                {progressPercent}%
              </span>
            )}
          </div>
        </div>
        <div className="reader-toolbar-actions">
          {onPreferencesChange && (
            <button
              type="button"
              className={`toolbar-button reader-icon-square-button reader-appearance-button ${appearanceOpen ? "is-active" : ""}`}
              aria-label="阅读器设置"
              aria-pressed={appearanceOpen}
              data-tooltip="阅读器设置"
              onClick={() => setAppearanceOpen(current => !current)}
            ><span className="reader-aa-glyph" aria-hidden="true">Aa</span></button>
          )}
          {globalNavigation}
        </div>
      </div>
        </div>
      </div>

      <div className={`reader-workspace ${tocOpen && hasToc ? "has-toc" : ""} ${appearanceOpen ? "has-drawer" : ""}`}>
        {tocOpen && hasToc && chapters && onSelectChapter && (
          <aside className="reader-toc-sidebar" aria-label="目录" data-testid="reader-toc-sidebar">
            <div className="reader-toc-sidebar-header">
              <strong>目录</strong>
              <button type="button" className="icon-button small" aria-label="关闭目录" onClick={() => setTocOpen(false)}>×</button>
            </div>
            <nav className="reader-toc-sidebar-list" aria-label="章节目录">
              {chapters.map((chapter) => {
                const label = chapter.titleZh?.trim() || chapter.title;
                const isCurrent = chapter.id === transcript.article.id;
                return (
                  <button
                    key={chapter.id}
                    type="button"
                    className={`reader-toc-sidebar-item ${isCurrent ? "is-active" : ""}`}
                    aria-current={isCurrent ? "location" : undefined}
                    title={label}
                    onClick={() => onSelectChapter(chapter.id)}
                  >
                    <span>{label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        )}
        <main
          className={`reader-canvas theme-${preferences.theme} width-${preferences.readerWidth} font-${preferences.fontFamily} leading-${preferences.lineHeight} ${paginatedActive ? "is-paginated" : ""}`}
          data-theme={preferences.theme}
          data-paper-tint={preferences.theme === "night" ? preferences.darkTint : preferences.paperTint}
          data-layout-mode={paginatedActive ? preferences.layoutMode : "scroll"}
          data-chinese-indent={String(preferences.chineseIndent)}
          data-reader-width={preferences.readerWidth}
          data-reader-font-family={preferences.fontFamily}
          data-reader-line-height={preferences.lineHeight}
          style={{ "--reader-margin-pct": `${preferences.horizontalMargin}%` } as CSSProperties}
        >
          <section
            ref={root}
            className={`reading-page audiobook-transcript audiobook-transcript-page ${isPlaying ? "is-playing" : ""}`}
            lang="zh-CN"
            data-testid="audiobook-transcript"
            style={{ fontSize: `${preferences.fontSize}px` }}
          >
            <PaginatedReadingFrame
              active={paginatedActive}
              layoutMode={preferences.layoutMode}
              resetKey={documentId}
              measureDeps={[
                preferences.fontSize,
                preferences.fontFamily,
                preferences.lineHeight,
                preferences.horizontalMargin,
                preferences.readerWidth,
                preferences.chineseIndent,
                appearanceOpen,
                tocOpen,
                translatedCount,
              ]}
              previousLabel={magazine ? "上一篇" : "上一章"}
              nextLabel={magazine ? "下一篇" : "下一章"}
              bookPagination={bookPaginationChapters ? {
                chapters: bookPaginationChapters,
                currentChapterId: transcript.article.id,
                fontSize: preferences.fontSize,
                lineHeight: preferences.lineHeight,
                densityScale: 1.45,
              } : undefined}
              enableKeyboard
              controlsRef={paginationRef}
            >
              <header className="chinese-reading-heading">
                <span>{transcript.sourceTitle} · 中文译文</span>
                <h1>{magazine ? transcript.article.titleZh || transcript.article.title : transcript.article.title}</h1>
              </header>
              <div
                className="chinese-reading"
                onMouseUp={captureTranscriptSelection}
                onKeyUp={captureTranscriptSelection}
              >
                {renderBookLayout(transcript.article, index => {
                  const highlighted = index === paragraphIndex;
                  const text = transcript.paragraphs[index];
                  return <div key={index} data-transcript-paragraph={index}
                    className={`chinese-reading-paragraph ${highlighted ? "is-audiobook-source" : ""}`}>
                    {text ? <p>
                      <HighlightedSpeechText
                        text={text}
                        active={highlighted && active}
                        interactiveSentences={isPlaying && playable.has(index)}
                        onSelectSentence={(startOffset, sentenceText) => {
                          setSelectionMenu(null);
                          const chunk = resolveSpeechChunkForOffset(text, startOffset, sentenceText, loadAudiobookSmartSkip(getReaderStorage()));
                          onPlayFrom(index, chunk);
                        }}
                        cursor={{
                          chunkIndex: transcript.chunkIndex,
                          chunkText: transcript.chunkText,
                          chunkSeconds: transcript.chunkSeconds,
                          chunkDuration: transcript.chunkDuration,
                        }}
                      />
                    </p> : <p className="chinese-reading-placeholder">{highlighted && active
                      ? transcript.error || "正在准备本段译文…" : "待翻译"}</p>}
                  </div>;
                })}
              </div>
            </PaginatedReadingFrame>
          </section>
        </main>

        {appearanceOpen && onPreferencesChange && (
          <aside className="reader-drawer" data-testid="reader-drawer">
            <div className="drawer-header">
              <h3>阅读器设置</h3>
              <button type="button" className="icon-button small" aria-label="关闭侧栏" onClick={() => setAppearanceOpen(false)}>×</button>
            </div>
            <ReaderAppearanceDrawer preferences={preferences} onChange={onPreferencesChange} />
          </aside>
        )}
      </div>

      {selectionMenu && (
        <div
          ref={menuRef}
          className={`transcript-selection-menu is-${selectionMenu.placement}`}
          role="menu"
          aria-label="选中文本操作"
          data-testid="transcript-selection-menu"
          style={{ left: `${selectionMenu.left}px`, top: `${selectionMenu.top}px` }}
        >
          <button
            type="button"
            role="menuitem"
            className="transcript-selection-menu-item is-primary"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const { paragraphIndex: targetIndex, chunk } = selectionMenu;
              window.getSelection()?.removeAllRanges();
              setSelectionMenu(null);
              onPlayFrom(targetIndex, chunk);
            }}
          >
            <svg className="transcript-selection-menu-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M6.25 4.75L15.25 10L6.25 15.25V4.75Z" stroke="currentColor" strokeWidth="1.65" strokeLinejoin="round" />
            </svg>
            <span>听此处</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="transcript-selection-menu-item"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const textToCopy = selectionMenu.selectedText;
              window.getSelection()?.removeAllRanges();
              setSelectionMenu(null);
              void copyTextToClipboard(textToCopy).catch(() => {});
            }}
          >
            <svg className="transcript-selection-menu-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="7.25" y="7.25" width="8.5" height="8.5" rx="1.75" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12.75 7.25V5.5C12.75 4.81 12.19 4.25 11.5 4.25H5.5C4.81 4.25 4.25 4.81 4.25 5.5V11.5C4.25 12.19 4.81 12.75 5.5 12.75H7.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span>复制</span>
          </button>
        </div>
      )}
    </div>
  );
}
