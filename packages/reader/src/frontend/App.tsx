import { LessonLearning } from "./lesson-learning";
import { GlobalNavigation } from "./global-navigation";
import { BookDetailTabs, BookLessonsList } from "./book-detail-content";
import { ChineseReader } from "./chinese-reader";
import { renderBookLayout } from "./book-table";
import { BookSourceButton, BookVisual } from "./book-visual";
import { AppAppearanceContext, useSystemDarkMode } from "./appearance-context";
import { BookLibrarySearch } from "./book-library-search";
import { filterBookShelf, type BookShelfView } from "./book-shelf-filter";
import { BOOK_CATEGORIES, bookCategoryLabel, type BookCategoryId } from "../shared/book-category";
import { GlobalReadingList, GlobalContinueCard } from "./global-reading-list";
import { resolveReadingEntry, type ReadingEntryView } from "./global-reading";
import { readingEntryDocument, type ReadingEntry } from "./reading-entry";
import { isDocumentReadLater, toggleDocumentReadLater } from "./read-later-state";
import { recordDocumentHistory } from "./reading-history-state";
import { loadNavigation, saveNavigation, getNavigationStorage, loadReaderView, saveReaderView, saveBookDetailTab, type Page } from "./navigation-state";
import { SentenceExpressionList } from "./sentence-expression-list";
import { saveSentenceExpression, completeSentenceExpressionMeaning, needsContextualMeaningRepair } from "./sentence-expression-vocabulary";
import type { SentenceExpression } from "../shared/types";
import { isChapterNumberParagraph, isTranslatableText } from "../shared/translation-text";
import { articleReadingDocumentIdentity, bookChapterReadingDocumentIdentity, bookLessonReadingDocumentIdentity } from "../shared/reading-document-identity";
import { lessonParagraphs, type BookLesson } from "../shared/book-lesson";
import { deleteBookLesson, deleteScienceArticle, fetchBookLessons, fetchContentDiscovery, fetchScienceArticles, importScienceArticle, refreshContentDiscovery, refreshScienceArticle, updateBookCategory } from "./api";
import { loadLessonReaderState, saveLessonReaderState } from "./lesson-reader-state";
import { loadIssueRecords, type IssueLoadFailure } from "./issue-loading";
import { getReaderStorage } from "./reader-storage";
import { Fragment, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { articleImageUrl, assistSelection, bookCoverUrl, deleteBook, deleteIssue, explainWordContext, fetchArticleImages, fetchBook, fetchBooks, fetchBookTocChinese, fetchGuidePreparationStatus, fetchIssue, fetchIssues, generateBookTocChinese, importBookEpub, importEpub, issueCoverUrl, lookupDictionary, prepareSectionTranslations, previewBookEpubImport, previewEpubImport, previewEpubReplacement, replaceEpub, resumeGuidePreparation, translateParagraph } from "./api";
import type { BookTocChineseStatus } from "../shared/book-toc-chinese";
import {
  articleKey,
  findArticle,
  findIssue,
  flattenArticles,
  resolveIssueContinueArticle,
  toReaderIssue,
  type ReaderArticle,
  type ReaderIssue,
} from "./reader-model";
import {
  clampProgress,
  loadReaderState,
  readingPositionKey,
  readerArticleProgress,
  resolveArticleReadingPosition,
  saveReaderState,
  type ArticleReadingPosition,
  type BookReadingPosition,
  type ReadingPositionAnchor,
  type ReaderStateData,
} from "./reader-state";
import {
  isReadLater,
  loadReadLaterState,
  saveReadLaterState,
  toggleReadLater,
  type ReadLaterState,
} from "./read-later-state";
import {
  clearReadingHistory,
  loadReadingHistoryState,
  saveReadingHistoryState,
  type ReadingHistoryState,
} from "./reading-history-state";
import { loadNotesState, notesStateFromItems, readerNoteBelongsToDocument, readerNoteDocument, removeNoteFromState, resolveNoteAnchor, resolvedAnchoredNotesForDocument, saveNotesState, updateNoteText, type ReaderNote, type ReaderNoteAnchor, type ReaderNoteSelectionAnchor, type ResolvedNoteAnchor } from "./notes-state";
import type { ArticleImage, DictionaryLookupResponse, EpubImportPreview, EpubReplacementPreview, GuidePreparationStatus, IssueRecord } from "../shared/types";
import type { BookImportPreview, BookRecord, BookSummary } from "../shared/book-data-contract";
import type { ContentDiscoverySnapshot, DiscoveryCandidate } from "../shared/content-discovery";
import type { ScienceArticle } from "../shared/science-article";
import { scienceArticleImages } from "../shared/science-article";
import { ScienceArticleContent } from "./science-article-content";
import { scienceArticleGuide, scienceDiscoveryRefreshNotice } from "./science-article-directory";
import { compareScienceCandidatesByRecency, isScienceReadingCandidate } from "../shared/science-article-curation";
import { CodexPrepPanel } from "./codex-prep-panel";
import { BookPrepLayout } from "./book-prep-layout";
import type { AssistantScope } from "../shared/assistant-scope";
import type { ReaderAssistantContext } from "./reader-assistant-context";
import {
  addSavedSelection,
  removeSavedSelectionFromDocument,
  restoreRemovedSelections,
  findSavedTextOccurrences,
  loadSavedSelections,
  saveSavedSelections,
  savedHighlightSegments,
  savedSelectionBelongsToDocument,
  savedSelectionFamiliarity,
  isLearningFamiliarity,
  setSavedSelectionFamiliarity,
  setSavedSelectionTranslation,
  type FamiliarityLevel,
  type SavedSelection,
  type SavedTextOccurrence,
} from "./selection-state";
import {
  findWordContextMeaning,
  hasEnglishWordContext,
  loadWordContextMeanings,
  saveWordContextMeanings,
  sentenceForOccurrence,
  sentenceRangeForOccurrence,
  setWordContextMeaningUserOverride,
  upsertWordContextMeaning,
  wordContextOccurrenceKey,
  type WordContextMeaningRecord,
} from "./word-context-state";
import { clickableWordSegments, isDictionaryWord } from "./word-lookup";
import { PUBLICATIONS } from "../shared/publication";
import type { PublicationId } from "../shared/types";
import { buildPublicationShelf } from "./publication-library";
import { searchMagazineLibrary, searchMatchLabel, type SearchPublicationFilter } from "./full-text-search";
import { mergeSearchRefreshedIssues, searchRefreshIssueIds } from "./library-search-refresh";
import { guidePreparationIssueNeedsRefresh } from "./guide-preparation-refresh";
import {
  buildGlobalVocabularyItems,
  globalVocabularyTextKey,
  vocabularyContextDocument,
  type VocabularySourceId,
  type GlobalVocabularyContext,
  type GlobalVocabularyItem,
} from "./global-vocabulary";
import { buildDueVocabularyReviewQueue, deferCurrentVocabularyReviewKey, preferredVocabularyReviewContext, vocabularyReviewSentenceSegments } from "./vocabulary-review";
import {
  findSentenceTranslation,
  loadSentenceTranslations,
  saveSentenceTranslations,
  sentenceTranslationTarget,
  sentenceTranslationTargetForOccurrence,
  upsertSentenceTranslation,
  type SentenceTranslationRecord,
} from "./sentence-translation-state";
import { buildArticleVocabularyProfile } from "./article-difficulty";
import { filterIssueSections, issueReadingFilterCounts, type IssueReadingFilter } from "./issue-reading-filter";
import {
  findSelectionAssistCachedResult,
  loadSelectionAssistCache,
  saveSelectionAssistCache,
  selectionAssistCacheTarget,
  upsertSelectionAssistCachedResult,
  type SelectionAssistCacheRecord,
} from "./selection-assist-cache";
import { buildReaderSentences, readerSentenceIndexForOffset, readerSentenceProgress } from "./sentence-reading";
import {
  isVocabularyReviewDue,
  loadVocabularyReviewSchedules,
  saveVocabularyReviewSchedules,
  scheduleVocabularyAfterReview,
  type VocabularyReviewScheduleRecord,
} from "./vocabulary-review-schedule";
import {
  loadReaderPreferences,
  saveReaderPreferences,
  resolveReaderTheme,
  type ReaderPreferences,
} from "./reader-preferences";
import { AiProviderSettingsPanel } from "./ai-provider-settings-panel";
import { DataManagementPanel } from "./data-management-panel";
import {
  findParagraphTranslation,
  headingTranslationTarget,
  loadParagraphTranslations,
  paragraphTranslationTarget,
  saveParagraphTranslations,
  upsertParagraphTranslation,
  type ParagraphTranslationRecord,
} from "./paragraph-translation-state";
import { copyTextToClipboard } from "./clipboard";
import { findArticleMatches, type ArticleFindMatch } from "./article-find";
import { createReaderReturnTarget, type ReaderReturnSource, type ReaderReturnTarget } from "./reader-return";
import { resolveParagraphNavigationTarget, type ParagraphNavigationDirection } from "./reader-paragraph-navigation";
import { captureReaderJumpBackTarget, resolveReaderJumpBackTarget, type ReaderJumpBackTarget } from "./reader-jump-back";
import { bookChapterRoleLabel, buildBookTocGroups, resolveBookContinueChapter } from "./book-library";
import { bookReaderCollection, bookLessonReaderCollection, magazineReaderCollection, type ReaderCollectionView, type ReaderDocumentView } from "./reading-document-view.js";

type Drawer = "toc" | "notes" | "vocabulary" | null;
type ReaderMode = "article" | "sentence";
type SelectionCopyState = "idle" | "copied" | "error";
type LibraryPublicationFilter = "all" | PublicationId;

interface NotesViewState {
  query: string;
  publicationFilter: "all" | VocabularySourceId;
}

interface IssueTocViewState {
  issueId: string;
  readingFilter: IssueReadingFilter;
  query: string;
}

function freshIssueTocViewState(issueId = ""): IssueTocViewState {
  return { issueId, readingFilter: "all", query: "" };
}

interface ParagraphTranslationState {
  status: "loading" | "ready" | "error";
  expanded: boolean;
  translation?: string;
  error?: string;
  profileId?: string;
  model?: string;
  generatedAt?: string;
}

type GuideUiState = GuidePreparationStatus;

function readableGuideRequestError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message.trim() : "";
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    if (typeof parsed?.error === "string" && parsed.error.trim()) return parsed.error.trim();
  } catch {
    // Non-JSON request errors are already useful to display as-is.
  }
  return raw;
}

interface ActiveTextSelection {
  text: string;
  context: string;
  paragraphIndex: number;
  top: number;
  startOffset: number;
  endOffset?: number;
  left: number;
}

interface SelectionAssistUiState {
  status: "loading" | "ready" | "error";
  action: "translate" | "explain";
  result?: string;
  error?: string;
  model?: string;
}

type WordLookupStatus = "idle" | "loading" | "ready" | "error";

interface ActiveWordLookup {
  key: string;
  text: string;
  paragraph: string;
  paragraphIndex: number;
  startOffset: number;
  top: number;
  left: number;
  placement: "above" | "below";
  dictionaryStatus: WordLookupStatus;
  dictionary?: DictionaryLookupResponse;
  dictionaryError?: string;
  contextStatus: WordLookupStatus;
  contextMeaning?: WordContextMeaningRecord;
  contextError?: string;
}

interface VocabularySentenceFocus {
  token: number;
  paragraphIndex: number;
  sentenceStart: number;
  sentenceEnd: number;
  stabilizeLayout?: boolean;
}

type VocabularyNavigationDirection = "nearest" | "previous" | "next";

interface VocabularyJumpTarget {
  token: number;
  documentId: string;
  text: string;
  paragraphIndex: number;
  startOffset: number;
}

interface NoteJumpTarget {
  token: number;
  documentId: string;
  noteId: string;
}

interface NoteAnchorFocus {
  token: number;
  paragraphIndex: number;
  stabilizeLayout?: boolean;
}

interface ActiveParagraphCue {
  token: number;
  paragraphIndex: number;
}

type ReaderDrawerLayoutAnchor =
  | { kind: "paragraph"; paragraphIndex: number; viewportY: number; relativeY: number }
  | { kind: "sentence"; viewportY: number; relativeY: number };

interface GlobalVocabularyViewState {
  query: string;
  familiarityFilter: "all" | FamiliarityLevel;
  publicationFilter: "all" | VocabularySourceId;
  expandedKey: string | null;
  selectedKey: string | null;
}

interface LibrarySearchViewState {
  query: string;
  publicationFilter: SearchPublicationFilter;
}

const SAVED_MEANING_HOVER_DELAY_MS = 250;

function SavedSelectionHighlight({
  text,
  displayText,
  translationZh,
  familiarity,
  contextMeaning,
  onResolveContext,
  onOpenLookup,
}: {
  text: string;
  displayText?: React.ReactNode;
  translationZh?: string;
  familiarity: FamiliarityLevel;
  contextMeaning?: WordContextMeaningRecord;
  onResolveContext: () => Promise<WordContextMeaningRecord | undefined>;
  onOpenLookup: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  const [hoverVisible, setHoverVisible] = useState(false);
  const [resolvedContext, setResolvedContext] = useState<WordContextMeaningRecord | undefined>(contextMeaning);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const hoverTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setResolvedContext(contextMeaning);
    setStatus("idle");
  }, [contextMeaning, text]);

  useEffect(() => () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
  }, []);

  async function resolveContextMeaning() {
    if (resolvedContext || status === "loading") return resolvedContext;
    setStatus("loading");
    const resolved = await onResolveContext();
    if (resolved) {
      setResolvedContext(resolved);
      setStatus("idle");
      return resolved;
    }
    setStatus("error");
    return undefined;
  }

  function handleMouseEnter() {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      setHoverVisible(true);
      if (!resolvedContext) void resolveContextMeaning();
    }, SAVED_MEANING_HOVER_DELAY_MS);
  }

  function handleMouseLeave() {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHoverVisible(false);
  }

  function handleClick(event: React.MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    onOpenLookup(event);
  }

  const temporaryMeaning = translationZh?.trim().split(/[；;\n]/)[0]?.slice(0, 80);
  const tooltipText = status === "loading"
    ? temporaryMeaning || "正在分析语境…"
    : status === "error"
      ? temporaryMeaning || "暂时无法分析"
      : temporaryMeaning;

  const userContextMeaning = resolvedContext?.meaningSource === "user" ? resolvedContext.meaningZh?.trim() : undefined;
  const verifiedContextMeaning = resolvedContext?.meaningVersion === 2 ? resolvedContext.meaningZh?.trim() : undefined;
  const inlineMeaning = /\s/.test(text.trim())
    ? userContextMeaning || verifiedContextMeaning || temporaryMeaning || resolvedContext?.meaningZh?.trim()
    : userContextMeaning || resolvedContext?.meaningZh?.trim() || temporaryMeaning;
  if (!inlineMeaning) return <span className="saved-selection-awaiting-meaning" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} onClick={handleClick}>{displayText ?? text}</span>;
  return (
    <ruby className="saved-selection-ruby">
      <mark
        className={`saved-selection-highlight familiarity-${familiarity}`}
        data-saved-highlight="true"
        data-familiarity={familiarity}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {displayText ?? text}
        {hoverVisible && !resolvedContext && tooltipText && (
          <span className={`saved-selection-meaning ${status === "error" ? "is-error" : ""}`} role="tooltip">
            <span className="saved-selection-meaning-text">{tooltipText}</span>
          </span>
        )}
      </mark>
      <rt className="saved-selection-inline-meaning">{inlineMeaning}</rt>
    </ruby>
  );
}

function playWordPronunciation(
  text: string,
  dictionary: DictionaryLookupResponse | undefined,
  accent: "us" | "uk",
) {
  const url = accent === "us" ? dictionary?.usAudioUrl : dictionary?.ukAudioUrl;
  if (url) {
    const audio = new Audio(url);
    void audio.play().catch(() => {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
      const utterance = new window.SpeechSynthesisUtterance(text);
      utterance.lang = accent === "us" ? "en-US" : "en-GB";
      window.speechSynthesis.speak(utterance);
    });
    return;
  }
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
  const utterance = new window.SpeechSynthesisUtterance(text);
  utterance.lang = accent === "us" ? "en-US" : "en-GB";
  window.speechSynthesis.speak(utterance);
}

function WordLookupCard({
  lookup,
  vocabularyMeaning,
  vocabularyMeaningSource,
  familiarity,
  onClose,
  onOpenDetails,
  onFamiliarityChange,
  onContextMeaningChange,
  onVocabularyMeaningChange,
}: {
  lookup: ActiveWordLookup;
  vocabularyMeaning?: string;
  vocabularyMeaningSource?: SavedSelection["translationSource"];
  familiarity: FamiliarityLevel | null;
  onClose: () => void;
  onOpenDetails: () => void;
  onFamiliarityChange: (level: FamiliarityLevel) => void;
  onContextMeaningChange: (meaningZh: string) => void;
  onVocabularyMeaningChange: (meaningZh: string) => void;
}) {
  const dictionary = lookup.dictionary;
  const context = lookup.contextMeaning;
  const [editingContext, setEditingContext] = useState(false);
  const [contextMeaningDraft, setContextMeaningDraft] = useState(context?.meaningZh ?? "");
  const [editingVocabularyMeaning, setEditingVocabularyMeaning] = useState(false);
  const [vocabularyMeaningDraft, setVocabularyMeaningDraft] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setEditingContext(false);
    setContextMeaningDraft(lookup.contextMeaning?.meaningZh ?? "");
  }, [lookup.key]);

  useEffect(() => {
    setEditingVocabularyMeaning(false);
    setVocabularyMeaningDraft("");
  }, [lookup.key]);

  useEffect(() => {
    if (!editingContext) setContextMeaningDraft(context?.meaningZh ?? "");
  }, [context?.meaningZh, editingContext]);

  useEffect(() => {
    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (cardRef.current?.contains(target)) return;
      onClose();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
  }, [onClose]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    let frame = 0;

    const keepInsideReaderViewport = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = card.getBoundingClientRect();
        const margin = 12;
        const toolbar = document.querySelector<HTMLElement>(".reader-toolbar");
        const toolbarBottom = toolbar?.getBoundingClientRect().bottom ?? 0;
        const safeTop = Math.max(margin, toolbarBottom + 8);
        const safeBottom = window.innerHeight - margin;
        const safeLeft = margin;
        const safeRight = window.innerWidth - margin;

        let dx = 0;
        if (rect.left < safeLeft) dx = safeLeft - rect.left;
        else if (rect.right > safeRight) dx = safeRight - rect.right;

        const lowestAllowedTop = Math.max(safeTop, safeBottom - rect.height);
        const clampedTop = Math.min(Math.max(rect.top, safeTop), lowestAllowedTop);
        const dy = clampedTop - rect.top;

        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        setViewportOffset((current) => ({ x: current.x + dx, y: current.y + dy }));
      });
    };

    setViewportOffset({ x: 0, y: 0 });
    const resizeObserver = new ResizeObserver(keepInsideReaderViewport);
    resizeObserver.observe(card);
    keepInsideReaderViewport();
    window.addEventListener("resize", keepInsideReaderViewport);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", keepInsideReaderViewport);
    };
  }, [lookup.key, lookup.left, lookup.placement, lookup.top]);

  const firstZh = dictionary?.definitionsZh[0]?.definition;
  const firstEn = dictionary?.definitionsEn[0];
  const partOfSpeech = context?.partOfSpeech || firstEn?.partOfSpeech || dictionary?.definitionsZh[0]?.partOfSpeech || "";
  const normalizedVocabularyMeaning = vocabularyMeaning?.trim() ?? "";
  const legacyLooksCustomized = Boolean(
    normalizedVocabularyMeaning
    && vocabularyMeaningSource === undefined
    && firstZh?.trim()
    && normalizedVocabularyMeaning !== firstZh.trim(),
  );
  const hasCustomVocabularyMeaning = Boolean(
    normalizedVocabularyMeaning && (vocabularyMeaningSource === "user" || legacyLooksCustomized),
  );

  function startEditingVocabularyMeaning() {
    setVocabularyMeaningDraft(
      hasCustomVocabularyMeaning
        ? normalizedVocabularyMeaning
        : firstZh?.trim() || context?.meaningZh?.trim() || "",
    );
    setEditingVocabularyMeaning(true);
  }

  function saveVocabularyMeaning() {
    const next = vocabularyMeaningDraft.trim();
    if (!next) return;
    onVocabularyMeaningChange(next);
    setEditingVocabularyMeaning(false);
  }

  function saveContextMeaning() {
    const next = contextMeaningDraft.trim();
    if (!next) return;
    onContextMeaningChange(next);
    setEditingContext(false);
  }

  return (
    <div
      ref={cardRef}
      className={`word-lookup-card ${lookup.placement === "above" ? "is-above" : "is-below"}`}
      style={{
        top: lookup.top,
        left: lookup.left,
        transform: lookup.placement === "above"
          ? `translate(calc(-50% + ${viewportOffset.x}px), calc(-100% + ${viewportOffset.y}px))`
          : `translate(calc(-50% + ${viewportOffset.x}px), ${viewportOffset.y}px)`,
      }}
      role="dialog"
      aria-label={`“${lookup.text}”词典与语境解释`}
      data-testid="word-lookup-card"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button className="word-lookup-close" aria-label="关闭语境解释" aria-keyshortcuts="Escape" title="关闭 (Esc)" onClick={onClose}>×</button>
      <div className="word-lookup-head">
        <div>
          <strong>{lookup.text}</strong>
          {partOfSpeech && <em>{partOfSpeech}</em>}
        </div>
        <button className="word-lookup-more" aria-label={`查看“${lookup.text}”词汇详情`} aria-keyshortcuts="Enter" title="词汇详情 (Enter)" onClick={onOpenDetails}>更多 ›</button>
      </div>
      <div className="contextual-shortcut-hint word-lookup-shortcut-hint" data-testid="word-lookup-shortcut-hint" aria-label="单词卡快捷键">
        <span><kbd>0</kbd> 忽视</span>
        <span><kbd>1–4</kbd> 学习程度</span>
        <span><kbd>5</kbd> 已知</span>
        <span><kbd>Enter</kbd> 更多</span>
        <span><kbd>Esc</kbd> 关闭</span>
      </div>

      {hasCustomVocabularyMeaning ? (
        <div className="word-lookup-user-meaning">
          <div className="word-lookup-context-label-row">
            <span className="word-lookup-label">你的释义</span>
            {!editingVocabularyMeaning && (
              <button className="word-lookup-edit-action" aria-label={`修改“${lookup.text}”词汇释义`} onClick={startEditingVocabularyMeaning}>修改</button>
            )}
          </div>
          {editingVocabularyMeaning ? (
            <div className="word-lookup-context-edit">
              <input
                aria-label={`编辑“${lookup.text}”词汇释义`}
                value={vocabularyMeaningDraft}
                autoFocus
                onChange={(event) => setVocabularyMeaningDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveVocabularyMeaning();
                  if (event.key === "Escape") setEditingVocabularyMeaning(false);
                }}
              />
              <div>
                <button disabled={!vocabularyMeaningDraft.trim()} onClick={saveVocabularyMeaning}>保存</button>
                <button onClick={() => setEditingVocabularyMeaning(false)}>取消</button>
              </div>
            </div>
          ) : (
            <strong>{normalizedVocabularyMeaning}</strong>
          )}
        </div>
      ) : dictionary ? (
        <div className="word-lookup-dictionary-summary">
          <div className="word-lookup-context-label-row">
            <span className="word-lookup-label">词典释义</span>
            {!editingVocabularyMeaning && (
              <button className="word-lookup-edit-action" aria-label={`修改“${lookup.text}”词汇释义`} onClick={startEditingVocabularyMeaning}>修改</button>
            )}
          </div>
          {editingVocabularyMeaning ? (
            <div className="word-lookup-context-edit">
              <input
                aria-label={`编辑“${lookup.text}”词汇释义`}
                value={vocabularyMeaningDraft}
                autoFocus
                onChange={(event) => setVocabularyMeaningDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveVocabularyMeaning();
                  if (event.key === "Escape") setEditingVocabularyMeaning(false);
                }}
              />
              <div>
                <button disabled={!vocabularyMeaningDraft.trim()} onClick={saveVocabularyMeaning}>保存</button>
                <button onClick={() => setEditingVocabularyMeaning(false)}>取消</button>
              </div>
            </div>
          ) : (
            <>
              {firstZh && <strong>{firstZh}</strong>}
              {firstEn && <p><em>{firstEn.partOfSpeech}</em>{firstEn.definition}</p>}
            </>
          )}
        </div>
      ) : null}

      <div className="word-lookup-context">
        <div className="word-lookup-context-label-row">
          <span className="word-lookup-label">{context?.meaningSource === "user" ? "在此语境中 · 已修改" : "在此语境中 · AI"}</span>
          {context && !editingContext && (
            <button className="word-lookup-edit-action" aria-label={`修改“${lookup.text}”当前语境释义`} onClick={() => setEditingContext(true)}>修改</button>
          )}
        </div>
        {lookup.contextStatus === "loading" && <p>正在结合当前句子分析…</p>}
        {lookup.contextStatus === "error" && <p className="is-error">语境分析暂时失败，请稍后再试。</p>}
        {context && editingContext ? (
          <div className="word-lookup-context-edit">
            <input
              aria-label={`编辑“${lookup.text}”当前语境释义`}
              value={contextMeaningDraft}
              autoFocus
              onChange={(event) => setContextMeaningDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveContextMeaning();
                if (event.key === "Escape") setEditingContext(false);
              }}
            />
            <div>
              <button disabled={!contextMeaningDraft.trim()} onClick={saveContextMeaning}>保存</button>
              <button onClick={() => setEditingContext(false)}>取消</button>
            </div>
          </div>
        ) : context ? (
          <>
            <div className="word-lookup-context-heading"><strong>{context.meaningZh}</strong><small>{context.partOfSpeech}</small></div>
            <p>{context.explanationZh}</p>
          </>
        ) : null}
      </div>

      <div className="word-lookup-familiarity">
        <div className="word-lookup-familiarity-head">
          <span className="word-lookup-label">词汇状态</span>
          <small>{familiarity !== null ? familiarityStatusText(familiarity) : "选择后自动加入词汇"}</small>
        </div>
        <div className="familiarity-picker word-lookup-familiarity-picker" aria-label={`“${lookup.text}”熟悉度`}>
          {FAMILIARITY_LEVELS.map((level) => (
            <FamiliarityOptionButton
              key={level}
              level={level}
              active={familiarity === level}
              ariaLabel={`将“${lookup.text}”熟悉度设为 ${familiarityAriaStatus(level)}`}
              ariaKeyShortcuts={String(level)}
              onClick={() => onFamiliarityChange(level)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const FAMILIARITY_LEVELS = [0, 1, 2, 3, 4, 5] as const;
const GLOBAL_VOCABULARY_FAMILIARITY_LEVELS = [1, 2, 3, 4, 5] as const;
const FAMILIARITY_LABELS: Record<FamiliarityLevel, string> = {
  0: "忽视",
  1: "生词",
  2: "认识",
  3: "熟悉",
  4: "已学习",
  5: "已知",
};
const FAMILIARITY_TOOLTIPS: Record<FamiliarityLevel, string> = {
  0: "忽视",
  1: "1-生词",
  2: "认识 2",
  3: "熟悉 3",
  4: "已学习 4",
  5: "已知",
};

function familiarityStatusText(level: FamiliarityLevel): string {
  if (level === 0 || level === 5) return FAMILIARITY_LABELS[level];
  return `${level} · ${FAMILIARITY_LABELS[level]}`;
}

function familiarityAriaStatus(level: FamiliarityLevel): string {
  if (level === 0) return "忽视";
  return `${level} ${FAMILIARITY_LABELS[level]}`;
}

function FamiliarityOptionButton({
  level,
  active = false,
  ariaLabel,
  ariaKeyShortcuts,
  onClick,
}: {
  level: FamiliarityLevel;
  active?: boolean;
  ariaLabel: string;
  ariaKeyShortcuts?: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`familiarity-option level-${level} ${active ? "is-active" : ""}`}
      aria-label={ariaLabel}
      aria-keyshortcuts={ariaKeyShortcuts}
      data-tooltip={FAMILIARITY_TOOLTIPS[level]}
      onClick={onClick}
    >
      {level === 0 ? (
        <svg className="familiarity-option-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 3l18 18" />
          <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
          <path d="M9.9 4.3A10.7 10.7 0 0 1 12 4c5.2 0 9 4.7 9 8a8.7 8.7 0 0 1-1.8 3.8" />
          <path d="M6.2 6.2C4.1 7.7 3 10.1 3 12c0 3.3 3.8 8 9 8 1.5 0 2.9-.4 4.1-1" />
        </svg>
      ) : level === 5 ? (
        <svg className="familiarity-option-icon familiarity-option-check" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.5 12.5l4.7 4.7L19.8 6.8" />
        </svg>
      ) : (
        <span className="familiarity-option-number">{level}</span>
      )}
    </button>
  );
}

function WordDetailContent({
  lookup,
  vocabularyMeaning,
  familiarity,
  onBack,
  onVocabularyMeaningChange,
  onFamiliarityChange,
  onContextMeaningChange,
}: {
  lookup: ActiveWordLookup;
  vocabularyMeaning?: string;
  familiarity: FamiliarityLevel | null;
  onBack: () => void;
  onVocabularyMeaningChange: (meaningZh: string) => void;
  onFamiliarityChange: (level: FamiliarityLevel) => void;
  onContextMeaningChange: (meaningZh: string) => void;
}) {
  const dictionary = lookup.dictionary;
  const context = lookup.contextMeaning;
  const [editingVocabulary, setEditingVocabulary] = useState(false);
  const [vocabularyDraft, setVocabularyDraft] = useState(vocabularyMeaning ?? "");
  const [editingContext, setEditingContext] = useState(false);
  const [contextDraft, setContextDraft] = useState(context?.meaningZh ?? "");
  const partOfSpeech = context?.partOfSpeech || dictionary?.definitionsEn[0]?.partOfSpeech || dictionary?.definitionsZh[0]?.partOfSpeech || "";
  const englishDefinitions = dictionary?.definitionsEn ?? [];
  const aiEnglishDefinition = !englishDefinitions.length ? context?.meaningEn?.trim() ?? "" : "";
  const englishDefinitionSourceLabel = englishDefinitions.length
    ? dictionary?.englishDefinitionSource === "base-form" && dictionary.englishLookupWord
      ? `Dictionary · base form: ${dictionary.englishLookupWord}`
      : "Dictionary"
    : aiEnglishDefinition
      ? "AI fallback"
      : null;

  useEffect(() => {
    setEditingVocabulary(false);
    setEditingContext(false);
    setVocabularyDraft(vocabularyMeaning ?? "");
    setContextDraft(context?.meaningZh ?? "");
  }, [lookup.key]);

  useEffect(() => {
    if (!editingVocabulary) setVocabularyDraft(vocabularyMeaning ?? "");
  }, [vocabularyMeaning, editingVocabulary]);

  useEffect(() => {
    if (!editingContext) setContextDraft(context?.meaningZh ?? "");
  }, [context?.meaningZh, editingContext]);

  const examples = (() => {
    const result: Array<{ text: string; source: "Dictionary" | "AI" }> = [];
    const seen = new Set<string>();
    for (const item of dictionary?.definitionsEn ?? []) {
      const example = item.example?.trim();
      if (!example || seen.has(example.toLocaleLowerCase("en-US"))) continue;
      seen.add(example.toLocaleLowerCase("en-US"));
      result.push({ text: example, source: "Dictionary" });
    }
    for (const example of context?.examplesEn ?? []) {
      const clean = example.trim();
      if (!clean || seen.has(clean.toLocaleLowerCase("en-US"))) continue;
      seen.add(clean.toLocaleLowerCase("en-US"));
      result.push({ text: clean, source: "AI" });
    }
    return result.slice(0, 4);
  })();

  function saveVocabularyMeaning() {
    const next = vocabularyDraft.trim();
    if (!next) return;
    onVocabularyMeaningChange(next);
    setEditingVocabulary(false);
  }

  function saveContextMeaning() {
    const next = contextDraft.trim();
    if (!next) return;
    onContextMeaningChange(next);
    setEditingContext(false);
  }

  return (
    <div className="word-detail-content" data-testid="word-detail-view">
      <button className="word-detail-back" aria-label="返回词汇列表" onClick={onBack}>← 返回词汇</button>

      <div className="word-detail-heading">
        <div><strong>{lookup.text}</strong>{partOfSpeech && <em>{partOfSpeech}</em>}</div>
        <small>Word detail</small>
      </div>

      <div className="word-lookup-pronunciation word-detail-pronunciation">
        {lookup.dictionaryStatus === "loading" && <span>正在加载词典…</span>}
        {lookup.dictionaryStatus === "error" && <span className="is-error">词典暂不可用</span>}
        {dictionary && (
          <>
            <button aria-label={`详情播放 ${lookup.text} 美式发音`} onClick={() => playWordPronunciation(lookup.text, dictionary, "us")}>
              <span>🔊 美</span>
              <strong>{dictionary.usPhonetic ? `/${dictionary.usPhonetic.replace(/^\/+|\/+$/g, "")}/` : "发音"}</strong>
            </button>
            <button aria-label={`详情播放 ${lookup.text} 英式发音`} onClick={() => playWordPronunciation(lookup.text, dictionary, "uk")}>
              <span>🔊 英</span>
              <strong>{dictionary.ukPhonetic ? `/${dictionary.ukPhonetic.replace(/^\/+|\/+$/g, "")}/` : "发音"}</strong>
            </button>
          </>
        )}
      </div>

      <section className="word-detail-section word-detail-user-section">
        <div className="word-detail-section-title">
          <span>你的释义</span>
          {familiarity !== null && !editingVocabulary && <button onClick={() => setEditingVocabulary(true)}>修改</button>}
        </div>
        {editingVocabulary ? (
          <div className="word-detail-edit-row">
            <input
              aria-label={`编辑词汇“${lookup.text}”的详情释义`}
              value={vocabularyDraft}
              autoFocus
              onChange={(event) => setVocabularyDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveVocabularyMeaning();
                if (event.key === "Escape") setEditingVocabulary(false);
              }}
            />
            <div><button disabled={!vocabularyDraft.trim()} onClick={saveVocabularyMeaning}>保存</button><button onClick={() => setEditingVocabulary(false)}>取消</button></div>
          </div>
        ) : vocabularyMeaning ? (
          <strong className="word-detail-user-meaning">{vocabularyMeaning}</strong>
        ) : (
          <p className="word-detail-empty">选择下面的词汇状态后会加入词汇，你可以再维护自己的释义。</p>
        )}
      </section>

      <section className="word-detail-section">
        <div className="word-detail-section-title"><span>中文词典释义</span></div>
        {dictionary?.definitionsZh.length ? (
          <div className="word-detail-definition-list">
            {dictionary.definitionsZh.map((item, index) => <p key={`detail-zh:${index}`}>{item.definition}</p>)}
          </div>
        ) : <p className="word-detail-empty">中文词典释义暂不可用。</p>}
      </section>

      <section className="word-detail-section word-detail-english-section">
        <div className="word-detail-section-title">
          <span>English definition</span>
          {englishDefinitionSourceLabel && <small className="word-detail-definition-source">{englishDefinitionSourceLabel}</small>}
        </div>
        {englishDefinitions.length ? (
          <div className="word-detail-definition-list">
            {englishDefinitions.map((item, index) => (
              <div className="word-detail-definition" key={`detail-en:${index}`}>
                {item.partOfSpeech && <em>{item.partOfSpeech}</em>}
                <p>{item.definition}</p>
              </div>
            ))}
          </div>
        ) : aiEnglishDefinition ? (
          <div className="word-detail-definition-list">
            <div className="word-detail-definition is-ai-fallback">
              {partOfSpeech && <em>{partOfSpeech}</em>}
              <p>{aiEnglishDefinition}</p>
            </div>
          </div>
        ) : lookup.contextStatus === "loading" ? (
          <p className="word-detail-empty">正在准备英文释义…</p>
        ) : (
          <p className="word-detail-empty">英文释义暂不可用。</p>
        )}
      </section>

      <section className="word-detail-section word-detail-context-section">
        <div className="word-detail-section-title"><span>In this context</span></div>
        {lookup.contextStatus === "loading" && <p className="word-detail-empty">正在结合当前句子分析…</p>}
        {lookup.contextStatus === "error" && <p className="word-detail-empty is-error">语境分析暂时失败。</p>}
        {context && (
          <>
            <blockquote className="word-detail-source-sentence">{context.sentence}</blockquote>
            {context.meaningEn && <strong className="word-detail-context-meaning-en">{context.meaningEn}</strong>}
            {context.explanationEn && <p className="word-detail-context-explanation-en">{context.explanationEn}</p>}
            <div className="word-detail-chinese-support">
              <div className="word-detail-section-title">
                <span>{context.meaningSource === "user" ? "中文辅助 · 已修改" : "中文辅助 · AI"}</span>
                {!editingContext && <button onClick={() => setEditingContext(true)}>修改</button>}
              </div>
              {editingContext ? (
                <div className="word-detail-edit-row">
                  <input
                    aria-label={`编辑“${lookup.text}”详情当前语境释义`}
                    value={contextDraft}
                    autoFocus
                    onChange={(event) => setContextDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveContextMeaning();
                      if (event.key === "Escape") setEditingContext(false);
                    }}
                  />
                  <div><button disabled={!contextDraft.trim()} onClick={saveContextMeaning}>保存</button><button onClick={() => setEditingContext(false)}>取消</button></div>
                </div>
              ) : (
                <><strong>{context.meaningZh}</strong><p>{context.explanationZh}</p></>
              )}
            </div>
          </>
        )}
      </section>

      <section className="word-detail-section">
        <div className="word-detail-section-title"><span>Examples</span></div>
        {examples.length ? (
          <ol className="word-detail-examples">
            {examples.map((example, index) => (
              <li key={`${example.source}:${example.text}`}><span>{example.text}</span><small>{example.source}</small></li>
            ))}
          </ol>
        ) : <p className="word-detail-empty">例句正在准备中。</p>}
      </section>

      <section className="word-detail-section word-detail-familiarity">
        <div className="word-lookup-familiarity-head">
          <span className="word-lookup-label">词汇状态</span>
          <small>{familiarity !== null ? familiarityStatusText(familiarity) : "选择后自动加入词汇"}</small>
        </div>
        <div className="familiarity-picker" aria-label={`“${lookup.text}”详情熟悉度`}>
          {FAMILIARITY_LEVELS.map((level) => (
            <FamiliarityOptionButton
              key={level}
              level={level}
              active={familiarity === level}
              ariaLabel={`在详情将“${lookup.text}”熟悉度设为 ${familiarityAriaStatus(level)}`}
              onClick={() => onFamiliarityChange(level)}
            />
          ))}
        </div>
      </section>

      <small className="word-detail-sources">词典：有道 / Free Dictionary API · 语境：EasyCLIProxy</small>
    </div>
  );
}

function vocabularyTextKey(text: string): string {
  return text.trim().toLocaleLowerCase("en-US");
}

function uniqueVocabularyItems(selections: SavedSelection[]): SavedSelection[] {
  const unique = new Map<string, SavedSelection>();
  for (const item of selections) {
    const key = vocabularyTextKey(item.text);
    if (!key) continue;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, item);
    } else if (!existing.translationZh && item.translationZh) {
      unique.set(key, { ...existing, translationZh: item.translationZh, translationSource: item.translationSource });
    } else if (item.translationSource === "user" && existing.translationSource !== "user") {
      unique.set(key, { ...existing, translationZh: item.translationZh ?? existing.translationZh, translationSource: "user" });
    }
  }
  return [...unique.values()];
}

function VocabularyContent({
  savedSelections,
  occurrencesByText,
  occurrenceIndexes,
  onSavedTranslationChange,
  onSavedFamiliarityChange,
  onRemoveSavedSelection,
  onNavigateOccurrence,
  emptyMessage = "这篇文章还没有保存词汇。",
  focusedText,
}: {
  savedSelections: SavedSelection[];
  occurrencesByText: Map<string, SavedTextOccurrence[]>;
  occurrenceIndexes: Record<string, number>;
  onSavedTranslationChange: (text: string, translationZh: string) => void;
  onSavedFamiliarityChange: (text: string, familiarity: FamiliarityLevel) => void;
  onRemoveSavedSelection: (text: string) => void;
  onNavigateOccurrence: (text: string, direction: VocabularyNavigationDirection) => void;
  emptyMessage?: string;
  focusedText?: string;
}) {
  const items = uniqueVocabularyItems(savedSelections);
  const [editingSelectionId, setEditingSelectionId] = useState<string | null>(null);
  const [selectionMeaningDraft, setSelectionMeaningDraft] = useState("");
  const [selectedTextKey, setSelectedTextKey] = useState<string | null>(() => focusedText ? vocabularyTextKey(focusedText) : null);
  const learningCount = items.filter((item) => isLearningFamiliarity(savedSelectionFamiliarity(item))).length;
  const ignoredCount = items.filter((item) => savedSelectionFamiliarity(item) === 0).length;
  const knownCount = items.filter((item) => savedSelectionFamiliarity(item) === 5).length;

  useEffect(() => {
    if (!focusedText) return;
    const key = vocabularyTextKey(focusedText);
    setSelectedTextKey(key);
    const frame = window.requestAnimationFrame(() => {
      const target = [...document.querySelectorAll<HTMLElement>(".saved-selection-card[data-vocabulary-text]")]
        .find((element) => vocabularyTextKey(element.dataset.vocabularyText ?? "") === key);
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedText]);

  function startEditingSelection(item: SavedSelection) {
    setEditingSelectionId(item.id);
    setSelectionMeaningDraft(item.translationZh ?? "");
  }

  function saveSelectionMeaning(item: SavedSelection) {
    const next = selectionMeaningDraft.trim();
    if (!next) return;
    onSavedTranslationChange(item.text, next);
    setEditingSelectionId(null);
  }

  return (
    <div className="vocabulary-content">
      <div className="vocabulary-summary">
        <span>学习中 <strong>{learningCount}</strong></span>
        <span>忽视 <strong>{ignoredCount}</strong></span>
        <span>已知 <strong>{knownCount}</strong></span>
      </div>
      <div className="vocabulary-tip">词汇状态采用 LingQ 风格：忽视 / 1 生词 / 2 认识 / 3 熟悉 / 4 已学习 / 已知。</div>
      <div className="saved-selection-list">
        {items.length ? items.map((item) => {
          const familiarity = savedSelectionFamiliarity(item);
          const textKey = vocabularyTextKey(item.text);
          const occurrences = occurrencesByText.get(textKey) ?? [];
          const occurrenceIndex = Math.min(occurrenceIndexes[textKey] ?? 0, Math.max(occurrences.length - 1, 0));
          return (
            <div
              className={`saved-selection-card familiarity-${familiarity} ${familiarity === 5 ? "is-known" : ""} ${familiarity === 0 ? "is-ignored" : ""} ${selectedTextKey === textKey ? "is-selected" : ""}`}
              data-vocabulary-text={item.text}
              data-selected={selectedTextKey === textKey ? "true" : "false"}
              key={item.id}
              onClick={() => setSelectedTextKey(textKey)}
              onFocusCapture={() => setSelectedTextKey(textKey)}
            >
              <div className="saved-selection-card-header">
                <button
                  className="saved-selection-word-link"
                  aria-label={`定位“${item.text}”到正文`}
                  onClick={() => onNavigateOccurrence(item.text, "nearest")}
                >
                  {item.text}
                </button>
                <span className={`saved-selection-status familiarity-${familiarity}`}>
                  {familiarityStatusText(familiarity)}
                </span>
              </div>
              {editingSelectionId === item.id ? (
                <div className="saved-selection-card-edit">
                  <input
                    aria-label={`编辑词汇“${item.text}”的中文释义`}
                    value={selectionMeaningDraft}
                    autoFocus
                    onChange={(event) => setSelectionMeaningDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveSelectionMeaning(item);
                      if (event.key === "Escape") setEditingSelectionId(null);
                    }}
                  />
                  <div className="saved-selection-card-actions">
                    <button disabled={!selectionMeaningDraft.trim()} onClick={() => saveSelectionMeaning(item)}>保存</button>
                    <button onClick={() => setEditingSelectionId(null)}>取消</button>
                  </div>
                </div>
              ) : (
                <div className="saved-selection-meaning-row">
                  <div className="saved-selection-card-meaning">{item.translationZh || "还没有中文释义"}</div>
                  <button aria-label={`修改词汇“${item.text}”的中文释义`} onClick={() => startEditingSelection(item)}>修改</button>
                </div>
              )}
              {item.usageExplanationZh && <details className="saved-expression-usage"><summary>用法说明</summary><p>{item.usageExplanationZh}</p></details>}
              {occurrences.length > 0 && (
                <div className="vocabulary-occurrence-nav" aria-label={`“${item.text}”正文位置`}>
                  {occurrences.length > 1 ? (
                    <>
                      <button aria-label={`查看“${item.text}”上一处`} onClick={() => onNavigateOccurrence(item.text, "previous")}>‹</button>
                      <button
                        className="vocabulary-occurrence-position"
                        aria-label={`定位“${item.text}”到正文最近一处`}
                        onClick={() => onNavigateOccurrence(item.text, "nearest")}
                      >
                        本篇 {occurrences.length} 处 · {occurrenceIndex + 1}/{occurrences.length}
                      </button>
                      <button aria-label={`查看“${item.text}”下一处`} onClick={() => onNavigateOccurrence(item.text, "next")}>›</button>
                    </>
                  ) : (
                    <button
                      className="vocabulary-occurrence-position is-single"
                      aria-label={`定位“${item.text}”到正文唯一一处`}
                      onClick={() => onNavigateOccurrence(item.text, "nearest")}
                    >
                      定位到正文 · 1 处
                    </button>
                  )}
                </div>
              )}
              <div className="familiarity-picker" aria-label={`“${item.text}”熟悉度`}>
                {FAMILIARITY_LEVELS.map((level) => (
                  <FamiliarityOptionButton
                    key={level}
                    level={level}
                    active={familiarity === level}
                    ariaLabel={`将“${item.text}”熟悉度设为 ${familiarityAriaStatus(level)}`}
                    onClick={() => onSavedFamiliarityChange(item.text, level)}
                  />
                ))}
              </div>
              <div className="saved-selection-card-footer"><small>第 {item.paragraphIndex + 1} 段 · {new Date(item.createdAt).toLocaleString("zh-CN")}</small><button className="text-button" aria-label={`移除误选“${item.text}”`} title="仅移除本篇中的这个词条，可撤销后重新划选" onClick={(event) => { event.stopPropagation(); onRemoveSavedSelection(item.text); }}>移除误选</button></div>
            </div>
          );
        }) : <div className="drawer-empty">{emptyMessage}</div>}
      </div>
    </div>
  );
}

function VocabularyPanel({
  savedSelections,
  occurrencesByText,
  occurrenceIndexes,
  detailLookup,
  detailVocabularyMeaning,
  detailFamiliarity,
  onSavedTranslationChange,
  onSavedFamiliarityChange,
  onRemoveSavedSelection,
  onNavigateOccurrence,
  onCloseDetail,
  onDetailFamiliarityChange,
  onDetailContextMeaningChange,
  focusedText,
  panelClassName,
}: {
  savedSelections: SavedSelection[];
  occurrencesByText: Map<string, SavedTextOccurrence[]>;
  occurrenceIndexes: Record<string, number>;
  detailLookup: ActiveWordLookup | null;
  detailVocabularyMeaning?: string;
  detailFamiliarity: FamiliarityLevel | null;
  onSavedTranslationChange: (text: string, translationZh: string) => void;
  onSavedFamiliarityChange: (text: string, familiarity: FamiliarityLevel) => void;
  onRemoveSavedSelection: (text: string) => void;
  onNavigateOccurrence: (text: string, direction: VocabularyNavigationDirection) => void;
  onCloseDetail: () => void;
  onDetailFamiliarityChange: (level: FamiliarityLevel) => void;
  onDetailContextMeaningChange: (meaningZh: string) => void;
  focusedText?: string;
  panelClassName?: string;
}) {
  return (
    <aside className={`vocabulary-panel ${panelClassName ?? ""}`.trim()} data-testid="vocabulary-panel">
      <div className="vocabulary-panel-header">
        <div><span>{detailLookup ? "Word Detail" : "Vocabulary"}</span><h3>{detailLookup ? "词汇详情" : "词汇"}</h3></div>
        {!detailLookup && <strong>{uniqueVocabularyItems(savedSelections).length}</strong>}
      </div>
      <div className="vocabulary-panel-scroll">
        {detailLookup ? (
          <WordDetailContent
            lookup={detailLookup}
            vocabularyMeaning={detailVocabularyMeaning}
            familiarity={detailFamiliarity}
            onBack={onCloseDetail}
            onVocabularyMeaningChange={(meaningZh) => onSavedTranslationChange(detailLookup.text, meaningZh)}
            onFamiliarityChange={onDetailFamiliarityChange}
            onContextMeaningChange={onDetailContextMeaningChange}
          />
        ) : (
          <VocabularyContent
            savedSelections={savedSelections}
            occurrencesByText={occurrencesByText}
            occurrenceIndexes={occurrenceIndexes}
            onSavedTranslationChange={onSavedTranslationChange}
            onSavedFamiliarityChange={onSavedFamiliarityChange}
              onRemoveSavedSelection={onRemoveSavedSelection}
            onNavigateOccurrence={onNavigateOccurrence}
            focusedText={focusedText}
          />
        )}
      </div>
    </aside>
  );
}

function IssueCover({ issue, compact = false, preferReal = false }: { issue: ReaderIssue; compact?: boolean; preferReal?: boolean }) {
  const [realCoverFailed, setRealCoverFailed] = useState(false);
  useEffect(() => setRealCoverFailed(false), [issue.id, preferReal]);
  const showRealCover = preferReal && !realCoverFailed;
  return (
    <div
      className={`issue-cover ${compact ? "is-compact" : ""} ${showRealCover ? "has-real-cover" : ""}`}
      aria-label={`${issue.displayDate} 封面`}
      data-cover-source={showRealCover ? "epub" : "fallback"}
    >
      <div className="issue-cover-fallback">
        <div className="cover-kicker">{issue.coverKicker}</div>
        <div className="cover-rule" />
        <div className="cover-title">
          {issue.coverTitle.split("\n").map((line) => <span key={line}>{line}</span>)}
        </div>
        <div className="cover-art">
          <span className="cover-orbit orbit-a" />
          <span className="cover-orbit orbit-b" />
          <span className="cover-core">{issue.coverMark}</span>
        </div>
        <div className="cover-subtitle">{issue.coverSubtitle}</div>
        <div className="cover-date">{issue.date}</div>
      </div>
      {showRealCover && (
        <img
          className="issue-cover-real-image"
          data-testid="issue-real-cover"
          src={issueCoverUrl(issue.id)}
          alt=""
          aria-hidden="true"
          onError={() => setRealCoverFailed(true)}
        />
      )}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress-track" aria-label={`阅读进度 ${value}%`}>
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

interface EpubImportUiItem {
  file: File;
  preview: EpubImportPreview;
}

function epubImportStatusLabel(status: EpubImportPreview["status"]): string {
  if (status === "ready") return "可以导入";
  if (status === "duplicate") return "已存在";
  if (status === "unsupported") return "不支持";
  if (status === "invalid") return "无法解析";
  return "已导入";
}

function EpubImportControl({ onImported }: { onImported: () => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [items, setItems] = useState<EpubImportUiItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const readyCount = items.filter((item) => item.preview.status === "ready").length;
  const importedCount = items.filter((item) => item.preview.status === "imported").length;

  function closeDialog() {
    if (importing) return;
    setOpen(false);
    setItems([]);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function prepareFiles(files: File[]) {
    if (!files.length) return;
    setOpen(true);
    setPreparing(true);
    setError(null);
    setItems([]);
    const next: EpubImportUiItem[] = [];
    for (const file of files) {
      try {
        next.push({ file, preview: await previewEpubImport(file) });
      } catch (requestError) {
        next.push({
          file,
          preview: {
            filename: file.name,
            status: "invalid",
            hasCover: false,
            message: requestError instanceof Error ? requestError.message : "EPUB 校验请求失败。",
          },
        });
      }
    }
    setItems(next);
    setPreparing(false);
  }

  async function confirmImport() {
    if (!readyCount || importing) return;
    setImporting(true);
    setError(null);
    const next = [...items];
    let imported = 0;
    for (let index = 0; index < next.length; index += 1) {
      const item = next[index];
      if (item.preview.status !== "ready") continue;
      try {
        const result = await importEpub(item.file);
        next[index] = {
          ...item,
          preview: { ...result, coverDataUrl: item.preview.coverDataUrl },
        };
        if (result.status === "imported") imported += 1;
      } catch (requestError) {
        next[index] = {
          ...item,
          preview: {
            ...item.preview,
            status: "invalid",
            message: requestError instanceof Error ? requestError.message : "EPUB 导入请求失败。",
          },
        };
      }
      setItems([...next]);
    }
    if (imported > 0) {
      try {
        await onImported();
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : "导入完成，但刷新期刊列表失败。请手动刷新页面。");
      }
    }
    setImporting(false);
  }

  return (
    <>
      <input
        ref={inputRef}
        className="epub-import-input"
        data-testid="epub-import-input"
        type="file"
        accept=".epub,application/epub+zip"
        multiple
        onChange={(event) => void prepareFiles(Array.from(event.target.files ?? []))}
      />
      <button className="primary-button library-import-trigger" onClick={() => inputRef.current?.click()}>＋ 导入 EPUB</button>
      {open && (
        <div className="epub-import-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <section className="epub-import-dialog" role="dialog" aria-modal="true" aria-labelledby="epub-import-title" data-testid="epub-import-dialog">
            <header className="epub-import-dialog-header">
              <div><div className="eyebrow">EPUB Import</div><h2 id="epub-import-title">导入期刊</h2><p>先检查，再写入正式书库。原始 EPUB 不会被移动或删除。</p></div>
              <button className="icon-button" aria-label="关闭导入窗口" disabled={importing} onClick={closeDialog}>×</button>
            </header>
            {preparing ? (
              <div className="epub-import-preparing"><strong>正在检查 {inputRef.current?.files?.length ?? 0} 个 EPUB…</strong><span>正在识别杂志、日期、目录、文章和封面。</span></div>
            ) : (
              <div className="epub-import-list">
                {items.map((item) => (
                  <article className={`epub-import-row status-${item.preview.status}`} key={`${item.file.name}-${item.file.size}`} data-testid={`epub-import-row-${item.file.name}`}>
                    <div className="epub-import-cover">
                      {item.preview.coverDataUrl ? <img src={item.preview.coverDataUrl} alt="" /> : <span>{item.preview.publicationName?.slice(0, 1) ?? "E"}</span>}
                    </div>
                    <div className="epub-import-copy">
                      <strong>{item.preview.publicationName ?? item.preview.filename}</strong>
                      <span className="epub-import-filename">{item.preview.filename}</span>
                      {item.preview.date && <span>{item.preview.date}{typeof item.preview.articleCount === "number" ? ` · ${item.preview.articleCount} 篇文章` : ""}{typeof item.preview.sectionCount === "number" ? ` · ${item.preview.sectionCount} 个栏目` : ""}</span>}
                      <small>{item.preview.message}</small>
                    </div>
                    <span className={`epub-import-status status-${item.preview.status}`}>{epubImportStatusLabel(item.preview.status)}</span>
                  </article>
                ))}
              </div>
            )}
            {error && <div className="epub-import-error">{error}</div>}
            <footer className="epub-import-dialog-footer">
              <span>{preparing ? "正在校验…" : importedCount > 0 ? `已导入 ${importedCount} 本` : readyCount > 0 ? `${readyCount} 本可以导入` : "没有待导入文件"}</span>
              <div>
                <button className="text-button epub-import-cancel" disabled={importing} onClick={closeDialog}>{importedCount > 0 && readyCount === 0 ? "关闭" : "取消"}</button>
                {readyCount > 0 && <button className="primary-button" disabled={preparing || importing} onClick={() => void confirmImport()}>{importing ? "正在导入…" : `导入 ${readyCount} 本`}</button>}
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

interface BookImportUiItem {
  categoryId: BookCategoryId;
  file: File;
  preview: BookImportPreview;
}

function bookImportStatusLabel(status: BookImportPreview["status"]): string {
  if (status === "ready") return "可以导入";
  if (status === "duplicate") return "已存在";
  if (status === "conflict") return "文件名冲突";
  if (status === "unsupported") return "不支持";
  if (status === "invalid") return "无法解析";
  return "已导入";
}

function BookCover({ bookId, title, hasCover, compact = false }: { bookId: string; title: string; hasCover: boolean; compact?: boolean }) {
  const [coverFailed, setCoverFailed] = useState(false);
  const showImage = hasCover && !coverFailed;
  return (
    <div className={`book-cover ${compact ? "is-compact" : ""}`} data-cover-source={showImage ? "epub" : "fallback"}>
      <div className="book-cover-fallback"><span>BOOK</span><strong>{title}</strong></div>
      {showImage && <img data-testid="book-real-cover" src={bookCoverUrl(bookId)} alt="" aria-hidden="true" onError={() => setCoverFailed(true)} />}
    </div>
  );
}

function BookEpubImportControl({ onImported }: { onImported: () => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [items, setItems] = useState<BookImportUiItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const readyCount = items.filter((item) => item.preview.status === "ready").length;
  const importedCount = items.filter((item) => item.preview.status === "imported").length;

  function closeDialog() {
    if (importing) return;
    setOpen(false);
    setItems([]);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function prepareFiles(files: File[]) {
    if (!files.length) return;
    setOpen(true);
    setPreparing(true);
    setError(null);
    setItems([]);
    const next: BookImportUiItem[] = [];
    for (const file of files) {
      try {
        next.push({ file, categoryId: "uncategorized", preview: await previewBookEpubImport(file) });
      } catch (requestError) {
        next.push({
          file,
          preview: {
            filename: file.name,
            status: "invalid",
            hasCover: false,
            message: requestError instanceof Error ? requestError.message : "电子书 EPUB 校验请求失败。",
          },
          categoryId: "uncategorized",
        });
      }
    }
    setItems(next);
    setPreparing(false);
  }

  async function confirmImport() {
    if (!readyCount || importing) return;
    setImporting(true);
    setError(null);
    const next = [...items];
    let imported = 0;
    for (let index = 0; index < next.length; index += 1) {
      const item = next[index];
      if (item.preview.status !== "ready") continue;
      try {
        const result = await importBookEpub(item.file, item.categoryId);
        next[index] = { ...item, preview: { ...result, coverDataUrl: item.preview.coverDataUrl } };
        if (result.status === "imported") imported += 1;
      } catch (requestError) {
        next[index] = {
          ...item,
          preview: {
            ...item.preview,
            status: "invalid",
            message: requestError instanceof Error ? requestError.message : "电子书 EPUB 导入请求失败。",
          },
        };
      }
      setItems([...next]);
    }
    if (imported > 0) {
      try {
        await onImported();
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : "导入完成，但刷新电子书列表失败。请手动刷新页面。");
      }
    }
    setImporting(false);
  }

  return (
    <>
      <input ref={inputRef} className="epub-import-input" data-testid="book-epub-import-input" type="file" accept=".epub,application/epub+zip" multiple onChange={(event) => void prepareFiles(Array.from(event.target.files ?? []))} />
      <button className="primary-button library-import-trigger" onClick={() => inputRef.current?.click()}>＋ 导入电子书</button>
      {open && (
        <div className="epub-import-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <section className="epub-import-dialog" role="dialog" aria-modal="true" aria-labelledby="book-epub-import-title" data-testid="book-epub-import-dialog">
            <header className="epub-import-dialog-header">
              <div><div className="eyebrow">Book EPUB Import</div><h2 id="book-epub-import-title">导入电子书</h2><p>先解析书名、作者、封面和目录，再复制到本机 books/。原始 EPUB 不会被移动或删除。</p></div>
              <button className="icon-button" aria-label="关闭电子书导入窗口" disabled={importing} onClick={closeDialog}>×</button>
            </header>
            {preparing ? (
              <div className="epub-import-preparing"><strong>正在检查 {inputRef.current?.files?.length ?? 0} 个 EPUB…</strong><span>正在检查书名、目录、插图与原书排版。</span></div>
            ) : (
              <div className="epub-import-list">
                {items.map((item, index) => (
                  <article className={`epub-import-row status-${item.preview.status}`} key={`${item.file.name}-${item.file.size}`} data-testid={`book-epub-import-row-${item.file.name}`}>
                    <div className="epub-import-cover">{item.preview.coverDataUrl ? <img src={item.preview.coverDataUrl} alt="" /> : <span>{item.preview.title?.slice(0, 1) ?? "B"}</span>}</div>
                    <div className="epub-import-copy">
                      <strong>{item.preview.title ?? item.preview.filename}</strong>
                      <span className="epub-import-filename">{item.preview.filename}</span>
                      {item.preview.authors?.length ? <span>{item.preview.authors.join(" · ")}</span> : null}
                      {typeof item.preview.readableUnitCount === "number" && <span>{item.preview.partCount ?? 0} Parts · {item.preview.numberedChapterCount ?? 0} Chapters · {item.preview.readableUnitCount} 个可读单元</span>}
                      <small>{item.preview.message}</small>
                      {item.preview.status === "ready" ? <label className="book-import-category">分类<select aria-label={`为《${item.preview.title ?? item.file.name}》选择分类`} value={item.categoryId} disabled={importing} onChange={event => {
                        const categoryId = event.target.value as BookCategoryId;
                        setItems(current => current.map((row, i) => i === index ? { ...row, categoryId } : row));
                      }}>{BOOK_CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label> : item.preview.status === "imported" ? <small>分类：{bookCategoryLabel(item.categoryId)}</small> : null}
                      {item.preview.presentation && (item.preview.presentation.imageCount > 0 || item.preview.presentation.originalBlockCount > 0) && <small>
                        插图 {item.preview.presentation.imageCount} 张 · {item.preview.presentation.originalBlockCount} 处图形或排版可在阅读时查看原书
                      </small>}
                    </div>
                    <span className={`epub-import-status status-${item.preview.status}`}>{bookImportStatusLabel(item.preview.status)}</span>
                  </article>
                ))}
              </div>
            )}
            {error && <div className="epub-import-error">{error}</div>}
            <footer className="epub-import-dialog-footer">
              <span>{preparing ? "正在校验…" : importedCount > 0 ? `已导入 ${importedCount} 本` : readyCount > 0 ? `${readyCount} 本可以导入` : "没有待导入文件"}</span>
              <div>
                <button className="text-button epub-import-cancel" disabled={importing} onClick={closeDialog}>{importedCount > 0 && readyCount === 0 ? "关闭" : "取消"}</button>
                {readyCount > 0 && <button className="primary-button" disabled={preparing || importing} onClick={() => void confirmImport()}>{importing ? "正在导入…" : `导入 ${readyCount} 本`}</button>}
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

function BookContinueCard({ book, item, onContinue }: { book: BookSummary; item: ReadingEntryView; onContinue: () => void }) {
  return <section className="continue-card book-continue-card" data-testid="book-continue-card" data-document-id={item.key} aria-label="继续阅读电子书">
    <BookCover bookId={book.id} title={book.title} hasCover={book.hasCover} />
    <div className="continue-copy">
      <div className="eyebrow">继续阅读 · {item.category === "精选阅读" ? "精选阅读" : "原书章节"}</div>
      <h2>{book.title}</h2>
      <p className="book-continue-location">{item.title}</p>
      <div className="continue-meta">{book.authors.length > 0 && <span>{book.authors.join(" · ")}</span>}{book.publisher && <span>{book.publisher}</span>}</div>
      <div className="continue-progress"><ProgressBar value={item.progress} /><span>{item.progress}%</span></div>
      <button className="primary-button" data-testid="book-continue-reading" onClick={onContinue}>继续阅读 →</button>
    </div>
  </section>;
}

function formatScienceDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function discoveryDateLabel(candidate: DiscoveryCandidate): string {
  const publishedDate = formatScienceDate(candidate.publishedAt);
  if (publishedDate) return `发布于 ${publishedDate}`;
  const firstSeenDate = formatScienceDate(candidate.discoveredAt);
  return firstSeenDate ? `首次发现于 ${firstSeenDate}` : "";
}

function savedArticleDateLabel(article: ScienceArticle): string {
  const publishedDate = formatScienceDate(article.publishedAt);
  const savedDate = formatScienceDate(article.savedAt);
  if (publishedDate && savedDate) return `发布于 ${publishedDate} · 收录于 ${savedDate}`;
  if (publishedDate) return `发布于 ${publishedDate}`;
  return savedDate ? `收录于 ${savedDate}` : "";
}

function ScienceArticleLibraryPage() {
  const discoveryArticlesPerPage = 12;
  const savedArticlesPerPage = 10;
  const [articles, setArticles] = useState<ScienceArticle[]>([]);
  const [discoveryPage, setDiscoveryPage] = useState(1);
  const [savedPage, setSavedPage] = useState(1);
  const [snapshot, setSnapshot] = useState<ContentDiscoverySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const [updatingSources, setUpdatingSources] = useState(false);
  const [activeArticle, setActiveArticle] = useState<ScienceArticle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload() {
    const [saved, discovered] = await Promise.all([fetchScienceArticles(), fetchContentDiscovery()]);
    setArticles(saved); setSnapshot(discovered);
  }

  async function refreshSources() {
    if (updatingSources) return;
    setUpdatingSources(true); setError(null);
    try {
      const knownCandidateIds = new Set(snapshot?.candidates.map((candidate) => candidate.id) ?? []);
      const knownSavedUrls = new Set(articles.map((article) => article.sourceUrl));
      const discovered = await refreshContentDiscovery();
      setSnapshot(discovered);
      const refreshedArticles = await fetchScienceArticles();
      setArticles(refreshedArticles);
      const newCandidateCount = discovered.candidates.filter((candidate) => isScienceReadingCandidate(candidate) && !knownCandidateIds.has(candidate.id)).length;
      const newSavedCount = refreshedArticles.filter((article) => !knownSavedUrls.has(article.sourceUrl)).length;
      const failedSources = discovered.sources.filter((source) => source.status === "error");
      const sourceLabels: Record<string, string> = {
        "science-news-explores": "Science News Explores",
        "noaa-ocean-facts": "NOAA Ocean Facts", "nasa-space-place": "NASA Space Place",
        "nps-animals": "NPS 动物科普", "our-world-in-data": "Our World in Data", "bitcoin-org": "Bitcoin.org",
      };
      const outcome = scienceDiscoveryRefreshNotice(newCandidateCount, newSavedCount);
      const failureSummary = failedSources.length ? " 更新失败：" + failedSources.map((source) => sourceLabels[source.sourceId] ?? source.sourceId).join("、") + "。" : "";
      setNotice(outcome + failureSummary);
      setDiscoveryPage(1);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "更新失败"); }
    finally { setUpdatingSources(false); }
  }
  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchScienceArticles(), fetchContentDiscovery()]).then(([saved, discovered]) => {
      if (!cancelled) { setArticles(saved); setSnapshot(discovered); }
    }).catch((requestError: unknown) => {
      if (!cancelled) setError(requestError instanceof Error ? requestError.message : "读取科普文章失败");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function collect(candidate: DiscoveryCandidate) {
    if (busyUrl) return;
    setBusyUrl(candidate.sourceUrl); setError(null);
    try { const article = await importScienceArticle(candidate.sourceUrl); setArticles((current) => [article, ...current.filter((item) => item.id !== article.id)]); setSavedPage(1); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "收录文章失败"); }
    finally { setBusyUrl(null); }
  }

  async function remove(article: ScienceArticle) {
    if (!window.confirm(`从“我的科普文章”中移除《${article.title}》？`)) return;
    try { await deleteScienceArticle(article.id); setArticles((current) => current.filter((item) => item.id !== article.id)); if (activeArticle?.id === article.id) setActiveArticle(null); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "移除文章失败"); }
  }

  async function completeArticle(article: ScienceArticle) {
    if (busyUrl) return;
    setBusyUrl(article.sourceUrl); setError(null); setNotice(null);
    try {
      const updated = await refreshScienceArticle(article.id);
      setArticles((current) => current.map((item) => item.id === updated.id ? updated : item));
      setActiveArticle((current) => current?.id === updated.id ? updated : current);
      const cachedImages = scienceArticleImages(updated.blocks ?? []).filter((image) => image.status === "cached").length;
      setNotice(`原文图文已补全：正文已保存，本机图片 ${cachedImages} 张。受限或外站图片仍会保留来源说明。`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "补全原文图文失败，原有内容仍保留"); }
    finally { setBusyUrl(null); }
  }

  if (activeArticle) return <main className="page science-article-reader">
    <div className="science-reader-actions"><button className="text-button" onClick={() => setActiveArticle(null)}>← 返回科普文章</button>
      {activeArticle.contentVersion !== 2 && <button className="text-button" disabled={Boolean(busyUrl)} onClick={() => void completeArticle(activeArticle)}>{busyUrl ? "正在保存图文…" : "补全原文图文"}</button>}</div>
    {error && <div className="issue-delete-error" role="alert">{error}</div>}
    {notice && <div className="discovery-saved-label" role="status">{notice}</div>}
    <article className="science-article-paper">
      <div className="eyebrow">我的科普文章 · {activeArticle.sourceName}</div>
      <h1>{scienceArticleGuide(activeArticle.title).titleZh}</h1>
      <p className="science-article-original-title">{activeArticle.title}</p>
      <p className="science-article-byline">{activeArticle.author || activeArticle.sourceName} · {savedArticleDateLabel(activeArticle)}</p>
      <ScienceArticleContent key={`${activeArticle.id}:${activeArticle.updatedAt ?? activeArticle.savedAt}`} article={activeArticle} />
      <footer>{activeArticle.credit} · <a href={activeArticle.sourceUrl} target="_blank" rel="noreferrer">原文链接</a></footer>
    </article>
  </main>;

  const candidates = snapshot?.candidates.filter(isScienceReadingCandidate) ?? [];
  const sortedCandidates = [...candidates].sort(compareScienceCandidatesByRecency);
  const discoveryPageCount = Math.max(1, Math.ceil(sortedCandidates.length / discoveryArticlesPerPage));
  const visibleDiscoveryPage = Math.min(discoveryPage, discoveryPageCount);
  const visibleCandidates = sortedCandidates.slice((visibleDiscoveryPage - 1) * discoveryArticlesPerPage, visibleDiscoveryPage * discoveryArticlesPerPage);
  const savedUrls = new Set(articles.map((article) => article.sourceUrl));
  const savedArticles = [...articles].sort((left, right) => right.savedAt.localeCompare(left.savedAt));
  const savedPageCount = Math.max(1, Math.ceil(savedArticles.length / savedArticlesPerPage));
  const visibleSavedPage = Math.min(savedPage, savedPageCount);
  const visibleSavedArticles = savedArticles.slice((visibleSavedPage - 1) * savedArticlesPerPage, visibleSavedPage * savedArticlesPerPage);
  return <main className="page science-article-library">
    <section className="page-heading-row"><div><div className="eyebrow">Your science reading</div><h1>科普文章</h1><p>可收录的文章会保存正文到本机，之后可离线阅读；电子书仍在电子书书架中。</p></div>
      <button className="text-button" disabled={loading || Boolean(busyUrl)} onClick={() => { setLoading(true); void reload().catch((e: unknown) => setError(e instanceof Error ? e.message : "刷新失败")).finally(() => setLoading(false)); }}>刷新</button>
    </section>
    {error && <div className="issue-delete-error" role="alert">{error}</div>}
    {notice && <div className="discovery-saved-label" role="status">{notice}</div>}
    <section className="section-block content-discovery-section" aria-labelledby="science-discovery-title">
      <div className="section-title-row"><div><div className="eyebrow">Automatic discovery</div><h2 id="science-discovery-title">发现文章</h2></div>
        <button className="text-button" disabled={Boolean(busyUrl) || updatingSources} onClick={() => void refreshSources()}>{updatingSources ? "正在更新来源…" : "立即更新来源"}</button></div>
      <p className="muted-text">探索动物、健康、经济、商业、科技、AI、比特币与加密货币。来源正常时每天提供多篇可选内容，最多自动收录 10 篇；会跳过明显过难内容。</p>
      {snapshot?.sources.some((source) => source.status === "error") && <details className="science-source-errors"><summary>查看更新失败的来源</summary><ul>{snapshot.sources.filter((source) => source.status === "error").map((source) => <li key={source.sourceId}><strong>{source.sourceId === "our-world-in-data" ? "Our World in Data" : source.sourceId === "bitcoin-org" ? "Bitcoin.org" : source.sourceId === "nps-animals" ? "NPS 动物科普" : source.sourceId}</strong>：{source.error ?? "暂时无法更新"}</li>)}</ul></details>}
      {loading ? <div className="empty-panel">正在读取文章…</div> : candidates.length ? <><div className="discovery-list science-article-card-grid">{visibleCandidates.map((candidate) => {
        const guide = scienceArticleGuide(candidate.title);
        return <article className="discovery-card science-discovery-card" key={candidate.id}>
        <div className="discovery-card-copy"><div className="science-card-meta"><span className="discovery-source">{candidate.sourceName}{candidate.author ? ` · ${candidate.author}` : ""}</span>{discoveryDateLabel(candidate) && <span className="science-article-date">{discoveryDateLabel(candidate)}</span>}</div><h3>{candidate.title}</h3>
          <span className="science-article-translated-title">{guide.titleZh}</span><span className="science-article-teaser">{guide.teaserZh}</span></div>
        {savedUrls.has(candidate.sourceUrl) ? <div className="science-discovery-actions"><span className="discovery-saved-label">已收录</span><button className="text-button" onClick={() => { const saved = articles.find((article) => article.sourceUrl === candidate.sourceUrl); if (saved) setActiveArticle(saved); }}>开始阅读</button></div> : candidate.contentPolicy !== "link-only"
          ? <button className="text-button" disabled={Boolean(busyUrl)} onClick={() => void collect(candidate)}>{busyUrl === candidate.sourceUrl ? "正在收录图文…" : "加入我的文章"}</button>
          : <a href={candidate.sourceUrl} target="_blank" rel="noreferrer">查看来源 ↗</a>}
        </article>})}</div>{discoveryPageCount > 1 && <nav className="science-article-pagination" aria-label="发现文章分页">
          <button className="text-button" disabled={visibleDiscoveryPage === 1} onClick={() => setDiscoveryPage(visibleDiscoveryPage - 1)}>上一页</button>
          {Array.from({ length: discoveryPageCount }, (_item, index) => index + 1).map((page) => <button key={page} className={`science-article-page-number${page === visibleDiscoveryPage ? " is-current" : ""}`} aria-current={page === visibleDiscoveryPage ? "page" : undefined} aria-label={`第 ${page} 页`} onClick={() => setDiscoveryPage(page)}>{page}</button>)}
          <button className="text-button" disabled={visibleDiscoveryPage === discoveryPageCount} onClick={() => setDiscoveryPage(visibleDiscoveryPage + 1)}>下一页</button>
        </nav>}</> : <div className="empty-panel">暂无候选。在线时可更新来源，或稍后再试。</div>}
    </section>
    <details className="section-block science-article-saved-library"><summary><span className="eyebrow">Saved locally</span><strong>我的科普文章 · {articles.length}</strong><span className="science-article-saved-hint">展开已收录文章</span></summary>
      {loading ? <div className="empty-panel">正在读取本机书架…</div> : articles.length ? <><div className="discovery-list science-article-card-grid">{visibleSavedArticles.map((article) => {
        const guide = scienceArticleGuide(article.title);
        return <article className="discovery-card science-discovery-card" key={article.id}>
        <div className="discovery-card-copy"><div className="science-card-meta"><span className="discovery-source">{article.sourceName} · {article.author || article.sourceName}</span>{savedArticleDateLabel(article) && <span className="science-article-date">{savedArticleDateLabel(article)}</span>}</div><h3>{article.title}</h3><span className="science-article-translated-title">{guide.titleZh}</span><span className="science-article-teaser">{guide.teaserZh}</span><span className="discovery-policy">{article.contentVersion === 2 ? `已保存图文 · ${scienceArticleImages(article.blocks ?? []).filter((image) => image.status === "cached").length} 张本机图片` : "已保存正文 · 可补全原文图文"} · {article.credit}</span></div>
        <div className="science-article-actions"><button className="text-button" onClick={() => setActiveArticle(article)}>开始阅读</button>{article.contentVersion !== 2 && <button className="text-button" disabled={Boolean(busyUrl)} onClick={() => void completeArticle(article)}>{busyUrl === article.sourceUrl ? "正在保存图文…" : "补全原文图文"}</button>}<button className="text-button" disabled={Boolean(busyUrl)} onClick={() => void remove(article)}>移除</button></div>
      </article>})}</div>{savedPageCount > 1 && <nav className="science-article-pagination" aria-label="已收录文章分页">
        <button className="text-button" disabled={visibleSavedPage === 1} onClick={() => setSavedPage(visibleSavedPage - 1)}>上一页</button>
        {Array.from({ length: savedPageCount }, (_item, index) => index + 1).map((page) => <button key={page} className={`science-article-page-number${page === visibleSavedPage ? " is-current" : ""}`} aria-current={page === visibleSavedPage ? "page" : undefined} aria-label={`第 ${page} 页`} onClick={() => setSavedPage(page)}>{page}</button>)}
        <button className="text-button" disabled={visibleSavedPage === savedPageCount} onClick={() => setSavedPage(visibleSavedPage + 1)}>下一页</button>
      </nav>}</> : <div className="empty-panel">收录的文章会保存在这里，不会混入电子书书架。</div>}
    </details>
  </main>;
}

function BookLibraryPage({ books, loading, error, onOpenBook, onImported, onDeleted, continueCard, view, onViewChange }: { books: BookSummary[]; loading: boolean; error: string | null; onOpenBook: (bookId: string) => void; onImported: () => Promise<void>; onDeleted: (bookId: string) => void; continueCard?: ReactNode; view: BookShelfView; onViewChange: (view: BookShelfView) => void }) {
  const [menuBookId, setMenuBookId] = useState<string | null>(null);
  const [deletingBook, setDeletingBook] = useState<BookSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [categoryBook, setCategoryBook] = useState<BookSummary | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<BookCategoryId>("uncategorized");
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const categoryDialogRef = useRef<HTMLDialogElement>(null);
  const visibleBooks = useMemo(() => filterBookShelf(books, view), [books, view]);
  const filtered = Boolean(view.query.trim()) || view.categoryId !== "all";
  useEffect(() => {
    if (categoryBook) categoryDialogRef.current?.showModal();
    else categoryDialogRef.current?.close();
  }, [categoryBook]);

  async function saveCategory() {
    if (!categoryBook || savingCategory) return;
    setSavingCategory(true); setCategoryError(null);
    try { await updateBookCategory(categoryBook.id, selectedCategory); await onImported(); setCategoryBook(null); }
    catch (error) { setCategoryError(error instanceof Error ? error.message : "分类保存失败，请重试。"); }
    finally { setSavingCategory(false); }
  }
  useEffect(() => {
    if (deletingBook) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [deletingBook]);

  async function confirmDelete() {
    if (!deletingBook || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteBook(deletingBook.id);
      onDeleted(deletingBook.id);
      setDeletingBook(null);
      await onImported();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除电子书失败");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="page book-library-page">
      <section className="page-heading-row">
        <div><div className="eyebrow">Book library</div><h1>电子书</h1><p>按书名查找，或按分类挑一本想读的书。</p></div>
        <div className="library-heading-actions"><BookEpubImportControl onImported={onImported} /><div className="demo-chip">Local · books/</div></div>
      </section>
      {continueCard}
      <section className="section-block library-shelf-section">
        <div className="section-title-row"><div><div className="eyebrow">Bookshelf</div><h2>{books.length} 本电子书</h2></div><span className="muted-text">{filtered ? `显示 ${visibleBooks.length} / ${books.length} 本` : "你的本机书库"}</span></div>
        <div className="book-shelf-controls" role="search" aria-label="查找书架中的书">
          <label className="book-shelf-search">搜索书名<input type="search" placeholder="输入书名…" aria-label="搜索书名" value={view.query} onChange={event => onViewChange({ ...view, query: event.target.value })} /></label>
          <label className="book-shelf-category">分类<select aria-label="按分类筛选电子书" value={view.categoryId} onChange={event => onViewChange({ ...view, categoryId: event.target.value as BookShelfView["categoryId"] })}>
            <option value="all">全部分类（{books.length}）</option>
            {BOOK_CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.label}（{books.filter(book => (book.categoryId ?? "uncategorized") === category.id).length}）</option>)}
          </select></label>
          {filtered && <button className="text-button book-shelf-reset" onClick={() => onViewChange({ query: "", categoryId: "all" })}>清除筛选</button>}
        </div>
        {error && <div className="issue-delete-error">读取电子书书架失败：{error}</div>}
        {deleteError && !deletingBook && <div className="issue-delete-error" role="alert">{deleteError}</div>}
        {loading ? <div className="empty-panel">正在读取 books/…</div> : (
          <div className="library-grid book-library-grid" data-testid="book-library-grid">
            {visibleBooks.map((book) => (
              <div className="book-library-card-wrapper" key={book.id}>
              <button className="library-book book-library-card" data-testid={`book-card-${book.id}`} onClick={() => onOpenBook(book.id)}>
                <BookCover bookId={book.id} title={book.title} hasCover={book.hasCover} compact />
                <div className="library-book-copy">
                  <span className="library-book-publication">{bookCategoryLabel(book.categoryId)}</span>
                  <strong>{book.title}</strong>
                  <span>{book.authors.length ? book.authors.join(" · ") : "作者未知"}</span>
                  <span className="book-library-meta">{book.partCount} Parts · {book.numberedChapterCount} Chapters · {book.readableUnitCount} 个可读单元</span>
                </div>
              </button>
              <div className="book-library-actions" onKeyDown={(event) => { if (event.key === "Escape") setMenuBookId(null); }}>
                <button className="icon-button" aria-label={`管理电子书：${book.title}`} aria-expanded={menuBookId === book.id} onClick={() => setMenuBookId(menuBookId === book.id ? null : book.id)}>⋯</button>
                {menuBookId === book.id && <div className="book-library-menu">
                  <button className="text-button" onClick={() => { setMenuBookId(null); setCategoryBook(book); setSelectedCategory(book.categoryId ?? "uncategorized"); setCategoryError(null); }}>修改分类</button>
                  <button className="text-button is-danger" onClick={() => { setMenuBookId(null); setDeleteError(null); setDeletingBook(book); }}>删除此书</button>
                </div>}
              </div>
              </div>
            ))}
          </div>
        )}
        {!loading && !books.length && !error && <div className="empty-panel">电子书库还是空的。可以使用上方“导入电子书”把普通 EPUB 复制到本机 books/。</div>}
        {!loading && books.length > 0 && !visibleBooks.length && !error && <div className="empty-panel" role="status">没有找到符合条件的书。试试其他书名或分类，或清除筛选。</div>}
      </section>
      <dialog ref={categoryDialogRef} className="book-delete-dialog book-category-dialog" aria-labelledby="book-category-title" onCancel={event => { event.preventDefault(); if (!savingCategory) setCategoryBook(null); }}>
        <h2 id="book-category-title">修改分类</h2><p>{categoryBook?.title}</p>
        <label className="book-import-category">分类<select aria-label="书籍分类" value={selectedCategory} disabled={savingCategory} onChange={event => setSelectedCategory(event.target.value as BookCategoryId)}>{BOOK_CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
        {categoryError && <p role="alert">{categoryError}</p>}
        <div className="book-delete-dialog-actions"><button className="text-button" disabled={savingCategory} onClick={() => setCategoryBook(null)}>取消</button><button className="primary-button" disabled={savingCategory} onClick={() => void saveCategory()}>{savingCategory ? "正在保存…" : "保存分类"}</button></div>
      </dialog>
      <dialog ref={dialogRef} className="book-delete-dialog" aria-labelledby="book-delete-title" onCancel={(event) => { event.preventDefault(); if (!deleting) setDeletingBook(null); }}>
        <h2 id="book-delete-title">删除《{deletingBook?.title}》？</h2>
        <p>将删除本机阅读书库中的 EPUB 副本和可重新生成的中文目录缓存。</p>
        <p>导入前的原文件不会受影响。笔记、词汇和阅读记录会保留；书籍移除后，相关记录暂时无法打开原文。</p>
        {deleteError && <p className="issue-delete-error" role="alert">{deleteError}</p>}
        <div className="book-delete-dialog-actions">
          <button className="text-button" autoFocus disabled={deleting} onClick={() => setDeletingBook(null)}>取消</button>
          <button className="primary-button book-delete-confirm" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? "正在删除…" : "删除此书"}</button>
        </div>
      </dialog>
    </div>
  );
}

function BookDetailPage({ lessonsSection, lessonCount, lessonsLoading, book, loading, error, tocStatus, tocError, onRegenerate, onBack, onOpenChapter, readerState }: { lessonsSection: ReactNode; lessonCount: number; lessonsLoading: boolean; readerState: ReaderStateData; book: BookRecord | null; loading: boolean; error: string | null; tocStatus: BookTocChineseStatus | null; tocError: string | null; onRegenerate: () => void; onBack: () => void; onOpenChapter: (chapterId: string) => void }) {
  if (loading) return <div className="page"><button className="text-button" onClick={onBack}>← 返回电子书</button><div className="empty-panel">正在读取电子书目录…</div></div>;
  if (error || !book) return <div className="page"><button className="text-button" onClick={onBack}>← 返回电子书</button><div className="empty-panel">{error ? `无法读取电子书：${error}` : "这本电子书不存在。"}</div></div>;
  const groups = buildBookTocGroups(book);
  const continueChapter = resolveBookContinueChapter(book, readerState.lastBookPosition, readerState.bookProgress);
  const tocTitles = tocStatus?.titles;
  return (
    <div className="page book-detail-page">
      <button className="text-button" onClick={onBack}>← 返回电子书</button>
      <section className="book-detail-hero">
        <BookCover bookId={book.id} title={book.title} hasCover={Boolean(book.cover)} />
        <div className="book-detail-copy">
          <div className="eyebrow">Book · {book.epubVersion} · {book.navigationType.toUpperCase()}</div>
          <h1>{book.title}</h1>
          <p className="book-detail-authors">{book.authors.length ? book.authors.join(" · ") : "作者未知"}</p>
          <div className="book-detail-metadata"><span>{book.publisher ?? "出版社未知"}</span>{book.publishedAt && <span>{book.publishedAt}</span>}<span>{book.language ?? "语言未知"}</span></div>
          <div className="issue-stats"><div><strong>{book.parts.length}</strong><span>Parts</span></div><div><strong>{book.numberedChapterCount}</strong><span>Chapters</span></div><div><strong>{book.chapters.length}</strong><span>可读单元</span></div></div>
          {continueChapter && <button className="primary-button" data-testid="book-detail-continue" onClick={() => onOpenChapter(continueChapter.id)}>继续阅读 · {continueChapter.title} →</button>}
          <div className="book-reader-boundary">点击目录即可进入 Reader。阅读进度、翻译、查词、AI 与 Reader 内笔记使用 Book 独立身份保存。</div>
        </div>
      </section>
      <BookDetailTabs key={book.id} bookId={book.id} lessonCount={lessonCount} lessonsLoading={lessonsLoading} lessons={lessonsSection}>
      <section className="toc-card book-toc-card">
        <div className="section-title-row"><div><div className="eyebrow">Table of contents</div><h2>目录</h2></div><span className="muted-text">保持 EPUB 原始阅读顺序</span></div>
        <div className="book-toc-status" data-testid="book-toc-chinese-status">
          <span>{tocError ?? tocStatus?.error ?? (tocStatus?.state === "running" ? "中文目录生成中…" : tocStatus?.state === "ready" ? `中文目录已缓存 · ${tocStatus.model}` : "中文目录尚未生成；请配置 AI 服务")}</span>
          {tocStatus?.state !== "running" && <button className="text-button" onClick={onRegenerate}>{tocStatus?.state === "ready" ? "用当前模型重新生成" : "生成中文目录"}</button>}
        </div>
        {groups.map((group) => (
          <div className="toc-section book-toc-section" key={group.id} data-testid={`book-toc-group-${group.id}`}>
            <div className="toc-section-name">{group.kind === "part" && tocTitles?.parts[group.id.slice(5)] ? <><span>{group.label} · {group.title}</span><small>{tocTitles.parts[group.id.slice(5)]}</small></> : <><span>{group.label}</span>{group.title !== group.label && <small>{group.title}</small>}</>}</div>
            <div className="book-toc-list">
              {group.chapters.map((chapter) => (
                <button className="book-toc-row" key={chapter.id} data-testid={`book-toc-chapter-${chapter.id}`} onClick={() => onOpenChapter(chapter.id)}>
                  <span className="toc-index">{String(chapter.order).padStart(2, "0")}</span>
                  <div className="book-toc-copy"><span className="book-toc-title-original">{chapter.title}</span>{tocTitles?.chapters[chapter.id] && <span className="book-toc-title-zh">{tocTitles.chapters[chapter.id]}</span>}<small>{bookChapterRoleLabel(chapter.role)} · {chapter.paragraphs.length} 段 · {chapter.wordCount.toLocaleString()} 词</small></div>
                  <span className="book-toc-open">阅读 →</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
      </BookDetailTabs>
    </div>
  );
}

function LibraryPage({ continueCard, issues, lastPosition, publicationFilter, onPublicationFilterChange, onOpenPublication, onContinue, onImported }: {
  issues: ReaderIssue[];
  lastPosition: ReaderStateData["lastPosition"];
  continueCard?: ReactNode;
  publicationFilter: LibraryPublicationFilter;
  onPublicationFilterChange: (filter: LibraryPublicationFilter) => void;
  onOpenPublication: (publicationId: PublicationId) => void;
  onContinue: (issueId: string, articleId: string) => void;
  onImported: () => Promise<void>;
}) {
  const lastRead = lastPosition ? findArticle(issues, lastPosition.articleId, lastPosition.issueId) : undefined;
  const current = lastRead?.issue ?? issues[0];
  const currentArticle = lastRead?.article ?? (current ? flattenArticles(current)[0] : undefined);
  const shelf = buildPublicationShelf(issues);
  const shelfByPublication = new Map(shelf.map((item) => [item.publicationId, item]));
  const visiblePublications = shelf.filter((item) => publicationFilter === "all" || item.publicationId === publicationFilter);
  const visibleHeading = publicationFilter === "all" ? `${shelf.length}本杂志` : PUBLICATIONS[publicationFilter].name;
  const visibleIssueCount = visiblePublications.reduce((sum, item) => sum + item.issueCount, 0);

  return (
    <div className="page library-page">
      <section className="page-heading-row"><div><div className="eyebrow">Your reading space</div><h1>阅读空间</h1><p>统一续读期刊、电子书和精选阅读。阅读进度与学习数据留在本机。</p></div><div className="library-heading-actions"><EpubImportControl onImported={onImported} /><div className="demo-chip">Real EPUB · Local</div></div></section>
      {continueCard ?? (currentArticle && <section className="continue-card" data-testid="continue-reading"><IssueCover issue={current} compact preferReal /><div className="continue-copy"><div className="eyebrow">继续阅读 · {current.publicationName}</div><h2>{currentArticle.title}</h2>{currentArticle.titleZh && <div className="continue-title-zh">{currentArticle.titleZh}</div>}<p>{currentArticle.summaryZh || currentArticle.subtitle}</p><div className="continue-meta"><span>{current.publicationName}</span><span>·</span><span>{current.displayDate}</span><span>·</span><span>{currentArticle.section}</span><span>·</span><span>约 {currentArticle.minutes} 分钟</span></div><div className="continue-progress"><ProgressBar value={currentArticle.progress} /><span>{currentArticle.progress}%</span></div><button className="primary-button" onClick={() => onContinue(current.id, currentArticle.id)}>继续阅读 →</button></div></section>)}
      <section className="section-block library-shelf-section">
        <div className="section-title-row"><div><div className="eyebrow">Magazine shelf</div><h2>{visibleHeading}</h2></div><span className="muted-text">共 {visibleIssueCount} 期</span></div>
        <div className="library-publication-tabs" aria-label="书架杂志筛选">
          <button className={publicationFilter === "all" ? "is-active" : ""} aria-label="显示全部杂志" aria-pressed={publicationFilter === "all"} onClick={() => onPublicationFilterChange("all")}><span>全部</span><small>{shelf.length}</small></button>
          {Object.values(PUBLICATIONS).map((publication) => <button key={publication.id} className={publicationFilter === publication.id ? "is-active" : ""} aria-label={`筛选 ${publication.name}`} aria-pressed={publicationFilter === publication.id} onClick={() => onPublicationFilterChange(publication.id)}><span>{publication.name}</span><small>{shelfByPublication.get(publication.id)?.issueCount ?? 0}</small></button>)}
        </div>
        <div className="library-grid" data-testid="library-publication-grid">
          {visiblePublications.map((publication) => {
            const progressIssue = publication.recentIssue;
            const progressLabel = progressIssue.id === publication.latestIssue.id ? `最新一期已读 ${progressIssue.progress}%` : `${progressIssue.displayDate} 已读 ${progressIssue.progress}%`;
            return <button className="library-book" key={publication.publicationId} onClick={() => onOpenPublication(publication.publicationId)} data-testid={`publication-card-${publication.publicationId}`} data-publication-id={publication.publicationId}><IssueCover issue={publication.latestIssue} compact preferReal /><div className="library-book-copy"><span className="library-book-publication">{publication.publicationName}</span><strong>最新一期 · {publication.latestIssue.displayDate}</strong><span>共 {publication.issueCount} 期 · 最新一期 {publication.latestArticleCount} 篇文章</span><ProgressBar value={progressIssue.progress} /><span className="book-progress-label">{progressLabel}</span></div></button>;
          })}
        </div>
        {!visiblePublications.length && <div className="empty-panel">{publicationFilter === "all" ? "书库还没有 EPUB。可以使用上方“导入 EPUB”添加期刊。" : "这个杂志暂时还没有可阅读的 EPUB。"}</div>}
      </section>
    </div>
  );
}

function epubReplacementStatusLabel(status: EpubReplacementPreview["status"]): string {
  if (status === "ready") return "可以替换";
  if (status === "mismatch") return "期次不匹配";
  if (status === "unsupported") return "不支持";
  if (status === "missing") return "目标不存在";
  if (status === "replaced") return "已替换";
  return "无法解析";
}

function PublicationIssuesPage({ issues, publicationId, onBack, onOpenIssue, onDeleteIssue, onReplaceIssue }: {
  issues: ReaderIssue[];
  publicationId: PublicationId;
  onBack: () => void;
  onOpenIssue: (issueId: string) => void;
  onDeleteIssue: (issueId: string) => Promise<void>;
  onReplaceIssue: (issueId: string) => Promise<void>;
}) {
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const [deletingIssueId, setDeletingIssueId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [managementMenuIssueId, setManagementMenuIssueId] = useState<string | null>(null);
  const [replacementIssue, setReplacementIssue] = useState<ReaderIssue | null>(null);
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [replacementPreview, setReplacementPreview] = useState<EpubReplacementPreview | null>(null);
  const [replacementPreparing, setReplacementPreparing] = useState(false);
  const [replacingIssueId, setReplacingIssueId] = useState<string | null>(null);
  const [replacementError, setReplacementError] = useState<string | null>(null);
  const publication = buildPublicationShelf(issues).find((item) => item.publicationId === publicationId);
  if (!publication) return <div className="page"><button className="text-button" onClick={onBack}>← 返回期刊</button><div className="empty-panel">这个杂志暂时还没有可阅读的 EPUB。</div></div>;

  async function confirmDelete(issue: ReaderIssue) {
    setManagementMenuIssueId(null);
    const confirmed = window.confirm(`确定删除 ${issue.publicationName} · ${issue.displayDate} 吗？\n\n将删除该期 EPUB 和可重新生成的本期缓存。你的笔记、词汇、稍后阅读、阅读历史和阅读位置不会删除。`);
    if (!confirmed) return;
    setDeleteError(null);
    setDeletingIssueId(issue.id);
    try {
      await onDeleteIssue(issue.id);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除期刊失败");
    } finally {
      setDeletingIssueId(null);
    }
  }

  function chooseReplacement(issue: ReaderIssue) {
    setManagementMenuIssueId(null);
    setReplacementIssue(issue);
    setReplacementFile(null);
    setReplacementPreview(null);
    setReplacementError(null);
    if (replacementInputRef.current) replacementInputRef.current.value = "";
    replacementInputRef.current?.click();
  }

  async function prepareReplacement(file: File | undefined) {
    if (!file || !replacementIssue) return;
    setReplacementFile(file);
    setReplacementPreparing(true);
    setReplacementError(null);
    try {
      setReplacementPreview(await previewEpubReplacement(replacementIssue.id, file));
    } catch (error) {
      setReplacementPreview(null);
      setReplacementError(error instanceof Error ? error.message : "替换 EPUB 校验失败。");
    } finally {
      setReplacementPreparing(false);
    }
  }

  function closeReplacement() {
    if (replacingIssueId) return;
    setReplacementIssue(null);
    setReplacementFile(null);
    setReplacementPreview(null);
    setReplacementError(null);
    if (replacementInputRef.current) replacementInputRef.current.value = "";
  }

  async function confirmReplacement() {
    if (!replacementIssue || !replacementFile || replacementPreview?.status !== "ready" || replacingIssueId) return;
    const confirmed = window.confirm(`确定用 ${replacementFile.name} 替换 ${replacementIssue.publicationName} · ${replacementIssue.displayDate} 吗？\n\n正式 issueId 不会变化；笔记、词汇、稍后阅读、历史和阅读位置继续保留。旧的本期解析缓存与中文导读会按新 EPUB 重新生成。`);
    if (!confirmed) return;
    const issueId = replacementIssue.id;
    setReplacingIssueId(issueId);
    setReplacementError(null);
    try {
      const result = await replaceEpub(issueId, replacementFile);
      setReplacementPreview(result);
      if (result.status === "replaced") {
        await onReplaceIssue(issueId);
        setReplacementIssue(null);
        setReplacementFile(null);
        setReplacementPreview(null);
        if (replacementInputRef.current) replacementInputRef.current.value = "";
      }
    } catch (error) {
      setReplacementError(error instanceof Error ? error.message : "替换 EPUB 失败。");
    } finally {
      setReplacingIssueId(null);
    }
  }

  return (
    <div className="page publication-page">
      <button className="text-button" onClick={onBack}>← 返回期刊</button>
      <section className="page-heading-row publication-heading-row">
        <div><div className="eyebrow">Issue archive</div><h1>{publication.publicationName}</h1><p>按期浏览和管理本地 EPUB。最新一期为 {publication.latestIssue.displayDate}。</p></div>
        <div className="demo-chip">{publication.issueCount} 期</div>
      </section>
      <section className="section-block publication-issues-section">
        <div className="section-title-row"><div><div className="eyebrow">All issues</div><h2>全部期次</h2></div><span className="muted-text">{publication.issueCount} 期 · 从新到旧</span></div>
        {deleteError && <div className="issue-delete-error" role="alert">{deleteError}</div>}
        <div className="library-grid publication-issue-grid" data-testid="publication-issue-grid">
          {publication.issues.map((issue, index) => (
            <div className="publication-issue-card" key={issue.id}>
              <button className="library-book" onClick={() => onOpenIssue(issue.id)} data-testid={`issue-card-${issue.id}`} data-publication-id={issue.publicationId} disabled={deletingIssueId === issue.id || replacingIssueId === issue.id}>
                <IssueCover issue={issue} compact preferReal />
                <div className="library-book-copy"><span className="library-book-publication">{index === 0 ? "最新一期" : "往期"}</span><strong>{issue.displayDate}</strong><span>{flattenArticles(issue).length} 篇文章</span><ProgressBar value={issue.progress} /><span className="book-progress-label">已读 {issue.progress}%</span></div>
              </button>
              <div className="issue-management-actions">
                <button
                  className="text-button issue-more-button"
                  aria-label={`更多操作：${issue.publicationName} ${issue.displayDate}`}
                  aria-expanded={managementMenuIssueId === issue.id}
                  aria-controls={`issue-management-menu-${issue.id}`}
                  disabled={deletingIssueId !== null || replacingIssueId !== null}
                  onClick={() => setManagementMenuIssueId((current) => current === issue.id ? null : issue.id)}
                >··· 更多</button>
                {managementMenuIssueId === issue.id && (
                  <div className="issue-management-menu" id={`issue-management-menu-${issue.id}`} role="menu" data-testid={`issue-management-menu-${issue.id}`}>
                    <button role="menuitem" className="issue-replace-button" aria-label={`替换期刊：${issue.publicationName} ${issue.displayDate}`} onClick={() => chooseReplacement(issue)}>{replacingIssueId === issue.id ? "正在替换…" : "替换 EPUB"}</button>
                    <button role="menuitem" className="issue-delete-button" aria-label={`删除期刊：${issue.publicationName} ${issue.displayDate}`} onClick={() => void confirmDelete(issue)}>{deletingIssueId === issue.id ? "正在删除…" : "删除这期"}</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      <input ref={replacementInputRef} className="epub-import-input" data-testid="epub-replacement-input" type="file" accept=".epub,application/epub+zip" onChange={(event) => void prepareReplacement(event.target.files?.[0])} />
      {replacementIssue && (replacementPreparing || replacementFile || replacementError) && (
        <div className="epub-import-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeReplacement(); }}>
          <section className="epub-import-dialog" role="dialog" aria-modal="true" aria-labelledby="epub-replacement-title" data-testid="epub-replacement-dialog">
            <header className="epub-import-dialog-header">
              <div><div className="eyebrow">Replace EPUB</div><h2 id="epub-replacement-title">替换这一期</h2><p>只接受同一本杂志、同一个日期的修正版 EPUB。正式 issueId 与用户学习数据不会改变。</p></div>
              <button className="icon-button" aria-label="关闭替换窗口" disabled={Boolean(replacingIssueId)} onClick={closeReplacement}>×</button>
            </header>
            {replacementPreparing ? (
              <div className="epub-import-preparing"><strong>正在校验修正版 EPUB…</strong><span>正在解析杂志、日期、目录、文章和封面。</span></div>
            ) : replacementPreview && replacementFile ? (
              <div className="epub-import-list">
                <article className={`epub-import-row status-${replacementPreview.status}`} data-testid="epub-replacement-preview">
                  <div className="epub-import-cover">{replacementPreview.coverDataUrl ? <img src={replacementPreview.coverDataUrl} alt="" /> : <span>{replacementPreview.publicationName?.slice(0, 1) ?? "E"}</span>}</div>
                  <div className="epub-import-copy">
                    <strong>{replacementPreview.publicationName ?? replacementFile.name}</strong>
                    <span className="epub-import-filename">{replacementFile.name}</span>
                    {replacementPreview.date && <span>{replacementPreview.date}{typeof replacementPreview.articleCount === "number" ? ` · ${replacementPreview.articleCount} 篇文章` : ""}{typeof replacementPreview.sectionCount === "number" ? ` · ${replacementPreview.sectionCount} 个栏目` : ""}</span>}
                    <small>{replacementPreview.message}</small>
                  </div>
                  <span className={`epub-import-status status-${replacementPreview.status}`}>{epubReplacementStatusLabel(replacementPreview.status)}</span>
                </article>
              </div>
            ) : null}
            {replacementError && <div className="epub-import-error" role="alert">{replacementError}</div>}
            <footer className="epub-import-dialog-footer">
              <span>{replacementPreview?.status === "ready" ? "校验通过后仍需再次确认" : replacementPreview ? "这个文件不能用于替换当前期次" : "请选择修正版 EPUB"}</span>
              <div>
                <button className="text-button epub-import-cancel" disabled={Boolean(replacingIssueId)} onClick={closeReplacement}>取消</button>
                {replacementPreview?.status === "ready" && <button className="primary-button" disabled={replacementPreparing || Boolean(replacingIssueId)} onClick={() => void confirmReplacement()}>{replacingIssueId ? "正在替换…" : "确认替换"}</button>}
              </div>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function IssuePage({ issue, readLaterState, guideState, guideRequestError, lastPosition, viewState, restoreScrollY, onViewStateChange, onBack, onOpenArticle, onToggleReadLater, onRetryGuides }: {
  issue: ReaderIssue;
  readLaterState: ReadLaterState;
  guideState?: GuideUiState;
  guideRequestError?: string;
  lastPosition: ReaderStateData["lastPosition"];
  viewState: IssueTocViewState;
  restoreScrollY: number;
  onViewStateChange: (state: IssueTocViewState) => void;
  onBack: () => void;
  onOpenArticle: (articleId: string, scrollY: number) => void;
  onToggleReadLater: (articleId: string) => void;
  onRetryGuides: () => void;
}) {
  const articles = flattenArticles(issue);
  const continueArticle = resolveIssueContinueArticle(issue, lastPosition);
  const guidedCount = articles.filter((article) => article.titleZh && article.summaryZh).length;
  const savedSelections = loadSavedSelections(getReaderStorage());
  const activeViewState = viewState.issueId === issue.id ? viewState : freshIssueTocViewState(issue.id);
  const { readingFilter, query: tocQuery } = activeViewState;
  const restoreScrollYRef = useRef(Math.max(0, restoreScrollY));

  useLayoutEffect(() => {
    const scrollY = Math.max(0, restoreScrollYRef.current);
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "auto" }));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [issue.id]);
  const readingFilterCounts = issueReadingFilterCounts(issue, readLaterState, tocQuery);
  const visibleSections = filterIssueSections(issue, readLaterState, readingFilter, tocQuery);
  const readingFilters: Array<{ id: IssueReadingFilter; label: string }> = [
    { id: "all", label: "全部" },
    { id: "unread", label: "未读" },
    { id: "reading", label: "阅读中" },
    { id: "read-later", label: "稍后阅读" },
    { id: "read", label: "已读" },
  ];

  return (
    <div className="page issue-page">
      <button className="text-button" onClick={onBack}>← 返回期次</button>
      <section className="issue-hero">
        <IssueCover issue={issue} preferReal />
        <div className="issue-hero-copy">
          <div className="eyebrow">Issue</div>
          <h1>{issue.displayDate}</h1>
          <p>{issue.description}</p>
          <div className="issue-stats">
            <div><strong>{articles.length}</strong><span>篇文章</span></div>
            <div><strong>{issue.sections.length}</strong><span>个栏目</span></div>
            <div><strong>{issue.progress}%</strong><span>阅读进度</span></div>
          </div>
          <ProgressBar value={issue.progress} />
          {continueArticle && (
            <button className="primary-button" onClick={() => onOpenArticle(continueArticle.id, window.scrollY)}>
              {continueArticle.progress > 0 ? "继续本期阅读" : "开始阅读"} →
            </button>
          )}
        </div>
      </section>

      <section className="toc-card">
        <div className="section-title-row">
          <div>
            <div className="eyebrow">Table of contents</div>
            <h2>本期目录</h2>
          </div>
          <div className="guide-status-group">
            <span className={`muted-text guide-status ${guideState?.state === "error" ? "is-error" : ""}`}>
              {guidedCount === articles.length
                ? `中英双语 · ${guidedCount}/${articles.length} 已缓存`
                : guideState?.state === "error"
                  ? `中文导读生成中断 · ${guidedCount}/${articles.length}`
                  : guideState?.state === "partial"
                    ? `中文导读待继续 · ${guidedCount}/${articles.length}`
                    : guideState?.state === "idle"
                      ? `中文导读待生成 · ${guidedCount}/${articles.length}`
                      : `正在准备中文导读 ${guidedCount}/${articles.length}`}
            </span>
            {guidedCount < articles.length && guideState?.state !== "running" && (
              <button className="text-button guide-retry-button" onClick={onRetryGuides}>继续生成</button>
            )}
            {guideRequestError && guideState?.state !== "complete" && (
              <span className="guide-request-error" role="status">{guideRequestError}</span>
            )}
          </div>
        </div>

        <div className="issue-toc-search">
          <label htmlFor={`issue-toc-search-${issue.id}`}>搜索本期目录</label>
          <div className="issue-toc-search-field">
            <input
              id={`issue-toc-search-${issue.id}`}
              type="search"
              value={tocQuery}
              placeholder="搜索标题、副标题或中文摘要"
              onChange={(event) => onViewStateChange({ ...activeViewState, query: event.target.value })}
              data-testid="issue-toc-search"
            />
            {tocQuery && <button className="text-button" onClick={() => onViewStateChange({ ...activeViewState, query: "" })} aria-label="清空本期目录搜索">清空</button>}
          </div>
        </div>

        <div className="issue-reading-filters" aria-label="本期目录阅读状态筛选">
          {readingFilters.map((filter) => (
            <button
              key={filter.id}
              className={readingFilter === filter.id ? "is-active" : ""}
              aria-pressed={readingFilter === filter.id}
              data-testid={`issue-reading-filter-${filter.id}`}
              onClick={() => onViewStateChange({ ...activeViewState, readingFilter: filter.id })}
            >
              <span>{filter.label}</span>
              <small>{readingFilterCounts[filter.id]}</small>
            </button>
          ))}
        </div>

        {visibleSections.map((section) => (
          <div className="toc-section" key={section.name}>
            <div className="toc-section-name"><span>{section.name}</span><small>{section.nameZh}</small></div>
            <div className="toc-article-list">
              {section.articles.map(({ article, originalIndex }) => {
                const vocabularyProfile = buildArticleVocabularyProfile(article.paragraphs, savedSelections);
                return (
                  <div className="toc-article-row" key={article.id} data-testid={`toc-article-${article.id}`}>
                    <button className="toc-article-main" onClick={() => onOpenArticle(article.id, window.scrollY)}>
                      <span className="toc-index">{String(originalIndex + 1).padStart(2, "0")}</span>
                      <span className="toc-copy">
                        <strong className="toc-title-en">{article.title}</strong>
                        {article.titleZh
                          ? <span className="toc-title-zh">{article.titleZh}</span>
                          : <span className="toc-guide-placeholder">{guideState?.state === "error" || guideState?.state === "partial" ? "中文标题待补齐" : "中文标题准备中…"}</span>}
                        {article.subtitle && <small className="toc-subtitle-en">{article.subtitle}</small>}
                        {article.subtitleZh && <small className="toc-subtitle-zh">{article.subtitleZh}</small>}
                        {article.summaryZh && <span className="toc-summary-zh">{article.summaryZh}</span>}
                        <span className={`toc-vocabulary-profile difficulty-${vocabularyProfile.difficulty}`} data-testid={`article-vocabulary-profile-${article.id}`}>
                          <b>{vocabularyProfile.difficultyLabel}</b>
                          <span>新词 {vocabularyProfile.newPercent}%</span>
                          <span>学习中 {vocabularyProfile.learningPercent}%</span>
                          <span>已知 {vocabularyProfile.knownPercent}%</span>
                          {vocabularyProfile.ignoredPercent > 0 && <span>忽视 {vocabularyProfile.ignoredPercent}%</span>}
                        </span>
                      </span>
                      <span className="toc-meta">{article.minutes} min</span>
                      <span className={`read-state ${article.progress === 100 ? "is-done" : article.progress > 0 ? "is-reading" : ""}`}>
                        {article.progress === 100 ? "✓" : article.progress > 0 ? `${article.progress}%` : "○"}
                      </span>
                    </button>
                    <button
                      className={`icon-button small ${isReadLater(readLaterState, issue.id, article.id) ? "is-active" : ""}`}
                      aria-label={isReadLater(readLaterState, issue.id, article.id) ? `移出稍后阅读：${article.title}` : `加入稍后阅读：${article.title}`}
                      onClick={() => onToggleReadLater(article.id)}
                    >
                      {isReadLater(readLaterState, issue.id, article.id) ? "★" : "☆"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {!visibleSections.length && (
          <div className="issue-reading-filter-empty" data-testid="issue-reading-filter-empty">{tocQuery.trim() ? "当前搜索和筛选条件下没有文章。" : "当前筛选下没有文章。"}</div>
        )}
      </section>
    </div>
  );
}

function noteAnchorExcerpt(anchor: ReaderNoteAnchor): string {
  const source = anchor.kind === "selection" ? anchor.selectedText : anchor.paragraphText;
  return source.length > 120 ? `${source.slice(0, 117)}…` : source;
}

function noteAnchorPresentation(note: ReaderNote, paragraphs: string[]): {
  resolved: ResolvedNoteAnchor | null;
  label: string;
  excerpt?: string;
} | null {
  if (!note.anchor) return null;
  const resolved = resolveNoteAnchor(note.anchor, paragraphs);
  if (!resolved) {
    return {
      resolved: null,
      label: "原文位置已变化 · 已按文章笔记保留",
      excerpt: noteAnchorExcerpt(note.anchor),
    };
  }
  return {
    resolved,
    label: `第 ${resolved.paragraphIndex + 1} 段${resolved.kind === "selection" ? " · 选区" : ""}${resolved.reanchored ? " · 已重新定位" : ""}`,
    excerpt: noteAnchorExcerpt(note.anchor),
  };
}

function ReaderDrawer({
  drawer,
  issue,
  article,
  readerMode,
  currentSentenceSelections,
  notes,
  savedSelections,
  noteDraft,
  noteDraftAnchor,
  noteDraftInputRef,
  wordDetailLookup,
  wordDetailVocabularyMeaning,
  wordDetailFamiliarity,
  vocabularyOccurrencesByText,
  vocabularyOccurrenceIndexes,
  onClose,
  onOpenArticle,
  onNoteDraftChange,
  onAddNote,
  onExitNoteDraft,
  onClearNoteDraftAnchor,
  onLocateNote,
  onEditNote,
  onDeleteNote,
  onSavedTranslationChange,
  onSavedFamiliarityChange,
  onRemoveSavedSelection,
  onNavigateVocabularyOccurrence,
  onCloseWordDetail,
  onWordDetailFamiliarityChange,
  onWordDetailContextMeaningChange,
}: {
  drawer: Exclude<Drawer, null>;
  issue: ReaderCollectionView;
  article: ReaderDocumentView;
  readerMode: ReaderMode;
  currentSentenceSelections: SavedSelection[];
  notes: ReaderNote[];
  savedSelections: SavedSelection[];
  noteDraft: string;
  noteDraftAnchor?: ReaderNoteAnchor;
  noteDraftInputRef: React.RefObject<HTMLTextAreaElement | null>;
  wordDetailLookup: ActiveWordLookup | null;
  wordDetailVocabularyMeaning?: string;
  wordDetailFamiliarity: FamiliarityLevel | null;
  vocabularyOccurrencesByText: Map<string, SavedTextOccurrence[]>;
  vocabularyOccurrenceIndexes: Record<string, number>;
  onClose: () => void;
  onOpenArticle: (articleId: string) => void;
  onNoteDraftChange: (value: string) => void;
  onAddNote: () => void;
  onExitNoteDraft: () => void;
  onClearNoteDraftAnchor: () => void;
  onLocateNote: (noteId: string) => void;
  onEditNote: (noteId: string, text: string) => void;
  onDeleteNote: (noteId: string) => void;
  onSavedTranslationChange: (text: string, translationZh: string) => void;
  onSavedFamiliarityChange: (text: string, familiarity: FamiliarityLevel) => void;
  onRemoveSavedSelection: (text: string) => void;
  onNavigateVocabularyOccurrence: (text: string, direction: VocabularyNavigationDirection) => void;
  onCloseWordDetail: () => void;
  onWordDetailFamiliarityChange: (level: FamiliarityLevel) => void;
  onWordDetailContextMeaningChange: (meaningZh: string) => void;
}) {
  const articleNotes = notes.filter((note) => readerNoteBelongsToDocument(note, article.identity));
  const articleSelections = savedSelections.filter((item) => savedSelectionBelongsToDocument(item, article.identity));
  const [vocabularyScope, setVocabularyScope] = useState<"sentence" | "article">(readerMode === "sentence" ? "sentence" : "article");
  useEffect(() => setVocabularyScope(readerMode === "sentence" ? "sentence" : "article"), [readerMode]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");

  function startEditingNote(note: ReaderNote) {
    setEditingNoteId(note.id);
    setEditingNoteText(note.text);
  }

  function cancelEditingNote() {
    setEditingNoteId(null);
    setEditingNoteText("");
  }

  function saveEditedNote(noteId: string) {
    const text = editingNoteText.trim();
    if (!text) return;
    onEditNote(noteId, text);
    cancelEditingNote();
  }

  function handleNoteDraftKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onExitNoteDraft();
      return;
    }
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    if (!noteDraft.trim()) return;
    onAddNote();
  }

  return (
    <aside className="reader-drawer" data-testid="reader-drawer">
      <div className="drawer-header">
        <h3>{drawer === "toc" ? issue.kind === "lessons" ? "精选阅读目录" : issue.kind === "book" ? "本书目录" : "本期目录" : drawer === "notes" ? "笔记" : wordDetailLookup ? "词汇详情" : "词汇"}</h3>
        <button className="icon-button small" aria-label="关闭侧栏" onClick={onClose}>×</button>
      </div>

      {drawer === "toc" && (
        <div className={`drawer-scroll ${issue.kind === "book" ? "book-drawer-toc" : ""}`}>
          {issue.groups.map((section) => (
            <div className="drawer-toc-section" key={section.id}>
              <div className="drawer-label"><span>{section.label}</span>{section.labelSecondary && <small>{section.labelSecondary}</small>}</div>
              {section.documents.map((item) => (
                <button
                  className={`drawer-article ${item.id === article.id ? "is-active" : ""}`}
                  key={item.id}
                  onClick={() => onOpenArticle(item.id)}
                >
                  <span className="drawer-article-copy">{issue.kind === "book" && item.tocTitleZh ? <><span>{item.title}</span><small>{item.tocTitleZh}</small></> : <><span>{item.title}</span>{item.titleZh && <small>{item.titleZh}</small>}</>}</span>
                  {item.id === article.id && <span className="current-dot">●</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {drawer === "notes" && (
        <div className="drawer-scroll notes-panel">
          {noteDraftAnchor && (
            <div className="note-draft-anchor" data-testid="note-draft-anchor">
              <div>
                <strong>{noteDraftAnchor.kind === "selection" ? `选区锚点 · 第 ${noteDraftAnchor.paragraphIndex + 1} 段` : `段落锚点 · 第 ${noteDraftAnchor.paragraphIndex + 1} 段`}</strong>
                <p>“{noteAnchorExcerpt(noteDraftAnchor)}”</p>
              </div>
              <button className="icon-button small" aria-label="移除笔记锚点" onClick={onClearNoteDraftAnchor}>×</button>
            </div>
          )}
          <textarea
            aria-label="新笔记"
            aria-keyshortcuts="Control+Enter Meta+Enter Escape"
            ref={noteDraftInputRef}
            placeholder="记下你的疑问、联想或要回看的地方…"
            value={noteDraft}
            onChange={(event) => onNoteDraftChange(event.target.value)}
            onKeyDown={handleNoteDraftKeyDown}
          />
          <button className="primary-button full" disabled={!noteDraft.trim()} onClick={onAddNote}>添加笔记</button>
          <div className="notes-list">
            {articleNotes.length ? articleNotes.map((note) => {
              const anchorInfo = noteAnchorPresentation(note, article.paragraphs);
              return (
                <div className="note-card" key={note.id}>
                  {editingNoteId === note.id ? (
                    <div className="note-edit-form">
                      <textarea
                        aria-label="编辑笔记内容"
                        value={editingNoteText}
                        onChange={(event) => setEditingNoteText(event.target.value)}
                      />
                      <div className="note-actions">
                        <button className="text-button note-action-button" disabled={!editingNoteText.trim()} onClick={() => saveEditedNote(note.id)}>保存</button>
                        <button className="text-button note-action-button" onClick={cancelEditingNote}>取消</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p>{note.text}</p>
                      {anchorInfo && (
                        <div className={`note-anchor-summary ${anchorInfo.resolved ? "" : "is-stale"}`}>
                          <span>{anchorInfo.label}</span>
                          {anchorInfo.excerpt && <blockquote>“{anchorInfo.excerpt}”</blockquote>}
                          {anchorInfo.resolved && <button className="text-button note-anchor-locate" onClick={() => onLocateNote(note.id)}>定位原文</button>}
                        </div>
                      )}
                      <div className="note-meta-row">
                        <span>{formatHistoryTime(note.createdAt)}</span>
                        <div className="note-actions">
                          <button className="text-button note-action-button" aria-label={`编辑笔记：${note.text}`} onClick={() => startEditingNote(note)}>编辑</button>
                          <button className="text-button note-action-button is-danger" aria-label={`删除笔记：${note.text}`} onClick={() => onDeleteNote(note.id)}>删除</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            }) : <div className="drawer-empty">这篇文章还没有笔记。</div>}
          </div>
        </div>
      )}

      {drawer === "vocabulary" && (
        <div className="drawer-scroll vocabulary-drawer-panel">
          {wordDetailLookup ? (
            <WordDetailContent
              lookup={wordDetailLookup}
              vocabularyMeaning={wordDetailVocabularyMeaning}
              familiarity={wordDetailFamiliarity}
              onBack={onCloseWordDetail}
              onVocabularyMeaningChange={(meaningZh) => onSavedTranslationChange(wordDetailLookup.text, meaningZh)}
              onFamiliarityChange={onWordDetailFamiliarityChange}
              onContextMeaningChange={onWordDetailContextMeaningChange}
            />
          ) : (
            <>
              {readerMode === "sentence" && <div className="vocabulary-scope-tabs" role="group" aria-label="词汇范围">
                <button className={vocabularyScope === "sentence" ? "is-active" : ""} aria-pressed={vocabularyScope === "sentence"} onClick={() => setVocabularyScope("sentence")}>本句 {uniqueVocabularyItems(currentSentenceSelections).length}</button>
                <button className={vocabularyScope === "article" ? "is-active" : ""} aria-pressed={vocabularyScope === "article"} onClick={() => setVocabularyScope("article")}>全文 {uniqueVocabularyItems(articleSelections).length}</button>
              </div>}
              <VocabularyContent
                savedSelections={readerMode === "sentence" && vocabularyScope === "sentence" ? currentSentenceSelections : articleSelections}
                emptyMessage={readerMode === "sentence" && vocabularyScope === "sentence" ? "本句还没有保存词汇。" : undefined}
                occurrencesByText={vocabularyOccurrencesByText}
                occurrenceIndexes={vocabularyOccurrenceIndexes}
                onSavedTranslationChange={onSavedTranslationChange}
                onSavedFamiliarityChange={onSavedFamiliarityChange}
                onRemoveSavedSelection={onRemoveSavedSelection}
                onNavigateOccurrence={onNavigateVocabularyOccurrence}
              />
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function ArticleMediaFigure({ issueId, articleId, image, onZoom }: {
  issueId: string;
  articleId: string;
  image: ArticleImage;
  onZoom: (image: ArticleImage, trigger: HTMLButtonElement) => void;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [issueId, articleId, image.id]);
  if (failed) return null;
  const caption = image.caption?.trim() ?? "";
  const alt = image.alt.trim() || caption || "Article image";
  return (
    <figure
      className={`article-media-figure role-${image.role}`}
      data-testid="article-media-figure"
      data-image-role={image.role}
      data-after-paragraph={image.afterParagraphIndex}
    >
      <button
        type="button"
        className="article-media-zoom-trigger"
        aria-label={`放大查看图片：${alt}`}
        title="点击放大查看"
        onClick={(event) => onZoom(image, event.currentTarget)}
      >
        <img
          loading="lazy"
          src={articleImageUrl(issueId, articleId, image.id)}
          alt={alt}
          onError={() => setFailed(true)}
        />
        <span className="article-media-zoom-hint" aria-hidden="true">⌕</span>
      </button>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function ReaderPage({
  issue,
  article,
  readLaterState,
  notes,
  preferences,
  onBack,
  onOpenArticle,
  onToggleReadLater,
  onNotesChange,
  onEditNote,
  onDeleteNote,
  onProgressChange,
  readingPosition,
  onReadingPositionChange,
  vocabularyJump,
  onConsumeVocabularyJump,
  noteJump,
  onConsumeNoteJump,
  readerReturnTarget,
  onReturnToSource,
  focusMode,
  onFocusModeChange,
  onOpenLearning,
  globalNavigation,
  onQuietViewChange,
  onAssistantContext,
}: {
  issue: ReaderCollectionView;
  article: ReaderDocumentView;
  readLaterState: ReadLaterState;
  notes: ReaderNote[];
  preferences: ReaderPreferences;
  onBack: () => void;
  onOpenArticle: (articleId: string) => void;
  onToggleReadLater: (articleId: string) => void;
  onNotesChange: (notes: ReaderNote[]) => void;
  onEditNote: (noteId: string, text: string) => void;
  onDeleteNote: (noteId: string) => void;
  onProgressChange: (progress: number) => void;
  readingPosition?: ReadingPositionAnchor;
  onReadingPositionChange: (position: ReadingPositionAnchor) => void;
  vocabularyJump: VocabularyJumpTarget | null;
  onConsumeVocabularyJump: (token: number) => void;
  noteJump: NoteJumpTarget | null;
  onConsumeNoteJump: (token: number) => void;
  readerReturnTarget: ReaderReturnTarget | null;
  onReturnToSource: () => void;
  focusMode: boolean;
  onFocusModeChange: (focusMode: boolean) => void;
  onOpenLearning?: () => void;
  globalNavigation: ReactNode;
  onQuietViewChange?: (quiet: boolean) => void;
  onAssistantContext?: (context: ReaderAssistantContext | null) => void;
}) {
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false);
  const [readerMode, setReaderMode] = useState<ReaderMode>(() => loadReaderView(article.identity.documentId)?.mode ?? "article");
  const [readerLanguage, setReaderLanguage] = useState<"english" | "chinese">(() => loadReaderView(article.identity.documentId)?.language === "chinese" ? "chinese" : "english");
  useEffect(() => { onQuietViewChange?.(focusMode || readerMode === "sentence"); }, [focusMode, readerMode, onQuietViewChange]);
  useEffect(() => () => onQuietViewChange?.(false), [onQuietViewChange]);
  const assistantContextRef = useRef<ReaderAssistantContext | null>(null);
  useEffect(() => {
    onAssistantContext?.({ documentId: article.identity.documentId, paragraphCount: article.paragraphs.length,
      currentParagraphIndex: () => assistantContextRef.current?.currentParagraphIndex() ?? null,
      locateParagraph: index => assistantContextRef.current?.locateParagraph(index) });
    return () => onAssistantContext?.(null);
  }, [article.identity.documentId, article.paragraphs.length, onAssistantContext]);
  const chineseParagraphRef = useRef(0);
  const [readerViewDocument, setReaderViewDocument] = useState("");
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [pendingSentenceAnchor, setPendingSentenceAnchor] = useState<{ paragraphIndex: number; startOffset: number } | null>(null);
  const [sentenceTranslationVisible, setSentenceTranslationVisible] = useState(false);
  const [sentenceTranslationRecords, setSentenceTranslationRecords] = useState<SentenceTranslationRecord[]>(() =>
    loadSentenceTranslations(getReaderStorage()),
  );
  const [sentenceTranslationRequests, setSentenceTranslationRequests] = useState<Record<string, {
    status: "loading" | "error";
    kind?: "translation" | "expressions";
    error?: string;
  }>>({});
  const [noteDraft, setNoteDraft] = useState("");
  const [noteDraftAnchor, setNoteDraftAnchor] = useState<ReaderNoteAnchor | undefined>(undefined);
  const [paragraphTranslationRecords, setParagraphTranslationRecords] = useState<ParagraphTranslationRecord[]>(() =>
    loadParagraphTranslations(getReaderStorage()),
  );
  const [translations, setTranslations] = useState<Record<string, ParagraphTranslationState>>({});
  const [fullArticleTranslationExpanded, setFullArticleTranslationExpanded] = useState(false);
  const [fullArticleTranslationRunning, setFullArticleTranslationRunning] = useState(false);
  const [articleImages, setArticleImages] = useState<ArticleImage[]>([]);
  const [zoomedArticleImage, setZoomedArticleImage] = useState<ArticleImage | null>(null);
  const [articleImageZoomDetailSize, setArticleImageZoomDetailSize] = useState(false);
  const [savedSelections, setSavedSelections] = useState<SavedSelection[]>(() => loadSavedSelections(getReaderStorage()));
  const meaningDocumentRef = useRef<string | null>(article.identity.documentId);
  meaningDocumentRef.current = article.identity.documentId;
  useEffect(() => { meaningDocumentRef.current = article.identity.documentId; return () => { meaningDocumentRef.current = null; }; }, [article.identity.documentId]);
  const meaningRepairAttempts = useRef(new Set<string>());
  const [meaningRepairFailures, setMeaningRepairFailures] = useState<string[]>([]);
  const [meaningRepairPending, setMeaningRepairPending] = useState(0);
  const [meaningRepairRetry, setMeaningRepairRetry] = useState(0);

  const [removedVocabulary, setRemovedVocabulary] = useState<{ text: string; records: SavedSelection[]; contextRecords: WordContextMeaningRecord[]; sentenceRecords: SentenceTranslationRecord[] }[]>([]);
  const [vocabularyRemovalError, setVocabularyRemovalError] = useState("");
  const [removalNoticeVisible, setRemovalNoticeVisible] = useState(false);
  useEffect(() => { setRemovedVocabulary([]); setVocabularyRemovalError(""); setRemovalNoticeVisible(false); setMeaningRepairPending(0); setMeaningRepairFailures([]); meaningRepairAttempts.current.clear(); }, [article.identity.documentId]);
  useEffect(() => {
    if (!removalNoticeVisible) return;
    const timer = window.setTimeout(() => setRemovalNoticeVisible(false), 7000);
    return () => window.clearTimeout(timer);
  }, [removalNoticeVisible, removedVocabulary.length]);
  const [activeSelection, setActiveSelection] = useState<ActiveTextSelection | null>(null);
  const [selectionAssistState, setSelectionAssistState] = useState<SelectionAssistUiState | null>(null);
  const [selectionSaved, setSelectionSaved] = useState(false);
  const [selectionTranslationZh, setSelectionTranslationZh] = useState("");
  const [selectionCopyState, setSelectionCopyState] = useState<SelectionCopyState>("idle");
  const [articleFindOpen, setArticleFindOpen] = useState(false);
  const [articleFindQuery, setArticleFindQuery] = useState("");
  const [articleFindIndex, setArticleFindIndex] = useState(0);
  const [jumpBackTarget, setJumpBackTarget] = useState<ReaderJumpBackTarget | null>(null);
  const [selectionAssistCacheRecords, setSelectionAssistCacheRecords] = useState<SelectionAssistCacheRecord[]>(() =>
    loadSelectionAssistCache(getReaderStorage()),
  );
  const [wordContextMeanings, setWordContextMeanings] = useState<WordContextMeaningRecord[]>(() => loadWordContextMeanings(getReaderStorage()));
  const wordContextMeaningsRef = useRef(wordContextMeanings);
  const [activeWordLookup, setActiveWordLookup] = useState<ActiveWordLookup | null>(null);
  const [wordDetailLookup, setWordDetailLookup] = useState<ActiveWordLookup | null>(null);
  const [vocabularyOccurrenceIndexes, setVocabularyOccurrenceIndexes] = useState<Record<string, number>>({});
  const [focusedVocabularySentence, setFocusedVocabularySentence] = useState<VocabularySentenceFocus | null>(null);
  const [focusedNoteAnchor, setFocusedNoteAnchor] = useState<NoteAnchorFocus | null>(null);
  const [activeParagraphCue, setActiveParagraphCue] = useState<ActiveParagraphCue | null>(null);
  const wordContextRequestsRef = useRef(new Map<string, Promise<WordContextMeaningRecord | undefined>>());
  const selectionAssistRequestPendingRef = useRef(false);
  const fullArticleTranslationRunRef = useRef(0);
  const vocabularyFocusSequenceRef = useRef(0);
  const vocabularyFocusTimerRef = useRef<number | null>(null);
  const noteAnchorFocusSequenceRef = useRef(0);
  const noteAnchorFocusTimerRef = useRef<number | null>(null);
  const activeParagraphCueSequenceRef = useRef(0);
  const activeParagraphCueTimerRef = useRef<number | null>(null);
  const readerShortcutHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const articleFindInputRef = useRef<HTMLInputElement>(null);
  const noteDraftInputRef = useRef<HTMLTextAreaElement>(null);
  const noteDraftResumePendingRef = useRef(false);
  const readerDrawerLayoutAnchorRef = useRef<ReaderDrawerLayoutAnchor | null>(null);
  const articleFindJumpCapturedRef = useRef(false);
  const readingPageRef = useRef<HTMLElement>(null);
  const articleImageZoomTriggerRef = useRef<HTMLButtonElement | null>(null);
  const articleMediaZoomCloseRef = useRef<HTMLButtonElement>(null);
  const restoredArticleKeyRef = useRef<string | null>(null);
  const allArticles = issue.documents;
  const currentIndex = allArticles.findIndex((item) => item.id === article.id);
  const previous = currentIndex > 0 ? allArticles[currentIndex - 1] : null;
  const next = currentIndex < allArticles.length - 1 ? allArticles[currentIndex + 1] : null;
  const magazineIdentity = article.identity.kind === "article" ? article.identity : null;
  const queuedForLater = isDocumentReadLater(readLaterState, { document: article.identity });
  const issueProgress = Math.round(((currentIndex + Math.max(article.progress, 1) / 100) / Math.max(allArticles.length, 1)) * 100);
  const articleSelections = savedSelections.filter((item) => savedSelectionBelongsToDocument(item, article.identity));
  const currentMeaningFailures = meaningRepairFailures.filter((id) => articleSelections.some((item) => item.id === id && needsContextualMeaningRepair(item)));
  const anchoredNotesByParagraph = useMemo(() => {
    const groups = new Map<number, ReturnType<typeof resolvedAnchoredNotesForDocument>>();
    resolvedAnchoredNotesForDocument(notes, article.identity, article.paragraphs).forEach((item) => {
      groups.set(item.resolved.paragraphIndex, [...(groups.get(item.resolved.paragraphIndex) ?? []), item]);
    });
    return groups;
  }, [notes, article.identity.documentId, article.paragraphs]);
  const vocabularyOccurrencesByText = useMemo(() => {
    const occurrences = new Map<string, SavedTextOccurrence[]>();
    uniqueVocabularyItems(articleSelections).forEach((item) => {
      occurrences.set(vocabularyTextKey(item.text), findSavedTextOccurrences(article.paragraphs, item.text));
    });
    return occurrences;
  }, [article.id, article.paragraphs, savedSelections]);
  const activeWordVocabulary = activeWordLookup
    ? uniqueVocabularyItems(savedSelections).find((item) =>
        item.text.trim().toLocaleLowerCase("en-US") === activeWordLookup.text.trim().toLocaleLowerCase("en-US"),
      )
    : undefined;
  const activeWordFamiliarity = activeWordVocabulary ? savedSelectionFamiliarity(activeWordVocabulary) : null;
  const wordDetailVocabulary = wordDetailLookup
    ? uniqueVocabularyItems(savedSelections).find((item) =>
        item.text.trim().toLocaleLowerCase("en-US") === wordDetailLookup.text.trim().toLocaleLowerCase("en-US"),
      )
    : undefined;
  const wordDetailFamiliarity = wordDetailVocabulary ? savedSelectionFamiliarity(wordDetailVocabulary) : null;
  const articleVocabularyProfile = useMemo(
    () => buildArticleVocabularyProfile(article.paragraphs, savedSelections),
    [article.id, article.paragraphs, savedSelections],
  );
  const articleSentences = useMemo(() => buildReaderSentences(article.paragraphs), [article.id, article.paragraphs]);
  const isChapterNumber = useCallback((text: string, index: number) =>
    isChapterNumberParagraph(text, index, issue.kind === "book" ? article.title : undefined, article.paragraphs[index + 1]),
  [issue.kind, article.title, article.paragraphs]);
  const canTranslateParagraph = useCallback((text: string, index: number) =>
    isTranslatableText(text) && !isChapterNumber(text, index)
      && !(article.visuals ?? []).some(visual => visual.coveredParagraphIndexes.includes(index) || visual.captionParagraphIndexes.includes(index)), [isChapterNumber, article.visuals]);
  const fullArticleTranslationTargets = useMemo(
    () => article.paragraphs.map((sourceText, paragraphIndex) => paragraphTranslationTarget({
      document: article.identity,
      paragraphIndex,
      sourceText,
    })).filter((target) => canTranslateParagraph(target.sourceText, target.paragraphIndex)),
    [article.identity.documentId, article.paragraphs, canTranslateParagraph],
  );
  const fullArticleTranslatedCount = useMemo(
    () => fullArticleTranslationTargets.filter((target) => findParagraphTranslation(paragraphTranslationRecords, target)).length,
    [fullArticleTranslationTargets, paragraphTranslationRecords],
  );
  const currentArticleTranslationLoading = fullArticleTranslationTargets.some((target) => translations[target.key]?.status === "loading");
  const articleFindMatches = useMemo(
    () => findArticleMatches(article.paragraphs, articleFindQuery),
    [article.id, article.paragraphs, articleFindQuery],
  );
  const articleFindMatchesByParagraph = useMemo(() => {
    const groups = new Map<number, ArticleFindMatch[]>();
    articleFindMatches.forEach((match) => {
      groups.set(match.paragraphIndex, [...(groups.get(match.paragraphIndex) ?? []), match]);
    });
    return groups;
  }, [articleFindMatches]);
  const activeArticleFindIndex = articleFindMatches.length
    ? Math.min(articleFindIndex, articleFindMatches.length - 1)
    : 0;
  const currentSentence = articleSentences[Math.min(sentenceIndex, Math.max(articleSentences.length - 1, 0))];
  const currentOriginalVisual = currentSentence ? article.visuals?.find(visual => visual.coveredParagraphIndexes.includes(currentSentence.paragraphIndex) || visual.captionParagraphIndexes.includes(currentSentence.paragraphIndex)) : undefined;
  const currentSentenceTarget = currentSentence ? sentenceTranslationTarget({
    document: article.identity,
    paragraphIndex: currentSentence.paragraphIndex,
    startOffset: currentSentence.startOffset,
    sourceText: currentSentence.text,
    paragraphContext: article.paragraphs[currentSentence.paragraphIndex],
  }) : null;
  const currentSentenceTranslation = currentSentenceTarget
    ? findSentenceTranslation(sentenceTranslationRecords, currentSentenceTarget)
    : undefined;
  const currentSentenceTranslationRequest = currentSentenceTarget
    ? sentenceTranslationRequests[currentSentenceTarget.key]
    : undefined;
  const currentSentenceVocabularySelections = useMemo(() => {
    if (!currentSentence) return [];
    return articleSelections.filter((item) => (vocabularyOccurrencesByText.get(vocabularyTextKey(item.text)) ?? []).some((occurrence) =>
      occurrence.paragraphIndex === currentSentence.paragraphIndex
      && occurrence.startOffset < currentSentence.endOffset
      && occurrence.endOffset > currentSentence.startOffset));
  }, [articleSelections, currentSentence, vocabularyOccurrencesByText]);
  const articleImagesByAnchor = useMemo(() => {
    const groups = new Map<number, ArticleImage[]>();
    articleImages.forEach((image) => groups.set(image.afterParagraphIndex, [...(groups.get(image.afterParagraphIndex) ?? []), image]));
    return groups;
  }, [articleImages]);
  const headingsBeforeParagraph = useMemo(() => {
    const groups = new Map<number, Array<{ level: 1 | 2 | 3; text: string; headingIndex: number }>>();
    let pending: Array<{ level: 1 | 2 | 3; text: string; headingIndex: number }> = [];
    let headingIndex = 0;
    article.blocks.forEach((block) => {
      if (block.kind === "heading") {
        pending = [...pending, { level: block.level, text: block.text, headingIndex }];
        headingIndex += 1;
        return;
      }
      if (pending.length) {
        groups.set(block.paragraphIndex, pending);
        pending = [];
      }
    });
    return groups;
  }, [article.identity.documentId, article.blocks]);

  useEffect(() => {
    setArticleFindOpen(false);
    setArticleFindQuery("");
    setArticleFindIndex(0);
    setJumpBackTarget(null);
    setActiveParagraphCue(null);
    if (activeParagraphCueTimerRef.current !== null) {
      window.clearTimeout(activeParagraphCueTimerRef.current);
      activeParagraphCueTimerRef.current = null;
    }
    articleFindJumpCapturedRef.current = false;
    noteDraftResumePendingRef.current = false;
    setZoomedArticleImage(null);
    articleImageZoomTriggerRef.current = null;
    setArticleImageZoomDetailSize(false);
    fullArticleTranslationRunRef.current += 1;
    setFullArticleTranslationExpanded(false);
    setFullArticleTranslationRunning(false);
  }, [article.identity.documentId]);

  useLayoutEffect(() => {
    const anchor = readerDrawerLayoutAnchorRef.current;
    readerDrawerLayoutAnchorRef.current = null;
    if (!anchor) return;
    const node = readingPageRef.current;
    if (!node) return;

    let frame = 0;
    let stabilizationTimer = 0;
    let resizeObserver: ResizeObserver | null = null;
    let active = true;

    const targetForAnchor = () => anchor.kind === "sentence"
      ? node.querySelector<HTMLElement>(".sentence-reading-card")
      : node.querySelector<HTMLElement>(`.reading-body .reading-paragraph-block[data-paragraph-index="${anchor.paragraphIndex}"]`);
    const applyAnchor = () => {
      if (!active) return;
      const target = targetForAnchor();
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const targetY = rect.top + rect.height * anchor.relativeY;
      const delta = targetY - anchor.viewportY;
      if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) return;
      window.scrollBy({ top: delta, left: 0, behavior: "auto" });
    };
    const scheduleAnchor = () => {
      if (!active) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(applyAnchor);
    };
    const stopStabilization = () => {
      if (!active) return;
      active = false;
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (stabilizationTimer) {
        window.clearTimeout(stabilizationTimer);
        stabilizationTimer = 0;
      }
      window.removeEventListener("wheel", stopStabilization);
      window.removeEventListener("touchstart", stopStabilization);
      window.removeEventListener("pointerdown", stopStabilization);
      window.removeEventListener("keydown", stopStabilization);
    };

    applyAnchor();
    frame = window.requestAnimationFrame(() => {
      applyAnchor();
      frame = window.requestAnimationFrame(applyAnchor);
    });
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleAnchor);
      resizeObserver.observe(node);
    }
    stabilizationTimer = window.setTimeout(stopStabilization, 500);
    window.addEventListener("wheel", stopStabilization, { passive: true });
    window.addEventListener("touchstart", stopStabilization, { passive: true });
    window.addEventListener("pointerdown", stopStabilization, { passive: true });
    window.addEventListener("keydown", stopStabilization);

    return stopStabilization;
  }, [drawer, article.identity.documentId, readerMode]);

  useEffect(() => {
    if (!articleFindOpen) return;
    const frame = window.requestAnimationFrame(() => articleFindInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [articleFindOpen]);

  useEffect(() => {
    if (!zoomedArticleImage) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => articleMediaZoomCloseRef.current?.focus({ preventScroll: true }));
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [zoomedArticleImage]);

  useLayoutEffect(() => {
    if (!articleFindOpen || !articleFindMatches.length) return;
    if (readerMode !== "article") {
      switchReaderMode("article");
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const target = readingPageRef.current?.querySelector<HTMLElement>(
        `[data-article-find-match-index="${activeArticleFindIndex}"]`,
      );
      const match = articleFindMatches[activeArticleFindIndex];
      if (!target || !match) return;
      target.scrollIntoView({ block: "center", behavior: "auto" });
      flashActiveParagraph(match.paragraphIndex);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [articleFindOpen, articleFindQuery, activeArticleFindIndex, articleFindMatches.length, readerMode, article.id]);

  useEffect(() => {
    let cancelled = false;
    setArticleImages([]);
    if (!magazineIdentity) return () => { cancelled = true; };
    void fetchArticleImages(magazineIdentity.issueId, magazineIdentity.articleId)
      .then((images) => { if (!cancelled) setArticleImages(images); })
      .catch(() => { if (!cancelled) setArticleImages([]); });
    return () => { cancelled = true; };
  }, [article.identity.documentId]);

  useEffect(() => {
    const node = readingPageRef.current;
    if (readerMode !== "article" || readerLanguage === "chinese" || !node) return;
    const identity = article.identity.documentId;
    let scrollFrame = 0;
    let restoreFrame = 0;
    let captureTimer = 0;
    let stabilizationTimer = 0;
    let restoreActive = false;
    let restoreCommitted = false;
    let resizeObserver: ResizeObserver | null = null;

    const metrics = () => {
      const top = node.getBoundingClientRect().top + window.scrollY;
      const scrollable = Math.max(node.offsetHeight - window.innerHeight + 120, 1);
      return { top, scrollable };
    };

    const capturePosition = () => {
      if (node.dataset.readerArticleId !== article.id) return;
      const blocks = [...node.querySelectorAll<HTMLElement>(".reading-body .reading-paragraph-block[data-paragraph-index]")];
      if (!blocks.length) return;
      const anchorY = Math.min(180, Math.max(96, window.innerHeight * 0.22));
      const block = blocks.find((candidate) => candidate.getBoundingClientRect().bottom >= anchorY) ?? blocks[blocks.length - 1];
      const paragraphIndex = Number(block.dataset.paragraphIndex);
      const paragraphText = article.paragraphs[paragraphIndex] ?? "";
      if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0 || !paragraphText) return;
      const viewportOffset = Math.round(block.getBoundingClientRect().top / 8) * 8;
      onReadingPositionChange({ paragraphIndex, paragraphText, viewportOffset });
    };

    const scheduleCapture = () => {
      if (captureTimer) return;
      captureTimer = window.setTimeout(() => {
        captureTimer = 0;
        capturePosition();
      }, 120);
    };

    const stopRestoreStabilization = () => {
      restoreActive = false;
      resizeObserver?.disconnect();
      resizeObserver = null;
    };

    if (restoredArticleKeyRef.current !== identity) {
      restoredArticleKeyRef.current = identity;
      const explicitJump = vocabularyJump?.documentId === article.identity.documentId || noteJump?.documentId === article.identity.documentId;
      if (explicitJump) {
        restoreCommitted = true;
      } else {
        const resolvedParagraphIndex = resolveArticleReadingPosition(readingPosition, article.paragraphs);
        restoreActive = true;
        const applyRestore = () => {
          if (!restoreActive) return;
          restoreCommitted = true;
          if (resolvedParagraphIndex !== null && readingPosition) {
            const target = node.querySelector<HTMLElement>(`[data-paragraph-index="${resolvedParagraphIndex}"]`);
            if (!target) return;
            const targetTop = window.scrollY + target.getBoundingClientRect().top - readingPosition.viewportOffset;
            window.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
            return;
          }
          if (article.progress > 1) {
            const { top, scrollable } = metrics();
            window.scrollTo({ top: Math.max(0, top + (scrollable * article.progress) / 100 - 70), behavior: "auto" });
            return;
          }
          window.scrollTo({ top: 0, behavior: "auto" });
        };
        restoreFrame = window.requestAnimationFrame(() => {
          restoreFrame = window.requestAnimationFrame(applyRestore);
        });
        if (resolvedParagraphIndex !== null && typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => {
            if (!restoreActive) return;
            window.requestAnimationFrame(applyRestore);
          });
          resizeObserver.observe(node);
        }
        stabilizationTimer = window.setTimeout(stopRestoreStabilization, 2_000);
      }
    }

    const handleScroll = () => {
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = window.requestAnimationFrame(() => {
        const { top, scrollable } = metrics();
        const travelled = window.scrollY - top + 90;
        const reachedArticleEnd = node.getBoundingClientRect().bottom <= window.innerHeight + 2;
        const progress = readerArticleProgress((travelled / scrollable) * 100, reachedArticleEnd);
        if (progress > article.progress) onProgressChange(progress);
        scheduleCapture();
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") capturePosition();
    };
    const stopOnUserIntent = () => {
      stopRestoreStabilization();
      capturePosition();
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pagehide", capturePosition);
    window.addEventListener("wheel", stopOnUserIntent, { passive: true });
    window.addEventListener("touchstart", stopOnUserIntent, { passive: true });
    window.addEventListener("pointerdown", stopOnUserIntent, { passive: true });
    window.addEventListener("keydown", stopOnUserIntent);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (restoredArticleKeyRef.current === identity && !restoreCommitted) restoredArticleKeyRef.current = null;
      window.cancelAnimationFrame(restoreFrame);
      window.cancelAnimationFrame(scrollFrame);
      if (captureTimer) window.clearTimeout(captureTimer);
      if (stabilizationTimer) window.clearTimeout(stabilizationTimer);
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pagehide", capturePosition);
      window.removeEventListener("wheel", stopOnUserIntent);
      window.removeEventListener("touchstart", stopOnUserIntent);
      window.removeEventListener("pointerdown", stopOnUserIntent);
      window.removeEventListener("keydown", stopOnUserIntent);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [article.identity.documentId, readerMode, readerLanguage, onProgressChange, onReadingPositionChange]);

  useEffect(() => {
    setActiveSelection(null);
    setSelectionAssistState(null);
    setSelectionSaved(false);
    setSelectionTranslationZh("");
    setActiveWordLookup(null);
    setWordDetailLookup(null);
    setVocabularyOccurrenceIndexes({});
    setFocusedVocabularySentence(null);
    setPendingSentenceAnchor(null);
    setNoteDraftAnchor(undefined);
    setFocusedNoteAnchor(null);
    setKeyboardHelpOpen(false);
    const resumedParagraphIndex = resolveArticleReadingPosition(readingPosition, article.paragraphs);
    const resumedSentenceIndex = resumedParagraphIndex !== null
      ? readerSentenceIndexForOffset(articleSentences, resumedParagraphIndex, 0)
      : -1;
    const savedView = loadReaderView(article.identity.documentId);
    setReaderMode(savedView?.mode ?? "article");
    setReaderLanguage(savedView?.language === "chinese" ? "chinese" : "english");
    chineseParagraphRef.current = resumedParagraphIndex ?? 0;
    setSentenceIndex(savedView ? Math.min(savedView.sentenceIndex, Math.max(0, articleSentences.length - 1)) : resumedSentenceIndex >= 0 ? resumedSentenceIndex : 0);
    setReaderViewDocument(article.identity.documentId);
    setSentenceTranslationVisible(false);
    setActiveParagraphCue(null);
    if (activeParagraphCueTimerRef.current !== null) {
      window.clearTimeout(activeParagraphCueTimerRef.current);
      activeParagraphCueTimerRef.current = null;
    }
    if (vocabularyFocusTimerRef.current !== null) {
      window.clearTimeout(vocabularyFocusTimerRef.current);
      vocabularyFocusTimerRef.current = null;
    }
    if (noteAnchorFocusTimerRef.current !== null) {
      window.clearTimeout(noteAnchorFocusTimerRef.current);
      noteAnchorFocusTimerRef.current = null;
    }
  }, [article.identity.documentId, articleSentences.length]);

  useEffect(() => {
    if (readerViewDocument === article.identity.documentId) saveReaderView(article.identity.documentId, { mode: readerMode, sentenceIndex, language: readerLanguage });
  }, [readerViewDocument, article.identity.documentId, readerMode, sentenceIndex, readerLanguage]);

  useEffect(() => {
    if (!vocabularyJump || vocabularyJump.documentId !== article.identity.documentId) return;
    setReaderMode("article");
    const paragraph = article.paragraphs[vocabularyJump.paragraphIndex] ?? "";
    if (!paragraph) {
      onConsumeVocabularyJump(vocabularyJump.token);
      return;
    }
    const safeStart = Math.max(0, Math.min(vocabularyJump.startOffset, Math.max(paragraph.length - 1, 0)));
    const sentence = sentenceRangeForOccurrence(paragraph, safeStart, Math.max(vocabularyJump.text.length, 1));
    vocabularyFocusSequenceRef.current += 1;
    setFocusedVocabularySentence({
      token: vocabularyFocusSequenceRef.current,
      paragraphIndex: vocabularyJump.paragraphIndex,
      sentenceStart: sentence.startOffset,
      sentenceEnd: sentence.endOffset,
    });
    flashActiveParagraph(vocabularyJump.paragraphIndex);
    onConsumeVocabularyJump(vocabularyJump.token);
  }, [vocabularyJump?.token, article.identity.documentId]);

  useEffect(() => {
    if (!noteJump || noteJump.documentId !== article.identity.documentId) return;
    setDrawer("notes");
    const note = notes.find((candidate) => candidate.id === noteJump.noteId);
    const resolved = resolveNoteAnchor(note?.anchor, article.paragraphs);
    if (resolved) focusResolvedNoteAnchor(resolved, true);
    onConsumeNoteJump(noteJump.token);
  }, [noteJump?.token, article.identity.documentId]);

  useEffect(() => {
    if (!focusedVocabularySentence) return;
    const token = focusedVocabularySentence.token;
    const stabilizeLayout = Boolean(focusedVocabularySentence.stabilizeLayout);
    let frame = 0;
    let stabilizationTimer = 0;
    let resizeObserver: ResizeObserver | null = null;
    let stabilizationActive = stabilizeLayout;

    const scrollFocusedSentence = (behavior: ScrollBehavior) => {
      const target = readingPageRef.current?.querySelector<HTMLElement>(`[data-vocabulary-focus-token="${token}"]`);
      target?.scrollIntoView({ behavior, block: "center", inline: "nearest" });
    };
    const scheduleStableFocus = () => {
      if (!stabilizationActive) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => scrollFocusedSentence("auto"));
    };
    const stopStabilization = () => {
      stabilizationActive = false;
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (stabilizationTimer) {
        window.clearTimeout(stabilizationTimer);
        stabilizationTimer = 0;
      }
    };

    if (stabilizeLayout) {
      scheduleStableFocus();
      const node = readingPageRef.current;
      if (node && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(scheduleStableFocus);
        resizeObserver.observe(node);
      }
      stabilizationTimer = window.setTimeout(stopStabilization, 2_000);
      window.addEventListener("wheel", stopStabilization, { passive: true });
      window.addEventListener("touchstart", stopStabilization, { passive: true });
      window.addEventListener("pointerdown", stopStabilization, { passive: true });
      window.addEventListener("keydown", stopStabilization);
    } else {
      frame = window.requestAnimationFrame(() => scrollFocusedSentence("smooth"));
    }

    if (vocabularyFocusTimerRef.current !== null) window.clearTimeout(vocabularyFocusTimerRef.current);
    vocabularyFocusTimerRef.current = window.setTimeout(() => {
      setFocusedVocabularySentence((current) => current?.token === token ? null : current);
      vocabularyFocusTimerRef.current = null;
    }, 3_000);

    return () => {
      window.cancelAnimationFrame(frame);
      stopStabilization();
      window.removeEventListener("wheel", stopStabilization);
      window.removeEventListener("touchstart", stopStabilization);
      window.removeEventListener("pointerdown", stopStabilization);
      window.removeEventListener("keydown", stopStabilization);
    };
  }, [focusedVocabularySentence?.token]);

  useEffect(() => {
    if (!focusedNoteAnchor) return;
    const token = focusedNoteAnchor.token;
    const stabilizeLayout = Boolean(focusedNoteAnchor.stabilizeLayout);
    let frame = 0;
    let stabilizationTimer = 0;
    let resizeObserver: ResizeObserver | null = null;
    let stabilizationActive = stabilizeLayout;

    const scrollFocusedNote = (behavior: ScrollBehavior) => {
      const target = readingPageRef.current?.querySelector<HTMLElement>(`[data-note-anchor-focus-token="${token}"]`);
      target?.scrollIntoView({ behavior, block: "center", inline: "nearest" });
    };
    const scheduleStableFocus = () => {
      if (!stabilizationActive) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => scrollFocusedNote("auto"));
    };
    const stopStabilization = () => {
      stabilizationActive = false;
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (stabilizationTimer) {
        window.clearTimeout(stabilizationTimer);
        stabilizationTimer = 0;
      }
    };

    if (stabilizeLayout) {
      scheduleStableFocus();
      const node = readingPageRef.current;
      if (node && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(scheduleStableFocus);
        resizeObserver.observe(node);
      }
      stabilizationTimer = window.setTimeout(stopStabilization, 2_000);
      window.addEventListener("wheel", stopStabilization, { passive: true });
      window.addEventListener("touchstart", stopStabilization, { passive: true });
      window.addEventListener("pointerdown", stopStabilization, { passive: true });
      window.addEventListener("keydown", stopStabilization);
    } else {
      frame = window.requestAnimationFrame(() => scrollFocusedNote("smooth"));
    }

    if (noteAnchorFocusTimerRef.current !== null) window.clearTimeout(noteAnchorFocusTimerRef.current);
    noteAnchorFocusTimerRef.current = window.setTimeout(() => {
      setFocusedNoteAnchor((current) => current?.token === token ? null : current);
      noteAnchorFocusTimerRef.current = null;
    }, 3_000);

    return () => {
      window.cancelAnimationFrame(frame);
      stopStabilization();
      window.removeEventListener("wheel", stopStabilization);
      window.removeEventListener("touchstart", stopStabilization);
      window.removeEventListener("pointerdown", stopStabilization);
      window.removeEventListener("keydown", stopStabilization);
    };
  }, [focusedNoteAnchor?.token]);

  useEffect(() => () => {
    if (vocabularyFocusTimerRef.current !== null) window.clearTimeout(vocabularyFocusTimerRef.current);
    if (noteAnchorFocusTimerRef.current !== null) window.clearTimeout(noteAnchorFocusTimerRef.current);
    if (activeParagraphCueTimerRef.current !== null) window.clearTimeout(activeParagraphCueTimerRef.current);
  }, []);

  function handleTextSelection() {
    const selection = window.getSelection();
    const body = readingPageRef.current?.querySelector(".reading-body");
    if (!selection || selection.isCollapsed || !body || selection.rangeCount === 0) return;

    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (!text || text.length > 2_000) return;

    if (/^[A-Za-z]+(?:[’'-][A-Za-z]+)*$/.test(text)) {
      setActiveSelection(null);
      setSelectionAssistState(null);
      setSelectionSaved(false);
      setSelectionTranslationZh("");
      return;
    }

    const range = selection.getRangeAt(0);
    if (!body.contains(range.commonAncestorContainer)) return;
    const anchorElement = selection.anchorNode instanceof Element
      ? selection.anchorNode
      : selection.anchorNode?.parentElement;
    const paragraphBlock = anchorElement?.closest<HTMLElement>(".reading-paragraph-block");
    if (!paragraphBlock || !body.contains(paragraphBlock)) return;

    const paragraphIndex = Number(paragraphBlock.dataset.paragraphIndex);
    if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0) return;
    const paragraph = article.paragraphs[paragraphIndex] ?? "";
    const paragraphTextElement = paragraphBlock.querySelector("p");
    const rangeBaseOffset = readerMode === "sentence" && currentSentence?.paragraphIndex === paragraphIndex
      ? currentSentence.startOffset
      : 0;
    function visibleDomOffset(container: Node, offset: number): number | null {
      if (!paragraphTextElement || !(container instanceof Text) || !paragraphTextElement.contains(container)) return null;
      const walker = document.createTreeWalker(paragraphTextElement, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (parent?.closest("rt, .word-lookup-card, .saved-selection-meaning")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let visibleOffset = 0;
      let current = walker.nextNode();
      while (current) {
        if (current === container) return rangeBaseOffset + visibleOffset + Math.min(offset, current.textContent?.length ?? 0);
        visibleOffset += current.textContent?.length ?? 0;
        current = walker.nextNode();
      }
      return null;
    }

    const domStartOffset = visibleDomOffset(range.startContainer, range.startOffset);
    const endElement = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
    const endParagraphBlock = endElement?.closest<HTMLElement>(".reading-paragraph-block");
    const domEndOffset = endParagraphBlock === paragraphBlock ? visibleDomOffset(range.endContainer, range.endOffset) : null;
    const selectedAtDomOffset = domStartOffset !== null
      && paragraph.slice(domStartOffset, domStartOffset + text.length).replace(/\s+/g, " ").trim() === text;
    const fallbackStartOffset = paragraph.indexOf(text, rangeBaseOffset);
    const startOffset = selectedAtDomOffset && domStartOffset !== null
      ? domStartOffset
      : fallbackStartOffset >= 0
        ? fallbackStartOffset
        : Math.max(0, domStartOffset ?? rangeBaseOffset);
    const selectionEndOffset = domEndOffset !== null
      && domEndOffset > startOffset
      && paragraph.slice(startOffset, domEndOffset).replace(/\s+/g, " ").trim() === text
        ? domEndOffset
        : paragraph.slice(startOffset, startOffset + text.length).replace(/\s+/g, " ").trim() === text
          ? startOffset + text.length
          : undefined;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    const selectionPopoverMargin = 16;
    const selectionPopoverWidth = Math.min(410, Math.max(0, window.innerWidth - selectionPopoverMargin * 2));
    const selectionPopoverHalfWidth = selectionPopoverWidth / 2;
    const selectionCenterMin = selectionPopoverMargin + selectionPopoverHalfWidth;
    const selectionCenterMax = window.innerWidth - selectionPopoverMargin - selectionPopoverHalfWidth;
    const selectionCenter = rect.left + rect.width / 2;
    const selectionLeft = selectionCenterMin <= selectionCenterMax
      ? Math.max(selectionCenterMin, Math.min(selectionCenterMax, selectionCenter))
      : window.innerWidth / 2;

    setActiveSelection({
      text,
      context: paragraph,
      paragraphIndex,
      startOffset,
      top: Math.min(window.innerHeight - 16, Math.max(120, rect.top - 10)),
      ...(selectionEndOffset !== undefined ? { endOffset: selectionEndOffset } : {}),
      left: selectionLeft,
    });
    setSelectionAssistState(null);
    setSelectionSaved(articleSelections.some((item) => item.text === text && item.paragraphIndex === paragraphIndex));
    setSelectionTranslationZh("");
    setSelectionCopyState("idle");
  }

  async function runSelectionAssist(action: "translate" | "explain") {
    if (!activeSelection || selectionAssistRequestPendingRef.current) return;
    const target = selectionAssistCacheTarget({
      document: article.identity,
      paragraphIndex: activeSelection.paragraphIndex,
      startOffset: activeSelection.startOffset,
      sourceText: activeSelection.text,
    });
    const sentenceRange = sentenceRangeForOccurrence(
      activeSelection.context,
      activeSelection.startOffset,
      1,
    );
    const isWholeSentence = sentenceRange.startOffset === activeSelection.startOffset
      && sentenceRange.text.replace(/\s+/g, " ").trim() === activeSelection.text;

    if (action === "translate" && isWholeSentence) {
      const sentenceTarget = sentenceTranslationTarget({
        document: article.identity,
        paragraphIndex: activeSelection.paragraphIndex,
        startOffset: sentenceRange.startOffset,
        sourceText: sentenceRange.text,
        paragraphContext: activeSelection.context,
      });
      const cachedSentence = findSentenceTranslation(sentenceTranslationRecords, sentenceTarget);
      if (cachedSentence) {
        setSelectionAssistState({
          status: "ready",
          action,
          result: cachedSentence.translationZh,
          model: cachedSentence.model,
        });
        setSelectionTranslationZh(cachedSentence.translationZh.trim());
        return;
      }

      selectionAssistRequestPendingRef.current = true;
      setSelectionAssistState({ status: "loading", action });
      try {
        const result = await translateParagraph({
          mode: "sentence",
          paragraphContext: activeSelection.context,
          text: sentenceRange.text,
          contextBefore: article.paragraphs[activeSelection.paragraphIndex - 1],
          contextAfter: article.paragraphs[activeSelection.paragraphIndex + 1],
        });
        const record: SentenceTranslationRecord = {
          ...sentenceTarget,
          translationZh: result.translation,
          expressions: result.expressions,
          model: result.model,
          provider: result.provider,
          generatedAt: new Date().toISOString(),
        };
        setSentenceTranslationRecords((current) => {
          const next = upsertSentenceTranslation(current, record);
          saveSentenceTranslations(getReaderStorage(), next);
          return next;
        });
        setSelectionAssistState({ status: "ready", action, result: result.translation, model: result.model });
        setSelectionTranslationZh(result.translation.trim());
      } catch (error) {
        setSelectionAssistState({
          status: "error",
          action,
          error: error instanceof Error ? error.message : "辅助请求失败",
        });
      }
      selectionAssistRequestPendingRef.current = false;
      return;
    }

    const cached = findSelectionAssistCachedResult(selectionAssistCacheRecords, target, action);
    if (cached) {
      setSelectionAssistState({ status: "ready", action, result: cached.result, model: cached.model });
      if (action === "translate") setSelectionTranslationZh(cached.result.trim());
      return;
    }

    selectionAssistRequestPendingRef.current = true;
    setSelectionAssistState({ status: "loading", action });
    try {
      const result = await assistSelection({
        action,
        text: activeSelection.text,
        context: activeSelection.context,
        articleTitle: article.title,
      });
      setSelectionAssistState({
        status: "ready",
        action,
        result: result.result,
        model: result.model,
      });
      setSelectionAssistCacheRecords((current) => {
        const next = upsertSelectionAssistCachedResult(current, target, action, {
          result: result.result,
          model: result.model,
          provider: result.provider,
          generatedAt: new Date().toISOString(),
        });
        saveSelectionAssistCache(getReaderStorage(), next);
        return next;
      });
      if (action === "translate") setSelectionTranslationZh(result.result.trim());
    } catch (error) {
      setSelectionAssistState({
        status: "error",
        action,
        error: error instanceof Error ? error.message : "辅助请求失败",
      });
    }
    selectionAssistRequestPendingRef.current = false;
  }

  async function copyActiveSelection() {
    if (!activeSelection) return;
    setSelectionCopyState("idle");
    try {
      await copyTextToClipboard(activeSelection.text);
      setSelectionCopyState("copied");
    } catch {
      setSelectionCopyState("error");
    }
  }

  function saveActiveSelection() {
    if (!activeSelection) return;
    setSavedSelections((current) => {
      const next = addSavedSelection(current, {
        document: article.identity,
        articleTitle: article.title,
        text: activeSelection.text,
        context: activeSelection.context,
        paragraphIndex: activeSelection.paragraphIndex,
        translationZh: selectionTranslationZh || undefined,
        translationSource: selectionTranslationZh ? "auto" : undefined,
      });
      saveSavedSelections(getReaderStorage(), next);
      return next;
    });
    setSelectionSaved(true);
  }

  function ensureWordContextMeaning(
    text: string,
    paragraph: string,
    paragraphIndex: number,
    startOffset: number,
    verifyConsistency = false,
  ): Promise<WordContextMeaningRecord | undefined> {
    const occurrence = {
      document: article.identity,
      paragraphIndex,
      startOffset,
      text,
      paragraph,
    };
    const cached = findWordContextMeaning(wordContextMeaningsRef.current, occurrence);
    if (cached && hasEnglishWordContext(cached) && (!verifyConsistency || cached.meaningVersion === 2 || cached.meaningSource === "user")) return Promise.resolve(cached);

    const key = wordContextOccurrenceKey(occurrence);
    const requestKey = key + (verifyConsistency ? ":verified-v2" : "");
    const pending = wordContextRequestsRef.current.get(requestKey);
    if (pending) return pending;

    const sentence = sentenceForOccurrence(paragraph, startOffset, text.length);
    const target = sentenceTranslationTargetForOccurrence({ ...occurrence, targetLength: text.length });
    const priorSentence = findSentenceTranslation(loadSentenceTranslations(getReaderStorage()), target);
    const priorExpression = priorSentence?.expressions?.find((item) => item.text.toLowerCase() === text.toLowerCase());
    const request = explainWordContext({
      text,
      sentence,
      paragraph,
      contextBefore: article.paragraphs[paragraphIndex - 1],
      contextAfter: article.paragraphs[paragraphIndex + 1],
      articleTitle: article.title,
      ...(verifyConsistency ? { verifyConsistency: true, sentenceTranslationZh: priorSentence?.translationZh, expressionExplanationZh: priorExpression?.explanationZh, suggestedMeaningZh: cached?.meaningZh || priorExpression?.meaningZh } : {}),
    }).then((result) => {
      const latest = findWordContextMeaning(wordContextMeaningsRef.current, occurrence);
      if (!verifyConsistency && latest?.meaningVersion === 2) return latest;
      if (verifyConsistency && !result.sentenceTranslationZh?.trim()) throw new Error("语境核对结果不完整");
      const record: WordContextMeaningRecord = {
        ...result,
        ...(verifyConsistency ? { meaningVersion: 2 as const } : {}),
        ...occurrence,
        key,
        sentence,
        generatedAt: new Date().toISOString(),
        meaningZh: latest?.meaningSource === "user" ? latest.meaningZh : result.meaningZh,
        meaningSource: latest?.meaningSource ?? "ai",
        editedAt: latest?.editedAt,
      };
      const next = upsertWordContextMeaning(wordContextMeaningsRef.current, record);
      wordContextMeaningsRef.current = next;
      saveWordContextMeanings(getReaderStorage(), next);
      setWordContextMeanings(next);
      if (verifyConsistency && result.sentenceTranslationZh && meaningDocumentRef.current === occurrence.document.documentId) {
        setSentenceTranslationRecords((current) => {
          const previous = findSentenceTranslation(current, target);
          const expression = { kind: priorExpression?.kind, text, meaningZh: record.meaningZh, meaningVersion: 2 as const, explanationZh: record.explanationZh };
          const expressions = [...(previous?.expressions ?? []).filter((item) => item.text.toLowerCase() !== text.toLowerCase()), expression];
          const updated = upsertSentenceTranslation(current, { ...target, translationZh: result.sentenceTranslationZh!, expressions: expressions.slice(-4), model: result.model, provider: result.provider, generatedAt: record.generatedAt });
          saveSentenceTranslations(getReaderStorage(), updated);
          return updated;
        });
      }
      return record;
    }).catch(() => undefined).finally(() => {
      wordContextRequestsRef.current.delete(requestKey);
    });

    wordContextRequestsRef.current.set(requestKey, request);
    return request;
  }

  useEffect(() => {
    if (meaningRepairPending > 0) return;
    const documentId = article.identity.documentId;
    const missing = articleSelections.filter((item) => isLearningFamiliarity(savedSelectionFamiliarity(item)) && needsContextualMeaningRepair(item) && !meaningRepairAttempts.current.has(`${documentId}:${item.id}`));
    if (!missing.length) return;
    let cursor = 0;
    for (const item of missing) meaningRepairAttempts.current.add(`${documentId}:${item.id}`);
    async function work() {
      while (cursor < missing.length && meaningDocumentRef.current === documentId) {
        const item = missing[cursor++];
        const paragraph = article.paragraphs[item.paragraphIndex] ?? item.context;
        const offset = item.startOffset ?? paragraph.indexOf(item.text);
        if (offset < 0) continue;
        setMeaningRepairPending((count) => count + 1);
        const cached = findWordContextMeaning(wordContextMeaningsRef.current, { document: article.identity, paragraphIndex: item.paragraphIndex, startOffset: offset, text: item.text, paragraph });
        const phrase = /\s/.test(item.text.trim());
        const result = !phrase && cached?.meaningZh?.trim() ? cached : await ensureWordContextMeaning(item.text, paragraph, item.paragraphIndex, offset, phrase);
        if (meaningDocumentRef.current !== documentId) return;
        setMeaningRepairPending((count) => Math.max(0, count - 1));
        if (result?.meaningZh?.trim() && result.meaningZh.length <= 120) {
          setSavedSelections((current) => {
            const next = current.map((record) => record.id === item.id && needsContextualMeaningRepair(record) ? { ...record, translationZh: result.meaningZh.trim(), translationSource: "auto" as const, ...(phrase ? { meaningVersion: 2 as const, usageExplanationZh: result.explanationZh } : {}) } : record);
            saveSavedSelections(getReaderStorage(), next); return next;
          });
          setMeaningRepairFailures((current) => current.filter((id) => id !== item.id));
        } else setMeaningRepairFailures((current) => current.includes(item.id) ? current : [...current, item.id]);
      }
    }
    void work(); void work();
  }, [article.identity.documentId, savedSelections, meaningRepairRetry, meaningRepairPending]);

  function openWordLookup(
    text: string,
    paragraph: string,
    paragraphIndex: number,
    startOffset: number,
    target: HTMLElement,
  ) {
    const selection = window.getSelection();
    const selectedText = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (selection && !selection.isCollapsed && selectedText && selectedText !== text.trim()) return;
    if (readerMode === "article") setPendingSentenceAnchor({ paragraphIndex, startOffset });

    const occurrence = { document: article.identity, paragraphIndex, startOffset, text, paragraph };
    const key = wordContextOccurrenceKey(occurrence);
    const cachedContext = findWordContextMeaning(wordContextMeanings, occurrence);
    const rect = target.getBoundingClientRect();
    const placement: "above" | "below" = rect.top > window.innerHeight * 0.55 ? "above" : "below";
    const top = placement === "above" ? rect.top - 8 : rect.bottom + 8;
    const left = Math.max(210, Math.min(window.innerWidth - 210, rect.left + rect.width / 2));
    const dictionaryEligible = isDictionaryWord(text);

    setActiveSelection(null);
    setSelectionAssistState(null);
    setActiveWordLookup({
      key,
      text,
      paragraph,
      paragraphIndex,
      startOffset,
      top,
      left,
      placement,
      dictionaryStatus: dictionaryEligible ? "loading" : "idle",
      contextStatus: cachedContext ? "ready" : "loading",
      contextMeaning: cachedContext,
    });
    window.getSelection()?.removeAllRanges();

    if (!cachedContext || !hasEnglishWordContext(cachedContext)) {
      void ensureWordContextMeaning(text, paragraph, paragraphIndex, startOffset).then((record) => {
        setActiveWordLookup((current) => current?.key === key
          ? {
              ...current,
              contextStatus: record ? "ready" : "error",
              contextMeaning: record,
              contextError: record ? undefined : "语境分析暂时失败",
            }
          : current);
        setWordDetailLookup((current) => current?.key === key
          ? {
              ...current,
              contextStatus: record ? "ready" : "error",
              contextMeaning: record,
              contextError: record ? undefined : "语境分析暂时失败",
            }
          : current);
      });
    }

    if (dictionaryEligible) {
      void lookupDictionary(text).then((dictionary) => {
        setActiveWordLookup((current) => current?.key === key
          ? { ...current, dictionaryStatus: "ready", dictionary, dictionaryError: undefined }
          : current);
        setWordDetailLookup((current) => current?.key === key
          ? { ...current, dictionaryStatus: "ready", dictionary, dictionaryError: undefined }
          : current);
        if (preferences.autoPronounceOnWordClick) {
          playWordPronunciation(text, dictionary, preferences.pronunciationAccent);
        }
      }).catch((error) => {
        if (preferences.autoPronounceOnWordClick) {
          playWordPronunciation(text, undefined, preferences.pronunciationAccent);
        }
        setActiveWordLookup((current) => current?.key === key
          ? {
              ...current,
              dictionaryStatus: "error",
              dictionaryError: error instanceof Error ? error.message : "词典查询失败",
            }
          : current);
        setWordDetailLookup((current) => current?.key === key
          ? {
              ...current,
              dictionaryStatus: "error",
              dictionaryError: error instanceof Error ? error.message : "词典查询失败",
            }
          : current);
      });
    }
  }

  function setWordLookupFamiliarity(lookup: ActiveWordLookup, familiarity: FamiliarityLevel) {
    setSavedSelections((current) => {
      const normalizedText = lookup.text.trim().toLocaleLowerCase("en-US");
      const existing = current.find((item) => item.text.trim().toLocaleLowerCase("en-US") === normalizedText);
      const translationZh = existing?.translationZh
        || lookup.dictionary?.definitionsZh[0]?.definition
        || lookup.contextMeaning?.meaningZh
        || undefined;
      const next = addSavedSelection(current, {
        document: article.identity,
        articleTitle: article.title,
        text: lookup.text,
        context: lookup.paragraph,
        paragraphIndex: lookup.paragraphIndex,
        translationZh,
        familiarity,
        translationSource: existing?.translationSource ?? (existing?.translationZh ? undefined : translationZh ? "auto" : undefined),
      });
      saveSavedSelections(getReaderStorage(), next);
      return next;
    });
  }

  function updateWordLookupVocabularyMeaning(lookup: ActiveWordLookup, meaningZh: string) {
    const nextMeaning = meaningZh.trim();
    if (!nextMeaning) return;
    setSavedSelections((current) => {
      const normalizedText = lookup.text.trim().toLocaleLowerCase("en-US");
      const existing = current.find((item) => item.text.trim().toLocaleLowerCase("en-US") === normalizedText);
      const next = addSavedSelection(current, {
        document: article.identity,
        articleTitle: article.title,
        text: lookup.text,
        context: lookup.paragraph,
        paragraphIndex: lookup.paragraphIndex,
        translationZh: nextMeaning,
        translationSource: "user",
        familiarity: existing ? savedSelectionFamiliarity(existing) : 1,
      });
      saveSavedSelections(getReaderStorage(), next);
      return next;
    });
  }

  function updateWordLookupContextMeaning(lookup: ActiveWordLookup, meaningZh: string) {
    if (!lookup.contextMeaning) return;
    const key = lookup.key;
    const editedAt = new Date();
    const normalizedText = lookup.text.trim().toLocaleLowerCase("en-US");
    const nextMeanings = setWordContextMeaningUserOverride(wordContextMeaningsRef.current, key, meaningZh, editedAt);
    wordContextMeaningsRef.current = nextMeanings;
    saveWordContextMeanings(getReaderStorage(), nextMeanings);
    setWordContextMeanings(nextMeanings);
    // Keep the saved vocabulary card in sync with the user's contextual gloss.
    // Scope by document so an identical word in another book is left alone.
    setSavedSelections((current) => {
      let changed = false;
      const next = current.map((item) => {
        if (!savedSelectionBelongsToDocument(item, article.identity)
          || item.text.trim().toLocaleLowerCase("en-US") !== normalizedText
          || (item.translationZh === meaningZh.trim() && item.translationSource === "user")) return item;
        changed = true;
        return { ...item, translationZh: meaningZh.trim(), translationSource: "user" as const };
      });
      if (changed) saveSavedSelections(getReaderStorage(), next);
      return changed ? next : current;
    });
    const updateLookup = (current: ActiveWordLookup | null) => {
      if (!current || current.key !== key || !current.contextMeaning) return current;
      return {
        ...current,
        contextMeaning: {
          ...current.contextMeaning,
          meaningZh: meaningZh.trim(),
          meaningSource: "user" as const,
          editedAt: editedAt.toISOString(),
        },
      };
    };
    setActiveWordLookup(updateLookup);
    setWordDetailLookup(updateLookup);
  }

  function openActiveWordDetails() {
    if (!activeWordLookup) return;
    const lookup = activeWordLookup;
    setWordDetailLookup(lookup);
    setActiveWordLookup(null);
    if (window.matchMedia("(max-width: 1080px)").matches) openReaderDrawer("vocabulary", lookup.paragraphIndex);

    if (!lookup.contextMeaning || !hasEnglishWordContext(lookup.contextMeaning)) {
      void ensureWordContextMeaning(lookup.text, lookup.paragraph, lookup.paragraphIndex, lookup.startOffset).then((record) => {
        setWordDetailLookup((current) => current?.key === lookup.key
          ? {
              ...current,
              contextStatus: record ? "ready" : "error",
              contextMeaning: record,
              contextError: record ? undefined : "语境分析暂时失败",
            }
          : current);
      });
    }

    if (isDictionaryWord(lookup.text) && !lookup.dictionary) {
      void lookupDictionary(lookup.text).then((dictionary) => {
        setWordDetailLookup((current) => current?.key === lookup.key
          ? { ...current, dictionaryStatus: "ready", dictionary, dictionaryError: undefined }
          : current);
      }).catch((error) => {
        setWordDetailLookup((current) => current?.key === lookup.key
          ? {
              ...current,
              dictionaryStatus: "error",
              dictionaryError: error instanceof Error ? error.message : "词典查询失败",
            }
          : current);
      });
    }
  }

  function removeSavedExpression(text: string) {
    const { remaining, removed } = removeSavedSelectionFromDocument(savedSelections, article.identity, text);
    if (!removed.length) return;
    try {
      const normalizedText = text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
      const removedContextMeanings = wordContextMeaningsRef.current.filter((record) =>
        record.document?.documentId === article.identity.documentId
        && record.text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") === normalizedText,
      );
      const removedSentenceRecords = sentenceTranslationRecords.filter((record) =>
        record.document.documentId === article.identity.documentId
        && record.expressions?.some((expression) => expression.text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") === normalizedText),
      );
      saveSavedSelections(getReaderStorage(), remaining);
      setSavedSelections(remaining);
      const remainingContextMeanings = wordContextMeaningsRef.current.filter((record) =>
        record.document?.documentId !== article.identity.documentId
        || record.text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") !== normalizedText,
      );
      wordContextMeaningsRef.current = remainingContextMeanings;
      saveWordContextMeanings(getReaderStorage(), remainingContextMeanings);
      setWordContextMeanings(remainingContextMeanings);
      setSentenceTranslationRecords((current) => {
        let changed = false;
        const next = current.map((record) => {
          if (record.document.documentId !== article.identity.documentId || !record.expressions?.length) return record;
          let recordChanged = false;
          const expressions = record.expressions.map((expression) => {
            if (expression.text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") !== normalizedText
              || (!expression.meaningZh && expression.meaningVersion === undefined)) return expression;
            const { meaningZh: _meaningZh, meaningVersion: _meaningVersion, ...withoutCachedMeaning } = expression;
            changed = true;
            recordChanged = true;
            return withoutCachedMeaning;
          });
          return recordChanged ? { ...record, expressions } : record;
        });
        if (changed) saveSentenceTranslations(getReaderStorage(), next);
        return changed ? next : current;
      });
      setRemovedVocabulary((current) => [...current, { text, records: removed, contextRecords: removedContextMeanings, sentenceRecords: removedSentenceRecords }]);
      setRemovalNoticeVisible(true);
      setVocabularyRemovalError("");
      setActiveSelection(null); setSelectionSaved(false); setActiveWordLookup(null); setWordDetailLookup(null);
      setSelectionAssistState(null); setFocusedVocabularySentence(null);
    } catch { setVocabularyRemovalError("未能保存移除操作，词条仍保留，请重试。"); }
  }

  function undoVocabularyRemoval() {
    const last = removedVocabulary.at(-1);
    if (!last) return;
    try {
      const restored = restoreRemovedSelections(savedSelections, last.records);
      if (restored.length > 500) { setVocabularyRemovalError("词汇数量已达上限，请先移除其他词条后再撤销。"); return; }
      saveSavedSelections(getReaderStorage(), restored);
      setSavedSelections(restored);
      const restoredContexts = [...last.contextRecords, ...wordContextMeaningsRef.current.filter((record) => !last.contextRecords.some((removedRecord) => removedRecord.key === record.key))];
      wordContextMeaningsRef.current = restoredContexts;
      saveWordContextMeanings(getReaderStorage(), restoredContexts);
      setWordContextMeanings(restoredContexts);
      setSentenceTranslationRecords((current) => {
        const restoredRecords = [...last.sentenceRecords, ...current.filter((record) => !last.sentenceRecords.some((removedRecord) => removedRecord.key === record.key))];
        saveSentenceTranslations(getReaderStorage(), restoredRecords);
        return restoredRecords;
      });
      setRemovedVocabulary((current) => current.slice(0, -1));
      setRemovalNoticeVisible(removedVocabulary.length > 1);
      setVocabularyRemovalError("");
    } catch { setVocabularyRemovalError("未能保存撤销操作，请重试。"); }
  }

  function updateSavedExpressionTranslation(text: string, translationZh: string) {
    setSavedSelections((current) => {
      const next = setSavedSelectionTranslation(current, text, translationZh);
      saveSavedSelections(getReaderStorage(), next);
      return next;
    });
  }

  function updateSavedExpressionFamiliarity(text: string, familiarity: FamiliarityLevel) {
    setSavedSelections((current) => {
      const next = setSavedSelectionFamiliarity(current, text, familiarity);
      saveSavedSelections(getReaderStorage(), next);
      return next;
    });
  }

  function nearestVocabularyOccurrenceIndex(occurrences: SavedTextOccurrence[]): number {
    const readingPage = readingPageRef.current;
    if (!readingPage || occurrences.length < 2) return 0;
    const viewportAnchor = window.innerHeight * 0.42;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    occurrences.forEach((occurrence, index) => {
      const paragraph = readingPage.querySelector<HTMLElement>(`[data-paragraph-index="${occurrence.paragraphIndex}"]`);
      if (!paragraph) return;
      const rect = paragraph.getBoundingClientRect();
      const distance = Math.abs(rect.top + Math.min(rect.height / 2, 90) - viewportAnchor);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    return nearestIndex;
  }

  function flashActiveParagraph(paragraphIndex: number) {
    if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0 || paragraphIndex >= article.paragraphs.length) return;
    activeParagraphCueSequenceRef.current += 1;
    const token = activeParagraphCueSequenceRef.current;
    setActiveParagraphCue({ token, paragraphIndex });
    if (activeParagraphCueTimerRef.current !== null) window.clearTimeout(activeParagraphCueTimerRef.current);
    activeParagraphCueTimerRef.current = window.setTimeout(() => {
      setActiveParagraphCue((current) => current?.token === token ? null : current);
      activeParagraphCueTimerRef.current = null;
    }, 1_600);
  }

  function currentJumpBackTarget(): ReaderJumpBackTarget | null {
    const node = readingPageRef.current;
    if (!node) return null;
    const metrics = readerMode === "sentence"
      ? (() => {
          const block = node.querySelector<HTMLElement>(".sentence-reading-block[data-paragraph-index]");
          if (!block || !currentSentence) return [];
          const rect = block.getBoundingClientRect();
          return [{ paragraphIndex: currentSentence.paragraphIndex, top: rect.top, bottom: rect.bottom }];
        })()
      : [...node.querySelectorAll<HTMLElement>(".reading-body .reading-paragraph-block[data-paragraph-index]")].map((block) => {
          const rect = block.getBoundingClientRect();
          return { paragraphIndex: Number(block.dataset.paragraphIndex), top: rect.top, bottom: rect.bottom };
        });
    return captureReaderJumpBackTarget({
      documentId: article.identity.documentId,
      paragraphs: article.paragraphs,
      metrics,
      anchorY: Math.min(180, Math.max(96, window.innerHeight * 0.22)),
      mode: readerMode,
      sentenceIndex: readerMode === "sentence" ? sentenceIndex : undefined,
    });
  }

  function rememberJumpBackTarget() {
    const target = currentJumpBackTarget();
    if (target) setJumpBackTarget(target);
  }

  function returnToJumpBackTarget() {
    const resolved = resolveReaderJumpBackTarget(jumpBackTarget, article.identity.documentId, article.paragraphs, articleSentences.length);
    if (!resolved) {
      setJumpBackTarget(null);
      return;
    }
    setArticleFindOpen(false);
    setKeyboardHelpOpen(false);
    setActiveSelection(null);
    setSelectionAssistState(null);
    setActiveWordLookup(null);
    setWordDetailLookup(null);
    setDrawer(null);
    setFocusedVocabularySentence(null);
    setFocusedNoteAnchor(null);
    setSentenceTranslationVisible(false);
    setJumpBackTarget(null);
    articleFindJumpCapturedRef.current = false;

    flashActiveParagraph(resolved.paragraphIndex);

    if (resolved.mode === "sentence" && resolved.sentenceIndex !== undefined) {
      setReaderMode("sentence");
      setSentenceIndex(resolved.sentenceIndex);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => readingPageRef.current?.querySelector<HTMLElement>(".sentence-reading-card")?.scrollIntoView({ block: "center", behavior: "auto" }));
      });
      return;
    }

    setReaderMode("article");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = readingPageRef.current?.querySelector<HTMLElement>(`.reading-body .reading-paragraph-block[data-paragraph-index="${resolved.paragraphIndex}"]`);
        if (!target) return;
        const top = window.scrollY + target.getBoundingClientRect().top - resolved.viewportOffset;
        window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
      });
    });
  }

  function navigateVocabularyOccurrence(text: string, direction: VocabularyNavigationDirection) {
    const textKey = vocabularyTextKey(text);
    const occurrences = vocabularyOccurrencesByText.get(textKey) ?? [];
    if (!occurrences.length) return;
    rememberJumpBackTarget();
    setReaderMode("article");

    const currentIndex = Math.min(vocabularyOccurrenceIndexes[textKey] ?? 0, occurrences.length - 1);
    const nextIndex = direction === "nearest"
      ? nearestVocabularyOccurrenceIndex(occurrences)
      : direction === "previous"
        ? (currentIndex - 1 + occurrences.length) % occurrences.length
        : (currentIndex + 1) % occurrences.length;
    const occurrence = occurrences[nextIndex];
    const paragraph = article.paragraphs[occurrence.paragraphIndex] ?? "";
    const sentence = sentenceRangeForOccurrence(paragraph, occurrence.startOffset, Math.max(occurrence.endOffset - occurrence.startOffset, 1));

    setVocabularyOccurrenceIndexes((current) => ({ ...current, [textKey]: nextIndex }));
    vocabularyFocusSequenceRef.current += 1;
    setFocusedVocabularySentence({
      token: vocabularyFocusSequenceRef.current,
      paragraphIndex: occurrence.paragraphIndex,
      sentenceStart: sentence.startOffset,
      sentenceEnd: sentence.endOffset,
    });
    flashActiveParagraph(occurrence.paragraphIndex);
    setActiveWordLookup(null);
    void ensureWordContextMeaning(text, paragraph, occurrence.paragraphIndex, occurrence.startOffset);
  }

  function openArticleImageZoom(image: ArticleImage, trigger: HTMLButtonElement) {
    articleImageZoomTriggerRef.current = trigger;
    const sourceImage = trigger.querySelector<HTMLImageElement>("img");
    const sourceWidth = sourceImage?.getBoundingClientRect().width ?? trigger.getBoundingClientRect().width;
    const naturalWidth = sourceImage?.naturalWidth ?? 0;
    const naturalHeight = sourceImage?.naturalHeight ?? 0;
    const heightLimitedWidth = naturalWidth > 0 && naturalHeight > 0
      ? window.innerHeight * 0.82 * (naturalWidth / naturalHeight)
      : sourceWidth;
    const fitWidth = naturalWidth > 0
      ? Math.min(naturalWidth, heightLimitedWidth, Math.min(window.innerWidth * 0.96, 1800))
      : Math.min(sourceWidth, Math.min(window.innerWidth * 0.96, 1800));
    setArticleImageZoomDetailSize(fitWidth + 1 < sourceWidth);
    setKeyboardHelpOpen(false);
    closeSelectionAssist();
    setActiveWordLookup(null);
    setWordDetailLookup(null);
    setZoomedArticleImage(image);
  }

  function closeArticleImageZoom() {
    if (!zoomedArticleImage) return;
    const trigger = articleImageZoomTriggerRef.current;
    articleImageZoomTriggerRef.current = null;
    setZoomedArticleImage(null);
    setArticleImageZoomDetailSize(false);
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  }

  function closeSelectionAssist() {
    setActiveSelection(null);
    setSelectionAssistState(null);
    setSelectionSaved(false);
    window.getSelection()?.removeAllRanges();
    setSelectionTranslationZh("");
    setSelectionCopyState("idle");
  }

  function currentSelectionNoteAnchor(): ReaderNoteSelectionAnchor | undefined {
    if (!activeSelection || activeSelection.endOffset === undefined) return undefined;
    const paragraphText = article.paragraphs[activeSelection.paragraphIndex] ?? "";
    const selectedText = paragraphText.slice(activeSelection.startOffset, activeSelection.endOffset);
    if (!selectedText || selectedText.replace(/\s+/g, " ").trim() !== activeSelection.text) return undefined;
    return {
      kind: "selection",
      paragraphIndex: activeSelection.paragraphIndex,
      paragraphText,
      startOffset: activeSelection.startOffset,
      endOffset: activeSelection.endOffset,
      selectedText,
    };
  }

  function beginParagraphNote(paragraphIndex: number, paragraphText: string) {
    setNoteDraftAnchor({ kind: "paragraph", paragraphIndex, paragraphText });
    openNotesDrawer(paragraphIndex);
  }

  function currentReadingParagraphIndex(): number | null {
    if (readerLanguage === "chinese") return chineseParagraphRef.current;
    if (readerMode === "sentence") return currentSentence?.paragraphIndex ?? null;
    const readingPage = readingPageRef.current;
    if (!readingPage) return null;
    const anchorY = window.innerHeight * 0.5;
    let nearest: { paragraphIndex: number; distance: number } | null = null;
    const blocks = readingPage.querySelectorAll<HTMLElement>(".reading-body .reading-paragraph-block[data-paragraph-index]");
    for (const block of blocks) {
      const paragraphIndex = Number(block.dataset.paragraphIndex);
      if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0 || paragraphIndex >= article.paragraphs.length) continue;
      const rect = block.getBoundingClientRect();
      if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) continue;
      if (rect.top <= anchorY && rect.bottom >= anchorY) return paragraphIndex;
      const distance = anchorY < rect.top ? rect.top - anchorY : anchorY - rect.bottom;
      if (!nearest || distance < nearest.distance) nearest = { paragraphIndex, distance };
    }
    return nearest?.paragraphIndex ?? null;
  }

  function locateCodexParagraph(paragraphIndex: number) {
    if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0 || paragraphIndex >= article.paragraphs.length) return;
    rememberJumpBackTarget();
    setReaderMode("article");
    setKeyboardHelpOpen(false);
    setActiveSelection(null);
    setSelectionAssistState(null);
    setActiveWordLookup(null);
    setWordDetailLookup(null);
    if (readerLanguage === "chinese") {
      chineseParagraphRef.current = paragraphIndex;
      window.requestAnimationFrame(() => readingPageRef.current?.querySelector(`[data-chinese-paragraph="${paragraphIndex}"]`)?.scrollIntoView({ block: "center", behavior: "auto" }));
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = readingPageRef.current?.querySelector<HTMLElement>(`.reading-body .reading-paragraph-block[data-paragraph-index="${paragraphIndex}"]`);
        if (!target) return;
        flashActiveParagraph(paragraphIndex);
        target.scrollIntoView({ block: "center", behavior: "auto" });
      });
    });
  }

  function captureReaderDrawerLayoutAnchor(preferredParagraphIndex?: number): ReaderDrawerLayoutAnchor | null {
    const readingPage = readingPageRef.current;
    if (!readingPage) return null;
    const target = readerMode === "sentence"
      ? readingPage.querySelector<HTMLElement>(".sentence-reading-card")
      : (() => {
          const paragraphIndex = preferredParagraphIndex ?? currentReadingParagraphIndex();
          if (paragraphIndex === null) return null;
          return readingPage.querySelector<HTMLElement>(`.reading-body .reading-paragraph-block[data-paragraph-index="${paragraphIndex}"]`);
        })();
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.height) || rect.height <= 0) return null;
    const viewportCenter = window.innerHeight * 0.5;
    const targetCenter = rect.top + rect.height / 2;
    const viewportY = rect.top <= viewportCenter && rect.bottom >= viewportCenter ? viewportCenter : targetCenter;
    const relativeY = Math.max(0, Math.min(1, (viewportY - rect.top) / rect.height));
    return readerMode === "sentence"
      ? { kind: "sentence", viewportY, relativeY }
      : { kind: "paragraph", paragraphIndex: Number(target.dataset.paragraphIndex), viewportY, relativeY };
  }

  function prepareReaderDrawerLayoutChange(preferredParagraphIndex?: number) {
    readerDrawerLayoutAnchorRef.current = captureReaderDrawerLayoutAnchor(preferredParagraphIndex);
  }

  function openReaderDrawer(nextDrawer: Exclude<Drawer, null>, preferredParagraphIndex?: number) {
    if (drawer === null) prepareReaderDrawerLayoutChange(preferredParagraphIndex);
    setDrawer(nextDrawer);
  }

  function openNotesDrawer(preferredParagraphIndex?: number) {
    openReaderDrawer("notes", preferredParagraphIndex);
  }

  function closeReaderDrawer() {
    if (drawer !== null) prepareReaderDrawerLayoutChange();
    setDrawer(null);
  }

  function beginQuickNote(): boolean {
    noteDraftResumePendingRef.current = false;
    const paragraphIndex = currentReadingParagraphIndex();
    if (paragraphIndex === null) return false;
    const paragraphText = article.paragraphs[paragraphIndex] ?? "";
    if (!paragraphText) return false;
    setKeyboardHelpOpen(false);
    closeArticleFind();
    setActiveSelection(null);
    setSelectionAssistState(null);
    setActiveWordLookup(null);
    setWordDetailLookup(null);
    setNoteDraftAnchor({ kind: "paragraph", paragraphIndex, paragraphText });
    openNotesDrawer(paragraphIndex);
    flashActiveParagraph(paragraphIndex);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => noteDraftInputRef.current?.focus());
    });
    return true;
  }

  function beginSelectionNote(): boolean {
    const anchor = currentSelectionNoteAnchor();
    if (!anchor) return false;
    setKeyboardHelpOpen(false);
    setNoteDraftAnchor(anchor);
    openNotesDrawer(anchor.paragraphIndex);
    closeSelectionAssist();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => noteDraftInputRef.current?.focus());
    });
    return true;
  }

  function focusResolvedNoteAnchor(resolved: ResolvedNoteAnchor, stabilizeLayout = false) {
    setReaderMode("article");
    flashActiveParagraph(resolved.paragraphIndex);
    noteAnchorFocusSequenceRef.current += 1;
    setFocusedNoteAnchor({
      token: noteAnchorFocusSequenceRef.current,
      paragraphIndex: resolved.paragraphIndex,
      stabilizeLayout,
    });
  }

  function focusNote(noteId: string) {
    const note = notes.find((candidate) => candidate.id === noteId);
    const resolved = resolveNoteAnchor(note?.anchor, article.paragraphs);
    if (resolved) {
      rememberJumpBackTarget();
      focusResolvedNoteAnchor(resolved);
    }
  }

  function openInlineNotes(paragraphIndex: number) {
    const firstAnchoredNote = anchoredNotesByParagraph.get(paragraphIndex)?.[0];
    setNoteDraftAnchor(undefined);
    openNotesDrawer(paragraphIndex);
    if (firstAnchoredNote) focusResolvedNoteAnchor(firstAnchoredNote.resolved);
  }

  function exitNoteDraft() {
    noteDraftResumePendingRef.current = true;
    closeReaderDrawer();
    window.requestAnimationFrame(() => readingPageRef.current?.focus({ preventScroll: true }));
  }

  function toggleDrawer(nextDrawer: Exclude<Drawer, null>) {
    let focusResumedNoteDraft = false;
    if (nextDrawer === "notes") {
      const resumeDraft = drawer === null && noteDraftResumePendingRef.current;
      noteDraftResumePendingRef.current = false;
      focusResumedNoteDraft = resumeDraft;
      if (!resumeDraft) setNoteDraftAnchor(undefined);
    } else {
      noteDraftResumePendingRef.current = false;
    }
    const resolvedDrawer = drawer === nextDrawer ? null : nextDrawer;
    if ((drawer === null) !== (resolvedDrawer === null)) prepareReaderDrawerLayoutChange();
    setDrawer(resolvedDrawer);
    if (focusResumedNoteDraft) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const input = noteDraftInputRef.current;
          if (!input) return;
          input.focus({ preventScroll: true });
          const end = input.value.length;
          input.setSelectionRange(end, end);
        });
      });
    }
  }

  function toggleContentsDrawerFromShortcut() {
    const opening = drawer !== "toc";
    setKeyboardHelpOpen(false);
    toggleDrawer("toc");
    if (!opening) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const currentArticleButton = document.querySelector<HTMLElement>(".reader-drawer .drawer-article.is-active");
        if (!currentArticleButton) return;
        currentArticleButton.focus({ preventScroll: true });
        currentArticleButton.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
      });
    });
  }

  function openPreviousArticle() {
    if (!previous) return;
    onOpenArticle(previous.id);
  }

  function openNextArticle() {
    if (!next) return;
    onOpenArticle(next.id);
  }

  function addNote() {
    const text = noteDraft.trim();
    if (!text) return;
    onNotesChange([
      ...notes,
      {
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        document: article.identity,
        text,
        createdAt: new Date().toISOString(),
        ...(noteDraftAnchor ? { anchor: noteDraftAnchor } : {}),
      },
    ]);
    setNoteDraft("");
    setNoteDraftAnchor(undefined);
  }

  async function ensureReadingTextTranslation(
    target: ReturnType<typeof paragraphTranslationTarget>,
    text: string,
    contextBefore: string | undefined,
    contextAfter: string | undefined,
    force = false,
    expanded = true,
  ): Promise<boolean> {
    if (!isTranslatableText(text)) return false;
    const key = target.key;
    const current = translations[key];

    if (!force && current?.status === "loading") return false;

    if (!force && current?.status === "ready") {
      setTranslations((items) => ({ ...items, [key]: { ...current, expanded, error: undefined } }));
      return true;
    }

    if (!force) {
      const cached = findParagraphTranslation(paragraphTranslationRecords, target);
      if (cached) {
        setTranslations((items) => ({
          ...items,
          [key]: {
            status: "ready",
            expanded,
            translation: cached.translationZh,
            profileId: cached.profileId,
            model: cached.model,
            generatedAt: cached.generatedAt,
          },
        }));
        return true;
      }
    }

    setTranslations((items) => ({
      ...items,
      [key]: {
        ...(force && current?.status === "ready" ? current : {}),
        status: "loading",
        expanded,
        error: undefined,
      },
    }));

    try {
      const result = await translateParagraph({
        text,
        contextBefore,
        contextAfter,
      });
      const record: ParagraphTranslationRecord = {
        ...target,
        translationZh: result.translation,
        ...(result.profileId ? { profileId: result.profileId } : {}),
        model: result.model,
        provider: result.provider,
        generatedAt: new Date().toISOString(),
      };
      setParagraphTranslationRecords((records) => {
        const next = upsertParagraphTranslation(records, record);
        saveParagraphTranslations(getReaderStorage(), next);
        return next;
      });
      setTranslations((items) => ({
        ...items,
        [key]: {
          status: "ready",
          expanded,
          translation: record.translationZh,
          profileId: record.profileId,
          model: record.model,
          generatedAt: record.generatedAt,
        },
      }));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "翻译失败";
      if (force && current?.status === "ready" && current.translation) {
        setTranslations((items) => ({ ...items, [key]: { ...current, status: "ready", expanded, error: message } }));
        return false;
      }
      setTranslations((items) => ({ ...items, [key]: { status: "error", expanded, error: message } }));
      return false;
    }
  }

  async function ensureParagraphTranslation(index: number, paragraph: string, force = false, expanded = true): Promise<boolean> {
    if (!canTranslateParagraph(paragraph, index)) return false;
    const target = paragraphTranslationTarget({ document: article.identity, paragraphIndex: index, sourceText: paragraph });
    return ensureReadingTextTranslation(target, paragraph, article.paragraphs[index - 1], article.paragraphs[index + 1], force, expanded);
  }

  async function toggleTranslation(index: number, paragraph: string, force = false) {
    if (!canTranslateParagraph(paragraph, index)) return;
    const target = paragraphTranslationTarget({ document: article.identity, paragraphIndex: index, sourceText: paragraph });
    const current = translations[target.key];
    if (!force && current?.status === "loading") return;
    if (!force && current?.status === "ready") {
      setFullArticleTranslationExpanded(false);
      setTranslations((items) => ({ ...items, [target.key]: { ...current, expanded: !current.expanded, error: undefined } }));
      return;
    }
    await ensureParagraphTranslation(index, paragraph, force, true);
  }

  async function toggleHeadingTranslation(headingIndex: number, heading: string, force = false) {
    if (!isTranslatableText(heading)) return;
    const target = headingTranslationTarget({ document: article.identity, headingIndex, sourceText: heading });
    const current = translations[target.key];
    if (!force && current?.status === "loading") return;
    if (!force && current?.status === "ready") {
      setFullArticleTranslationExpanded(false);
      setTranslations((items) => ({ ...items, [target.key]: { ...current, expanded: !current.expanded, error: undefined } }));
      return;
    }
    await ensureReadingTextTranslation(target, heading, undefined, undefined, force, true);
  }

  async function toggleFullArticleTranslation() {
    if (fullArticleTranslationRunning || currentArticleTranslationLoading) return;

    if (fullArticleTranslationExpanded) {
      setFullArticleTranslationExpanded(false);
      setTranslations((items) => {
        const next = { ...items };
        fullArticleTranslationTargets.forEach((target) => {
          const current = next[target.key];
          if (current?.expanded) next[target.key] = { ...current, expanded: false };
        });
        return next;
      });
      return;
    }

    if (readerMode !== "article") switchReaderMode("article");
    setFullArticleTranslationExpanded(true);

    const missing = article.paragraphs.flatMap((paragraph, index) => {
      if (!canTranslateParagraph(paragraph, index)) return [];
      const target = paragraphTranslationTarget({ document: article.identity, paragraphIndex: index, sourceText: paragraph });
      const current = translations[target.key];
      const cached = findParagraphTranslation(paragraphTranslationRecords, target);
      return current?.status === "ready" || cached ? [] : [{ index, paragraph }];
    });

    setTranslations((items) => {
      const next = { ...items };
      fullArticleTranslationTargets.forEach((target) => {
        const current = items[target.key];
        if (current?.status === "ready") {
          next[target.key] = { ...current, expanded: true, error: undefined };
          return;
        }
        const cached = findParagraphTranslation(paragraphTranslationRecords, target);
        if (cached) {
          next[target.key] = {
            status: "ready",
            expanded: true,
            translation: cached.translationZh,
            profileId: cached.profileId,
            model: cached.model,
            generatedAt: cached.generatedAt,
          };
          return;
        }
        if (current?.status === "error") next[target.key] = { ...current, expanded: true };
      });
      return next;
    });

    if (!missing.length) return;

    fullArticleTranslationRunRef.current += 1;
    const runToken = fullArticleTranslationRunRef.current;
    setFullArticleTranslationRunning(true);
    let cursor = 0;
    const worker = async () => {
      while (cursor < missing.length && fullArticleTranslationRunRef.current === runToken) {
        const item = missing[cursor];
        cursor += 1;
        await ensureParagraphTranslation(item.index, item.paragraph, false, true);
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(3, missing.length) }, () => worker()));
    } finally {
      if (fullArticleTranslationRunRef.current === runToken) setFullArticleTranslationRunning(false);
    }
  }

  function switchReaderMode(nextMode: ReaderMode) {
    if (readerLanguage === "chinese") {
      setReaderLanguage("english");
      const paragraphIndex = chineseParagraphRef.current;
      setPendingSentenceAnchor({ paragraphIndex, startOffset: 0 });
      if (nextMode === "sentence") {
        const index = readerSentenceIndexForOffset(articleSentences, paragraphIndex, 0);
        setSentenceIndex(Math.max(0, index)); setReaderMode("sentence");
      } else {
        setReaderMode("article");
        setFocusedVocabularySentence({ token: ++vocabularyFocusSequenceRef.current, paragraphIndex, sentenceStart: 0, sentenceEnd: article.paragraphs[paragraphIndex]?.length ?? 0, stabilizeLayout: true });
      }
      return;
    }
    if (nextMode === readerMode) return;
    setActiveSelection(null);
    setActiveWordLookup(null);
    setSelectionAssistState(null);
    setSentenceTranslationVisible(false);
    if (nextMode === "sentence") {
      setArticleFindOpen(false);
      setDrawer(null);
      setWordDetailLookup(null);
      setKeyboardHelpOpen(false);
    }

    if (nextMode === "sentence" && articleSentences.length) {
      const anchoredIndex = pendingSentenceAnchor
        ? readerSentenceIndexForOffset(
            articleSentences,
            pendingSentenceAnchor.paragraphIndex,
            pendingSentenceAnchor.startOffset,
          )
        : -1;
      const visibleParagraphIndex = currentReadingParagraphIndex();
      const resumedParagraphIndex = resolveArticleReadingPosition(readingPosition, article.paragraphs);
      const entryParagraphIndex = visibleParagraphIndex ?? resumedParagraphIndex;
      const resumedIndex = entryParagraphIndex !== null
        ? readerSentenceIndexForOffset(articleSentences, entryParagraphIndex, 0)
        : -1;
      setSentenceIndex(anchoredIndex >= 0 ? anchoredIndex : resumedIndex >= 0 ? resumedIndex : 0);
      setPendingSentenceAnchor(null);
      setReaderMode(nextMode);
      window.requestAnimationFrame(() => readingPageRef.current?.scrollIntoView({ block: "start" }));
      return;
    }

    if (nextMode === "article" && currentSentence) {
      setPendingSentenceAnchor({ paragraphIndex: currentSentence.paragraphIndex, startOffset: currentSentence.startOffset });
      vocabularyFocusSequenceRef.current += 1;
      setFocusedVocabularySentence({
        token: vocabularyFocusSequenceRef.current,
        paragraphIndex: currentSentence.paragraphIndex,
        sentenceStart: currentSentence.startOffset,
        sentenceEnd: currentSentence.endOffset,
        stabilizeLayout: true,
      });
    }
    setReaderMode(nextMode);
  }

  function toggleChineseReader() {
    if (readerLanguage === "chinese") { switchReaderMode("article"); return; }
    chineseParagraphRef.current = readerMode === "sentence" ? currentSentence?.paragraphIndex ?? 0 : currentReadingParagraphIndex() ?? resolveArticleReadingPosition(readingPosition, article.paragraphs) ?? 0;
    setReaderMode("article"); setReaderLanguage("chinese");
    setDrawer(null); setWordDetailLookup(null); setActiveWordLookup(null); setActiveSelection(null);
    setSelectionAssistState(null); setArticleFindOpen(false); setKeyboardHelpOpen(false);
    fullArticleTranslationRunRef.current += 1; setFullArticleTranslationRunning(false);
  }

  function moveSentence(delta: -1 | 1) {
    if (!articleSentences.length) return;
    const nextIndex = Math.max(0, Math.min(articleSentences.length - 1, sentenceIndex + delta));
    if (nextIndex === sentenceIndex) return;
    setSentenceIndex(nextIndex);
    setSentenceTranslationVisible(false);
    setWordDetailLookup(null);
    if (drawer === "vocabulary") setDrawer(null);
    setActiveSelection(null);
    setActiveWordLookup(null);
    setSelectionAssistState(null);
    onProgressChange(readerSentenceProgress(nextIndex, articleSentences.length));
  }

  function moveParagraph(direction: ParagraphNavigationDirection): boolean {
    if (readerMode !== "article") return false;
    const readingPage = readingPageRef.current;
    if (!readingPage) return false;
    const blocks = [...readingPage.querySelectorAll<HTMLElement>(".reading-body .reading-paragraph-block[data-paragraph-index]")];
    const targetIndex = resolveParagraphNavigationTarget(
      blocks.map((block) => {
        const rect = block.getBoundingClientRect();
        return { index: Number(block.dataset.paragraphIndex), top: rect.top, bottom: rect.bottom };
      }),
      window.innerHeight * 0.5,
      direction,
    );
    if (targetIndex === null) return false;
    const target = readingPage.querySelector<HTMLElement>(`.reading-body .reading-paragraph-block[data-paragraph-index="${targetIndex}"]`);
    if (!target) return false;
    setKeyboardHelpOpen(false);
    setActiveSelection(null);
    setSelectionAssistState(null);
    setActiveWordLookup(null);
    setWordDetailLookup(null);
    flashActiveParagraph(targetIndex);
    target.scrollIntoView({ block: "center", behavior: "auto" });
    return true;
  }

  async function saveCurrentSentenceExpression(expression: SentenceExpression) {
    if (!currentSentenceTarget || !currentSentence) return;
    openReaderDrawer("vocabulary");
    const target = currentSentenceTarget;
    const paragraph = article.paragraphs[currentSentence.paragraphIndex];
    const offset = target.startOffset + target.sourceText.indexOf(expression.text.trim());
    const ready = await completeSentenceExpressionMeaning(expression, () => ensureWordContextMeaning(expression.text, paragraph, target.paragraphIndex, offset, true));
    if (meaningDocumentRef.current !== target.document.documentId) return;
    setSavedSelections((current) => {
      const next = saveSentenceExpression(current, target, ready, paragraph, article.title);
      if (next !== current) saveSavedSelections(getReaderStorage(), next);
      return next;
    });
  }

  function toggleCurrentSentenceTranslation(regenerate: false | "translation" | "expressions" = false) {
    if (!currentSentence || !currentSentenceTarget || !isTranslatableText(currentSentence.text)
      || !canTranslateParagraph(article.paragraphs[currentSentence.paragraphIndex], currentSentence.paragraphIndex)) return;
    if (sentenceTranslationVisible && !regenerate) {
      setSentenceTranslationVisible(false);
      return;
    }
    setSentenceTranslationVisible(true);
    if (currentSentenceTranslation && !regenerate) return;
    if (currentSentenceTranslationRequest?.status === "loading") return;

    const target = currentSentenceTarget;
    const paragraph = article.paragraphs[currentSentence.paragraphIndex];
    const paragraphTarget = paragraphTranslationTarget({ document: article.identity, paragraphIndex: currentSentence.paragraphIndex, sourceText: paragraph });
    const paragraphTranslationReference = findParagraphTranslation(paragraphTranslationRecords, paragraphTarget)?.translationZh
      ?? (translations[paragraphTarget.key]?.status === "ready" ? translations[paragraphTarget.key]?.translation : undefined);
    setSentenceTranslationRequests((current) => ({ ...current, [target.key]: { status: "loading", kind: regenerate || "translation" } }));
    void translateParagraph({
      mode: "sentence",
      paragraphContext: paragraph,
      ...(paragraphTranslationReference ? { paragraphTranslationReference } : {}),
      text: currentSentence.text,
      contextBefore: article.paragraphs[currentSentence.paragraphIndex - 1],
      contextAfter: article.paragraphs[currentSentence.paragraphIndex + 1],
    }).then((result) => {
      const previous = currentSentenceTranslation;
      const recommendedExpressions = (result.expressions ?? []).map((expression) => {
        if (regenerate !== "expressions") return expression;
        const normalized = expression.text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
        const existingUserGloss = articleSelections.find((item) => savedSelectionBelongsToDocument(item, article.identity)
          && item.text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") === normalized
          && item.translationSource === "user")?.translationZh?.trim();
        const offset = target.startOffset + target.sourceText.indexOf(expression.text.trim());
        const contextualRecord = offset >= target.startOffset ? findWordContextMeaning(wordContextMeaningsRef.current, {
          document: article.identity,
          paragraphIndex: target.paragraphIndex,
          startOffset: offset,
          text: expression.text,
          paragraph,
        }) : undefined;
        const userGloss = contextualRecord?.meaningSource === "user" ? contextualRecord.meaningZh.trim() : existingUserGloss;
        return userGloss ? { ...expression, meaningZh: userGloss, meaningVersion: 2 as const } : expression;
      });
      const record: SentenceTranslationRecord = {
        ...target,
        translationZh: regenerate === "expressions" ? previous?.translationZh ?? result.translation : result.translation,
        expressions: regenerate === "translation" && previous
          ? previous.expressions
          : recommendedExpressions,
        model: result.model,
        provider: result.provider,
        generatedAt: new Date().toISOString(),
      };
      setSentenceTranslationRecords((current) => {
        const nextRecords = upsertSentenceTranslation(current, record);
        saveSentenceTranslations(getReaderStorage(), nextRecords);
        return nextRecords;
      });
      setSentenceTranslationRequests((current) => {
        const nextRequests = { ...current };
        delete nextRequests[target.key];
        return nextRequests;
      });
    }).catch((error) => {
      setSentenceTranslationRequests((current) => ({
        ...current,
        [target.key]: {
          status: "error",
          error: error instanceof Error ? error.message : "句子翻译失败",
        },
      }));
    });
  }

  function openArticleFind() {
    setKeyboardHelpOpen(false);
    closeSelectionAssist();
    setActiveWordLookup(null);
    setWordDetailLookup(null);
    if (articleFindMatches.length && !articleFindJumpCapturedRef.current) {
      rememberJumpBackTarget();
      articleFindJumpCapturedRef.current = true;
    }
    setArticleFindOpen(true);
  }

  function closeArticleFind() {
    setArticleFindOpen(false);
    articleFindJumpCapturedRef.current = false;
  }

  function updateArticleFindQuery(query: string) {
    const nextMatches = findArticleMatches(article.paragraphs, query);
    if (nextMatches.length && !articleFindJumpCapturedRef.current) {
      rememberJumpBackTarget();
      articleFindJumpCapturedRef.current = true;
    }
    if (!query.trim()) articleFindJumpCapturedRef.current = false;
    setArticleFindQuery(query);
    setArticleFindIndex(0);
  }

  function moveArticleFind(direction: -1 | 1) {
    if (!articleFindMatches.length) return;
    setArticleFindIndex((current) => {
      const normalized = Math.min(current, articleFindMatches.length - 1);
      return (normalized + direction + articleFindMatches.length) % articleFindMatches.length;
    });
  }

  function handleArticleFindKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      closeArticleFind();
      event.currentTarget.blur();
      event.preventDefault();
      return;
    }
    if (event.key === "Enter") {
      moveArticleFind(event.shiftKey ? -1 : 1);
      event.preventDefault();
    }
  }

  function toggleFocusMode() {
    const nextFocusMode = !focusMode;
    if (nextFocusMode) {
      setKeyboardHelpOpen(false);
      setActiveSelection(null);
      setSelectionAssistState(null);
      setActiveWordLookup(null);
      setWordDetailLookup(null);
      closeReaderDrawer();
    }
    onFocusModeChange(nextFocusMode);
  }

  readerShortcutHandlerRef.current = (event: KeyboardEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const key = event.key.length === 1 ? event.key.toLocaleLowerCase("en-US") : event.key;
    if (zoomedArticleImage) {
      if (key === "Escape") {
        closeArticleImageZoom();
        event.preventDefault();
        return;
      }
      if (key === "Tab") {
        articleMediaZoomCloseRef.current?.focus({ preventScroll: true });
        event.preventDefault();
      }
      return;
    }
    const typingTarget = Boolean(target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || typingTarget) return;
    if (readerLanguage === "chinese" && !["1", "2", "f", "Escape", "?"].includes(key)) return;
    const helpShortcut = key === "?" || (event.shiftKey && key === "/");
    const findShortcut = key === "/" && !event.shiftKey;
    const jumpBackShortcut = key === "b" && !event.shiftKey;
    const quickNoteShortcut = key === "n" && event.shiftKey;
    const translationShortcut = key === "t" && !event.shiftKey;
    const readLaterShortcut = key === "s" && !event.shiftKey;
    const contentsShortcut = key === "c" && !event.shiftKey;
    const wordLookupButtonTarget = Boolean(target?.closest(".word-lookup-card button"));
    const wordLookupFamiliarityShortcut = activeWordLookup && !event.shiftKey && /^[0-5]$/.test(key)
      ? Number(key) as FamiliarityLevel
      : null;
    const wordLookupDetailsShortcut = Boolean(activeWordLookup && !event.shiftKey && key === "Enter" && !wordLookupButtonTarget);
    const selectionTranslateShortcut = Boolean(activeSelection && translationShortcut);
    const selectionExplainShortcut = Boolean(activeSelection && !event.shiftKey && key === "e");
    const selectionCopyShortcut = Boolean(activeSelection && contentsShortcut);
    const selectionSaveShortcut = Boolean(activeSelection && readLaterShortcut);
    const selectionNoteShortcut = Boolean(activeSelection && !event.shiftKey && key === "n");
    const selectionAssistShortcut = selectionTranslateShortcut
      || selectionExplainShortcut
      || selectionCopyShortcut
      || selectionSaveShortcut
      || selectionNoteShortcut;
    const nonRepeatingShortcut = key === "1"
      || key === "2"
      || key === "n"
      || key === "f"
      || translationShortcut
      || readLaterShortcut
      || contentsShortcut
      || wordLookupFamiliarityShortcut !== null
      || wordLookupDetailsShortcut
      || selectionAssistShortcut
      || jumpBackShortcut
      || helpShortcut
      || findShortcut
      || (event.shiftKey && (key === "ArrowLeft" || key === "ArrowRight"));
    if (event.repeat && nonRepeatingShortcut) return;

    if (key === "Escape") {
      const hasTransientReaderUi = articleFindOpen || keyboardHelpOpen || Boolean(activeSelection) || Boolean(activeWordLookup) || Boolean(wordDetailLookup) || Boolean(drawer);
      if (hasTransientReaderUi) {
        setArticleFindOpen(false);
        setKeyboardHelpOpen(false);
        if (activeSelection) closeSelectionAssist();
        else {
          setActiveSelection(null);
          setSelectionAssistState(null);
        }
        setActiveWordLookup(null);
        setWordDetailLookup(null);
        closeReaderDrawer();
        event.preventDefault();
        return;
      }
      if (focusMode) {
        onFocusModeChange(false);
        event.preventDefault();
      }
      return;
    }

    if (helpShortcut) {
      setArticleFindOpen(false);
      setKeyboardHelpOpen((current) => !current);
      event.preventDefault();
      return;
    }
    if (findShortcut) {
      openArticleFind();
      event.preventDefault();
      return;
    }
    if (selectionTranslateShortcut) {
      setKeyboardHelpOpen(false);
      if (!selectionAssistRequestPendingRef.current) void runSelectionAssist("translate");
      event.preventDefault();
      return;
    }
    if (selectionExplainShortcut) {
      setKeyboardHelpOpen(false);
      if (!selectionAssistRequestPendingRef.current) void runSelectionAssist("explain");
      event.preventDefault();
      return;
    }
    if (selectionCopyShortcut) {
      setKeyboardHelpOpen(false);
      void copyActiveSelection();
      event.preventDefault();
      return;
    }
    if (selectionSaveShortcut) {
      setKeyboardHelpOpen(false);
      saveActiveSelection();
      event.preventDefault();
      return;
    }
    if (selectionNoteShortcut) {
      setKeyboardHelpOpen(false);
      beginSelectionNote();
      event.preventDefault();
      return;
    }
    if (wordLookupFamiliarityShortcut !== null && activeWordLookup) {
      setKeyboardHelpOpen(false);
      setWordLookupFamiliarity(activeWordLookup, wordLookupFamiliarityShortcut);
      event.preventDefault();
      return;
    }
    if (wordLookupDetailsShortcut) {
      setKeyboardHelpOpen(false);
      openActiveWordDetails();
      event.preventDefault();
      return;
    }
    if (key === "1") {
      setKeyboardHelpOpen(false);
      switchReaderMode("article");
      event.preventDefault();
      return;
    }
    if (key === "2") {
      setKeyboardHelpOpen(false);
      switchReaderMode("sentence");
      event.preventDefault();
      return;
    }
    if (key === "f") {
      toggleFocusMode();
      event.preventDefault();
      return;
    }
    if (readLaterShortcut) {
      setKeyboardHelpOpen(false);
      onToggleReadLater(article.id);
      event.preventDefault();
      return;
    }
    if (contentsShortcut) {
      toggleContentsDrawerFromShortcut();
      event.preventDefault();
      return;
    }
    if (translationShortcut) {
      if (readerMode === "sentence") {
        if (!currentSentence || !currentSentenceTarget) return;
        setKeyboardHelpOpen(false);
        toggleCurrentSentenceTranslation();
        event.preventDefault();
        return;
      }
      const paragraphIndex = currentReadingParagraphIndex();
      if (paragraphIndex === null) return;
      const paragraph = article.paragraphs[paragraphIndex] ?? "";
      if (!paragraph) return;
      setKeyboardHelpOpen(false);
      void toggleTranslation(paragraphIndex, paragraph);
      event.preventDefault();
      return;
    }
    if (quickNoteShortcut) {
      if (beginQuickNote()) event.preventDefault();
      return;
    }
    if (key === "n" && !event.shiftKey) {
      setKeyboardHelpOpen(false);
      toggleDrawer("notes");
      event.preventDefault();
      return;
    }
    if (jumpBackShortcut) {
      if (!jumpBackTarget) return;
      setKeyboardHelpOpen(false);
      returnToJumpBackTarget();
      event.preventDefault();
      return;
    }
    if (event.shiftKey && key === "ArrowLeft") {
      if (!previous) return;
      setKeyboardHelpOpen(false);
      openPreviousArticle();
      event.preventDefault();
      return;
    }
    if (event.shiftKey && key === "ArrowRight") {
      if (!next) return;
      setKeyboardHelpOpen(false);
      openNextArticle();
      event.preventDefault();
      return;
    }
    if (!event.shiftKey && key === "j") {
      if (readerMode === "article") {
        if (moveParagraph(1)) event.preventDefault();
      } else {
        moveSentence(1);
        event.preventDefault();
      }
      return;
    }
    if (!event.shiftKey && key === "k") {
      if (readerMode === "article") {
        if (moveParagraph(-1)) event.preventDefault();
      } else {
        moveSentence(-1);
        event.preventDefault();
      }
      return;
    }
    if (readerMode === "sentence" && key === "ArrowLeft") {
      moveSentence(-1);
      event.preventDefault();
      return;
    }
    if (readerMode === "sentence" && key === "ArrowRight") {
      moveSentence(1);
      event.preventDefault();
    }
  };

  useLayoutEffect(() => {
    const handleReaderShortcut = (event: KeyboardEvent) => readerShortcutHandlerRef.current(event);
    window.addEventListener("keydown", handleReaderShortcut);
    return () => window.removeEventListener("keydown", handleReaderShortcut);
  }, []);

  function renderParagraphRange(
    paragraph: string,
    paragraphIndex: number,
    rangeStart: number,
    rangeEnd: number,
    rangeKey: string,
  ) {
    const slice = paragraph.slice(rangeStart, rangeEnd);
    if (!slice) return null;
    const paragraphKey = `${article.id}:${paragraphIndex}:${rangeKey}`;
    const paragraphFindMatches = articleFindOpen ? (articleFindMatchesByParagraph.get(paragraphIndex) ?? []) : [];

    function decorateFindMatches(
      text: string,
      absoluteStart: number,
      keyPrefix: string,
      renderPiece: (piece: string, pieceStart: number, pieceKey: string) => React.ReactNode,
    ) {
      if (!paragraphFindMatches.length || !text) return renderPiece(text, absoluteStart, `${keyPrefix}:whole`);
      const absoluteEnd = absoluteStart + text.length;
      const overlapping = paragraphFindMatches.filter((match) => match.endOffset > absoluteStart && match.startOffset < absoluteEnd);
      if (!overlapping.length) return renderPiece(text, absoluteStart, `${keyPrefix}:whole`);

      const nodes: React.ReactNode[] = [];
      let cursor = absoluteStart;
      overlapping.forEach((match) => {
        const matchStart = Math.max(absoluteStart, match.startOffset);
        const matchEnd = Math.min(absoluteEnd, match.endOffset);
        if (matchStart > cursor) {
          const before = text.slice(cursor - absoluteStart, matchStart - absoluteStart);
          nodes.push(<Fragment key={`${keyPrefix}:before:${match.index}`}>{renderPiece(before, cursor, `${keyPrefix}:before:${match.index}`)}</Fragment>);
        }
        if (matchEnd > matchStart) {
          const matchedText = text.slice(matchStart - absoluteStart, matchEnd - absoluteStart);
          nodes.push(
            <span
              key={`${keyPrefix}:match:${match.index}:${matchStart}`}
              className={`article-find-match ${match.index === activeArticleFindIndex ? "is-active" : ""}`}
              data-article-find-match-index={match.index}
              data-article-find-active={match.index === activeArticleFindIndex}
            >
              {renderPiece(matchedText, matchStart, `${keyPrefix}:match:${match.index}`)}
            </span>,
          );
        }
        cursor = Math.max(cursor, matchEnd);
      });
      if (cursor < absoluteEnd) {
        const after = text.slice(cursor - absoluteStart);
        nodes.push(<Fragment key={`${keyPrefix}:after`}>{renderPiece(after, cursor, `${keyPrefix}:after`)}</Fragment>);
      }
      return nodes;
    }

    return savedHighlightSegments(slice, articleSelections).map((segment, segmentIndex) => {
      const startOffset = rangeStart + (segment.startOffset ?? 0);
      if (!segment.saved) {
        return decorateFindMatches(segment.text, startOffset, `${paragraphKey}:plain:${segmentIndex}`, (piece, pieceStart, pieceKey) =>
          clickableWordSegments(piece, pieceStart).map((token, tokenIndex) => token.isWord
            ? (
                <span
                  key={`${pieceKey}:word:${tokenIndex}`}
                  className="dictionary-word-token"
                  data-word-token={token.text}
                  onClick={(event) => openWordLookup(token.text, paragraph, paragraphIndex, token.startOffset, event.currentTarget)}
                >
                  {token.text}
                </span>
              )
            : <span key={`${pieceKey}:plain:${tokenIndex}`}>{token.text}</span>),
        );
      }

      const contextMeaning = findWordContextMeaning(wordContextMeanings, {
        document: article.identity,
        paragraphIndex,
        startOffset,
        text: segment.text,
        paragraph,
      });
      return (
        <SavedSelectionHighlight
          key={`${paragraphKey}:saved:${segmentIndex}:${segment.text}`}
          text={segment.text}
          displayText={decorateFindMatches(segment.text, startOffset, `${paragraphKey}:saved:${segmentIndex}`, (piece) => piece)}
          translationZh={segment.translationZh}
          familiarity={segment.familiarity ?? 1}
          contextMeaning={/\s/.test(segment.text.trim()) && contextMeaning?.meaningVersion !== 2 ? undefined : contextMeaning}
          onResolveContext={() => ensureWordContextMeaning(segment.text, paragraph, paragraphIndex, startOffset, /\s/.test(segment.text.trim()))}
          onOpenLookup={(event) => openWordLookup(segment.text, paragraph, paragraphIndex, startOffset, event.currentTarget)}
        />
      );
    });
  }

  assistantContextRef.current = { documentId: article.identity.documentId, paragraphCount: article.paragraphs.length,
    currentParagraphIndex: currentReadingParagraphIndex, locateParagraph: locateCodexParagraph };
  return (
    <div className={`reader-page-shell ${onOpenLearning ? "has-learning" : ""} ${focusMode ? "is-focus-mode" : ""} ${readerMode === "sentence" ? "is-sentence-mode" : ""} ${readerLanguage === "chinese" ? "is-chinese-mode" : ""}`} data-focus-mode={focusMode} data-reader-mode={readerMode} data-reader-language={readerLanguage} data-theme={preferences.theme}>
      <div className="reader-toolbar">
        <div className="reader-toolbar-left reader-focus-hidden">
          <button className="icon-button" aria-label={issue.kind === "lessons" ? "返回精选阅读与备课" : issue.kind === "book" ? "返回本书目录" : "返回本期目录"} onClick={onBack}>←</button>
          {readerReturnTarget && (
            <button
              className="reader-return-button"
              aria-label={`返回${readerReturnTarget.label}${readerReturnTarget.detail ? ` ${readerReturnTarget.detail}` : ""}`}
              onClick={onReturnToSource}
            >
              <span>← 返回{readerReturnTarget.label}</span>
              {readerReturnTarget.detail && <strong>{readerReturnTarget.detail}</strong>}
            </button>
          )}
          <div className="reader-breadcrumb">
            {readerMode === "sentence" ? <h1 title={article.title}>{article.title}</h1> : <><span>{issue.displayLabel}</span><strong>{article.section}</strong></>}
          </div>
        </div>
        <div className="reader-toolbar-center">
          <div className="reader-position">{currentIndex + 1} / {allArticles.length}</div>
          <div className="reader-mode-switch" aria-label="阅读模式">
            <button className={readerMode === "article" ? "is-active" : ""} aria-pressed={readerMode === "article"} aria-keyshortcuts="1" title="快捷键 1" onClick={() => switchReaderMode("article")}>整篇</button>
            <button className={readerMode === "sentence" ? "is-active" : ""} aria-pressed={readerMode === "sentence"} aria-keyshortcuts="2" title="快捷键 2" onClick={() => switchReaderMode("sentence")}>逐句</button>
          </div>
        </div>
        <div className="reader-toolbar-actions">
          {globalNavigation}
          <button
            className={`toolbar-button reader-focus-hidden ${drawer === "toc" ? "is-active" : ""}`}
            aria-label={issue.kind === "lessons" ? "精选阅读目录" : issue.kind === "book" ? "本书目录" : "本期目录"}
            aria-keyshortcuts="C"
            title={`${issue.kind === "lessons" ? "精选阅读目录" : issue.kind === "book" ? "本书目录" : "本期目录"} (C)`}
            onClick={() => toggleDrawer("toc")}
          >☰ <span>目录</span></button>
          {(
            <button
              className={`toolbar-button reader-focus-hidden ${queuedForLater ? "is-active" : ""}`}
              aria-label={queuedForLater ? "移出稍后阅读" : "加入稍后阅读"}
              aria-keyshortcuts="S"
              title="稍后阅读 (S)"
              onClick={() => onToggleReadLater(article.id)}
            >
              {queuedForLater ? "★" : "☆"} <span>稍后读</span>
            </button>
          )}
          {jumpBackTarget && (
            <button
              className="toolbar-button reader-jump-back-button"
              aria-label="返回刚才位置"
              aria-keyshortcuts="B"
              title="返回刚才阅读位置 (B)"
              onClick={returnToJumpBackTarget}
            >↩ <span>刚才位置</span></button>
          )}
          {<button className={`toolbar-button reader-chinese-button ${readerLanguage === "chinese" ? "is-active" : ""}`} aria-label={readerLanguage === "chinese" ? "返回英文阅读" : "中文阅读"} aria-pressed={readerLanguage === "chinese"} title={readerLanguage === "chinese" ? "返回对应英文段落" : "中文全文与听书"} onClick={toggleChineseReader}>{readerLanguage === "chinese" ? "A" : "中"}<span>{readerLanguage === "chinese" ? "返回英文" : "中文阅读"}</span></button>}
          {issue.kind === "book" && <BookSourceButton identity={article.identity} className="toolbar-button reader-source-button" />}
          <button
            className={`toolbar-button reader-full-translation-button ${fullArticleTranslationExpanded ? "is-active" : ""}`}
            aria-label={fullArticleTranslationRunning
              ? `全文翻译中 ${fullArticleTranslatedCount}/${fullArticleTranslationTargets.length}`
              : fullArticleTranslationExpanded
                ? "收起全文译文"
                : `翻译全文${fullArticleTranslatedCount ? `，已缓存 ${fullArticleTranslatedCount}/${fullArticleTranslationTargets.length} 段` : ""}`}
            aria-pressed={fullArticleTranslationExpanded}
            disabled={fullArticleTranslationRunning || currentArticleTranslationLoading}
            title={fullArticleTranslationRunning
              ? `正在翻译全文 · ${fullArticleTranslatedCount}/${fullArticleTranslationTargets.length}`
              : fullArticleTranslationExpanded
                ? "收起全文中文翻译"
                : "展开已缓存译文并补齐未翻译段落"}
            onClick={() => void toggleFullArticleTranslation()}
          >
            {fullArticleTranslationRunning ? "…" : fullArticleTranslationExpanded ? "收" : "译"}
            <span>{fullArticleTranslationRunning ? `${fullArticleTranslatedCount}/${fullArticleTranslationTargets.length}` : fullArticleTranslationExpanded ? "译文" : "全文"}</span>
          </button>
          {onOpenLearning && <button className="toolbar-button reader-learning-button reader-focus-hidden" aria-label="练习" title="选择练习阶段" onClick={onOpenLearning}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h12v18H6V3Zm3 4h6m-6 4h6m-6 4h3" /></svg><span>练习</span></button>}
          <button className={`toolbar-button ${drawer === "notes" ? "is-active" : ""}`} aria-label="阅读笔记" aria-keyshortcuts="N" title="阅读笔记 (N)" onClick={() => toggleDrawer("notes")}>✎ <span>笔记</span></button>
          <button
            className={`toolbar-button reader-find-button ${articleFindOpen ? "is-active" : ""}`}
            aria-label="查找当前文章"
            aria-expanded={articleFindOpen}
            aria-keyshortcuts="/"
            title="查找当前文章 (/)"
            onClick={() => articleFindOpen ? closeArticleFind() : openArticleFind()}
          >⌕ <span>查找</span></button>
          <button
            className={`toolbar-button reader-shortcuts-button ${keyboardHelpOpen ? "is-active" : ""}`}
            aria-label="阅读快捷键"
            aria-expanded={keyboardHelpOpen}
            aria-keyshortcuts="?"
            title="阅读快捷键 (?)"
            onClick={() => setKeyboardHelpOpen((current) => !current)}
          >⌨ <span>快捷键</span></button>
          <button
            className={`toolbar-button reader-focus-toggle ${focusMode ? "is-active" : ""}`}
            aria-label={focusMode ? "退出沉浸阅读" : "进入沉浸阅读"}
            aria-pressed={focusMode}
            aria-keyshortcuts="F"
            title="沉浸阅读 (F)"
            onClick={toggleFocusMode}
          >{focusMode ? "⊙" : "◐"} <span>{focusMode ? "退出沉浸" : "沉浸"}</span></button>
          <button className={`toolbar-button reader-focus-hidden mobile-vocabulary-button ${drawer === "vocabulary" ? "is-active" : ""}`} aria-label="打开词汇" onClick={() => toggleDrawer("vocabulary")}>▤ <span>词汇{uniqueVocabularyItems(articleSelections).length ? ` ${uniqueVocabularyItems(articleSelections).length}` : ""}</span></button>
        </div>
      </div>

      <div className="reader-progress-line"><span style={{ width: `${issueProgress}%` }} /></div>

      {articleFindOpen && (
        <aside className="reader-find-bar" role="search" aria-label="当前文章内查找" data-testid="reader-find-bar">
          <input
            ref={articleFindInputRef}
            type="search"
            aria-label="查找当前文章正文"
            placeholder="查找英文正文"
            value={articleFindQuery}
            onChange={(event) => updateArticleFindQuery(event.target.value)}
            onKeyDown={handleArticleFindKeyDown}
          />
          <span className="reader-find-count" aria-live="polite" data-testid="reader-find-count">
            {articleFindQuery.trim()
              ? articleFindMatches.length
                ? `${activeArticleFindIndex + 1} / ${articleFindMatches.length}`
                : "0 / 0"
              : "输入关键词"}
          </span>
          <button aria-label="上一个匹配" disabled={!articleFindMatches.length} onClick={() => moveArticleFind(-1)}>↑</button>
          <button aria-label="下一个匹配" disabled={!articleFindMatches.length} onClick={() => moveArticleFind(1)}>↓</button>
          <button aria-label="关闭文章内查找" onClick={closeArticleFind}>×</button>
        </aside>
      )}

      {(meaningRepairPending > 0 || currentMeaningFailures.length > 0) && <aside className="vocabulary-meaning-notice" aria-label="补充词汇释义">
        {meaningRepairPending > 0 && <span role="status">正在核对已保存词条的语境释义…</span>}
        {currentMeaningFailures.length > 0 && <><span role="alert">部分词条释义未能更新，请重试。</span><button className="text-button" disabled={meaningRepairPending > 0} onClick={() => { meaningRepairAttempts.current.clear(); setMeaningRepairFailures([]); setMeaningRepairRetry((value) => value + 1); }}>重试补充释义</button></>}
      </aside>}
      {(removalNoticeVisible && removedVocabulary.length > 0 || vocabularyRemovalError) && <aside className="vocabulary-removal-notice" data-testid="vocabulary-removal-notice" aria-label="词汇移除与撤销">
        {vocabularyRemovalError ? <span role="alert">{vocabularyRemovalError}</span> : <span role="status">已从本篇移除“{removedVocabulary.at(-1)?.text}”。可重新划选正确短语。</span>}
        {removedVocabulary.length > 0 && <button className="text-button" onClick={undoVocabularyRemoval}>撤销上次移除</button>}
      </aside>}

      {keyboardHelpOpen && (
        <aside className="reader-shortcuts-panel" role="dialog" aria-label="阅读快捷键" data-testid="reader-shortcuts-panel">
          <div className="reader-shortcuts-heading">
            <strong>阅读快捷键</strong>
            <button className="icon-button small" aria-label="关闭阅读快捷键" onClick={() => setKeyboardHelpOpen(false)}>×</button>
          </div>
          <div className="reader-shortcuts-grid">
            <kbd>1</kbd><span>整篇模式</span>
            <kbd>2</kbd><span>逐句模式</span>
            <kbd>← / →</kbd><span>上一句 / 下一句（逐句模式）</span>
            <kbd>J / K</kbd><span>下一段 / 上一段（整篇） · 下一句 / 上一句（逐句）</span>
            <kbd>T</kbd><span>查看 / 收起当前段翻译（整篇） · 当前句翻译（逐句）</span>
            <><kbd>S</kbd><span>加入 / 移出当前内容稍后阅读</span></>
            <kbd>C</kbd><span>打开 / 关闭{issue.kind === "lessons" ? "精选阅读" : issue.kind === "book" ? "本书" : "本期"}目录；打开时聚焦当前{issue.kind === "book" ? "章节" : "文章"}</span>
            <kbd>选区 T / E / C / S / N</kbd><span>翻译 / 解释 / 复制 / 保存 / 记笔记（选中文字时优先）</span>
            <kbd>⇧ ← / ⇧ →</kbd><span>{issue.kind === "book" ? "上一章 / 下一章" : "上一篇 / 下一篇"}</span>
            <kbd>N</kbd><span>打开 / 关闭笔记</span>
            <kbd>⇧ N</kbd><span>为当前段落写锚点笔记</span>
            <kbd>Ctrl / ⌘ Enter</kbd><span>保存新笔记（笔记输入框）</span>
            <kbd>B</kbd><span>返回刚才阅读位置（有返回点时）</span>
            <kbd>F</kbd><span>进入 / 退出沉浸阅读</span>
            <kbd>/</kbd><span>查找当前文章英文正文</span>
            <kbd>Esc</kbd><span>关闭浮层 / 查找；无浮层时退出沉浸</span>
            <kbd>?</kbd><span>显示 / 隐藏本说明</span>
          </div>
          <small>输入框、文本域和可编辑区域获得焦点时，快捷键自动停用。</small>
        </aside>
      )}

      <div className={`reader-workspace ${drawer ? "has-drawer" : ""} ${wordDetailLookup ? "has-word-detail" : ""}`}>
        <main
          className={`reader-canvas theme-${preferences.theme} width-${preferences.readerWidth} font-${preferences.fontFamily} leading-${preferences.lineHeight} ${preferences.showVocabularyBackgrounds ? "" : "hide-vocabulary-backgrounds"} ${preferences.showChineseGlosses ? "" : "hide-chinese-glosses"}`}
          data-theme={preferences.theme}
          data-reader-width={preferences.readerWidth}
          data-reader-font-family={preferences.fontFamily}
          data-reader-line-height={preferences.lineHeight}
          data-show-vocabulary-backgrounds={preferences.showVocabularyBackgrounds}
          data-show-chinese-glosses={preferences.showChineseGlosses}
        >
          <article ref={readingPageRef} tabIndex={-1} className="reading-page" data-reader-article-id={article.id} style={{ fontSize: `${preferences.fontSize}px` }}>
            <header className="reading-header">
              <div className="reading-section"><span>{article.section}</span><small>{article.sectionZh}</small></div>
              <h1>{article.title}</h1>
              {article.titleZh && <h2 className="reading-title-zh">{article.titleZh}</h2>}
              {article.subtitle && <p className="reading-deck">{article.subtitle}</p>}
              {article.subtitleZh && <p className="reading-deck-zh">{article.subtitleZh}</p>}
              {article.summaryZh && <div className="reading-summary-zh"><strong>这篇讲什么</strong><p>{article.summaryZh}</p></div>}
              <div className="reading-meta">{article.wordCount.toLocaleString()} words · 约 {article.minutes} 分钟 · {article.lesson ? article.lesson.adaptation : issue.kind === "book" ? "电子书 EPUB" : "真实 EPUB"}</div>
              {article.lesson && <details className="lesson-reader-explanation" data-testid="lesson-reader-explanation">
                <summary>中文知识解读与原书出处</summary>
                <p>{article.lesson.explanationZh}</p><p>重点表达：{article.lesson.keywords.join(" / ")}</p>
                <p>原书依据：{article.lesson.evidence.join("；")}</p>
              </details>}
              <div className={`reading-vocabulary-profile difficulty-${articleVocabularyProfile.difficulty}`} data-testid="reading-vocabulary-profile">
                <strong>词汇难度 · {articleVocabularyProfile.difficultyLabel}</strong>
                <span>新词 {articleVocabularyProfile.newPercent}%</span>
                <span>学习中 {articleVocabularyProfile.learningPercent}%</span>
                <span>已知 {articleVocabularyProfile.knownPercent}%</span>
                {articleVocabularyProfile.ignoredPercent > 0 && <span>忽视 {articleVocabularyProfile.ignoredPercent}%</span>}
              </div>
            </header>

            <div className={`reading-body ${readerMode === "sentence" ? "sentence-reading-body" : ""}`} onMouseUp={readerLanguage === "chinese" ? undefined : handleTextSelection}>
              {readerLanguage === "chinese" ? <ChineseReader key={article.identity.documentId} article={article} initialParagraph={chineseParagraphRef.current}
                beforeFirstParagraph={magazineIdentity ? (articleImagesByAnchor.get(-1) ?? []).map(image => <ArticleMediaFigure key={image.id} issueId={magazineIdentity.issueId} articleId={magazineIdentity.articleId} image={image} onZoom={openArticleImageZoom} />) : undefined}
                afterParagraph={magazineIdentity ? index => (articleImagesByAnchor.get(index) ?? []).map(image => <ArticleMediaFigure key={image.id} issueId={magazineIdentity.issueId} articleId={magazineIdentity.articleId} image={image} onZoom={openArticleImageZoom} />) : undefined}
                onPosition={index => {
                  if (article.paragraphs[index] === undefined) return;
                  chineseParagraphRef.current = index;
                  onReadingPositionChange({ paragraphIndex: index, paragraphText: article.paragraphs[index], viewportOffset: 110 });
                  onProgressChange(Math.min(99, Math.round(index / article.paragraphs.length * 100)));
                }}
                onTranslation={record => setParagraphTranslationRecords(records => upsertParagraphTranslation(records, record))}
                onComplete={() => onProgressChange(100)}
              /> : readerMode === "article" ? (
                <>
                  {magazineIdentity && (articleImagesByAnchor.get(-1) ?? []).map((image) => (
                    <ArticleMediaFigure key={image.id} issueId={magazineIdentity.issueId} articleId={magazineIdentity.articleId} image={image} onZoom={openArticleImageZoom} />
                  ))}
                  {renderBookLayout(article, index => {
                const paragraph = article.paragraphs[index];
                const translationTarget = paragraphTranslationTarget({ document: article.identity, paragraphIndex: index, sourceText: paragraph });
                const key = translationTarget.key;
                const translatable = canTranslateParagraph(paragraph, index);
                const translation = translatable ? translations[key] : undefined;
                const expanded = translation?.expanded ?? false;
                const sentenceFocus = focusedVocabularySentence?.paragraphIndex === index ? focusedVocabularySentence : null;
                const noteFocus = focusedNoteAnchor?.paragraphIndex === index ? focusedNoteAnchor : null;
                const paragraphCue = activeParagraphCue?.paragraphIndex === index ? activeParagraphCue : null;
                const anchoredNotes = anchoredNotesByParagraph.get(index) ?? [];
                const buttonLabel = translation?.status === "loading"
                  ? `正在翻译第 ${index + 1} 段`
                  : translation?.status === "error"
                    ? `重试翻译第 ${index + 1} 段`
                    : translation?.status === "ready" && expanded
                      ? `收起第 ${index + 1} 段翻译`
                      : `翻译第 ${index + 1} 段`;

                return (
                  <Fragment key={key}>
                  <div
                    className={`reading-paragraph-block ${isChapterNumber(paragraph, index) ? "is-chapter-number" : ""} ${noteFocus ? "is-note-anchor-focus" : ""} ${paragraphCue ? "is-active-paragraph-cue" : ""}`}
                    data-paragraph-index={index}
                    data-note-anchor-focus-token={noteFocus?.token}
                    data-active-paragraph-cue-token={paragraphCue?.token}
                  >
                    <p>
                      {sentenceFocus ? (
                        <>
                          {renderParagraphRange(paragraph, index, 0, sentenceFocus.sentenceStart, "before-focus")}
                          <span
                            className="vocabulary-target-sentence"
                            data-vocabulary-target-sentence="true"
                            data-vocabulary-focus-token={sentenceFocus.token}
                          >
                            {renderParagraphRange(paragraph, index, sentenceFocus.sentenceStart, sentenceFocus.sentenceEnd, "focus")}
                          </span>
                          {renderParagraphRange(paragraph, index, sentenceFocus.sentenceEnd, paragraph.length, "after-focus")}
                        </>
                      ) : renderParagraphRange(paragraph, index, 0, paragraph.length, "full")}
                    </p>
                    {anchoredNotes.length > 0 && (
                      <button
                        className="paragraph-note-marker"
                        aria-label={`查看第 ${index + 1} 段的 ${anchoredNotes.length} 条笔记`}
                        data-testid={`paragraph-note-marker-${index}`}
                        onClick={() => openInlineNotes(index)}
                      >
                        <span aria-hidden="true">✎</span><strong>{anchoredNotes.length}</strong>
                      </button>
                    )}
                    {translatable && <button
                      className={`paragraph-translate-button ${expanded ? "is-active" : ""}`}
                      aria-label={buttonLabel}
                      disabled={fullArticleTranslationRunning || translation?.status === "loading"}
                      title="当前阅读段可按 T 查看 / 收起翻译"
                      onClick={() => void toggleTranslation(index, paragraph)}
                    >
                      {translation?.status === "loading" ? "…" : expanded ? "收" : "译"}
                    </button>}
                    <button
                      className="paragraph-note-button"
                      aria-label={`为第 ${index + 1} 段写笔记`}
                      onClick={() => beginParagraphNote(index, paragraph)}
                    >记</button>
                    {expanded && (
                      <div className={`translation-panel ${translation?.status === "error" ? "is-error" : ""}`}>
                        <div className="translation-label">
                          <span>中文辅助</span>
                          {translation?.model && <small title={translation.profileId ? `AI 配置：${translation.profileId}` : undefined}>{translation.model} · 已缓存</small>}
                        </div>
                        {translation?.status === "loading" && <p>正在翻译这一段…</p>}
                        {translation?.status === "ready" && (
                          <>
                            <p>{translation.translation}</p>
                            <div className="translation-cache-actions">
                              {translation.error && <span className="translation-refresh-error">重新翻译失败，已保留原缓存：{translation.error}</span>}
                              <button className="text-button" onClick={() => void toggleTranslation(index, paragraph, true)}>重新翻译</button>
                            </div>
                          </>
                        )}
                        {translation?.status === "error" && <p>翻译失败：{translation.error}。点击“重试”再试一次。</p>}
                      </div>
                    )}
                  </div>
                  {magazineIdentity && (articleImagesByAnchor.get(index) ?? []).map((image) => (
                    <ArticleMediaFigure key={image.id} issueId={magazineIdentity.issueId} articleId={magazineIdentity.articleId} image={image} onZoom={openArticleImageZoom} />
                  ))}
                  </Fragment>
                );
                  }, index => (<>
                  {(headingsBeforeParagraph.get(index) ?? []).map((heading, headingIndex) => {
                    const HeadingTag = heading.level === 1 ? "h2" : heading.level === 2 ? "h3" : "h4";
                    const headingTarget = headingTranslationTarget({ document: article.identity, headingIndex: heading.headingIndex, sourceText: heading.text });
                    const headingTranslation = isTranslatableText(heading.text) ? translations[headingTarget.key] : undefined;
                    const headingExpanded = headingTranslation?.expanded ?? false;
                    return (
                      <div className="reading-book-heading-block" key={`${article.identity.documentId}:${index}:heading:${headingIndex}`}>
                        <HeadingTag className={`reading-book-heading level-${heading.level}`}>{heading.text}</HeadingTag>
                        {issue.kind === "book" && isTranslatableText(heading.text) && (
                          <>
                            <button
                              className={`paragraph-translate-button ${headingExpanded ? "is-active" : ""}`}
                              aria-label={`${headingTranslation?.status === "loading" ? "正在翻译标题" : headingExpanded ? "收起标题翻译" : "翻译标题"}：${heading.text}`}
                              disabled={fullArticleTranslationRunning || headingTranslation?.status === "loading"}
                              onClick={() => void toggleHeadingTranslation(heading.headingIndex, heading.text)}
                            >{headingTranslation?.status === "loading" ? "…" : headingExpanded ? "收" : "译"}</button>
                            {headingExpanded && (
                              <div className={`translation-panel ${headingTranslation?.status === "error" ? "is-error" : ""}`}>
                                <div className="translation-label">
                                  <span>中文辅助</span>
                                  {headingTranslation?.model && <small>{headingTranslation.model} · 已缓存</small>}
                                </div>
                                {headingTranslation?.status === "loading" && <p>正在翻译这个标题…</p>}
                                {headingTranslation?.status === "ready" && (
                                  <>
                                    <p>{headingTranslation.translation}</p>
                                    <div className="translation-cache-actions">
                                      {headingTranslation.error && <span className="translation-refresh-error">重新翻译失败，已保留原缓存：{headingTranslation.error}</span>}
                                      <button className="text-button" onClick={() => void toggleHeadingTranslation(heading.headingIndex, heading.text, true)}>重新翻译</button>
                                    </div>
                                  </>
                                )}
                                {headingTranslation?.status === "error" && <p>翻译失败：{headingTranslation.error}。点击“重试”再试一次。</p>}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                  </>))}
                </>
              ) : currentSentence ? (
                <section className="sentence-reading-card" data-testid="sentence-reading-card">
                  <div className="sentence-reading-meta">
                    <span className="sentence-reading-eyebrow">SENTENCE BY SENTENCE</span>
                    <span>第 {sentenceIndex + 1} / {articleSentences.length} 句</span>
                  </div>
                  <div
                    className={`reading-paragraph-block sentence-reading-block ${activeParagraphCue?.paragraphIndex === currentSentence.paragraphIndex ? "is-active-paragraph-cue" : ""}`}
                    data-paragraph-index={currentSentence.paragraphIndex}
                    data-active-paragraph-cue-token={activeParagraphCue?.paragraphIndex === currentSentence.paragraphIndex ? activeParagraphCue.token : undefined}
                  >
                    {currentOriginalVisual ? <BookVisual key={currentOriginalVisual.id} visual={currentOriginalVisual} identity={article.identity} renderCaption={index => <p key={index}>{article.paragraphs[index]}</p>} /> : <p data-testid="sentence-reading-source">
                      {renderParagraphRange(
                        article.paragraphs[currentSentence.paragraphIndex] ?? "",
                        currentSentence.paragraphIndex,
                        currentSentence.startOffset,
                        currentSentence.endOffset,
                        `sentence-${currentSentence.key}`,
                      )}
                    </p>}
                  </div>
                  <div className="sentence-reading-tools">
                    {isTranslatableText(currentSentence.text) && canTranslateParagraph(article.paragraphs[currentSentence.paragraphIndex], currentSentence.paragraphIndex) && <button className="sentence-translation-toggle" aria-label={sentenceTranslationVisible ? "收起句子翻译" : "查看句子翻译"} aria-expanded={sentenceTranslationVisible} title="当前句可按 T 查看 / 收起翻译" onClick={() => toggleCurrentSentenceTranslation()}>
                      <span aria-hidden="true">译</span>{sentenceTranslationVisible ? "收起翻译" : "查看翻译"}<kbd aria-hidden="true">T</kbd>
                    </button>}
                  </div>
                  {sentenceTranslationVisible && isTranslatableText(currentSentence.text) && canTranslateParagraph(article.paragraphs[currentSentence.paragraphIndex], currentSentence.paragraphIndex) && (
                    <div className={`sentence-reading-translation ${currentSentenceTranslationRequest?.status === "error" ? "is-error" : ""}`} data-testid="sentence-reading-translation">
                      <span>句子翻译</span>
                      {currentSentenceTranslation && <><p>{currentSentenceTranslation.translationZh}</p><SentenceExpressionList translation={currentSentenceTranslation} target={currentSentenceTarget} selections={savedSelections} onSave={saveCurrentSentenceExpression} onFamiliarityChange={updateSavedExpressionFamiliarity} /></>}
                      {currentSentenceTranslation && !currentSentenceTranslation.expressions?.length && <p className="muted-text">本句暂无需要单独学习的关键表达。</p>}
                      {currentSentenceTranslationRequest?.status === "loading" && <p role="status">{currentSentenceTranslationRequest.kind === "expressions" ? "正在重新推荐关键表达…" : currentSentenceTranslation ? "正在重新翻译本句…" : "正在翻译当前句子…"}</p>}
                      {currentSentenceTranslationRequest?.status === "error" && <p role="alert">{currentSentenceTranslation ? "更新失败，已保留上次内容，请重试。" : "句子翻译暂时失败，请重试。"}</p>}
                      <div className="sentence-translation-actions">
                        <button className="text-button" disabled={currentSentenceTranslationRequest?.status === "loading"} onClick={() => toggleCurrentSentenceTranslation("translation")}>重新翻译本句</button>
                        <button className="text-button" disabled={currentSentenceTranslationRequest?.status === "loading"} onClick={() => toggleCurrentSentenceTranslation("expressions")}>重新推荐关键表达</button>
                      </div>
                    </div>
                  )}
                  <nav className="sentence-reading-nav" aria-label="逐句导航">
                    <button disabled={sentenceIndex <= 0} onClick={() => moveSentence(-1)}>← 上一句</button>
                    <div className="sentence-reading-progress"><div role="progressbar" aria-label="逐句阅读进度" aria-valuemin={0} aria-valuemax={articleSentences.length} aria-valuenow={sentenceIndex + 1}><span style={{ width: `${(sentenceIndex + 1) / articleSentences.length * 100}%` }} /></div><span>{Math.round(((sentenceIndex + 1) / articleSentences.length) * 100)}%</span></div>
                    {sentenceIndex >= articleSentences.length - 1
                      ? <button aria-label="完成阅读并返回上一页" onClick={onBack}>完成 →</button>
                      : <button onClick={() => moveSentence(1)}>下一句 →</button>}
                  </nav>
                  <p className="sentence-reading-hint">← → 切换句子<span>·</span>T 查看翻译<span>·</span>点击单词查词</p>
                </section>
              ) : <div className="empty-panel">这篇文章没有可用句子。</div>}
            </div>

            <footer className="article-footer-nav">
              <button disabled={!previous} onClick={openPreviousArticle}>
                <span>← {issue.kind === "book" ? "上一章" : "上一篇"}</span>
                <strong>{previous?.title ?? (issue.kind === "book" ? "已经是第一章" : "已经是第一篇")}</strong>
              </button>
              <button
                disabled={!next}
                onClick={openNextArticle}
                data-testid="next-article"
              >
                <span>{issue.kind === "book" ? "下一章" : "下一篇"} →</span>
                <strong>{next?.title ?? (issue.kind === "book" ? "已经是最后一章" : "已经是最后一篇")}</strong>
              </button>
            </footer>
          </article>
          {activeSelection && (
            <div
              className="selection-assist-popover"
              data-testid="selection-assist-popover"
              style={{ top: activeSelection.top, left: activeSelection.left }}
              onMouseDown={(event) => event.preventDefault()}
            >
              <div className="selection-assist-toolbar">
                <button aria-label="翻译选中文字" aria-keyshortcuts="T" title="翻译选区 (T)" disabled={selectionAssistState?.status === "loading"} onClick={() => void runSelectionAssist("translate")}>翻译</button>
                <button aria-label="解释选中文字" aria-keyshortcuts="E" title="解释选区 (E)" disabled={selectionAssistState?.status === "loading"} onClick={() => void runSelectionAssist("explain")}>解释</button>
                <button
                  aria-label="复制选中文字"
                  aria-keyshortcuts="C"
                  title="复制选区 (C)"
                  className={selectionCopyState === "copied" ? "is-copied" : selectionCopyState === "error" ? "is-copy-error" : ""}
                  onClick={() => void copyActiveSelection()}
                >{selectionCopyState === "copied" ? "已复制" : selectionCopyState === "error" ? "复制失败" : "复制"}</button>
                <button aria-label="保存选中文字" aria-keyshortcuts="S" title="保存选区 (S)" className={selectionSaved ? "is-saved" : ""} onClick={saveActiveSelection}>{selectionSaved ? "已保存" : "保存"}</button>
                <button aria-label="为选中文字写笔记" aria-keyshortcuts="N" title="选区笔记 (N)" disabled={!currentSelectionNoteAnchor()} onClick={beginSelectionNote}>记笔记</button>
                <button className="selection-assist-close" aria-label="关闭选中辅助" aria-keyshortcuts="Escape" title="关闭 (Esc)" onClick={closeSelectionAssist}>×</button>
              </div>
              <div className="contextual-shortcut-hint selection-assist-shortcut-hint" data-testid="selection-assist-shortcut-hint" aria-label="选区辅助快捷键">
                <span><kbd>T</kbd> 翻译</span>
                <span><kbd>E</kbd> 解释</span>
                <span><kbd>C</kbd> 复制</span>
                <span><kbd>S</kbd> 保存</span>
                <span><kbd>N</kbd> 笔记</span>
                <span><kbd>Esc</kbd> 关闭</span>
              </div>
              <div className="selection-assist-source">“{activeSelection.text}”</div>
              {selectionAssistState && (
                <div className={`selection-assist-result ${selectionAssistState.status === "error" ? "is-error" : ""}`}>
                  <div className="selection-assist-result-label">
                    <span>{selectionAssistState.action === "translate" ? "中文翻译" : "语境解释"}</span>
                    {selectionAssistState.model && <small>{selectionAssistState.model}</small>}
                  </div>
                  {selectionAssistState.status === "loading" && <p>正在处理选中的内容…</p>}
                  {selectionAssistState.status === "ready" && <p>{selectionAssistState.result}</p>}
                  {selectionAssistState.status === "error" && <p>请求失败：{selectionAssistState.error}</p>}
                </div>
              )}
            </div>
          )}
          {activeWordLookup && (
            <WordLookupCard
              lookup={activeWordLookup}
              vocabularyMeaning={activeWordVocabulary?.translationZh}
              vocabularyMeaningSource={activeWordVocabulary?.translationSource}
              familiarity={activeWordFamiliarity}
              onClose={() => setActiveWordLookup(null)}
              onOpenDetails={openActiveWordDetails}
              onFamiliarityChange={(level) => setWordLookupFamiliarity(activeWordLookup, level)}
              onContextMeaningChange={(meaningZh) => updateWordLookupContextMeaning(activeWordLookup, meaningZh)}
              onVocabularyMeaningChange={(meaningZh) => updateWordLookupVocabularyMeaning(activeWordLookup, meaningZh)}
            />
          )}
        </main>

        {drawer && (
          <ReaderDrawer
            drawer={drawer}
            issue={issue}
            article={article}
            readerMode={readerMode}
            currentSentenceSelections={currentSentenceVocabularySelections}
            notes={notes}
            savedSelections={savedSelections}
            noteDraft={noteDraft}
            noteDraftAnchor={noteDraftAnchor}
            noteDraftInputRef={noteDraftInputRef}
            wordDetailLookup={wordDetailLookup}
            wordDetailVocabularyMeaning={wordDetailVocabulary?.translationZh}
            wordDetailFamiliarity={wordDetailFamiliarity}
            vocabularyOccurrencesByText={vocabularyOccurrencesByText}
            vocabularyOccurrenceIndexes={vocabularyOccurrenceIndexes}
            onClose={closeReaderDrawer}
            onOpenArticle={onOpenArticle}
            onNoteDraftChange={setNoteDraft}
            onAddNote={addNote}
            onExitNoteDraft={exitNoteDraft}
            onClearNoteDraftAnchor={() => setNoteDraftAnchor(undefined)}
            onLocateNote={focusNote}
            onEditNote={onEditNote}
            onDeleteNote={onDeleteNote}
            onSavedTranslationChange={updateSavedExpressionTranslation}
            onSavedFamiliarityChange={updateSavedExpressionFamiliarity}
            onRemoveSavedSelection={removeSavedExpression}
            onNavigateVocabularyOccurrence={navigateVocabularyOccurrence}
            onCloseWordDetail={() => setWordDetailLookup(null)}
            onWordDetailFamiliarityChange={(level) => wordDetailLookup && setWordLookupFamiliarity(wordDetailLookup, level)}
            onWordDetailContextMeaningChange={(meaningZh) => wordDetailLookup && updateWordLookupContextMeaning(wordDetailLookup, meaningZh)}
          />
        )}
        <VocabularyPanel
          savedSelections={articleSelections}
          occurrencesByText={vocabularyOccurrencesByText}
          occurrenceIndexes={vocabularyOccurrenceIndexes}
          detailLookup={wordDetailLookup}
          detailVocabularyMeaning={wordDetailVocabulary?.translationZh}
          detailFamiliarity={wordDetailFamiliarity}
          onSavedTranslationChange={updateSavedExpressionTranslation}
          onSavedFamiliarityChange={updateSavedExpressionFamiliarity}
            onRemoveSavedSelection={removeSavedExpression}
          onNavigateOccurrence={navigateVocabularyOccurrence}
          onCloseDetail={() => setWordDetailLookup(null)}
          onDetailFamiliarityChange={(level) => wordDetailLookup && setWordLookupFamiliarity(wordDetailLookup, level)}
          onDetailContextMeaningChange={(meaningZh) => wordDetailLookup && updateWordLookupContextMeaning(wordDetailLookup, meaningZh)}
        />
      </div>
      {zoomedArticleImage && magazineIdentity && (
        <div
          className={`article-media-lightbox${articleImageZoomDetailSize ? " is-detail-size" : ""}`}
          data-testid="article-media-lightbox"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeArticleImageZoom();
          }}
        >
          <div className="article-media-lightbox-dialog" role="dialog" aria-modal="true" aria-label="放大文章图片">
            <button
              ref={articleMediaZoomCloseRef}
              type="button"
              className="article-media-lightbox-close"
              aria-label="关闭放大图片"
              title="关闭 (Esc)"
              onClick={closeArticleImageZoom}
            >×</button>
            <figure>
              <img
                src={articleImageUrl(magazineIdentity.issueId, magazineIdentity.articleId, zoomedArticleImage.id)}
                alt={zoomedArticleImage.alt.trim() || zoomedArticleImage.caption?.trim() || "Article image"}
                onError={closeArticleImageZoom}
              />
              {zoomedArticleImage.caption?.trim() && <figcaption>{zoomedArticleImage.caption.trim()}</figcaption>}
            </figure>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchHighlight({ text, query }: { text: string; query: string }) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return <>{text}</>;
  const index = text.toLocaleLowerCase().indexOf(trimmedQuery.toLocaleLowerCase());
  if (index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark className="search-highlight">{text.slice(index, index + trimmedQuery.length)}</mark>{text.slice(index + trimmedQuery.length)}</>;
}

function SearchPage({ books, onOpenReading, onToggleReading, issues, viewState, readLaterState, onViewStateChange, onOpenArticle, onToggleReadLater }: {
  issues: ReaderIssue[];
  books: BookSummary[];
  onOpenReading: (entry: ReadingEntry) => void;
  onToggleReading: (entry: ReadingEntry) => void;
  viewState: LibrarySearchViewState;
  readLaterState: ReadLaterState;
  onViewStateChange: (state: LibrarySearchViewState) => void;
  onOpenArticle: (articleId: string, issueId?: string) => void;
  onToggleReadLater: (issueId: string, articleId: string) => void;
}) {
  const { query, publicationFilter } = viewState;
  const [scope, setScope] = useState<"all" | "magazines" | "books" | "lessons">("all");
  const showMagazines = scope === "all" || scope === "magazines";
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(
    () => searchMagazineLibrary(issues, deferredQuery, publicationFilter),
    [issues, deferredQuery, publicationFilter],
  );
  const visibleResults = results.slice(0, 100);
  const hasQuery = Boolean(query.trim());
  const hasDeferredQuery = Boolean(deferredQuery.trim());

  return (
    <div className="page search-page">
      <section className="page-heading-row search-heading">
        <div><div className="eyebrow">Local full-text search</div><h1>搜索</h1><p>搜索本地期刊、电子书章节和精选阅读的标题与正文，以及已有中文内容；不调用 AI。</p></div>
        <div className="demo-chip">{showMagazines ? `期刊 · ${hasDeferredQuery ? results.length + " 篇匹配" : issues.reduce((sum, issue) => sum + flattenArticles(issue).length, 0) + " 篇可搜索"}` : `${books.length} 本电子书`}</div>
      </section>

      <div className="library-publication-tabs" aria-label="搜索内容类型">{([["all", "全部内容"], ["magazines", "期刊文章"], ["books", "电子书章节"], ["lessons", "精选阅读"]] as const).map(([value, label]) => <button key={value} aria-label={`搜索${label}`} aria-pressed={scope === value} className={scope === value ? "is-active" : ""} onClick={() => { setScope(value); onViewStateChange({ ...viewState, publicationFilter: "all" }); }}>{label}</button>)}</div>
      <section className="search-controls" aria-label="全文搜索条件">
        <label className="search-input-wrap">
          <span>搜索阅读库</span>
          <input
            type="search"
            value={query}
            autoFocus
            placeholder="例如 AI、China、tariffs、人工智能…"
            onChange={(event) => onViewStateChange({ ...viewState, query: event.target.value })}
            data-testid="library-search-input"
          />
        </label>
        {showMagazines && <div className="search-publication-filter" aria-label="按杂志筛选搜索结果">
          <button className={publicationFilter === "all" ? "is-active" : ""} onClick={() => onViewStateChange({ ...viewState, publicationFilter: "all" })}>全部</button>
          {Object.values(PUBLICATIONS).map((publication) => (
            <button
              key={publication.id}
              className={publicationFilter === publication.id ? "is-active" : ""}
              onClick={() => onViewStateChange({ ...viewState, publicationFilter: publication.id })}
            >{publication.name}</button>
          ))}
        </div>}
      </section>

      {!hasQuery && <div className="search-empty-state"><strong>从你的阅读库里找内容</strong><span>输入英文或中文关键词；搜索只读取本地 EPUB 与已经生成的中文缓存。</span></div>}
      {showMagazines && hasDeferredQuery && !results.length && <div className="empty-panel">期刊中没有找到“{deferredQuery.trim()}”相关内容。可以换一个更短或更具体的关键词。</div>}
      {showMagazines && hasDeferredQuery && visibleResults.length > 0 && (
        <div className="search-results" data-testid="library-search-results">
          <div className="search-results-meta"><span>共 {results.length} 篇匹配</span>{results.length > visibleResults.length && <span>先显示前 {visibleResults.length} 篇</span>}</div>
          {visibleResults.map((result) => {
            const queued = isReadLater(readLaterState, result.issueId, result.articleId);
            return (
              <div className="search-result-card" key={`${result.issueId}:${result.articleId}`} data-testid={`search-result-${result.issueId}-${result.articleId}`}>
                <button className="search-result-main" onClick={() => onOpenArticle(result.articleId, result.issueId)}>
                  <div className="search-result-meta">
                    <span>{result.publicationName}</span><span>{result.displayDate}</span><span>{result.sectionZh}</span><em>命中：{searchMatchLabel(result.matchField)}</em>
                  </div>
                  <h2><SearchHighlight text={result.title} query={deferredQuery} /></h2>
                  {result.titleZh && <div className="search-result-title-zh"><SearchHighlight text={result.titleZh} query={deferredQuery} /></div>}
                  <p><SearchHighlight text={result.snippet} query={deferredQuery} /></p>
                  <span className="search-result-open">阅读全文 →</span>
                </button>
                <button
                  className={`icon-button search-read-later-button ${queued ? "is-active" : ""}`}
                  aria-label={queued ? `移出稍后阅读：${result.title}` : `加入稍后阅读：${result.title}`}
                  onClick={() => onToggleReadLater(result.issueId, result.articleId)}
                >{queued ? "★" : "☆"}</button>
              </div>
            );
          })}
        </div>
      )}
      {scope !== "magazines" && publicationFilter === "all" && <BookLibrarySearch books={books} query={deferredQuery} kind={scope === "all" ? "all" : scope} readLaterState={readLaterState} onOpen={onOpenReading} onToggle={onToggleReading} />}
    </div>
  );
}

function ReadLaterPage({ items, onOpen, onRemove }: {
  items: NonNullable<ReturnType<typeof resolveReadingEntry>>[];
  onOpen: (entry: ReadingEntry) => void;
  onRemove: (entry: ReadingEntry) => void;
}) {
  return <div className="page list-page"><section className="page-heading-row"><div><div className="eyebrow">Read later</div><h1>稍后阅读</h1><p>保存想读的期刊文章、电子书章节和精选阅读，最近加入的排在最前。</p></div><div className="demo-chip">{items.length} saved</div></section>
    <GlobalReadingList items={items} onOpen={onOpen} onRemove={onRemove} empty="还没有稍后阅读。可在任意阅读内容中点击星标加入。" />
  </div>;
}

function formatHistoryTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function ReadingHistoryPage({ items, onOpen, onClear }: {
  items: Array<NonNullable<ReturnType<typeof resolveReadingEntry>> & { timestamp?: string }>;
  onOpen: (entry: ReadingEntry) => void;
  onClear: () => void;
}) {
  return <div className="page list-page"><section className="page-heading-row"><div><div className="eyebrow">Reading history</div><h1>阅读历史</h1><p>统一记录打开过的期刊文章、电子书章节与精选阅读；重复打开只更新时间。</p></div>
    <div className="history-heading-actions"><div className="demo-chip">{items.length} read</div>{items.length > 0 && <button className="text-button history-clear-button" onClick={onClear}>清空历史</button>}</div></section>
    <GlobalReadingList history items={items} onOpen={onOpen} empty="还没有阅读历史。打开文章、书籍章节或精选阅读后会自动出现在这里。" />
  </div>;
}

function NotesPage({ issues, books, notes, viewState, onViewStateChange, onOpenNote, onEditNote, onDeleteNote }: {
  issues: ReaderIssue[];
  books: BookSummary[];
  notes: ReaderNote[];
  viewState: NotesViewState;
  onViewStateChange: (state: NotesViewState) => void;
  onOpenNote: (note: ReaderNote) => void;
  onEditNote: (noteId: string, text: string) => void;
  onDeleteNote: (noteId: string) => void;
}) {
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [noteBooks, setNoteBooks] = useState<Record<string, BookRecord>>({});
  const [noteLessons, setNoteLessons] = useState<Record<string, BookLesson[]>>({});
  useEffect(() => {
    let cancelled = false;
    const bookIds = [...new Set(notes.flatMap((note) => {
      const document = readerNoteDocument(note);
      return document && document.kind !== "article" ? [document.bookId] : [];
    }))];
    void Promise.allSettled(bookIds.map((id) => fetchBook(id))).then((results) => {
      if (cancelled) return;
      setNoteBooks(Object.fromEntries(results.flatMap((result) => result.status === "fulfilled" ? [[result.value.id, result.value]] : [])));
    });
    const lessonBookIds = [...new Set(notes.flatMap((note) => { const document = readerNoteDocument(note); return document?.kind === "book-lesson" ? [document.bookId] : []; }))];
    void Promise.allSettled(lessonBookIds.map(async (id) => [id, await fetchBookLessons(id)] as const)).then((results) => {
      if (!cancelled) setNoteLessons(Object.fromEntries(results.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])));
    });
    return () => { cancelled = true; };
  }, [notes]);
  const resolvedNotes = useMemo(() => notes.flatMap<{ note: ReaderNote; title: string; titleZh: string; sourceLabel: string; sourceId: VocabularySourceId; paragraphs: string[]; available: boolean }>((note) => {
    const document = readerNoteDocument(note);
    if (!document) return [];
    if (document.kind === "book-lesson") {
      const book = noteBooks[document.bookId];
      const lesson = noteLessons[document.bookId]?.find((entry) => entry.id === document.lessonId && entry.sourceFingerprint === book?.sourceFingerprint);
      return [{ note, title: lesson?.titleZh ?? "精选阅读暂不可用", titleZh: "", sourceLabel: `${book?.title ?? books.find((item) => item.id === document.bookId)?.title ?? "电子书"} · 精选阅读`,
        sourceId: "books", paragraphs: lesson ? lessonParagraphs(lesson) : [], available: Boolean(lesson) }];
    }
    if (document.kind === "book-chapter") {
      const book = noteBooks[document.bookId];
      const chapter = book?.chapters.find((candidate) => candidate.id === document.chapterId);
      return [{ note, title: chapter?.title ?? "章节笔记", titleZh: "", sourceLabel: book?.title ?? books.find((item) => item.id === document.bookId)?.title ?? "电子书",
        sourceId: "books", paragraphs: chapter?.paragraphs ?? [], available: Boolean(chapter) }];
    }
    const match = findArticle(issues, document.articleId, document.issueId);
    return [{ note, title: match?.article.title ?? "文章暂不可用", titleZh: match?.article.titleZh ?? "",
      sourceLabel: match ? `${match.issue.publicationName} · ${match.issue.displayDate}` : "期刊来源暂不可用",
      sourceId: match?.issue.publicationId ?? "economist", paragraphs: match?.article.paragraphs ?? [], available: Boolean(match) }];
  }), [issues, notes, books, noteBooks, noteLessons]);
  const filteredNotes = useMemo(() => {
    const normalizedQuery = viewState.query.trim().toLocaleLowerCase("en-US");
    return resolvedNotes.filter(({ note, sourceId }) => {
      if (viewState.publicationFilter !== "all" && sourceId !== viewState.publicationFilter) return false;
      return !normalizedQuery || note.text.toLocaleLowerCase("en-US").includes(normalizedQuery);
    });
  }, [resolvedNotes, viewState]);

  function startEditingNote(note: ReaderNote) {
    setEditingNoteId(note.id);
    setEditingNoteText(note.text);
  }

  function cancelEditingNote() {
    setEditingNoteId(null);
    setEditingNoteText("");
  }

  function saveEditedNote(noteId: string) {
    const text = editingNoteText.trim();
    if (!text) return;
    onEditNote(noteId, text);
    cancelEditingNote();
  }

  return (
    <div className="page list-page">
      <section className="page-heading-row">
        <div><div className="eyebrow">Thinking while reading</div><h1>笔记</h1><p>不需要离开阅读器，先把疑问和联想记下来。</p></div>
        <div className="demo-chip">{notes.length} notes</div>
      </section>
      {notes.length > 0 && (
        <>
          <section className="global-vocabulary-controls notes-overview-controls" aria-label="笔记筛选">
            <label className="global-vocabulary-search">
              <span>搜索</span>
              <input
                aria-label="搜索笔记"
                value={viewState.query}
                onChange={(event) => onViewStateChange({ ...viewState, query: event.target.value })}
                placeholder="搜索笔记内容…"
              />
            </label>
            <div className="global-vocabulary-filter-group">
              <span>来源</span>
              <div className="global-vocabulary-filter-row">
                <button className={viewState.publicationFilter === "all" ? "is-active" : ""} onClick={() => onViewStateChange({ ...viewState, publicationFilter: "all" })}>全部</button>
                <button className={viewState.publicationFilter === "books" ? "is-active" : ""} onClick={() => onViewStateChange({ ...viewState, publicationFilter: "books" })}>电子书</button>
                {Object.values(PUBLICATIONS).map((publication) => (
                  <button key={publication.id} className={viewState.publicationFilter === publication.id ? "is-active" : ""} onClick={() => onViewStateChange({ ...viewState, publicationFilter: publication.id })}>{publication.name}</button>
                ))}
              </div>
            </div>
          </section>
          <div className="global-vocabulary-results-meta">显示 {filteredNotes.length} / {resolvedNotes.length} 条笔记</div>
        </>
      )}
      <div className="notes-overview-grid">
        {!notes.length ? <div className="empty-panel">还没有笔记。阅读文章时可以随手记下疑问和联想。</div> : filteredNotes.length ? filteredNotes.map(({ note, title, titleZh, sourceLabel, paragraphs, available }) => {
          const editing = editingNoteId === note.id;
          const anchorInfo = available ? noteAnchorPresentation(note, paragraphs) : note.anchor ? { label: "已保存原文摘录", excerpt: note.anchor.paragraphText, resolved: false } : null;
          return (
            <div className="overview-note" key={note.id}>
              {editing ? (
                <div className="overview-note-editor">
                  <textarea
                    aria-label="编辑笔记内容"
                    value={editingNoteText}
                    onChange={(event) => setEditingNoteText(event.target.value)}
                  />
                  <div className="note-actions">
                    <button className="text-button note-action-button" disabled={!editingNoteText.trim()} onClick={() => saveEditedNote(note.id)}>保存</button>
                    <button className="text-button note-action-button" onClick={cancelEditingNote}>取消</button>
                  </div>
                </div>
              ) : (
                <>
                  <button className="overview-note-main" onClick={() => onOpenNote(note)}>
                    <div className="note-quote">“{note.text}”</div>
                    {anchorInfo && (
                      <div className={`overview-note-anchor ${anchorInfo.resolved ? "" : "is-stale"}`}>
                        <b>{anchorInfo.label}</b>
                        {anchorInfo.excerpt && <small>“{anchorInfo.excerpt}”</small>}
                      </div>
                    )}
                    <strong>{title}</strong>
                    {titleZh && <small>{titleZh}</small>}
                    <span>{sourceLabel} · {formatHistoryTime(note.createdAt)}</span>
                  </button>
                  <div className="overview-note-actions note-actions">
                    <button className="text-button note-action-button" aria-label={`编辑笔记：${note.text}`} onClick={() => startEditingNote(note)}>编辑</button>
                    <button className="text-button note-action-button is-danger" aria-label={`删除笔记：${note.text}`} onClick={() => onDeleteNote(note.id)}>删除</button>
                  </div>
                </>
              )}
            </div>
          );
        }) : <div className="empty-panel">没有符合当前搜索或杂志筛选的笔记。</div>}
      </div>
    </div>
  );
}

function GlobalVocabularyPage({
  issues,
  books,
  onOpenContext,
  onStartReview,
  viewState,
  onViewStateChange,
}: {
  issues: ReaderIssue[];
  books: BookSummary[];
  onOpenContext: (context: GlobalVocabularyContext) => void;
  onStartReview: () => void;
  viewState: GlobalVocabularyViewState;
  onViewStateChange: (state: GlobalVocabularyViewState) => void;
}) {
  const [savedSelections, setSavedSelections] = useState<SavedSelection[]>(() => loadSavedSelections(getReaderStorage()));
  const [contextRecords, setContextRecords] = useState<WordContextMeaningRecord[]>(() => loadWordContextMeanings(getReaderStorage()));
  const { query, familiarityFilter, publicationFilter, expandedKey, selectedKey } = viewState;
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailLookup, setDetailLookup] = useState<ActiveWordLookup | null>(null);

  const items = useMemo(
    () => buildGlobalVocabularyItems(savedSelections, contextRecords, issues, books),
    [savedSelections, contextRecords, issues, books],
  );
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
    return items.filter((item) => {
      if (familiarityFilter !== "all" && item.familiarity !== familiarityFilter) return false;
      if (publicationFilter !== "all" && !item.publicationIds.includes(publicationFilter)) return false;
      if (!normalizedQuery) return true;
      return item.text.toLocaleLowerCase("en-US").includes(normalizedQuery)
        || (item.translationZh ?? "").toLocaleLowerCase("zh-CN").includes(normalizedQuery);
    });
  }, [items, query, familiarityFilter, publicationFilter]);
  const detailItem = detailKey ? items.find((item) => item.key === detailKey) : undefined;
  const reviewableCount = buildDueVocabularyReviewQueue(items, loadVocabularyReviewSchedules(getReaderStorage())).length;

  useEffect(() => {
    if (!expandedKey) return;
    const frame = window.requestAnimationFrame(() => {
      const target = [...document.querySelectorAll<HTMLElement>("[data-global-vocabulary-key]")]
        .find((element) => element.dataset.globalVocabularyKey === expandedKey);
      target?.scrollIntoView({ block: "center", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expandedKey]);

  function updateVocabularyMeaning(text: string, meaningZh: string) {
    setSavedSelections((current) => {
      const next = setSavedSelectionTranslation(current, text, meaningZh);
      saveSavedSelections(getReaderStorage(), next);
      return next;
    });
  }

  function updateVocabularyFamiliarity(text: string, familiarity: FamiliarityLevel) {
    setSavedSelections((current) => {
      const next = setSavedSelectionFamiliarity(current, text, familiarity);
      saveSavedSelections(getReaderStorage(), next);
      return next;
    });
  }

  function updateDetailContextMeaning(meaningZh: string) {
    if (!detailLookup?.contextMeaning) return;
    const editedAt = new Date();
    setContextRecords((current) => {
      const next = setWordContextMeaningUserOverride(current, detailLookup.key, meaningZh, editedAt);
      saveWordContextMeanings(getReaderStorage(), next);
      return next;
    });
    setDetailLookup((current) => current?.contextMeaning ? {
      ...current,
      contextMeaning: {
        ...current.contextMeaning,
        meaningZh: meaningZh.trim(),
        meaningSource: "user",
        editedAt: editedAt.toISOString(),
      },
    } : current);
  }

  function openWordDetail(item: GlobalVocabularyItem) {
    const context = item.contexts[0];
    if (!context) return;
    const occurrence = {
      document: vocabularyContextDocument(context),
      paragraphIndex: context.paragraphIndex,
      startOffset: context.startOffset,
      text: item.text,
      paragraph: context.paragraph,
    };
    const key = wordContextOccurrenceKey(occurrence);
    const cached = findWordContextMeaning(contextRecords, occurrence);
    const dictionaryEligible = isDictionaryWord(item.text);
    setDetailKey(item.key);
    setDetailLookup({
      key,
      text: item.text,
      paragraph: context.paragraph,
      paragraphIndex: context.paragraphIndex,
      startOffset: context.startOffset,
      top: 0,
      left: 0,
      placement: "below",
      dictionaryStatus: dictionaryEligible ? "loading" : "idle",
      contextStatus: cached ? "ready" : "loading",
      contextMeaning: cached,
    });

    if (dictionaryEligible) {
      void lookupDictionary(item.text).then((dictionary) => {
        setDetailLookup((current) => current?.key === key
          ? { ...current, dictionaryStatus: "ready", dictionary, dictionaryError: undefined }
          : current);
      }).catch((error) => {
        setDetailLookup((current) => current?.key === key
          ? { ...current, dictionaryStatus: "error", dictionaryError: error instanceof Error ? error.message : "词典查询失败" }
          : current);
      });
    }

    if (!cached || !hasEnglishWordContext(cached)) {
      const match = context.articleId && context.issueId ? findArticle(issues, context.articleId, context.issueId) : undefined;
      const article = match?.article;
      void explainWordContext({
        text: item.text,
        sentence: context.sentence,
        paragraph: context.paragraph,
        contextBefore: article?.paragraphs[context.paragraphIndex - 1],
        contextAfter: article?.paragraphs[context.paragraphIndex + 1],
        articleTitle: context.articleTitle,
      }).then((result) => {
        const record: WordContextMeaningRecord = {
          ...result,
          ...occurrence,
          key,
          sentence: context.sentence,
          generatedAt: new Date().toISOString(),
          meaningZh: cached?.meaningSource === "user" ? cached.meaningZh : result.meaningZh,
          meaningSource: cached?.meaningSource ?? "ai",
          editedAt: cached?.editedAt,
        };
        setContextRecords((current) => {
          const next = upsertWordContextMeaning(current, record);
          saveWordContextMeanings(getReaderStorage(), next);
          return next;
        });
        setDetailLookup((current) => current?.key === key
          ? { ...current, contextStatus: "ready", contextMeaning: record, contextError: undefined }
          : current);
      }).catch(() => {
        setDetailLookup((current) => current?.key === key
          ? { ...current, contextStatus: "error", contextError: "语境分析暂时失败" }
          : current);
      });
    }
  }

  if (detailLookup && detailItem) {
    return (
      <div className="page global-vocabulary-page">
        <div className="global-vocabulary-detail-shell">
          <WordDetailContent
            lookup={detailLookup}
            vocabularyMeaning={detailItem.translationZh}
            familiarity={detailItem.familiarity}
            onBack={() => { setDetailLookup(null); setDetailKey(null); }}
            onVocabularyMeaningChange={(meaningZh) => updateVocabularyMeaning(detailItem.text, meaningZh)}
            onFamiliarityChange={(level) => updateVocabularyFamiliarity(detailItem.text, level)}
            onContextMeaningChange={updateDetailContextMeaning}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page global-vocabulary-page">
      <section className="page-heading-row global-vocabulary-heading">
        <div>
          <div className="eyebrow">Across your reading</div>
          <h1>我的词汇</h1>
          <p>右侧阅读栏只看当前文章；这里汇总期刊和电子书中保存过的全部词汇与语境。</p>
        </div>
        <div className="global-vocabulary-heading-actions">
          <button className="primary-button" onClick={onStartReview} disabled={!reviewableCount}>开始复习 · {reviewableCount}</button>
          <div className="demo-chip">{items.length} words</div>
        </div>
      </section>

      <section className="global-vocabulary-controls" aria-label="词汇筛选">
        <label className="global-vocabulary-search">
          <span>搜索</span>
          <input aria-label="搜索我的词汇" value={query} onChange={(event) => onViewStateChange({ ...viewState, query: event.target.value })} placeholder="输入英文或中文释义…" />
        </label>
        <div className="global-vocabulary-filter-group">
          <span>词汇状态</span>
          <div className="global-vocabulary-filter-row">
            <button className={familiarityFilter === "all" ? "is-active" : ""} onClick={() => onViewStateChange({ ...viewState, familiarityFilter: "all" })}>全部</button>
            {GLOBAL_VOCABULARY_FAMILIARITY_LEVELS.map((level) => (
              <button key={level} className={familiarityFilter === level ? "is-active" : ""} onClick={() => onViewStateChange({ ...viewState, familiarityFilter: level })}>
                {familiarityStatusText(level)}
              </button>
            ))}
          </div>
        </div>
        <div className="global-vocabulary-filter-group">
          <span>来源</span>
          <div className="global-vocabulary-filter-row">
            <button className={publicationFilter === "all" ? "is-active" : ""} onClick={() => onViewStateChange({ ...viewState, publicationFilter: "all" })}>全部</button>
            <button className={publicationFilter === "books" ? "is-active" : ""} onClick={() => onViewStateChange({ ...viewState, publicationFilter: "books" })}>电子书</button>
            {Object.values(PUBLICATIONS).map((publication) => (
              <button key={publication.id} className={publicationFilter === publication.id ? "is-active" : ""} onClick={() => onViewStateChange({ ...viewState, publicationFilter: publication.id })}>{publication.name}</button>
            ))}
          </div>
        </div>
      </section>

      <div className="global-vocabulary-results-meta">显示 {filteredItems.length} / {items.length} 个词汇</div>
      <div className="global-vocabulary-list" data-testid="global-vocabulary-list">
        {filteredItems.length ? filteredItems.map((item) => {
          const expanded = expandedKey === item.key;
          const selected = selectedKey === item.key;
          return (
            <article
              className={`global-vocabulary-card familiarity-${item.familiarity} ${expanded ? "is-expanded" : ""} ${selected ? "is-selected" : ""}`}
              data-vocabulary-text={item.text}
              data-global-vocabulary-key={item.key}
              key={item.key}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button")) return;
                onViewStateChange({ ...viewState, selectedKey: item.key });
              }}
            >
              <div className="global-vocabulary-card-head">
                <button className="global-vocabulary-word" aria-expanded={expanded} onClick={() => onViewStateChange({ ...viewState, selectedKey: item.key, expandedKey: expanded ? null : item.key })}>
                  <strong>{item.text}</strong>
                  <span>{item.translationZh || "还没有中文释义"}</span>
                </button>
                <span className={`saved-selection-status familiarity-${item.familiarity}`}>{familiarityStatusText(item.familiarity)}</span>
              </div>
              <div className="global-vocabulary-stats">
                <span>{item.articleCount} 篇文章 / 章节</span>
                <span>{item.contextCount} 个语境</span>
                <span>{item.publicationIds.map((id) => id === "books" ? "电子书" : PUBLICATIONS[id].name).join(" · ")}</span>
              </div>
              <div className="global-vocabulary-card-actions">
                <button onClick={() => onViewStateChange({ ...viewState, selectedKey: item.key, expandedKey: expanded ? null : item.key })}>{expanded ? "收起语境" : "查看所有语境"}</button>
                <button onClick={() => { onViewStateChange({ ...viewState, selectedKey: item.key }); openWordDetail(item); }}>学习详情</button>
              </div>
              <div className="familiarity-picker global-vocabulary-familiarity" aria-label={`全局“${item.text}”熟悉度`}>
                {FAMILIARITY_LEVELS.map((level) => (
                  <FamiliarityOptionButton
                    key={level}
                    level={level}
                    active={item.familiarity === level}
                    ariaLabel={`在词汇库将“${item.text}”熟悉度设为 ${familiarityAriaStatus(level)}`}
                    onClick={() => { onViewStateChange({ ...viewState, selectedKey: item.key }); updateVocabularyFamiliarity(item.text, level); }}
                  />
                ))}
              </div>
              {expanded && (
                <div className="global-vocabulary-contexts">
                  {item.contexts.map((context, index) => (
                    <button className="global-vocabulary-context" key={context.id} onClick={() => { onViewStateChange({ ...viewState, selectedKey: item.key }); onOpenContext(context); }}>
                      <span className="global-vocabulary-context-index">{String(index + 1).padStart(2, "0")}</span>
                      <span className="global-vocabulary-context-copy">
                        <small>{context.publicationName} · {context.articleTitle}</small>
                        <strong>{context.sentence}</strong>
                        {(context.meaningZh || context.meaningEn) && <em>{context.meaningZh}{context.meaningZh && context.meaningEn ? " · " : ""}{context.meaningEn}</em>}
                        {context.usageExplanationZh && <span>用法：{context.usageExplanationZh}</span>}
                      </span>
                      <span className="global-vocabulary-context-open">打开原文 →</span>
                    </button>
                  ))}
                </div>
              )}
            </article>
          );
        }) : <div className="empty-panel">没有符合当前筛选条件的词汇。</div>}
      </div>
    </div>
  );
}

function VocabularyReviewPage({ issues, books, onOpenVocabulary }: { issues: ReaderIssue[]; books: BookSummary[]; onOpenVocabulary: () => void }) {
  const [savedSelections, setSavedSelections] = useState<SavedSelection[]>(() => loadSavedSelections(getReaderStorage()));
  const [contextRecords, setContextRecords] = useState<WordContextMeaningRecord[]>(() => loadWordContextMeanings(getReaderStorage()));
  const [reviewSchedules, setReviewSchedules] = useState<VocabularyReviewScheduleRecord[]>(() =>
    loadVocabularyReviewSchedules(getReaderStorage()),
  );
  const items = useMemo(
    () => buildGlobalVocabularyItems(savedSelections, contextRecords, issues, books),
    [savedSelections, contextRecords, issues, books],
  );
  const [reviewKeys, setReviewKeys] = useState<string[]>(() =>
    buildDueVocabularyReviewQueue(
      buildGlobalVocabularyItems(
        loadSavedSelections(getReaderStorage()),
        loadWordContextMeanings(getReaderStorage()),
        issues,
        books,
      ),
      loadVocabularyReviewSchedules(getReaderStorage()),
    ).map((item) => item.key),
  );
  const [initialTotal, setInitialTotal] = useState(reviewKeys.length);
  const [revealed, setRevealed] = useState(false);
  const [sentenceTranslationRecords, setSentenceTranslationRecords] = useState<SentenceTranslationRecord[]>(() =>
    loadSentenceTranslations(getReaderStorage()),
  );
  const [sentenceTranslationRequests, setSentenceTranslationRequests] = useState<Record<string, {
    status: "loading" | "error";
    kind?: "translation" | "expressions";
    error?: string;
  }>>({});
  const currentItem = reviewKeys.length ? items.find((item) => item.key === reviewKeys[0]) : undefined;
  const currentContext = currentItem ? preferredVocabularyReviewContext(currentItem) : null;
  const completed = Math.max(0, initialTotal - reviewKeys.length);
  const progress = initialTotal ? Math.round((completed / initialTotal) * 100) : 0;
  const restartableItems = buildDueVocabularyReviewQueue(items, reviewSchedules);
  const currentSentenceTarget = currentContext ? sentenceTranslationTargetForOccurrence({
    document: vocabularyContextDocument(currentContext),
    paragraphIndex: currentContext.paragraphIndex,
    paragraph: currentContext.paragraph,
    startOffset: currentContext.startOffset,
    targetLength: currentContext.text.length,
  }) : null;
  const currentSentenceTranslation = currentSentenceTarget
    ? findSentenceTranslation(sentenceTranslationRecords, currentSentenceTarget)
    : undefined;
  const currentSentenceRequest = currentSentenceTarget
    ? sentenceTranslationRequests[currentSentenceTarget.key]
    : undefined;
  const currentReviewSentenceSegments = useMemo(
    () => currentContext ? vocabularyReviewSentenceSegments(currentContext, savedSelections, contextRecords) : [],
    [currentContext, savedSelections, contextRecords],
  );
  const reviewPanelSelections = useMemo(() => {
    if (!currentContext || !currentItem) return [];
    const document = vocabularyContextDocument(currentContext);
    const sentenceVocabulary = new Set(currentReviewSentenceSegments
      .filter((segment) => segment.saved)
      .map((segment) => globalVocabularyTextKey(segment.text)));
    // Keep the reviewed term available even if legacy saved offsets no longer line up exactly.
    sentenceVocabulary.add(globalVocabularyTextKey(currentItem.text));
    return savedSelections.filter((selection) => savedSelectionBelongsToDocument(selection, document)
      && sentenceVocabulary.has(globalVocabularyTextKey(selection.text)));
  }, [currentContext, currentItem, currentReviewSentenceSegments, savedSelections]);
  function updateReviewExpressionFamiliarity(text: string, familiarity: FamiliarityLevel) {
    setSavedSelections((current) => {
      const next = setSavedSelectionFamiliarity(current, text, familiarity);
      saveSavedSelections(getReaderStorage(), next);
      return next;
    });
  }

  async function saveCurrentSentenceExpression(expression: SentenceExpression) {
    if (!currentSentenceTarget || !currentContext) return;
    const target = currentSentenceTarget; const context = currentContext;
    const offset = target.startOffset + target.sourceText.indexOf(expression.text.trim());
    const cached = findWordContextMeaning(contextRecords, { document: target.document, paragraphIndex: target.paragraphIndex, startOffset: offset, text: expression.text, paragraph: context.paragraph });
    const ready = await completeSentenceExpressionMeaning(expression, async () => {
      const result = cached?.meaningVersion === 2 ? cached : await explainWordContext({ text: expression.text, sentence: target.sourceText, paragraph: context.paragraph, articleTitle: context.articleTitle, verifyConsistency: true, sentenceTranslationZh: currentSentenceTranslation?.translationZh, expressionExplanationZh: expression.explanationZh, suggestedMeaningZh: expression.meaningZh || cached?.meaningZh });
      if (!result.sentenceTranslationZh) throw new Error("语境核对结果不完整，请重试。");
      setSentenceTranslationRecords((current) => {
        const previous = findSentenceTranslation(current, target);
        const expressions = [...(previous?.expressions ?? []).filter((item) => item.text !== expression.text), { kind: expression.kind, text: expression.text, meaningZh: result.meaningZh, meaningVersion: 2 as const, explanationZh: result.explanationZh }];
        const next = upsertSentenceTranslation(current, { ...target, translationZh: result.sentenceTranslationZh!, expressions: expressions.slice(-4), model: result.model, provider: result.provider, generatedAt: new Date().toISOString() });
        saveSentenceTranslations(getReaderStorage(), next); return next;
      });
      return result;
    });
    setSavedSelections((current) => {
      const next = saveSentenceExpression(current, target, ready, context.paragraph, context.articleTitle);
      if (next !== current) saveSavedSelections(getReaderStorage(), next);
      return next;
    });
  }

  function requestSentenceTranslation(context: GlobalVocabularyContext, regenerate: false | "translation" | "expressions" = false) {
    const target = sentenceTranslationTargetForOccurrence({
      document: vocabularyContextDocument(context),
      paragraphIndex: context.paragraphIndex,
      paragraph: context.paragraph,
      startOffset: context.startOffset,
      targetLength: context.text.length,
    });
    const previous = findSentenceTranslation(sentenceTranslationRecords, target);
    if (!regenerate && previous) return;
    if (sentenceTranslationRequests[target.key]?.status === "loading") return;
    const match = context.articleId && context.issueId ? findArticle(issues, context.articleId, context.issueId) : undefined;
    setSentenceTranslationRequests((current) => ({
      ...current,
      [target.key]: { status: "loading", kind: regenerate || undefined },
    }));
    void translateParagraph({
      mode: "sentence",
      paragraphContext: context.paragraph,
      text: target.sourceText,
      contextBefore: match?.article.paragraphs[context.paragraphIndex - 1],
      contextAfter: match?.article.paragraphs[context.paragraphIndex + 1],
    }).then((result) => {
      const recommendedExpressions = (result.expressions ?? []).map((expression) => {
        if (regenerate !== "expressions") return expression;
        const normalized = expression.text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
        const savedUserGloss = savedSelections.find((item) => savedSelectionBelongsToDocument(item, target.document)
          && item.text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") === normalized
          && item.translationSource === "user")?.translationZh?.trim();
        const offset = target.startOffset + target.sourceText.indexOf(expression.text.trim());
        const contextualRecord = offset >= target.startOffset ? findWordContextMeaning(contextRecords, {
          document: target.document,
          paragraphIndex: target.paragraphIndex,
          startOffset: offset,
          text: expression.text,
          paragraph: context.paragraph,
        }) : undefined;
        const userGloss = contextualRecord?.meaningSource === "user" ? contextualRecord.meaningZh.trim() : savedUserGloss;
        return userGloss ? { ...expression, meaningZh: userGloss, meaningVersion: 2 as const } : expression;
      });
      const record: SentenceTranslationRecord = {
        ...target,
        translationZh: regenerate === "expressions" && previous ? previous.translationZh : result.translation,
        expressions: regenerate === "translation" && previous ? previous.expressions : recommendedExpressions,
        model: result.model,
        provider: result.provider,
        generatedAt: new Date().toISOString(),
      };
      setSentenceTranslationRecords((current) => {
        const next = upsertSentenceTranslation(current, record);
        saveSentenceTranslations(getReaderStorage(), next);
        return next;
      });
      setSentenceTranslationRequests((current) => {
        const next = { ...current };
        delete next[target.key];
        return next;
      });
    }).catch((error) => {
      setSentenceTranslationRequests((current) => ({
        ...current,
        [target.key]: {
          status: "error",
          error: error instanceof Error ? error.message : "句子翻译失败",
        },
      }));
    });
  }

  function revealCurrent() {
    if (!currentContext) return;
    setRevealed(true);
    requestSentenceTranslation(currentContext);
  }

  function updateReviewVocabularyMeaning(text: string, meaningZh: string) {
    if (!currentContext || !meaningZh.trim()) return;
    const document = vocabularyContextDocument(currentContext);
    const normalizedText = text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    setSavedSelections((current) => {
      const next = current.map((selection) => savedSelectionBelongsToDocument(selection, document)
        && selection.text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") === normalizedText
        ? { ...selection, translationZh: meaningZh.trim(), translationSource: "user" as const }
        : selection);
      saveSavedSelections(getReaderStorage(), next);
      return next;
    });
    if (!currentItem || normalizedText !== currentItem.text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")) return;
    const occurrence = { document, paragraphIndex: currentContext.paragraphIndex, startOffset: currentContext.startOffset, text: currentItem.text, paragraph: currentContext.paragraph };
    const key = wordContextOccurrenceKey(occurrence);
    const existing = findWordContextMeaning(contextRecords, occurrence);
    const editedAt = new Date().toISOString();
    const nextRecord: WordContextMeaningRecord = existing
      ? { ...existing, meaningZh: meaningZh.trim(), meaningSource: "user", editedAt }
      : {
          ...occurrence,
          ...(document.kind === "article" ? { issueId: document.issueId, articleId: document.articleId } : {}),
          key,
          sentence: currentContext.sentence,
          meaningZh: meaningZh.trim(),
          explanationZh: "",
          meaningEn: "",
          explanationEn: "",
          examplesEn: [],
          partOfSpeech: "",
          model: "manual",
          provider: "easycliproxy",
          generatedAt: editedAt,
          meaningSource: "user",
          editedAt,
        };
    setContextRecords((current) => {
      const next = upsertWordContextMeaning(current, nextRecord);
      saveWordContextMeanings(getReaderStorage(), next);
      return next;
    });
  }

  function updateReviewVocabularyFamiliarity(text: string, familiarity: FamiliarityLevel) {
    if (!currentContext) return;
    const document = vocabularyContextDocument(currentContext);
    setSavedSelections((current) => {
      const normalizedText = text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
      const next = current.map((selection) => savedSelectionBelongsToDocument(selection, document)
        && selection.text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") === normalizedText
        ? { ...selection, familiarity }
        : selection);
      saveSavedSelections(getReaderStorage(), next);
      return next;
    });
  }

  function removeReviewVocabulary(text: string) {
    if (!currentContext) return;
    const document = vocabularyContextDocument(currentContext);
    const textKey = globalVocabularyTextKey(text);
    const result = removeSavedSelectionFromDocument(savedSelections, document, text);
    saveSavedSelections(getReaderStorage(), result.remaining);
    setSavedSelections(result.remaining);
    const nextItems = buildGlobalVocabularyItems(result.remaining, contextRecords, issues, books);
    if (!nextItems.some((item) => item.key === textKey)) {
      setReviewKeys((keys) => keys.filter((key) => key !== textKey));
      setReviewSchedules((schedules) => {
        const nextSchedules = schedules.filter((schedule) => globalVocabularyTextKey(schedule.text) !== textKey);
        saveVocabularyReviewSchedules(getReaderStorage(), nextSchedules);
        return nextSchedules;
      });
      if (currentItem?.key === textKey) setRevealed(false);
    }
  }

  function rateCurrent(level: FamiliarityLevel) {
    if (!currentItem) return;
    setSavedSelections((current) => {
      const next = setSavedSelectionFamiliarity(current, currentItem.text, level);
      saveSavedSelections(getReaderStorage(), next);
      return next;
    });
    setReviewSchedules((current) => {
      const next = scheduleVocabularyAfterReview(current, currentItem.text, level);
      saveVocabularyReviewSchedules(getReaderStorage(), next);
      return next;
    });
    setReviewKeys((current) => current.filter((key) => key !== currentItem.key));
    setRevealed(false);
  }

  function deferCurrent() {
    setReviewKeys((current) => deferCurrentVocabularyReviewKey(current));
    setRevealed(false);
  }

  function restartReview() {
    const nextKeys = buildDueVocabularyReviewQueue(items, reviewSchedules).map((item) => item.key);
    setReviewKeys(nextKeys);
    setInitialTotal(nextKeys.length);
    setRevealed(false);
  }

  if (!initialTotal) {
    return (
      <div className="page vocabulary-review-page">
        <section className="review-empty-state">
          <div className="eyebrow">Vocabulary review</div>
          <h1>当前没有到期的词</h1>
          <p>1 生词～4 已学习会按状态安排下次复习；首次进入学习状态的词会立即进入一次复习。忽视和已知不进入队列。</p>
          <button className="primary-button" onClick={onOpenVocabulary}>回到我的词汇</button>
        </section>
      </div>
    );
  }

  if (!currentItem || !currentContext) {
    return (
      <div className="page vocabulary-review-page">
        <section className="review-empty-state">
          <div className="eyebrow">Review complete</div>
          <h1>本轮复习完成</h1>
          <p>本轮共处理 {initialTotal} 个词。新的判断已经安排下一次复习：1 约 1 天、2 约 3 天、3 约 7 天、4 约 30 天；忽视和已知退出队列。</p>
          <div className="review-finished-actions">
            {restartableItems.length > 0 && <button className="primary-button" onClick={restartReview}>再来一轮 · {restartableItems.length}</button>}
            <button className="text-button" onClick={onOpenVocabulary}>回到我的词汇</button>
          </div>
        </section>
      </div>
    );
  }

  const contextMeaningZh = currentContext.meaningZh?.trim();
  const vocabularyMeaningZh = currentItem.translationZh?.trim();
  const primaryMeaningZh = contextMeaningZh || vocabularyMeaningZh || "还没有保存中文释义";
  const showVocabularyMeaning = Boolean(vocabularyMeaningZh && vocabularyMeaningZh !== contextMeaningZh);

  return (
    <div className={`page vocabulary-review-page ${revealed ? "has-review-detail" : ""}`}>
      <section className="page-heading-row review-heading">
        <div>
          <div className="eyebrow">Vocabulary review</div>
          <h1>词汇复习</h1>
          <p>这里只出现当前已到期的词。先读英文和真实原句，可以直接重新判断词汇状态；不确定时再查看释义，暂时不想判断时可以稍后再看。</p>
        </div>
        <div className="demo-chip">剩余 {reviewKeys.length}</div>
      </section>

      <section className="review-progress" aria-label="本轮复习进度">
        <div><span>本轮进度</span><strong>{completed + 1} / {initialTotal}</strong></div>
        <ProgressBar value={progress} />
      </section>

      <article className={`review-card familiarity-${currentItem.familiarity}`} data-testid="vocabulary-review-card" data-vocabulary-text={currentItem.text}>
        <div className="review-card-meta">
          <div className="review-card-kicker">{currentContext.publicationName} · {currentContext.articleTitle}</div>
          <span className={`review-previous-familiarity familiarity-${currentItem.familiarity}`} data-testid="review-previous-familiarity">
            原状态 {familiarityStatusText(currentItem.familiarity)}
          </span>
        </div>
        <h2>{currentItem.text}</h2>
        <blockquote data-testid="review-source-sentence">
          {currentReviewSentenceSegments.map((segment, index) => {
            const showSavedBackground = Boolean(segment.saved && segment.isTarget && revealed);
            const showGloss = Boolean(segment.meaningZh && (!segment.isTarget || revealed));
            const className = showSavedBackground
              ? `review-sentence-highlight familiarity-${segment.familiarity ?? 1}${segment.isTarget ? " review-sentence-target" : ""}`
              : segment.isTarget ? "review-sentence-target" : "";
            const content = showSavedBackground ? (
              <mark
                className={className}
                data-review-target={segment.isTarget ? "true" : undefined}
              >
                {segment.text}
              </mark>
            ) : (
              <span className={className || undefined} data-review-target={segment.isTarget ? "true" : undefined}>{segment.text}</span>
            );
            return showGloss ? (
              <ruby className="saved-selection-ruby review-sentence-ruby" key={`${index}:${segment.text}`}>
                {content}
                <rt className="saved-selection-inline-meaning" data-testid="review-sentence-gloss">{segment.meaningZh}</rt>
              </ruby>
            ) : <span key={`${index}:${segment.text}`}>{content}</span>;
          })}
        </blockquote>

        {revealed && (
          <div className="review-answer" data-testid="vocabulary-review-answer">
            <div className="review-answer-block">
              <span>{contextMeaningZh ? "当前语境" : "词汇释义"}</span>
              <strong>{primaryMeaningZh}</strong>
              {currentContext.meaningEn && <small>{currentContext.meaningEn}</small>}
            </div>
            {currentContext.usageExplanationZh && <details className="saved-expression-usage"><summary>短语用法</summary><p>{currentContext.usageExplanationZh}</p></details>}
            {showVocabularyMeaning && (
              <div className="review-answer-block is-secondary">
                <span>你的词汇释义</span>
                <strong>{vocabularyMeaningZh}</strong>
              </div>
            )}
            <div className={`review-sentence-translation ${currentSentenceRequest?.status === "error" ? "is-error" : ""}`} data-testid="review-sentence-translation">
              <span>句子翻译</span>
                      {currentSentenceTranslation && <><p>{currentSentenceTranslation.translationZh}</p><SentenceExpressionList translation={currentSentenceTranslation} target={currentSentenceTarget} selections={savedSelections} onSave={saveCurrentSentenceExpression} onFamiliarityChange={updateReviewExpressionFamiliarity} /></>}
              {currentSentenceTranslation && !currentSentenceTranslation.expressions?.length && <p className="muted-text">本句暂无需要单独学习的关键表达。</p>}
              {currentSentenceRequest?.status === "loading" && <p role="status">{currentSentenceRequest.kind === "expressions" ? "正在重新推荐关键表达…" : currentSentenceTranslation ? "正在重新翻译本句…" : "正在翻译当前句子…"}</p>}
              {currentSentenceTranslation && currentSentenceRequest?.status === "error" && <p role="alert">更新失败，已保留上次译文，请重试。</p>}
              <button className="text-button" disabled={currentSentenceRequest?.status === "loading"} onClick={() => requestSentenceTranslation(currentContext, "translation")}>重新翻译本句</button>
              <button className="text-button" disabled={currentSentenceRequest?.status === "loading"} onClick={() => requestSentenceTranslation(currentContext, "expressions")}>重新推荐关键表达</button>
              {!currentSentenceTranslation && currentSentenceRequest?.status === "error" && (
                <div className="review-translation-error">
                  <p>句子翻译暂时失败。</p>
                  <button onClick={() => requestSentenceTranslation(currentContext)}>重试</button>
                </div>
              )}
            </div>
          </div>
        )}
        {!revealed && <>
          <div className="review-rating-copy">
            <span>之前：<strong>{familiarityStatusText(currentItem.familiarity)}</strong></span>
            <span>现在重新判断：选择这个词当前的状态。</span>
          </div>
          <div className="familiarity-picker review-familiarity" aria-label={`复习“${currentItem.text}”熟悉度`}>
            {FAMILIARITY_LEVELS.map((level) => (
              <FamiliarityOptionButton
                key={level}
                level={level}
                ariaLabel={`复习将“${currentItem.text}”熟悉度设为 ${familiarityAriaStatus(level)}`}
                onClick={() => rateCurrent(level)}
              />
            ))}
          </div>
          <div className="review-schedule-hint">下次大约：1 生词 · 1 天　2 认识 · 3 天　3 熟悉 · 7 天　4 已学习 · 30 天</div>
        </>}
        <div className="review-action-row">
          {!revealed && (
            <>
              <button className="primary-button review-reveal-button" onClick={revealCurrent}>查看释义</button>
              <button
                className="review-defer-button"
                onClick={deferCurrent}
                disabled={reviewKeys.length <= 1}
                title={reviewKeys.length <= 1 ? "本轮没有其他词可先复习" : "移到本轮末尾，稍后再次出现"}
              >
                稍后再看
              </button>
            </>
          )}
          {revealed && <button className="primary-button review-next-button" onClick={() => rateCurrent(1)}>下一个</button>}
        </div>
      </article>

      {revealed && (
        <VocabularyPanel
          panelClassName="review-vocabulary-panel"
          savedSelections={reviewPanelSelections}
          occurrencesByText={new Map<string, SavedTextOccurrence[]>()}
          occurrenceIndexes={{}}
          detailLookup={null}
          detailFamiliarity={null}
          focusedText={currentItem.text}
          onSavedTranslationChange={updateReviewVocabularyMeaning}
          onSavedFamiliarityChange={updateReviewVocabularyFamiliarity}
          onRemoveSavedSelection={removeReviewVocabulary}
          onNavigateOccurrence={() => {}}
          onCloseDetail={() => {}}
          onDetailFamiliarityChange={() => {}}
          onDetailContextMeaningChange={() => {}}
        />
      )}

      <div className="review-footer-note">未查看释义时可以直接评分；查看释义后，点击“下一个”会按“1 · 生词”记录并安排复习。“稍后再看”只调整本轮顺序，不修改状态或日程。</div>
    </div>
  );
}

function SettingsPage({
  preferences,
  onChange,
}: {
  preferences: ReaderPreferences;
  onChange: (patch: Partial<ReaderPreferences>) => void;
}) {
  return (
    <div className="page settings-page">
      <section className="page-heading-row settings-heading">
        <div>
          <div className="eyebrow">Global preferences</div>
          <h1>设置</h1>
          <p>所有杂志共用一套阅读偏好与 AI 服务配置。这里集中管理阅读辅助、外观、发音、数据备份和模型连接。</p>
        </div>
        <div className="demo-chip">阅读偏好在浏览器 · AI 配置在本机</div>
      </section>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-heading">
            <div><span>Reading aids</span><h2>阅读辅助</h2></div>
            <small>只改变显示方式，不会修改词汇状态、释义或复习日程。</small>
          </div>
          <div className="settings-list">
            <div className="settings-row">
              <div><strong>显示词汇底色</strong><span>正文与逐句模式中，1–3 的学习词显示黄色底色；4 已学习、已知和忽视始终不显示底色。</span></div>
              <button
                className={`settings-switch ${preferences.showVocabularyBackgrounds ? "is-on" : ""}`}
                type="button"
                role="switch"
                aria-label="显示词汇底色"
                aria-checked={preferences.showVocabularyBackgrounds}
                onClick={() => onChange({ showVocabularyBackgrounds: !preferences.showVocabularyBackgrounds })}
              ><span /></button>
            </div>
            <div className="settings-row">
              <div><strong>显示小中文</strong><span>控制已保存语境释义在英文单词上方的 ruby 小中文；关闭后词汇数据仍保留。</span></div>
              <button
                className={`settings-switch ${preferences.showChineseGlosses ? "is-on" : ""}`}
                type="button"
                role="switch"
                aria-label="显示小中文"
                aria-checked={preferences.showChineseGlosses}
                onClick={() => onChange({ showChineseGlosses: !preferences.showChineseGlosses })}
              ><span /></button>
            </div>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-heading">
            <div><span>Appearance</span><h2>外观与阅读</h2></div>
            <small>选一次主题，书架、对话、阅读和练习同步切换。</small>
          </div>
          <div className="settings-subgroup">
            <div className="settings-label">全局主题</div>
            <div className="segmented-control settings-segmented-control" role="group" aria-label="全局主题">
              {([{ id: "light", label: "浅色" }, { id: "sepia", label: "米白" }, { id: "green", label: "浅绿" }, { id: "dark", label: "深色" }, { id: "system", label: "跟随系统" }] as const).map(preset => <button key={preset.id} data-theme-swatch={preset.id} className={preferences.themePreset === preset.id ? "is-active" : ""} aria-pressed={preferences.themePreset === preset.id} onClick={() => onChange({ themePreset: preset.id })}><span className="theme-swatch" aria-hidden="true" />{preset.label}</button>)}
            </div>
          </div>
          <div className="settings-subgroup">
            <div className="settings-label">字号</div>
            <div className="stepper settings-stepper">
              <button aria-label="全局减小字号" onClick={() => onChange({ fontSize: Math.max(15, preferences.fontSize - 1) })}>A−</button>
              <strong>{preferences.fontSize}px</strong>
              <button aria-label="全局增大字号" onClick={() => onChange({ fontSize: Math.min(24, preferences.fontSize + 1) })}>A＋</button>
            </div>
          </div>
          <div className="settings-subgroup">
            <div className="settings-label">正文字体</div>
            <div className="segmented-control settings-segmented-control">
              <button className={preferences.fontFamily === "serif" ? "is-active" : ""} aria-pressed={preferences.fontFamily === "serif"} onClick={() => onChange({ fontFamily: "serif" })}>衬线</button>
              <button className={preferences.fontFamily === "sans" ? "is-active" : ""} aria-pressed={preferences.fontFamily === "sans"} onClick={() => onChange({ fontFamily: "sans" })}>无衬线</button>
            </div>
          </div>
          <div className="settings-subgroup">
            <div className="settings-label">行距</div>
            <div className="segmented-control settings-segmented-control">
              {(["compact", "standard", "relaxed"] as const).map((lineHeight) => (
                <button key={lineHeight} className={preferences.lineHeight === lineHeight ? "is-active" : ""} aria-pressed={preferences.lineHeight === lineHeight} onClick={() => onChange({ lineHeight })}>
                  {lineHeight === "compact" ? "紧凑" : lineHeight === "standard" ? "标准" : "舒展"}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-subgroup">
            <div className="settings-label">正文宽度</div>
            <div className="segmented-control settings-segmented-control">
              {(["narrow", "medium", "wide"] as const).map((width) => (
                <button key={width} className={preferences.readerWidth === width ? "is-active" : ""} onClick={() => onChange({ readerWidth: width })}>
                  {width === "narrow" ? "窄" : width === "medium" ? "中" : "宽"}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-heading">
            <div><span>Pronunciation</span><h2>发音</h2></div>
            <small>统一控制默认口音，以及点击正文单词时是否自动播放发音。</small>
          </div>
          <div className="settings-subgroup">
            <div className="settings-label">默认发音</div>
            <div className="segmented-control settings-segmented-control">
              <button
                className={preferences.pronunciationAccent === "us" ? "is-active" : ""}
                aria-pressed={preferences.pronunciationAccent === "us"}
                onClick={() => onChange({ pronunciationAccent: "us" })}
              >美式</button>
              <button
                className={preferences.pronunciationAccent === "uk" ? "is-active" : ""}
                aria-pressed={preferences.pronunciationAccent === "uk"}
                onClick={() => onChange({ pronunciationAccent: "uk" })}
              >英式</button>
            </div>
            <p className="settings-help">开启下面的自动发音后，点击单词会使用这里选择的默认口音；需要手动重播或对比另一种口音时，可在“更多”词汇详情中播放。</p>
          </div>
          <div className="settings-subgroup">
            <div className="settings-row">
              <div><strong>点击单词自动发音</strong><span>开启后，点击正文中的英文单词会自动播放上方选择的美式或英式发音；关闭后不会自动发声，仍可在“更多”词汇详情中手动播放。</span></div>
              <button
                className={`settings-switch ${preferences.autoPronounceOnWordClick ? "is-on" : ""}`}
                type="button"
                role="switch"
                aria-label="点击单词自动发音"
                aria-checked={preferences.autoPronounceOnWordClick}
                onClick={() => onChange({ autoPronounceOnWordClick: !preferences.autoPronounceOnWordClick })}
              ><span /></button>
            </div>
          </div>
        </section>

        <DataManagementPanel />

        <AiProviderSettingsPanel />
        <details className="settings-about"><summary>关于 Magazine Reader</summary><p>Reader V0.2 · 本机 EPUB 阅读器</p><p>EPUB 导入已启用，可在期刊与电子书页面导入。支持翻译、查词、笔记和词汇复习；阅读状态保存在当前浏览器。</p></details>
      </div>
    </div>
  );
}

export default function App() {
  const [initialNavigation] = useState(() => loadNavigation(getNavigationStorage()));
  const [navigationReady, setNavigationReady] = useState(!["book", "book-reader", "lesson-reader"].includes(initialNavigation.page));
  const [page, setPage] = useState<Page>(initialNavigation.page === "book-reader" || initialNavigation.page === "lesson-reader" ? "book" : initialNavigation.page);
  const [records, setRecords] = useState<IssueRecord[]>([]);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [bookShelfView, setBookShelfView] = useState<BookShelfView>({ query: "", categoryId: "all" });
  const [assistantOpen, setAssistantOpen] = useState(() => window.matchMedia("(min-width: 1151px)").matches);
  const [readerAssistantOpen, setReaderAssistantOpen] = useState(false);
  const [quietReaderView, setQuietReaderView] = useState(false);
  const readerAssistantContext = useRef<ReaderAssistantContext | null>(null);
  const registerAssistantContext = useCallback((context: ReaderAssistantContext | null) => { readerAssistantContext.current = context; }, []);
  useEffect(() => {
    const breakpoint = window.matchMedia("(min-width: 1151px)");
    const changed = () => { if (!breakpoint.matches) { setAssistantOpen(false); setReaderAssistantOpen(false); } };
    breakpoint.addEventListener("change", changed);
    changed();
    return () => breakpoint.removeEventListener("change", changed);
  }, []);
  const [selectedBookId, setSelectedBookId] = useState(initialNavigation.bookId);
  const [selectedBookLesson, setSelectedBookLesson] = useState<BookLesson | null>(null);
  const [bookLessonRecords, setBookLessonRecords] = useState<BookLesson[]>([]);
  const [newBookLesson, setNewBookLesson] = useState<{ bookId: string; id: string } | null>(null);
  const acknowledgeNewBookLesson = useCallback(() => setNewBookLesson(null), []);
  const [bookLessonsLoading, setBookLessonsLoading] = useState(false);
  const [bookLessonsError, setBookLessonsError] = useState("");
  const [bookLessonsReload, setBookLessonsReload] = useState(0);
  const [lessonReaderState, setLessonReaderState] = useState(() => loadLessonReaderState(getReaderStorage()));
  const [selectedBookRecord, setSelectedBookRecord] = useState<BookRecord | null>(null);
  const [bookTocStatus, setBookTocStatus] = useState<BookTocChineseStatus | null>(null);
  const [bookTocError, setBookTocError] = useState<string | null>(null);
  const [selectedBookChapterId, setSelectedBookChapterId] = useState(initialNavigation.chapterId);
  const [bookLibraryLoading, setBookLibraryLoading] = useState(true);
  const [bookLibraryError, setBookLibraryError] = useState<string | null>(null);
  const [bookDetailLoading, setBookDetailLoading] = useState(false);
  const [bookDetailError, setBookDetailError] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState(initialNavigation.issueId);
  const [selectedArticleId, setSelectedArticleId] = useState(initialNavigation.articleId);
  const [readLaterState, setReadLaterState] = useState<ReadLaterState>(() => loadReadLaterState(getReaderStorage()));
  const [readingHistoryState, setReadingHistoryState] = useState<ReadingHistoryState>(() => loadReadingHistoryState(getReaderStorage()));
  const [notes, setNotes] = useState<ReaderNote[]>(() => loadNotesState(getReaderStorage()).items);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [issueLoadFailures, setIssueLoadFailures] = useState<IssueLoadFailure[]>([]);
  const [readerState, setReaderState] = useState<ReaderStateData>(() => loadReaderState(getReaderStorage()));
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>(() => loadReaderPreferences(getReaderStorage()));
  const systemDark = useSystemDarkMode();
  const effectiveReaderPreferences = useMemo(() => ({ ...readerPreferences, theme: resolveReaderTheme(readerPreferences, systemDark) }), [readerPreferences, systemDark]);
  const appTheme = effectiveReaderPreferences.theme;
  useLayoutEffect(() => {
    document.documentElement.dataset.colorMode = appTheme === "night" ? "dark" : appTheme === "paper" ? "light" : appTheme;
  }, [appTheme]);
  const [readerFocusMode, setReaderFocusMode] = useState(false);
  const [guideStates, setGuideStates] = useState<Record<string, GuideUiState>>({});
  const [guideRequestErrors, setGuideRequestErrors] = useState<Record<string, string>>({});
  const [pendingVocabularyJump, setPendingVocabularyJump] = useState<VocabularyJumpTarget | null>(null);
  const [pendingNoteJump, setPendingNoteJump] = useState<NoteJumpTarget | null>(null);
  const [readerReturnTarget, setReaderReturnTarget] = useState<ReaderReturnTarget | null>(null);
  const [libraryPublicationFilter, setLibraryPublicationFilter] = useState<LibraryPublicationFilter>("all");
  const [librarySearchView, setLibrarySearchView] = useState<LibrarySearchViewState>({ query: "", publicationFilter: "all" });
  const [notesView, setNotesView] = useState<NotesViewState>({ query: "", publicationFilter: "all" });
  const [issueTocView, setIssueTocView] = useState<IssueTocViewState>(() => freshIssueTocViewState());
  const issueTocScrollRef = useRef<{ issueId: string; scrollY: number }>({ issueId: "", scrollY: 0 });
  const [selectedPublicationId, setSelectedPublicationId] = useState<PublicationId>(initialNavigation.publicationId);
  const [globalVocabularyView, setGlobalVocabularyView] = useState<GlobalVocabularyViewState>({
    query: "",
    familiarityFilter: "all",
    publicationFilter: "all",
    expandedKey: null,
    selectedKey: null,
  });
  const guideJobsRef = useRef<Set<string>>(new Set());
  const sectionTranslationJobsRef = useRef<Set<string>>(new Set());
  const bookOpenSequenceRef = useRef(0);
  const vocabularyJumpSequenceRef = useRef(0);
  const noteJumpSequenceRef = useRef(0);

  function clearGuideRequestError(issueId: string) {
    setGuideRequestErrors((current) => {
      if (!(issueId in current)) return current;
      const next = { ...current };
      delete next[issueId];
      return next;
    });
  }

  const readerIssues = useMemo(
    () => records.map((record) => toReaderIssue(record, readerState.progress)),
    [records, readerState.progress],
  );
  const publicationShelf = useMemo(() => buildPublicationShelf(readerIssues), [readerIssues]);
  const selectedIssue = findIssue(readerIssues, selectedIssueId) ?? readerIssues[0];
  const selectedArticle = selectedIssue
    ? flattenArticles(selectedIssue).find((article) => article.id === selectedArticleId) ?? flattenArticles(selectedIssue)[0]
    : undefined;
  const selectedIssueReaderCollection = useMemo(
    () => selectedIssue ? magazineReaderCollection(selectedIssue) : null,
    [selectedIssue],
  );
  const selectedArticleDocument = selectedIssueReaderCollection
    ? selectedIssueReaderCollection.documents.find((document) => document.id === selectedArticleId) ?? selectedIssueReaderCollection.documents[0]
    : undefined;
  const selectedBookReaderCollection = useMemo(
    () => selectedBookRecord ? bookReaderCollection(selectedBookRecord, readerState.bookProgress, bookTocStatus?.titles) : null,
    [selectedBookRecord, readerState.bookProgress, bookTocStatus],
  );
  const selectedBookDocument = selectedBookReaderCollection
    ? selectedBookReaderCollection.documents.find((document) => document.id === selectedBookChapterId) ?? selectedBookReaderCollection.documents[0]
    : undefined;

  const selectedLessonCollection = useMemo(() => selectedBookRecord ? bookLessonReaderCollection(selectedBookRecord, bookLessonRecords, lessonReaderState.progress) : null,
    [selectedBookRecord, bookLessonRecords, lessonReaderState.progress]);
  const selectedLessonDocument = selectedLessonCollection?.documents.find((document) => document.id === selectedBookLesson?.id);
  const globalHistoryItems = readingHistoryState.items.flatMap((entry) => {
    const view = resolveReadingEntry(entry, readerIssues, books, readerState, lessonReaderState);
    return view ? [{ ...view, timestamp: entry.lastOpenedAt }] : [];
  });
  const globalLaterItems = readLaterState.items.flatMap((entry) => {
    const view = resolveReadingEntry(entry, readerIssues, books, readerState, lessonReaderState);
    return view ? [view] : [];
  });
  const latestReadingEntry = readingHistoryState.lastRead ?? readingHistoryState.items[0];
  const latestMagazineReading = [readingHistoryState.lastRead, ...readingHistoryState.items].find((entry) => entry && readingEntryDocument(entry)?.kind === "article");
  const latestBookReading = [readingHistoryState.lastRead, ...readingHistoryState.items].find((entry) => entry && readingEntryDocument(entry)?.kind !== "article");
  const bookContinueEntry: ReadingEntry | undefined = latestBookReading ?? (readerState.lastBookPosition ? { document: bookChapterReadingDocumentIdentity(readerState.lastBookPosition.bookId, readerState.lastBookPosition.chapterId), title: "上次阅读位置" } : undefined);
  const bookContinueDocument = bookContinueEntry ? readingEntryDocument(bookContinueEntry) : null;
  const continueBook = bookContinueDocument && bookContinueDocument.kind !== "article" ? books.find(book => book.id === bookContinueDocument.bookId) : undefined;
  const bookContinue = bookContinueEntry ? resolveReadingEntry(bookContinueEntry, readerIssues, books, readerState, lessonReaderState) : null;

  const magazineContinue = latestMagazineReading ? resolveReadingEntry(latestMagazineReading, readerIssues, books, readerState, lessonReaderState) : null;
  const continueIdentity = latestMagazineReading ? readingEntryDocument(latestMagazineReading) : null;
  const continueIssue = continueIdentity?.kind === "article" ? findIssue(readerIssues, continueIdentity.issueId) : undefined;


  useEffect(() => {
    const document = page === "reader" ? selectedArticleDocument : page === "book-reader" ? selectedBookDocument : page === "lesson-reader" ? selectedLessonDocument : undefined;
    if (!document || (page === "reader" && document.id !== selectedArticleId)) return;
    const entry: ReadingEntry = { document: document.identity, title: document.title, sourceTitle: document.identity.kind === "article" ? selectedIssue?.publicationName : selectedBookRecord?.title,
      ...(document.identity.kind !== "article" ? { sourceFingerprint: selectedBookRecord?.sourceFingerprint } : {}) };
    setReadingHistoryState((current) => {
      const next = recordDocumentHistory(current, entry);
      saveReadingHistoryState(getReaderStorage(), next); return next;
    });
  }, [page, selectedArticleDocument?.identity.documentId, selectedBookDocument?.identity.documentId, selectedLessonDocument?.identity.documentId]);


  useEffect(() => {
    if (!selectedBookRecord) return;
    let active = true;
    const { id, sourceFingerprint } = selectedBookRecord;
    setBookLessonsLoading(true); setBookLessonsError("");
    void fetchBookLessons(id).then((lessons) => {
      if (active) setBookLessonRecords(lessons.filter((lesson) => lesson.bookId === id && lesson.sourceFingerprint === sourceFingerprint));
    }).catch(() => { if (active) setBookLessonsError("暂时无法加载精选阅读，请重试。"); })
      .finally(() => { if (active) setBookLessonsLoading(false); });
    return () => { active = false; };
  }, [selectedBookRecord?.id, selectedBookRecord?.sourceFingerprint, bookLessonsReload]);


  useEffect(() => {
    if (!selectedBookRecord) return;
    let active = true;
    const bookId = selectedBookRecord.id;
    const initialize = async () => {
      try {
        const status = await fetchBookTocChinese(bookId);
        if (!active) return;
        setBookTocStatus(status);
        if (status.state === "idle") {
          try {
            const started = await generateBookTocChinese(bookId);
            if (active) setBookTocStatus(started);
          } catch (error) {
            if (active) setBookTocError(error instanceof Error ? error.message : "中文目录生成不可用");
          }
        }
      } catch (error) {
        if (active) setBookTocError(error instanceof Error ? error.message : "无法读取中文目录");
      }
    };
    void initialize();
    return () => { active = false; };
  }, [selectedBookRecord]);

  useEffect(() => {
    if (!selectedBookRecord || bookTocStatus?.state !== "running") return;
    let active = true;
    const timer = window.setInterval(() => {
      void fetchBookTocChinese(selectedBookRecord.id).then((status) => {
        if (active) setBookTocStatus(status);
      }).catch((error: unknown) => {
        if (active) setBookTocError(error instanceof Error ? error.message : "无法读取中文目录");
      });
    }, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedBookRecord, bookTocStatus?.state]);

  useEffect(() => {
    if (page !== "reader" && page !== "book-reader" && page !== "lesson-reader" && readerFocusMode) setReaderFocusMode(false);
  }, [page, readerFocusMode]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const summaries = await fetchIssues();
        const result = await loadIssueRecords(summaries, fetchIssue);
        const loaded = result.records;
        if (cancelled) return;
        setIssueLoadFailures(result.failures);
        if (!loaded.length) {
          setRecords([]);
          setSelectedIssueId("");
          setSelectedArticleId("");
          setLoadError(null);
          if (["issue", "reader"].includes(initialNavigation.page)) setPage((current) => current === initialNavigation.page ? "library" : current);
          return;
        }
        setRecords(loaded);
        const converted = loaded.map((record) => toReaderIssue(record, readerState.progress));
        const saved = ["issue", "reader"].includes(initialNavigation.page) ? { issueId: initialNavigation.issueId, articleId: initialNavigation.articleId } : readerState.lastPosition;
        const savedIssue = saved ? findIssue(converted, saved.issueId) : undefined;
        const savedArticle = savedIssue && saved
          ? flattenArticles(savedIssue).find((article) => article.id === saved.articleId)
          : undefined;
        const initialIssue = savedIssue ?? converted[0];
        const initialArticle = savedArticle ?? flattenArticles(initialIssue)[0];
        setSelectedIssueId(initialIssue.id);
        if (initialNavigation.page !== "publication") setSelectedPublicationId(initialIssue.publicationId);
        setSelectedArticleId(initialArticle?.id ?? "");
        if (["issue", "reader"].includes(initialNavigation.page) && (!savedIssue || !savedArticle)) setPage((current) => current === initialNavigation.page ? savedIssue ? "issue" : "library" : current);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "读取 EPUB 失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchBooks()
      .then((loaded) => {
        if (cancelled) return;
        setBooks(loaded);
        setBookLibraryError(null);
      })
      .catch((error) => {
        if (!cancelled) setBookLibraryError(error instanceof Error ? error.message : "读取电子书失败");
      })
      .finally(() => {
        if (!cancelled) setBookLibraryLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!["book", "book-reader", "lesson-reader"].includes(initialNavigation.page)) return;
    let active = true;
    const target = initialNavigation.page === "lesson-reader" ? { lessonId: initialNavigation.lessonId }
      : initialNavigation.page === "book-reader" ? { chapterId: initialNavigation.chapterId } : undefined;
    void openBook(initialNavigation.bookId, target).finally(() => { if (active) setNavigationReady(true); });
    return () => { active = false; bookOpenSequenceRef.current += 1; };
  }, []);

  useEffect(() => {
    if (!navigationReady || loading) return;
    saveNavigation({ page, publicationId: selectedPublicationId, issueId: selectedIssueId, articleId: selectedArticleId, bookId: selectedBookId, chapterId: selectedBookChapterId, lessonId: selectedBookLesson?.id ?? "" });
  }, [page, selectedPublicationId, selectedIssueId, selectedArticleId, selectedBookId, selectedBookChapterId, selectedBookLesson?.id, navigationReady, loading]);

  function handleBookDeleted(bookId: string) {
    setBooks((items) => items.filter((book) => book.id !== bookId));
    if (selectedBookId === bookId) {
      bookOpenSequenceRef.current += 1;
      setSelectedBookId("");
      setSelectedBookRecord(null);
      setSelectedBookChapterId("");
      setBookTocStatus(null);
      setBookTocError(null);
    }
  }

  async function refreshBookRecords(): Promise<BookSummary[]> {
    setBookLibraryLoading(true);
    try {
      const loaded = await fetchBooks();
      setBooks(loaded);
      setBookLibraryError(null);
      if (selectedBookId && !loaded.some((book) => book.id === selectedBookId)) {
        bookOpenSequenceRef.current += 1;
        setSelectedBookId("");
        setSelectedBookRecord(null);
        setSelectedBookChapterId("");
        setBookTocStatus(null);
        setBookTocError(null);
      }
      return loaded;
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取电子书失败";
      setBookLibraryError(message);
      throw error;
    } finally {
      setBookLibraryLoading(false);
    }
  }

  async function handleDeleteBookLesson(lesson: BookLesson) {
    const confirmed = window.confirm(`确定删除《${lesson.titleZh}》这篇精选阅读吗？\n\n文章将从本书的精选阅读中移除。笔记、词汇和阅读记录会保留。`);
    if (!confirmed) return;
    await deleteBookLesson(lesson.bookId, lesson.id);
    setBookLessonRecords((current) => current.filter((item) => item.id !== lesson.id));
    setSelectedBookLesson((current) => current?.id === lesson.id ? null : current);
  }

  async function refreshIssueRecords(): Promise<IssueRecord[]> {
    const summaries = await fetchIssues();
    const result = await loadIssueRecords(summaries, fetchIssue);
    const loaded = mergeSearchRefreshedIssues(summaries, records, result.records);
    setIssueLoadFailures(result.failures);
    setRecords(loaded);
    setLoadError(null);
    if (!loaded.length) {
      setSelectedIssueId("");
      setSelectedArticleId("");
      return loaded;
    }
    if (!loaded.some((issue) => issue.id === selectedIssueId)) {
      const fallbackIssue = loaded[0];
      setSelectedIssueId(fallbackIssue.id);
      setSelectedArticleId(fallbackIssue.articles[0]?.id ?? "");
    }
    return loaded;
  }

  async function refreshSearchIssueRecords(): Promise<IssueRecord[]> {
    const summaries = await fetchIssues();
    const refreshIds = searchRefreshIssueIds(summaries, records);
    const result = await loadIssueRecords(summaries.filter((summary) => refreshIds.includes(summary.id)), fetchIssue);
    const refreshed = result.records;
    setIssueLoadFailures(result.failures);
    const loaded = mergeSearchRefreshedIssues(summaries, records, refreshed);
    const recordsChanged = loaded.length !== records.length || loaded.some((issue, index) => issue !== records[index]);
    if (recordsChanged) setRecords(loaded);
    setLoadError(null);
    if (!loaded.length) {
      setSelectedIssueId("");
      setSelectedArticleId("");
      return loaded;
    }
    if (!loaded.some((issue) => issue.id === selectedIssueId)) {
      const fallbackIssue = loaded[0];
      setSelectedIssueId(fallbackIssue.id);
      setSelectedArticleId(fallbackIssue.articles[0]?.id ?? "");
    }
    return loaded;
  }

  async function handleDeleteIssue(issueId: string) {
    await deleteIssue(issueId);
    guideJobsRef.current.delete(issueId);
    sectionTranslationJobsRef.current.delete(issueId);
    clearGuideRequestError(issueId);
    setGuideStates((current) => {
      const next = { ...current };
      delete next[issueId];
      return next;
    });
    const remaining = await refreshIssueRecords();
    if (!remaining.some((issue) => issue.publicationId === selectedPublicationId)) setPage("library");
  }

  async function handleReplaceIssue(issueId: string) {
    guideJobsRef.current.delete(issueId);
    sectionTranslationJobsRef.current.delete(issueId);
    clearGuideRequestError(issueId);
    setGuideStates((current) => {
      const next = { ...current };
      delete next[issueId];
      return next;
    });
    await refreshIssueRecords();
  }

  const updateProgress = useCallback((issueId: string, articleId: string, value: number) => {
    setReaderState((current) => {
      const key = articleKey(issueId, articleId);
      const currentProgress = current.progress[key] ?? 0;
      const nextProgress = Math.max(currentProgress, clampProgress(value));
      const samePosition = current.lastPosition?.issueId === issueId && current.lastPosition.articleId === articleId;
      if (nextProgress === currentProgress && samePosition) return current;
      const next: ReaderStateData = {
        ...current,
        version: 1,
        progress: { ...current.progress, [key]: nextProgress },
        lastPosition: { issueId, articleId },
      };
      saveReaderState(getReaderStorage(), next);
      return next;
    });
  }, []);

  const updateSelectedProgress = useCallback((progress: number) => {
    if (!selectedIssue || !selectedArticle) return;
    updateProgress(selectedIssue.id, selectedArticle.id, progress);
  }, [selectedIssue?.id, selectedArticle?.id, updateProgress]);

  const updateSelectedReadingPosition = useCallback((position: ReadingPositionAnchor) => {
    if (!selectedIssue || !selectedArticle) return;
    setReaderState((current) => {
      const key = readingPositionKey(selectedIssue.id, selectedArticle.id);
      const previous = current.positions[key];
      const samePosition = previous
        && previous.paragraphIndex === position.paragraphIndex
        && previous.paragraphText === position.paragraphText
        && previous.viewportOffset === position.viewportOffset;
      const sameLast = current.lastPosition?.issueId === selectedIssue.id && current.lastPosition.articleId === selectedArticle.id;
      if (samePosition && sameLast) return current;
      const nextPosition: ArticleReadingPosition = { issueId: selectedIssue.id, articleId: selectedArticle.id, ...position };
      const next: ReaderStateData = {
        ...current,
        version: 1,
        positions: { ...current.positions, [key]: nextPosition },
        lastPosition: { issueId: selectedIssue.id, articleId: selectedArticle.id },
      };
      saveReaderState(getReaderStorage(), next);
      return next;
    });
  }, [selectedIssue?.id, selectedArticle?.id]);

  const updateSelectedBookProgress = useCallback((progress: number) => {
    if (!selectedBookDocument || selectedBookDocument.identity.kind !== "book-chapter") return;
    const identity = selectedBookDocument.identity;
    setReaderState((current) => {
      const currentProgress = current.bookProgress[identity.documentId] ?? 0;
      const nextProgress = Math.max(currentProgress, clampProgress(progress));
      const sameLast = current.lastBookPosition?.documentId === identity.documentId;
      if (nextProgress === currentProgress && sameLast) return current;
      const next: ReaderStateData = {
        ...current,
        bookProgress: { ...current.bookProgress, [identity.documentId]: nextProgress },
        lastBookPosition: { documentId: identity.documentId, bookId: identity.bookId, chapterId: identity.chapterId },
      };
      saveReaderState(getReaderStorage(), next);
      return next;
    });
  }, [selectedBookDocument?.identity.documentId]);

  const updateSelectedBookReadingPosition = useCallback((position: ReadingPositionAnchor) => {
    if (!selectedBookDocument || selectedBookDocument.identity.kind !== "book-chapter") return;
    const identity = selectedBookDocument.identity;
    setReaderState((current) => {
      const previous = current.bookPositions[identity.documentId];
      const samePosition = previous
        && previous.paragraphIndex === position.paragraphIndex
        && previous.paragraphText === position.paragraphText
        && previous.viewportOffset === position.viewportOffset;
      const sameLast = current.lastBookPosition?.documentId === identity.documentId;
      if (samePosition && sameLast) return current;
      const nextPosition: BookReadingPosition = { documentId: identity.documentId, bookId: identity.bookId, chapterId: identity.chapterId, ...position };
      const next: ReaderStateData = {
        ...current,
        bookPositions: { ...current.bookPositions, [identity.documentId]: nextPosition },
        lastBookPosition: { documentId: identity.documentId, bookId: identity.bookId, chapterId: identity.chapterId },
      };
      saveReaderState(getReaderStorage(), next);
      return next;
    });
  }, [selectedBookDocument?.identity.documentId]);

  const updateReaderPreferences = useCallback((patch: Partial<ReaderPreferences>) => {
    setReaderPreferences((current) => {
      const next: ReaderPreferences = { ...current, ...patch, version: 1 };
      if (patch.theme) {
        next.themePreset = patch.theme === "night" ? "dark" : patch.theme === "paper" ? "light" : patch.theme;
      }
      next.theme = resolveReaderTheme(next, systemDark);
      saveReaderPreferences(getReaderStorage(), next);
      return next;
    });
  }, [systemDark]);

  const updateSelectedLessonProgress = useCallback((progress: number) => {
    if (!selectedLessonDocument) return;
    const key = selectedLessonDocument.identity.documentId;
    setLessonReaderState((current) => {
      const value = Math.max(current.progress[key] ?? 0, clampProgress(progress));
      if (value === current.progress[key]) return current;
      const next = { ...current, progress: { ...current.progress, [key]: value } };
      saveLessonReaderState(getReaderStorage(), next);
      return next;
    });
  }, [selectedLessonDocument?.identity.documentId]);

  const updateSelectedLessonPosition = useCallback((position: ReadingPositionAnchor) => {
    if (!selectedLessonDocument) return;
    const key = selectedLessonDocument.identity.documentId;
    setLessonReaderState((current) => {
      const old = current.positions[key];
      if (old && old.paragraphIndex === position.paragraphIndex && old.paragraphText === position.paragraphText && old.viewportOffset === position.viewportOffset) return current;
      const next = { ...current, positions: { ...current.positions, [key]: position } };
      saveLessonReaderState(getReaderStorage(), next);
      return next;
    });
  }, [selectedLessonDocument?.identity.documentId]);

  async function prepareSections(issueId: string) {
    if (sectionTranslationJobsRef.current.has(issueId)) return;
    const record = records.find((candidate) => candidate.id === issueId);
    if (!record) return;
    const missing = record.sections.filter((section) => !record.sectionTranslations?.[section]).length;
    if (!missing) return;

    sectionTranslationJobsRef.current.add(issueId);
    try {
      const result = await prepareSectionTranslations(issueId);
      setRecords((current) => current.map((item) => item.id === issueId ? result.issue : item));
    } catch {
      // Unknown sections fall back to English when the local AI provider is unavailable.
    } finally {
      sectionTranslationJobsRef.current.delete(issueId);
    }
  }

  async function prepareGuides(issueId: string) {
    if (guideJobsRef.current.has(issueId)) return;
    const record = records.find((candidate) => candidate.id === issueId);
    if (!record) return;

    clearGuideRequestError(issueId);
    guideJobsRef.current.add(issueId);
    let preparationStarted = false;
    try {
      let status = await resumeGuidePreparation(issueId);
      preparationStarted = true;
      setGuideStates((current) => ({ ...current, [issueId]: status }));
      if (status.state !== "running") {
        const updatedIssue = await fetchIssue(issueId);
        setRecords((current) => current.map((item) => item.id === issueId ? updatedIssue : item));
        return;
      }

      let polls = 0;
      while (status.state === "running" && polls < 600) {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        const previousStatus = status;
        status = await fetchGuidePreparationStatus(issueId);
        if (guidePreparationIssueNeedsRefresh(previousStatus, status)) {
          const updatedIssue = await fetchIssue(issueId);
          setRecords((current) => current.map((item) => item.id === issueId ? updatedIssue : item));
        }
        setGuideStates((current) => ({ ...current, [issueId]: status }));
        polls += 1;
      }
    } catch (error) {
      const requestError = readableGuideRequestError(
        error,
        preparationStarted ? "同步中文导读状态失败" : "启动中文导读失败",
      );
      let authoritativeStatus: GuidePreparationStatus | null = null;
      try {
        authoritativeStatus = await fetchGuidePreparationStatus(issueId);
      } catch {
        // If status reconciliation also fails, keep the best browser-side snapshot without inventing a server error.
      }

      if (authoritativeStatus) {
        setGuideStates((current) => ({ ...current, [issueId]: authoritativeStatus! }));
      } else {
        const completed = record.articles.filter((article) => Boolean(article.readerGuide)).length;
        const sectionCompleted = record.sections.filter((section) => Boolean(record.sectionTranslations?.[section])).length;
        setGuideStates((current) => {
          const previous = current[issueId];
          const state = previous?.state && previous.state !== "running"
            ? previous.state
            : completed === record.articles.length && sectionCompleted === record.sections.length
              ? "complete"
              : completed > 0 || sectionCompleted > 0
                ? "partial"
                : "idle";
          return {
            ...current,
            [issueId]: {
              issueId,
              state,
              total: record.articles.length,
              completed,
              remaining: record.articles.length - completed,
              sectionTotal: record.sections.length,
              sectionCompleted,
              sectionRemaining: record.sections.length - sectionCompleted,
              attemptCount: previous?.attemptCount ?? 0,
              failedArticleIds: previous?.failedArticleIds ?? [],
              lastAttemptAt: previous?.lastAttemptAt ?? null,
              lastCompletedAt: previous?.lastCompletedAt ?? null,
              lastError: previous?.lastError ?? null,
              updatedAt: new Date().toISOString(),
            },
          };
        });
      }
      if (authoritativeStatus?.state === "complete") {
        clearGuideRequestError(issueId);
      } else {
        setGuideRequestErrors((current) => ({
          ...current,
          [issueId]: `${preparationStarted ? "同步中文导读状态失败" : "启动中文导读失败"}：${requestError}`,
        }));
      }
    } finally {
      guideJobsRef.current.delete(issueId);
    }
  }

  async function openBook(bookId: string, target?: { sourceFingerprint?: string; chapterId?: string; lessonId?: string; source?: ReaderReturnTarget; noteId?: string; context?: GlobalVocabularyContext }) {
    const request = ++bookOpenSequenceRef.current;
    setReaderReturnTarget(null);
    setSelectedBookId(bookId);
    setSelectedBookLesson(null);
    setBookLessonRecords([]);
    setSelectedBookRecord(null);
    setBookTocStatus(null);
    setBookTocError(null);
    setBookDetailError(null);
    setBookDetailLoading(true);
    setPage("book");
    try {
      const book = await fetchBook(bookId);
      if (request !== bookOpenSequenceRef.current) return;
      setSelectedBookRecord(book);
      if (target) {
        if (target.sourceFingerprint && target.sourceFingerprint !== book.sourceFingerprint) throw new Error("原书内容已经变更，请从本书目录重新选择。原有学习记录已保留。");
        if (target.lessonId) {
          const lessons = await fetchBookLessons(bookId);
          if (request !== bookOpenSequenceRef.current) return;
          const lesson = lessons.find((entry) => entry.id === target.lessonId && entry.sourceFingerprint === book.sourceFingerprint);
          if (!lesson) throw new Error("这篇精选阅读已不可用，笔记和词汇仍保留。");
          openBookLesson(lesson, lessons, book);
        } else {
          if (!target.chapterId || !book.chapters.some((chapter) => chapter.id === target.chapterId)) throw new Error("原章节已不存在，请从目录重新选择。笔记和词汇仍保留。");
          openBookChapter(target.chapterId, book);
        }
        setReaderReturnTarget(target.source ?? null);
        const identity = target.lessonId ? bookLessonReadingDocumentIdentity(bookId, target.lessonId) : bookChapterReadingDocumentIdentity(bookId, target.chapterId!);
        if (target.noteId) setPendingNoteJump({ token: ++noteJumpSequenceRef.current, documentId: identity.documentId, noteId: target.noteId });
        if (target.context) setPendingVocabularyJump({ token: ++vocabularyJumpSequenceRef.current, documentId: identity.documentId, text: target.context.text, paragraphIndex: target.context.paragraphIndex, startOffset: target.context.startOffset });
      }
    } catch (error) {
      if (request === bookOpenSequenceRef.current) setBookDetailError(error instanceof Error ? error.message : "读取电子书目录失败");
    } finally {
      if (request === bookOpenSequenceRef.current) setBookDetailLoading(false);
    }
  }

  async function regenerateBookToc() {
    if (!selectedBookRecord) return;
    setBookTocError(null);
    try {
      setBookTocStatus(await generateBookTocChinese(selectedBookRecord.id, true));
    } catch (error) {
      setBookTocError(error instanceof Error ? error.message : "中文目录生成不可用");
    }
  }

  function openBookChapter(chapterId: string, book = selectedBookRecord) {
    if (!book) return;
    const collection = bookReaderCollection(book, readerState.bookProgress);
    const document = collection.documents.find((candidate) => candidate.id === chapterId);
    if (!document || document.identity.kind !== "book-chapter") return;
    saveBookDetailTab(book.id, "chapters");
    const identity = document.identity;
    setSelectedBookChapterId(chapterId);
    setSelectedBookLesson(null);
    setPendingVocabularyJump(null);
    setPendingNoteJump(null);
    setReaderFocusMode(false);
    setPage("book-reader");
    setReaderState((current) => {
      const existing = current.bookProgress[identity.documentId] ?? 0;
      const next: ReaderStateData = {
        ...current,
        bookProgress: { ...current.bookProgress, [identity.documentId]: Math.max(existing, 1) },
        lastBookPosition: {
          documentId: identity.documentId,
          bookId: identity.bookId,
          chapterId: identity.chapterId,
        },
      };
      saveReaderState(getReaderStorage(), next);
      return next;
    });
  }

  function openPublication(publicationId: PublicationId) {
    setReaderReturnTarget(null);
    setSelectedPublicationId(publicationId);
    setPage("publication");
  }

  function openBookLesson(lesson: BookLesson, lessons: BookLesson[], book = selectedBookRecord) {
    if (!book || lesson.bookId !== book.id || lesson.sourceFingerprint !== book.sourceFingerprint) return;
    saveBookDetailTab(book.id, "lessons");
    setSelectedBookLesson(lesson);
    setBookLessonRecords(lessons);
    setReaderFocusMode(false);
    setReaderReturnTarget(null);
    setPendingVocabularyJump(null);
    setPendingNoteJump(null);
    setPage("lesson-reader");
    const key = bookLessonReadingDocumentIdentity(book.id, lesson.id).documentId;
    setLessonReaderState((current) => {
      if ((current.progress[key] ?? 0) >= 1) return current;
      const next = { ...current, progress: { ...current.progress, [key]: 1 } };
      saveLessonReaderState(getReaderStorage(), next);
      return next;
    });
  }

  function openIssue(issueId: string) {
    const issue = findIssue(readerIssues, issueId);
    if (!issue) return;
    setReaderReturnTarget(null);
    setSelectedIssueId(issueId);
    setSelectedPublicationId(issue.publicationId);
    setIssueTocView(freshIssueTocViewState(issueId));
    issueTocScrollRef.current = { issueId, scrollY: 0 };
    const continueArticle = resolveIssueContinueArticle(issue, readerState.lastPosition);
    setSelectedArticleId(continueArticle?.id ?? "");
    setPage("issue");
    void prepareSections(issueId);
    void prepareGuides(issueId);
  }

  function openArticle(articleId: string, issueId?: string) {
    const found = findArticle(readerIssues, articleId, issueId) ?? findArticle(readerIssues, articleId);
    if (!found) return;
    setSelectedIssueId(found.issue.id);
    setSelectedPublicationId(found.issue.publicationId);
    setSelectedArticleId(articleId);
    updateProgress(found.issue.id, articleId, Math.max(1, found.article.progress));
    void prepareGuides(found.issue.id);
    void prepareSections(found.issue.id);
    setPage("reader");
  }

  function openArticleFromSource(articleId: string, issueId: string | undefined, source: ReaderReturnSource, detail?: string) {
    setReaderReturnTarget(createReaderReturnTarget(source, detail));
    openArticle(articleId, issueId);
  }

  function openNote(note: ReaderNote) {
    const document = readerNoteDocument(note);
    if (!document) return;
    const source = createReaderReturnTarget("notes");
    if (document.kind === "book-lesson") {
      void openBook(document.bookId, { lessonId: document.lessonId, source, noteId: note.id });
      return;
    }
    if (document.kind === "book-chapter") {
      void openBook(document.bookId, { chapterId: document.chapterId, source, noteId: note.id });
      return;
    }
    setReaderReturnTarget(source);
    setPendingNoteJump({ token: ++noteJumpSequenceRef.current, documentId: document.documentId, noteId: note.id });
    openArticle(document.articleId, document.issueId);
  }

  function openVocabularyContext(context: GlobalVocabularyContext) {
    const document = vocabularyContextDocument(context);
    const source = createReaderReturnTarget("vocabulary", context.text);
    if (document.kind === "book-lesson") {
      void openBook(document.bookId, { lessonId: document.lessonId, source, context });
      return;
    }
    if (document.kind === "book-chapter") {
      void openBook(document.bookId, { chapterId: document.chapterId, source, context });
      return;
    }
    const found = findArticle(readerIssues, document.articleId, document.issueId);
    if (!found) return;
    setReaderReturnTarget(source);
    setPendingVocabularyJump({
      token: ++vocabularyJumpSequenceRef.current,
      documentId: document.documentId,
      text: context.text,
      paragraphIndex: context.paragraphIndex,
      startOffset: context.startOffset,
    });
    openArticle(document.articleId, document.issueId);
  }

  function openReadingEntry(entry: ReadingEntry, source?: ReaderReturnSource) {
    const document = readingEntryDocument(entry);
    if (!document) return;
    if (document.kind === "article") {
      if (!findArticle(readerIssues, document.articleId, document.issueId)) { setPage("history"); return; }
      if (source) openArticleFromSource(document.articleId, document.issueId, source);
      else openArticle(document.articleId, document.issueId);
    } else void openBook(document.bookId, {
      ...(document.kind === "book-lesson" ? { lessonId: document.lessonId } : { chapterId: document.chapterId }),
      sourceFingerprint: entry.sourceFingerprint, source: source ? createReaderReturnTarget(source) : undefined,
    });
  }

  function toggleReadingEntry(entry: ReadingEntry) {
    setReadLaterState((current) => {
      const next = toggleDocumentReadLater(current, entry);
      saveReadLaterState(getReaderStorage(), next); return next;
    });
  }

  function handleToggleReadLater(issueId: string, articleId: string) {
    setReadLaterState((current) => {
      const next = toggleReadLater(current, issueId, articleId);
      saveReadLaterState(getReaderStorage(), next);
      return next;
    });
  }

  function handleClearReadingHistory() {
    if (!window.confirm("确定清空全部阅读历史吗？")) return;
    const next = clearReadingHistory(readingHistoryState);
    saveReadingHistoryState(getReaderStorage(), next);
    setReadingHistoryState(next);
  }

  function handleNotesChange(nextNotes: ReaderNote[]) {
    const next = notesStateFromItems(nextNotes);
    saveNotesState(getReaderStorage(), next);
    setNotes(next.items);
  }

  function handleEditNote(noteId: string, text: string) {
    setNotes((current) => {
      const next = updateNoteText(notesStateFromItems(current), noteId, text);
      saveNotesState(getReaderStorage(), next);
      return next.items;
    });
  }

  function handleDeleteNote(noteId: string) {
    if (!window.confirm("确定删除这条笔记吗？")) return;
    setNotes((current) => {
      const next = removeNoteFromState(notesStateFromItems(current), noteId);
      saveNotesState(getReaderStorage(), next);
      return next.items;
    });
  }

  const savedVocabulary = uniqueVocabularyItems(loadSavedSelections(getReaderStorage()));
  const globalVocabularyCount = savedVocabulary.length;
  const reviewSchedules = loadVocabularyReviewSchedules(getReaderStorage());
  const reviewVocabularyCount = savedVocabulary.filter((item) =>
    isVocabularyReviewDue(reviewSchedules, item.text, savedSelectionFamiliarity(item)),
  ).length;

  const navItems: Array<{ id: Page | "recent"; label: string; icon: string; count?: number }> = [
    { id: "library", label: "期刊", icon: "▦", count: publicationShelf.length },
    { id: "books", label: "电子书", icon: "▥", count: books.length },
    { id: "articles", label: "科普文章", icon: "▤" },
    { id: "recent", label: "最近阅读", icon: "◴" },
    { id: "history", label: "阅读历史", icon: "↶", count: readingHistoryState.items.length },
    { id: "search", label: "搜索", icon: "⌕" },
    { id: "bookmarks", label: "稍后阅读", icon: "☆", count: readLaterState.items.length },
    { id: "vocabulary", label: "词汇", icon: "▤", count: globalVocabularyCount },
    { id: "review", label: "复习", icon: "↻", count: reviewVocabularyCount },
    { id: "notes", label: "笔记", icon: "✎", count: notes.length },
    { id: "settings", label: "设置", icon: "⚙" },
  ];

  function handleNav(id: Page | "recent") {
    setNavigationReady(true);
    bookOpenSequenceRef.current += 1;
    setReaderReturnTarget(null);
    if (id === "recent") {
      if (latestReadingEntry) { openReadingEntry(latestReadingEntry); return; }
      const recent = readerState.lastPosition
        ? findArticle(readerIssues, readerState.lastPosition.articleId, readerState.lastPosition.issueId)
        : undefined;
      const fallbackIssue = readerIssues[0];
      const fallbackArticle = fallbackIssue ? flattenArticles(fallbackIssue)[0] : undefined;
      if (recent) openArticle(recent.article.id, recent.issue.id);
      else if (fallbackIssue && fallbackArticle) openArticle(fallbackArticle.id, fallbackIssue.id);
      else setPage("library");
    } else {
      setPage(id);
      if (id === "search") void refreshSearchIssueRecords().catch(() => undefined);
      if (id === "books") void refreshBookRecords().catch(() => undefined);
    }
  }

  const isReaderPage = ["reader", "book-reader", "lesson-reader"].includes(page);
  const assistantVisible = (isReaderPage ? readerAssistantOpen && !readerFocusMode && !quietReaderView : assistantOpen);
  const toggleAssistant = () => isReaderPage ? setReaderAssistantOpen(value => !value) : setAssistantOpen(value => !value);
  const closeAssistant = () => { if (isReaderPage) setReaderAssistantOpen(false); else setAssistantOpen(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.global-nav-assistant')?.focus()); };
  let assistantScope: AssistantScope = { kind: "all" };
  let assistantLabel = "全部书刊";
  if (page === "books") { assistantScope = { kind: "books" }; assistantLabel = "电子书书架"; }
  else if (page === "library") { assistantScope = { kind: "magazines" }; assistantLabel = "期刊书架"; }
  else if (page === "publication") { assistantScope = { kind: "publication", publicationId: selectedPublicationId }; assistantLabel = PUBLICATIONS[selectedPublicationId].name; }
  else if (page === "issue" && selectedIssue) { assistantScope = { kind: "issue", issueId: selectedIssue.id }; assistantLabel = `${selectedIssue.publicationName} · ${selectedIssue.label}`; }
  else if (page === "reader" && selectedIssue && selectedArticle) { assistantScope = { kind: "article", issueId: selectedIssue.id, articleId: selectedArticle.id }; assistantLabel = selectedArticle.title; }
  else if (page === "book-reader" && selectedBookDocument?.identity.kind === "book-chapter") { assistantScope = { kind: "chapter", bookId: selectedBookDocument.identity.bookId, chapterId: selectedBookDocument.identity.chapterId }; assistantLabel = selectedBookDocument.title; }
  else if (page === "lesson-reader" && selectedBookLesson) { assistantScope = { kind: "lesson", bookId: selectedBookLesson.bookId, lessonId: selectedBookLesson.id }; assistantLabel = selectedBookLesson.titleZh; }
  const assistantPanel = !assistantVisible ? undefined : page === "book" ? selectedBookRecord && !bookDetailLoading && !bookDetailError ? <CodexPrepPanel key={`book:${selectedBookRecord.id}:${selectedBookRecord.sourceFingerprint}`} book={selectedBookRecord} lessons={bookLessonRecords} onClose={closeAssistant} scopeLabel={selectedBookRecord.title} onLessonSaved={lesson => {
    setBookLessonRecords(current => [lesson, ...current.filter(item => item.id !== lesson.id)]);
    setNewBookLesson({ bookId: lesson.bookId, id: lesson.id });
    saveBookDetailTab(lesson.bookId, "lessons");
  }} onOpenLesson={openBookLesson} /> : undefined : <CodexPrepPanel key={JSON.stringify(assistantScope)} scope={assistantScope} scopeLabel={assistantLabel} onClose={closeAssistant}
    readerContext={isReaderPage ? { current: () => readerAssistantContext.current } : undefined} />;
  const readerNavigation = <GlobalNavigation items={navItems} page={page} loading={loading} onNavigate={handleNav} assistantOpen={assistantVisible} onToggleAssistant={toggleAssistant} compact />;

  return (
    <AppAppearanceContext.Provider value={appTheme === "night" ? "dark" : appTheme === "paper" ? "light" : appTheme}>
    <div className={`app-shell theme-${appTheme} ${(page === "reader" || page === "book-reader" || page === "lesson-reader") && readerFocusMode ? "is-reader-focus" : ""}`} data-theme={appTheme} data-reader-focus={(page === "reader" || page === "book-reader" || page === "lesson-reader") && readerFocusMode}>
      {!isReaderPage && <GlobalNavigation items={navItems} page={page} loading={loading} onNavigate={handleNav} assistantOpen={assistantVisible} onToggleAssistant={toggleAssistant} />}

      <main className={`main-panel ${page === "reader" || page === "book-reader" || page === "lesson-reader" ? "reader-mode" : ""}`}>
        <BookPrepLayout global reader={isReaderPage} prep={assistantPanel}><div className="global-page-content">
        {(page === "library" || page === "publication" || page === "issue" || page === "search") && (loadError || issueLoadFailures.length > 0) && (
          <section className="empty-panel" role="alert" data-testid="issue-load-warning">
            <strong>{loadError ? "期刊列表暂时无法读取" : "部分期刊未能读取，其余内容可继续使用"}</strong>
            <p>{loadError ?? issueLoadFailures.map((failure) => failure.label).join("；")}</p>
            <button className="primary-button" disabled={loading} onClick={() => {
              setLoading(true);
              void refreshIssueRecords().catch((error: unknown) => setLoadError(error instanceof Error ? error.message : "读取失败")).finally(() => setLoading(false));
            }}>{loading ? "正在重试…" : "重试读取期刊"}</button>
          </section>
        )}
        {loading && page === "library" && <p role="status">正在读取本地 EPUB…</p>}

        {page !== "reader" && page !== "book-reader" && page !== "lesson-reader" && (
            <div className="topbar-title">{page === "library" ? "期刊" : page === "publication" ? PUBLICATIONS[selectedPublicationId].name : page === "issue" ? selectedIssue?.label ?? "期刊" : page === "books" || page === "book" ? "电子书" : page === "articles" ? "科普文章" : page === "search" ? "搜索" : page === "bookmarks" ? "稍后阅读" : page === "history" ? "阅读历史" : page === "vocabulary" ? "Vocabulary" : page === "review" ? "Review" : page === "settings" ? "Settings" : "Notes"}</div>
        )}

        {page === "library" && (
          <LibraryPage
            issues={readerIssues}
            lastPosition={readerState.lastPosition}
            continueCard={magazineContinue ? <GlobalContinueCard item={magazineContinue} onOpen={openReadingEntry} cover={continueIssue ? <IssueCover issue={continueIssue} compact preferReal /> : undefined} /> : undefined}
            publicationFilter={libraryPublicationFilter}
            onPublicationFilterChange={setLibraryPublicationFilter}
            onOpenPublication={openPublication}
            onContinue={(issueId, articleId) => { setReaderReturnTarget(null); openArticle(articleId, issueId); }}
            onImported={() => refreshIssueRecords().then(() => undefined)}
          />
        )}
        {page === "publication" && <PublicationIssuesPage issues={readerIssues} publicationId={selectedPublicationId} onBack={() => setPage("library")} onOpenIssue={openIssue} onDeleteIssue={handleDeleteIssue} onReplaceIssue={handleReplaceIssue} />}
        {page === "books" && <BookLibraryPage view={bookShelfView} onViewChange={setBookShelfView} onDeleted={handleBookDeleted} continueCard={continueBook && bookContinue ? <BookContinueCard key={bookContinue.key} book={continueBook} item={bookContinue} onContinue={() => openReadingEntry(bookContinue.entry)} /> : undefined} books={books} loading={bookLibraryLoading} error={bookLibraryError} onOpenBook={(bookId) => { void openBook(bookId); }} onImported={() => refreshBookRecords().then(() => undefined)} />}
        {page === "articles" && <ScienceArticleLibraryPage />}
        {page === "book" && <BookDetailPage lessonCount={selectedLessonCollection?.documents.length ?? 0} lessonsLoading={bookLessonsLoading} lessonsSection={<BookLessonsList
          documents={selectedLessonCollection?.documents ?? []} loading={bookLessonsLoading} error={bookLessonsError}
          newLessonId={newBookLesson?.bookId === selectedBookRecord?.id ? newBookLesson?.id : undefined} onHighlightShown={acknowledgeNewBookLesson}
          onRetry={() => setBookLessonsReload((value) => value + 1)}
          onOpen={(id) => { const lesson = bookLessonRecords.find(entry => entry.id === id); if (lesson) openBookLesson(lesson, bookLessonRecords); }}
          onDelete={(id) => { const lesson = bookLessonRecords.find(entry => entry.id === id); if (lesson) void handleDeleteBookLesson(lesson).catch(error => window.alert(error instanceof Error ? error.message : "删除精选阅读失败")); }}
        />} readerState={readerState} book={selectedBookRecord} loading={bookDetailLoading} error={bookDetailError} tocStatus={bookTocStatus} tocError={bookTocError} onRegenerate={() => { void regenerateBookToc(); }} onBack={() => { bookOpenSequenceRef.current += 1; setPage("books"); }} onOpenChapter={openBookChapter} />}
        {page === "issue" && selectedIssue && (
          <IssuePage
            issue={selectedIssue}
            readLaterState={readLaterState}
            guideState={guideStates[selectedIssue.id]}
            guideRequestError={guideRequestErrors[selectedIssue.id]}
            lastPosition={readerState.lastPosition}
            viewState={issueTocView}
            restoreScrollY={issueTocScrollRef.current.issueId === selectedIssue.id ? issueTocScrollRef.current.scrollY : 0}
            onViewStateChange={setIssueTocView}
            onBack={() => { setSelectedPublicationId(selectedIssue.publicationId); setPage("publication"); }}
            onOpenArticle={(articleId, scrollY) => {
              issueTocScrollRef.current = { issueId: selectedIssue.id, scrollY };
              setReaderReturnTarget(null);
              openArticle(articleId, selectedIssue.id);
            }}
            onToggleReadLater={(articleId) => handleToggleReadLater(selectedIssue.id, articleId)}
            onRetryGuides={() => void prepareGuides(selectedIssue.id)}
          />
        )}
        {page === "reader" && selectedIssue && selectedArticle && selectedIssueReaderCollection && selectedArticleDocument && (
          <ReaderPage
            globalNavigation={readerNavigation}
            onQuietViewChange={setQuietReaderView}
            onAssistantContext={registerAssistantContext}
            issue={selectedIssueReaderCollection}
            article={selectedArticleDocument}
            readLaterState={readLaterState}
            notes={notes}
            preferences={effectiveReaderPreferences}
            focusMode={readerFocusMode}
            onFocusModeChange={setReaderFocusMode}
            onBack={() => {
              setReaderFocusMode(false);
              setReaderReturnTarget(null);
              setIssueTocView((current) => current.issueId === selectedIssue.id ? current : freshIssueTocViewState(selectedIssue.id));
              setPage("issue");
            }}
            onOpenArticle={(articleId) => openArticle(articleId, selectedIssue.id)}
            onToggleReadLater={(articleId) => handleToggleReadLater(selectedIssue.id, articleId)}
            onNotesChange={handleNotesChange}
            onEditNote={handleEditNote}
            onDeleteNote={handleDeleteNote}
            onProgressChange={updateSelectedProgress}
            readingPosition={readerState.positions[readingPositionKey(selectedIssue.id, selectedArticle.id)]}
            onReadingPositionChange={updateSelectedReadingPosition}
            vocabularyJump={pendingVocabularyJump}
            onConsumeVocabularyJump={(token) => setPendingVocabularyJump((current) => current?.token === token ? null : current)}
            noteJump={pendingNoteJump}
            onConsumeNoteJump={(token) => setPendingNoteJump((current) => current?.token === token ? null : current)}
            readerReturnTarget={readerReturnTarget}
            onReturnToSource={() => {
              if (!readerReturnTarget) return;
              setReaderFocusMode(false);
              const targetPage = readerReturnTarget.page;
              setReaderReturnTarget(null);
              setPage(targetPage);
            }}
          />
        )}
        {page === "lesson-reader" && selectedLessonCollection && selectedLessonDocument && selectedBookLesson && (
          <LessonLearning key={JSON.stringify(selectedBookLesson)} lesson={selectedBookLesson}>
          {openLearning => <ReaderPage
            globalNavigation={readerNavigation}
            onQuietViewChange={setQuietReaderView}
            onAssistantContext={registerAssistantContext}
            issue={selectedLessonCollection} article={selectedLessonDocument}
            readLaterState={readLaterState} notes={notes} preferences={effectiveReaderPreferences}
            onOpenLearning={openLearning}
            focusMode={readerFocusMode} onFocusModeChange={setReaderFocusMode}
            onBack={() => { setReaderFocusMode(false); setReaderReturnTarget(null); setPage("book"); }}
            onOpenArticle={(id) => { const lesson = bookLessonRecords.find((entry) => entry.id === id); if (lesson) openBookLesson(lesson, bookLessonRecords); }}
            onToggleReadLater={() => { if (selectedLessonDocument) toggleReadingEntry({ document: selectedLessonDocument.identity, title: selectedLessonDocument.title, sourceTitle: selectedBookRecord?.title, sourceFingerprint: selectedBookRecord?.sourceFingerprint }); }}
            onNotesChange={handleNotesChange} onEditNote={handleEditNote} onDeleteNote={handleDeleteNote}
            onProgressChange={updateSelectedLessonProgress}
            readingPosition={lessonReaderState.positions[selectedLessonDocument.identity.documentId]}
            onReadingPositionChange={updateSelectedLessonPosition}
            vocabularyJump={pendingVocabularyJump}
            onConsumeVocabularyJump={(token) => setPendingVocabularyJump((current) => current?.token === token ? null : current)}
            noteJump={pendingNoteJump}
            onConsumeNoteJump={(token) => setPendingNoteJump((current) => current?.token === token ? null : current)}
            readerReturnTarget={readerReturnTarget}
            onReturnToSource={() => { if (readerReturnTarget) { setReaderFocusMode(false); setPage(readerReturnTarget.page); setReaderReturnTarget(null); } }}
          />}
          </LessonLearning>
        )}
        {page === "book-reader" && selectedBookReaderCollection && selectedBookDocument && (
          <ReaderPage
            globalNavigation={readerNavigation}
            onQuietViewChange={setQuietReaderView}
            onAssistantContext={registerAssistantContext}
            issue={selectedBookReaderCollection}
            article={selectedBookDocument}
            readLaterState={readLaterState}
            notes={notes}
            preferences={effectiveReaderPreferences}
            focusMode={readerFocusMode}
            onFocusModeChange={setReaderFocusMode}
            onBack={() => { setReaderFocusMode(false); setReaderReturnTarget(null); setPage("book"); }}
            onOpenArticle={openBookChapter}
            onToggleReadLater={() => { if (selectedBookDocument) toggleReadingEntry({ document: selectedBookDocument.identity, title: selectedBookDocument.title, sourceTitle: selectedBookRecord?.title, sourceFingerprint: selectedBookRecord?.sourceFingerprint }); }}
            onNotesChange={handleNotesChange}
            onEditNote={handleEditNote}
            onDeleteNote={handleDeleteNote}
            onProgressChange={updateSelectedBookProgress}
            readingPosition={selectedBookDocument.identity.kind === "book-chapter" ? readerState.bookPositions[selectedBookDocument.identity.documentId] : undefined}
            onReadingPositionChange={updateSelectedBookReadingPosition}
            vocabularyJump={pendingVocabularyJump}
            onConsumeVocabularyJump={(token) => setPendingVocabularyJump((current) => current?.token === token ? null : current)}
            noteJump={pendingNoteJump}
            onConsumeNoteJump={(token) => setPendingNoteJump((current) => current?.token === token ? null : current)}
            readerReturnTarget={readerReturnTarget}
            onReturnToSource={() => { if (readerReturnTarget) { setReaderFocusMode(false); setPage(readerReturnTarget.page); setReaderReturnTarget(null); } }}
          />
        )}
        {page === "search" && <SearchPage books={books} onOpenReading={(entry) => openReadingEntry(entry, "search")} onToggleReading={toggleReadingEntry} issues={readerIssues} viewState={librarySearchView} readLaterState={readLaterState} onViewStateChange={setLibrarySearchView} onOpenArticle={(articleId, issueId) => openArticleFromSource(articleId, issueId, "search")} onToggleReadLater={handleToggleReadLater} />}
        {page === "bookmarks" && <ReadLaterPage items={globalLaterItems} onOpen={(entry) => openReadingEntry(entry, "bookmarks")} onRemove={toggleReadingEntry} />}
        {page === "history" && <ReadingHistoryPage items={globalHistoryItems} onOpen={(entry) => openReadingEntry(entry, "history")} onClear={handleClearReadingHistory} />}
        {page === "vocabulary" && (
          <GlobalVocabularyPage
            issues={readerIssues}
            books={books}
            onOpenContext={openVocabularyContext}
            onStartReview={() => setPage("review")}
            viewState={globalVocabularyView}
            onViewStateChange={setGlobalVocabularyView}
          />
        )}
        {page === "notes" && <NotesPage books={books} issues={readerIssues} notes={notes} viewState={notesView} onViewStateChange={setNotesView} onOpenNote={openNote} onEditNote={handleEditNote} onDeleteNote={handleDeleteNote} />}
        {page === "review" && <VocabularyReviewPage books={books} issues={readerIssues} onOpenVocabulary={() => setPage("vocabulary")} />}
        {page === "settings" && <SettingsPage preferences={readerPreferences} onChange={updateReaderPreferences} />}
        </div></BookPrepLayout>
      </main>
    </div>
    </AppAppearanceContext.Provider>
  );
}
