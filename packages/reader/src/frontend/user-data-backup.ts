import { LEARNING_GAME_PREFERENCES_KEY, validGamePreferences } from "./learning-game-preferences";
import { CHINESE_LISTENING_KEY, loadChineseListeningRecords } from "./chinese-listening-state";
import { LEARNING_ACTIVE_KEY, LEARNING_PROGRESS_KEY, loadLearningProgress } from "./learning-state";
import { LESSON_READER_STATE_KEY } from "./lesson-reader-state";
import { normalizeReadingEntry } from "./reading-entry";
import { NOTES_STATE_KEY } from "./notes-state";
import { PARAGRAPH_TRANSLATIONS_KEY } from "./paragraph-translation-state";
import { READ_LATER_STATE_KEY } from "./read-later-state";
import { READER_PREFERENCES_KEY } from "./reader-preferences";
import { READER_STATE_KEY } from "./reader-state";
import { READING_HISTORY_STATE_KEY } from "./reading-history-state";
import { READING_ASSISTANT_CACHE_KEY } from "./reading-assistant-cache";
import { SAVED_SELECTIONS_KEY } from "./selection-state";
import { SELECTION_ASSIST_CACHE_KEY } from "./selection-assist-cache";
import { SENTENCE_TRANSLATIONS_KEY } from "./sentence-translation-state";
import { VOCABULARY_REVIEW_SCHEDULE_KEY } from "./vocabulary-review-schedule";
import { WORD_CONTEXT_MEANINGS_KEY } from "./word-context-state";

import { loadNotesState } from "./notes-state";
import { loadReadLaterState } from "./read-later-state";
import { loadReadingHistoryState } from "./reading-history-state";
import { loadSavedSelections } from "./selection-state";
import { loadWordContextMeanings } from "./word-context-state";
import { loadVocabularyReviewSchedules } from "./vocabulary-review-schedule";
import { loadParagraphTranslations } from "./paragraph-translation-state";
import { loadSentenceTranslations } from "./sentence-translation-state";
import { loadSelectionAssistCache } from "./selection-assist-cache";
import { loadReadingAssistantCache } from "./reading-assistant-cache";

interface BackupStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type BackupValueShape = "reader-state" | "lesson-state" | "preferences" | "versioned-items" | "records";

export interface UserDataBackupEntryDefinition {
  key: string;
  label: string;
  shape: BackupValueShape;
}

export interface UserDataBackupV1 {
  app: "magazine-reader";
  version: 1;
  exportedAt: string;
  data: Record<string, unknown>;
}

export interface UserDataBackupSummaryEntry {
  key: string;
  label: string;
  count: number;
}

export interface UserDataBackupSummary {
  exportedAt: string;
  categoryCount: number;
  entries: UserDataBackupSummaryEntry[];
}

export const USER_DATA_BACKUP_ENTRIES: readonly UserDataBackupEntryDefinition[] = [
  { key: CHINESE_LISTENING_KEY, label: "中文听书位置与语速", shape: "records" },
  { key: LEARNING_GAME_PREFERENCES_KEY, label: "学习游戏声音与外观", shape: "preferences" },
  { key: LEARNING_PROGRESS_KEY, label: "学习练习进度与结果", shape: "versioned-items" },
  { key: READER_STATE_KEY, label: "阅读进度与位置", shape: "reader-state" },
  { key: LESSON_READER_STATE_KEY, label: "精选阅读进度与位置", shape: "lesson-state" },
  { key: READER_PREFERENCES_KEY, label: "阅读偏好", shape: "preferences" },
  { key: READ_LATER_STATE_KEY, label: "稍后阅读", shape: "versioned-items" },
  { key: READING_HISTORY_STATE_KEY, label: "阅读历史", shape: "versioned-items" },
  { key: NOTES_STATE_KEY, label: "笔记", shape: "versioned-items" },
  { key: SAVED_SELECTIONS_KEY, label: "词汇与熟悉度", shape: "records" },
  { key: WORD_CONTEXT_MEANINGS_KEY, label: "词汇语境释义", shape: "records" },
  { key: VOCABULARY_REVIEW_SCHEDULE_KEY, label: "词汇复习日程", shape: "records" },
  { key: PARAGRAPH_TRANSLATIONS_KEY, label: "段落翻译缓存", shape: "records" },
  { key: SENTENCE_TRANSLATIONS_KEY, label: "句子翻译缓存", shape: "records" },
  { key: SELECTION_ASSIST_CACHE_KEY, label: "选区翻译与解释缓存", shape: "records" },
  { key: READING_ASSISTANT_CACHE_KEY, label: "AI 阅读助手固定问题缓存", shape: "records" },
] as const;

export const USER_DATA_STORAGE_KEYS = USER_DATA_BACKUP_ENTRIES.map((entry) => entry.key);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordsAreObjects(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => isObject(item));
}

const recordLoaders: Record<string, (storage: Pick<BackupStorage, "getItem">) => unknown[]> = {
  [CHINESE_LISTENING_KEY]: loadChineseListeningRecords,
  [LEARNING_PROGRESS_KEY]: loadLearningProgress,
  [NOTES_STATE_KEY]: (storage) => loadNotesState(storage).items,
  [READ_LATER_STATE_KEY]: (storage) => loadReadLaterState(storage).items,
  [READING_HISTORY_STATE_KEY]: (storage) => loadReadingHistoryState(storage).items,
  [SAVED_SELECTIONS_KEY]: loadSavedSelections,
  [WORD_CONTEXT_MEANINGS_KEY]: loadWordContextMeanings,
  [VOCABULARY_REVIEW_SCHEDULE_KEY]: loadVocabularyReviewSchedules,
  [PARAGRAPH_TRANSLATIONS_KEY]: loadParagraphTranslations,
  [SENTENCE_TRANSLATIONS_KEY]: loadSentenceTranslations,
  [SELECTION_ASSIST_CACHE_KEY]: loadSelectionAssistCache,
  [READING_ASSISTANT_CACHE_KEY]: loadReadingAssistantCache,
};

const nonempty = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());
const nonnegativeInteger = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 0;
const validDate = (value: unknown): boolean => typeof value === "string" && Number.isFinite(Date.parse(value));
const articleIdentity = (value: unknown): boolean => isObject(value) && nonempty(value.issueId) && nonempty(value.articleId);
const bookIdentity = (value: unknown): boolean => isObject(value) && nonempty(value.bookId) && nonempty(value.chapterId)
  && value.documentId === `reading:book:${value.bookId}:${value.chapterId}`;
const positionAnchor = (value: unknown): boolean => isObject(value) && nonnegativeInteger(value.paragraphIndex)
  && nonempty(value.paragraphText) && typeof value.viewportOffset === "number" && Number.isFinite(value.viewportOffset);
const progressMap = (value: unknown): boolean => isObject(value) && Object.entries(value).every(([key, progress]) =>
  nonempty(key) && typeof progress === "number" && Number.isFinite(progress) && progress >= 0 && progress <= 100);
const optionalMap = (value: unknown, predicate: (item: unknown) => boolean): boolean =>
  value === undefined || (isObject(value) && Object.values(value).every(predicate));

function validNoteAnchor(value: unknown): boolean {
  if (!isObject(value) || !nonnegativeInteger(value.paragraphIndex) || !nonempty(value.paragraphText)) return false;
  if (value.kind === "paragraph") return true;
  return value.kind === "selection" && nonnegativeInteger(value.startOffset) && nonnegativeInteger(value.endOffset)
    && (value.endOffset as number) > (value.startOffset as number)
    && (value.endOffset as number) <= value.paragraphText.length && nonempty(value.selectedText)
    && value.paragraphText.slice(value.startOffset as number, value.endOffset as number) === value.selectedText;
}

function validRecords(entry: UserDataBackupEntryDefinition, value: unknown): boolean {
  const items = entry.shape === "versioned-items" && isObject(value) ? value.items : value;
  if (!recordsAreObjects(items)) return false;
  if (entry.shape === "versioned-items" && (!isObject(value) || value.version !== 1)) return false;
  if (entry.key === READING_HISTORY_STATE_KEY && isObject(value) && value.lastRead !== undefined) {
    const last = value.lastRead;
    if (!isObject(last) || !normalizeReadingEntry(last) || !validDate(last.lastOpenedAt)) return false;
  }
  const loader = recordLoaders[entry.key];
  if (!loader) return false;
  // Use the actual readers: a preview must never count records that loading will discard.
  const storage = { getItem: (key: string) => key === entry.key ? JSON.stringify(value) : null };
  if (loader(storage).length !== (items as unknown[]).length) return false;
  return (items as Record<string, unknown>[]).every((item) => {
    for (const field of ["createdAt", "savedAt", "lastOpenedAt", "generatedAt", "lastReviewedAt", "dueAt", "editedAt"]) {
      if (item[field] !== undefined && !validDate(item[field])) return false;
    }
    for (const field of ["paragraphIndex", "startOffset", "headingIndex", "reviewCount"]) {
      if (item[field] !== undefined && !nonnegativeInteger(item[field])) return false;
    }
    if (item.intervalDays !== undefined && (typeof item.intervalDays !== "number" || !Number.isFinite(item.intervalDays) || item.intervalDays <= 0)) return false;
    if (entry.key === NOTES_STATE_KEY && item.anchor !== undefined && !validNoteAnchor(item.anchor)) return false;
    return true;
  });
}

function validBackupValue(entry: UserDataBackupEntryDefinition, value: unknown): boolean {
  if (entry.key === LEARNING_GAME_PREFERENCES_KEY) return validGamePreferences(value);
  if (entry.shape === "records" || entry.shape === "versioned-items") return validRecords(entry, value);
  if (!isObject(value)) return false;
  if (entry.shape === "lesson-state") {
    return value.version === 1 && progressMap(value.progress)
      && Object.keys(value.progress as object).every((key) => key.startsWith("reading:lesson:"))
      && optionalMap(value.positions, positionAnchor)
      && (value.positions === undefined || Object.keys(value.positions as object).every((key) => key.startsWith("reading:lesson:")));
  }
  if (entry.shape === "reader-state") {
    return value.version === 1 && progressMap(value.progress)
      && (value.lastPosition === undefined || value.lastPosition === null || articleIdentity(value.lastPosition))
      && optionalMap(value.positions, (item) => articleIdentity(item) && positionAnchor(item))
      && (value.bookProgress === undefined || (progressMap(value.bookProgress) && Object.keys(value.bookProgress as object).every((key) => key.startsWith("reading:book:"))))
      && (value.lastBookPosition === undefined || value.lastBookPosition === null || bookIdentity(value.lastBookPosition))
      && optionalMap(value.bookPositions, (item) => bookIdentity(item) && positionAnchor(item));
  }
  return (value.version === undefined || value.version === 1)
    && (value.theme === undefined || value.theme === "paper" || value.theme === "sepia" || value.theme === "green" || value.theme === "night")
    && (value.themePreset === undefined || ["light", "sepia", "green", "dark", "system"].includes(value.themePreset as string))
    && (value.colorMode === undefined || value.colorMode === "light" || value.colorMode === "dark" || value.colorMode === "system")
    && (value.readingBackground === undefined || value.readingBackground === "paper" || value.readingBackground === "sepia")
    && (value.fontSize === undefined || (typeof value.fontSize === "number" && Number.isInteger(value.fontSize) && value.fontSize >= 15 && value.fontSize <= 24))
    && (value.readerWidth === undefined || value.readerWidth === "narrow" || value.readerWidth === "medium" || value.readerWidth === "wide")
    && (value.fontFamily === undefined || value.fontFamily === "serif" || value.fontFamily === "sans")
    && (value.lineHeight === undefined || value.lineHeight === "compact" || value.lineHeight === "standard" || value.lineHeight === "relaxed")
    && (value.showVocabularyBackgrounds === undefined || typeof value.showVocabularyBackgrounds === "boolean")
    && (value.showChineseGlosses === undefined || typeof value.showChineseGlosses === "boolean")
    && (value.pronunciationAccent === undefined || value.pronunciationAccent === "us" || value.pronunciationAccent === "uk")
    && (value.autoPronounceOnWordClick === undefined || typeof value.autoPronounceOnWordClick === "boolean");
}

function countBackupValue(entry: UserDataBackupEntryDefinition, value: unknown): number {
  if (entry.shape === "records") return Array.isArray(value) ? value.length : 0;
  if (!isObject(value)) return 0;
  if (entry.shape === "versioned-items") return Array.isArray(value.items) ? value.items.length : 0;
  if (entry.shape === "reader-state" || entry.shape === "lesson-state") {
    const keys = new Set<string>();
    if (isObject(value.progress)) Object.keys(value.progress).forEach((key) => keys.add(key));
    if (isObject(value.positions)) Object.keys(value.positions).forEach((key) => keys.add(key));
    if (isObject(value.bookProgress)) Object.keys(value.bookProgress).forEach((key) => keys.add(key));
    if (isObject(value.bookPositions)) Object.keys(value.bookPositions).forEach((key) => keys.add(key));
    return keys.size;
  }
  return 1;
}

function validateBackupObject(value: unknown): UserDataBackupV1 {
  if (!isObject(value) || value.app !== "magazine-reader" || value.version !== 1) {
    throw new Error("这不是受支持的 Magazine Reader 备份文件。");
  }
  if (typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt))) {
    throw new Error("备份文件缺少有效的导出时间。");
  }
  if (!isObject(value.data)) throw new Error("备份文件的数据区格式不正确。");

  const definitions = new Map(USER_DATA_BACKUP_ENTRIES.map((entry) => [entry.key, entry]));
  for (const [key, storedValue] of Object.entries(value.data)) {
    const entry = definitions.get(key);
    if (!entry) throw new Error(`备份文件包含未知数据项：${key}`);
    if (!validBackupValue(entry, storedValue)) throw new Error(`备份中的“${entry.label}”格式不正确。`);
  }

  return value as unknown as UserDataBackupV1;
}

export function buildUserDataBackup(storage: Pick<BackupStorage, "getItem">, now = new Date()): UserDataBackupV1 {
  const data: Record<string, unknown> = {};
  for (const entry of USER_DATA_BACKUP_ENTRIES) {
    const raw = storage.getItem(entry.key);
    if (raw === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`当前浏览器中的“${entry.label}”数据已损坏，无法安全导出。`);
    }
    if (!validBackupValue(entry, parsed)) {
      throw new Error(`当前浏览器中的“${entry.label}”格式异常，无法安全导出。`);
    }
    data[entry.key] = parsed;
  }
  return {
    app: "magazine-reader",
    version: 1,
    exportedAt: now.toISOString(),
    data,
  };
}

export function parseUserDataBackup(text: string): UserDataBackupV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("备份文件不是有效的 JSON。");
  }
  return validateBackupObject(parsed);
}

export function summarizeUserDataBackup(backup: UserDataBackupV1): UserDataBackupSummary {
  const valid = validateBackupObject(backup);
  const entries = USER_DATA_BACKUP_ENTRIES
    .filter((entry) => Object.prototype.hasOwnProperty.call(valid.data, entry.key))
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      count: countBackupValue(entry, valid.data[entry.key]),
    }));
  return { exportedAt: valid.exportedAt, categoryCount: entries.length, entries };
}

export function serializeUserDataBackup(backup: UserDataBackupV1): string {
  return `${JSON.stringify(validateBackupObject(backup), null, 2)}\n`;
}

export function userDataBackupFilename(exportedAt: string): string {
  const date = Number.isFinite(Date.parse(exportedAt)) ? new Date(exportedAt) : new Date();
  return `magazine-reader-backup-${date.toISOString().slice(0, 10)}.json`;
}

export function restoreUserDataBackup(storage: BackupStorage, backup: UserDataBackupV1): void {
  const valid = validateBackupObject(backup);
  const serialized = new Map<string, string>();
  for (const entry of USER_DATA_BACKUP_ENTRIES) {
    if (Object.prototype.hasOwnProperty.call(valid.data, entry.key)) {
      serialized.set(entry.key, JSON.stringify(valid.data[entry.key]));
    }
  }
  const previous = new Map(USER_DATA_BACKUP_ENTRIES.map((entry) => [entry.key, storage.getItem(entry.key)]));

  try {
    for (const entry of USER_DATA_BACKUP_ENTRIES) {
      const next = serialized.get(entry.key);
      if (next === undefined) storage.removeItem(entry.key);
      else storage.setItem(entry.key, next);
    }
  } catch (error) {
    for (const entry of USER_DATA_BACKUP_ENTRIES) {
      try {
        const old = previous.get(entry.key) ?? null;
        if (old === null) storage.removeItem(entry.key);
        else storage.setItem(entry.key, old);
      } catch {
        // Best-effort rollback. The original restore error remains the actionable failure.
      }
    }
    throw error;
  }
}

export function clearUserData(storage: Pick<BackupStorage, "removeItem">): void {
  storage.removeItem(LEARNING_ACTIVE_KEY);
  USER_DATA_BACKUP_ENTRIES.forEach((entry) => storage.removeItem(entry.key));
}
