import {
  loadSavedSelections,
  savedSelectionDocument,
  savedSelectionFamiliarity,
  SAVED_SELECTIONS_KEY,
  type SavedSelection,
} from "./selection-state";
import {
  loadWordContextMeanings,
  WORD_CONTEXT_MEANINGS_KEY,
  wordContextOccurrenceKey,
  type WordContextMeaningRecord,
} from "./word-context-state";
import {
  loadVocabularyReviewSchedules,
  VOCABULARY_REVIEW_SCHEDULE_KEY,
  vocabularyReviewKey,
  type VocabularyReviewScheduleRecord,
} from "./vocabulary-review-schedule";
import { normalizeReadingDocumentIdentity, type ReadingDocumentIdentity } from "../shared/reading-document-identity";

export const VOCABULARY_BACKUP_FORMAT = "vantilo-vocabulary-backup" as const;
export const VOCABULARY_BACKUP_FORMAT_VERSION = 1 as const;
export const MAX_VOCABULARY_BACKUP_BYTES = 25 * 1024 * 1024;
export const VOCABULARY_RESTORE_JOURNAL_KEY = "vantilo-vocabulary-restore-journal-v1";
export const VOCABULARY_STORAGE_KEYS = [SAVED_SELECTIONS_KEY, WORD_CONTEXT_MEANINGS_KEY, VOCABULARY_REVIEW_SCHEDULE_KEY] as const;
export const MAX_CONTEXT_SNIPPET_LENGTH = 320;

export interface VocabularyBackupData {
  savedSelections: SavedSelection[];
  contextualMeanings: WordContextMeaningRecord[];
  reviewSchedules: VocabularyReviewScheduleRecord[];
}

export interface VocabularyBackupV1 {
  format: typeof VOCABULARY_BACKUP_FORMAT;
  backupFormatVersion: typeof VOCABULARY_BACKUP_FORMAT_VERSION;
  appVersion: string;
  createdAt: string;
  counts: {
    vocabulary: number;
    savedSelections: number;
    contextualMeanings: number;
    reviewSchedules: number;
  };
  exclusions: string[];
  data: VocabularyBackupData;
  integrity: { algorithm: "SHA-256"; sha256: string; payloadBytes: number; fileBytes: number };
}

export interface VocabularyMergePreview {
  currentVocabularyCount: number;
  backupVocabularyCount: number;
  newVocabularyCount: number;
  existingVocabularyCount: number;
  mergeableRecords: number;
  conflictCount: number;
  incompatibleCount: number;
  addedSelections: number;
  mergedContextualMeanings: number;
  mergedReviewSchedules: number;
}

export interface VocabularyMergeResult {
  data: VocabularyBackupData;
  preview: VocabularyMergePreview;
}

export interface VocabularySourceAvailability {
  missingDocumentIds: string[];
  documentCount: number;
}

export interface VocabularyReadStorage { getItem(key: string): string | null }
export interface VocabularyTransactionStorage extends VocabularyReadStorage {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const EXCLUSIONS = [
  "电子书、EPUB、杂志、文章全文及其图片、音频、视频等原始内容",
  "阅读进度、逐句位置、Reader 设置、普通词典缓存和临时 AI 缓存",
  "API Key 明文或密文、OAuth Token、Codex 凭据、Agent 会话与 Runtime 数据",
  "Chromium Profile、Cookie、浏览器缓存、GPU 缓存和浏览历史",
];

const emptyData = (): VocabularyBackupData => ({ savedSelections: [], contextualMeanings: [], reviewSchedules: [] });

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

export function canonicalVocabularyJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function compactContextSnippet(value: string, target: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= MAX_CONTEXT_SNIPPET_LENGTH) return text;
  const normalized = normalizeText(target);
  const index = normalized ? text.toLocaleLowerCase("en-US").indexOf(normalized) : -1;
  const targetLength = Math.min(normalized.length, MAX_CONTEXT_SNIPPET_LENGTH - 2);
  const contentLimit = MAX_CONTEXT_SNIPPET_LENGTH - 2;
  let start = index >= 0 ? Math.max(0, index - Math.floor((contentLimit - targetLength) / 2)) : 0;
  let end = Math.min(text.length, start + contentLimit);
  if (end - start < contentLimit) start = Math.max(0, end - contentLimit);
  const leading = start > 0 ? "…" : "";
  const trailing = end < text.length ? "…" : "";
  return `${leading}${text.slice(start, end).trim()}${trailing}`.slice(0, MAX_CONTEXT_SNIPPET_LENGTH);
}

function parseStoredArray(storage: VocabularyReadStorage, key: string, label: string): unknown[] {
  const raw = storage.getItem(key);
  if (raw === null || raw === "") return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error(`本机“${label}”数据不是有效 JSON，已停止备份以保留原词汇。`); }
  if (!Array.isArray(value)) throw new Error(`本机“${label}”数据格式异常，已停止备份以保留原词汇。`);
  return value;
}

function selectionIdentity(item: SavedSelection): string {
  const document = savedSelectionDocument(item);
  if (!document) throw new Error("词汇来源关联无效，已停止备份。");
  return `${document.documentId}\u0000${item.paragraphIndex}\u0000${item.startOffset ?? "?"}\u0000${normalizeText(item.text)}`;
}

function contextBelongsToSavedVocabulary(record: WordContextMeaningRecord, selections: SavedSelection[]): boolean {
  const document = normalizeReadingDocumentIdentity(record.document) ?? normalizeReadingDocumentIdentity(record);
  if (!document) return false;
  const target = normalizeText(record.text);
  return selections.some(selection => {
    const savedDocument = savedSelectionDocument(selection);
    return savedDocument?.documentId === document.documentId
      && selection.paragraphIndex === record.paragraphIndex
      && normalizeText(selection.text) === target
      && (selection.startOffset === undefined || selection.startOffset === record.startOffset);
  });
}

function projectSelection(item: SavedSelection): SavedSelection {
  const document = savedSelectionDocument(item);
  if (!document) throw new Error("词汇来源关联无效，已停止备份。");
  return {
    id: item.id,
    document,
    articleTitle: item.articleTitle.slice(0, 500),
    text: item.text,
    context: compactContextSnippet(item.context, item.text),
    paragraphIndex: item.paragraphIndex,
    createdAt: item.createdAt,
    ...(Number.isFinite(item.startOffset) ? { startOffset: item.startOffset } : {}),
    ...(item.usageExplanationZh ? { usageExplanationZh: item.usageExplanationZh } : {}),
    ...(item.meaningVersion === 2 ? { meaningVersion: 2 as const } : {}),
    ...(item.translationZh ? { translationZh: item.translationZh } : {}),
    ...(item.translationSource ? { translationSource: item.translationSource } : {}),
    familiarity: savedSelectionFamiliarity(item),
  };
}

function projectContext(record: WordContextMeaningRecord): WordContextMeaningRecord {
  const document = normalizeReadingDocumentIdentity(record.document) ?? normalizeReadingDocumentIdentity(record);
  if (!document) throw new Error("语境释义来源关联无效，已停止备份。");
  return {
    key: wordContextOccurrenceKey({ document, paragraphIndex: record.paragraphIndex, startOffset: record.startOffset, text: record.text }),
    document,
    paragraphIndex: record.paragraphIndex,
    startOffset: record.startOffset,
    text: record.text,
    paragraph: compactContextSnippet(record.paragraph, record.text),
    sentence: compactContextSnippet(record.sentence, record.text),
    generatedAt: record.generatedAt,
    meaningSource: record.meaningSource ?? "ai",
    ...(record.editedAt ? { editedAt: record.editedAt } : {}),
    ...(record.meaningVersion === 2 ? { meaningVersion: 2 as const } : {}),
    ...(record.sentenceTranslationZh ? { sentenceTranslationZh: record.sentenceTranslationZh } : {}),
    meaningZh: record.meaningZh,
    explanationZh: record.explanationZh,
    meaningEn: record.meaningEn,
    explanationEn: record.explanationEn,
    examplesEn: record.examplesEn.slice(0, 20).map(value => value.slice(0, 1000)),
    partOfSpeech: record.partOfSpeech.slice(0, 120),
    model: record.model.slice(0, 200),
    provider: record.provider,
  };
}

function projectSchedule(record: VocabularyReviewScheduleRecord): VocabularyReviewScheduleRecord {
  return {
    key: vocabularyReviewKey(record.text),
    text: record.text,
    familiarity: record.familiarity,
    intervalDays: record.intervalDays,
    reviewCount: record.reviewCount,
    lastReviewedAt: record.lastReviewedAt,
    dueAt: record.dueAt,
  };
}

export function buildVocabularyBackupData(storage: VocabularyReadStorage): VocabularyBackupData {
  const savedRaw = parseStoredArray(storage, SAVED_SELECTIONS_KEY, "词汇与熟悉度");
  const contextRaw = parseStoredArray(storage, WORD_CONTEXT_MEANINGS_KEY, "词汇语境释义");
  const scheduleRaw = parseStoredArray(storage, VOCABULARY_REVIEW_SCHEDULE_KEY, "词汇复习记录");
  const saved = loadSavedSelections({ getItem: key => key === SAVED_SELECTIONS_KEY ? JSON.stringify(savedRaw) : null });
  const contexts = loadWordContextMeanings({ getItem: key => key === WORD_CONTEXT_MEANINGS_KEY ? JSON.stringify(contextRaw) : null });
  const schedules = loadVocabularyReviewSchedules({ getItem: key => key === VOCABULARY_REVIEW_SCHEDULE_KEY ? JSON.stringify(scheduleRaw) : null });
  if (saved.length !== savedRaw.length || contexts.length !== contextRaw.length || schedules.length !== scheduleRaw.length) {
    throw new Error("本机词汇数据含有无法识别的记录，已停止备份；原始数据未修改。请先处理异常记录。");
  }
  const projectedSelections = saved.map(projectSelection);
  const projectedContexts = contexts
    .filter(record => contextBelongsToSavedVocabulary(record, saved))
    .map(projectContext);
  return {
    savedSelections: projectedSelections,
    contextualMeanings: projectedContexts,
    reviewSchedules: schedules.map(projectSchedule),
  };
}

function vocabularyCount(data: VocabularyBackupData): number {
  return new Set(data.savedSelections.map(item => normalizeText(item.text)).filter(Boolean)).size;
}

function payloadFor(data: VocabularyBackupData, appVersion: string, createdAt: string) {
  return {
    format: VOCABULARY_BACKUP_FORMAT,
    backupFormatVersion: VOCABULARY_BACKUP_FORMAT_VERSION,
    appVersion,
    createdAt,
    counts: {
      vocabulary: vocabularyCount(data),
      savedSelections: data.savedSelections.length,
      contextualMeanings: data.contextualMeanings.length,
      reviewSchedules: data.reviewSchedules.length,
    },
    exclusions: EXCLUSIONS,
    data,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function createVocabularyBackupDocument(data: VocabularyBackupData, appVersion: string, createdAt = new Date().toISOString()): Promise<VocabularyBackupV1> {
  const payload = payloadFor(data, appVersion, createdAt);
  const payloadText = canonicalVocabularyJson(payload);
  const base = { ...payload, integrity: { algorithm: "SHA-256" as const, sha256: await sha256Hex(payloadText), payloadBytes: new TextEncoder().encode(payloadText).length, fileBytes: 0 } };
  let fileBytes = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const next = new TextEncoder().encode(JSON.stringify({ ...base, integrity: { ...base.integrity, fileBytes } }, null, 2) + "\n").length;
    if (next === fileBytes) break;
    fileBytes = next;
  }
  return { ...base, integrity: { ...base.integrity, fileBytes } };
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) throw new Error(`${label}包含不支持的字段或缺少必要字段。`);
}

function isString(value: unknown, max = 100_000): value is string { return typeof value === "string" && value.length <= max; }
function validDocument(value: unknown): value is ReadingDocumentIdentity {
  const normalized = normalizeReadingDocumentIdentity(value);
  return Boolean(normalized && (value as ReadingDocumentIdentity).documentId === normalized.documentId);
}

function validateSelection(value: unknown): value is SavedSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const allowed = ["id", "document", "articleTitle", "text", "context", "paragraphIndex", "createdAt", "startOffset", "usageExplanationZh", "meaningVersion", "translationZh", "translationSource", "familiarity"];
  if (Object.keys(item).some(key => !allowed.includes(key)) || !["id", "document", "articleTitle", "text", "context", "paragraphIndex", "createdAt", "familiarity"].every(key => key in item)) return false;
  return isString(item.id, 1024) && validDocument(item.document) && isString(item.articleTitle, 500) && isString(item.text, 2048)
    && Boolean(item.id.trim() && item.articleTitle.trim() && item.text.trim())
    && isString(item.context, MAX_CONTEXT_SNIPPET_LENGTH) && typeof item.paragraphIndex === "number" && Number.isInteger(item.paragraphIndex) && item.paragraphIndex >= 0
    && isString(item.createdAt, 100) && Number.isFinite(Date.parse(item.createdAt)) && (item.startOffset === undefined || typeof item.startOffset === "number" && Number.isInteger(item.startOffset) && item.startOffset >= 0)
    && (item.usageExplanationZh === undefined || isString(item.usageExplanationZh, 20_000)) && (item.meaningVersion === undefined || item.meaningVersion === 2)
    && (item.translationZh === undefined || isString(item.translationZh, 20_000))
    && (item.translationSource === undefined || ["auto", "dictionary", "user"].includes(String(item.translationSource)))
    && typeof item.familiarity === "number" && Number.isInteger(item.familiarity) && [0, 1, 2, 3, 4, 5].includes(item.familiarity);
}

function validateContext(value: unknown): value is WordContextMeaningRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const allowed = ["key", "document", "paragraphIndex", "startOffset", "text", "paragraph", "sentence", "generatedAt", "meaningSource", "editedAt", "meaningVersion", "sentenceTranslationZh", "meaningZh", "explanationZh", "meaningEn", "explanationEn", "examplesEn", "partOfSpeech", "model", "provider"];
  if (Object.keys(item).some(key => !allowed.includes(key))) return false;
  if (!["key", "document", "paragraphIndex", "startOffset", "text", "paragraph", "sentence", "generatedAt", "meaningZh", "explanationZh", "meaningEn", "explanationEn", "examplesEn", "partOfSpeech", "model", "provider"].every(key => key in item)) return false;
  if (!isString(item.key, 2048) || !validDocument(item.document) || typeof item.paragraphIndex !== "number" || !Number.isInteger(item.paragraphIndex) || item.paragraphIndex < 0
    || typeof item.startOffset !== "number" || !Number.isInteger(item.startOffset) || item.startOffset < 0 || !isString(item.text, 2048)
    || !isString(item.paragraph, MAX_CONTEXT_SNIPPET_LENGTH) || !isString(item.sentence, MAX_CONTEXT_SNIPPET_LENGTH) || !isString(item.generatedAt, 100) || !item.text.trim() || !Number.isFinite(Date.parse(item.generatedAt))
    || !isString(item.meaningZh, 20_000) || !isString(item.explanationZh, 20_000) || !isString(item.meaningEn, 20_000) || !isString(item.explanationEn, 20_000)
    || !Array.isArray(item.examplesEn) || item.examplesEn.length > 20 || !item.examplesEn.every(example => isString(example, 1000))
    || !isString(item.partOfSpeech, 120) || !isString(item.model, 200) || item.provider !== "easycliproxy") return false;
  if (item.meaningSource !== undefined && item.meaningSource !== "ai" && item.meaningSource !== "user") return false;
  if (item.editedAt !== undefined && !isString(item.editedAt, 100)) return false;
  if (item.meaningVersion !== undefined && item.meaningVersion !== 2) return false;
  if (item.sentenceTranslationZh !== undefined && !isString(item.sentenceTranslationZh, 20_000)) return false;
  return item.key === wordContextOccurrenceKey({ document: item.document, paragraphIndex: item.paragraphIndex as number, startOffset: item.startOffset as number, text: item.text as string });
}

function validateSchedule(value: unknown): value is VocabularyReviewScheduleRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !["key", "text", "familiarity", "intervalDays", "reviewCount", "lastReviewedAt", "dueAt"].includes(key))) return false;
  return isString(item.text, 2048) && Boolean(item.text.trim()) && item.key === vocabularyReviewKey(item.text)
    && typeof item.familiarity === "number" && [1, 2, 3, 4].includes(item.familiarity) && typeof item.intervalDays === "number" && Number.isFinite(item.intervalDays) && item.intervalDays >= 0
    && typeof item.reviewCount === "number" && Number.isInteger(item.reviewCount) && item.reviewCount >= 0
    && isString(item.lastReviewedAt, 100) && Number.isFinite(Date.parse(item.lastReviewedAt)) && isString(item.dueAt, 100) && Number.isFinite(Date.parse(item.dueAt));
}

export async function parseVocabularyBackup(serialized: string): Promise<VocabularyBackupV1> {
  if (new TextEncoder().encode(serialized).length > MAX_VOCABULARY_BACKUP_BYTES) throw new Error("词汇备份文件超过 25 MB 安全上限，未对本机数据进行更改。");
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new Error("备份文件不是有效 JSON，未对词汇数据进行更改。"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("备份文件格式无效。");
  const value = parsed as Record<string, unknown>;
  exactKeys(value, ["format", "backupFormatVersion", "appVersion", "createdAt", "counts", "exclusions", "data", "integrity"], "备份文件");
  if (value.format !== VOCABULARY_BACKUP_FORMAT) throw new Error("这不是 Vantilo 词汇备份文件。");
  if (value.backupFormatVersion !== VOCABULARY_BACKUP_FORMAT_VERSION) throw new Error(`不支持词汇备份格式版本 ${String(value.backupFormatVersion)}。本机数据未更改。`);
  if (!isString(value.appVersion, 100) || !isString(value.createdAt, 100) || !Number.isFinite(Date.parse(value.createdAt)) || !Array.isArray(value.exclusions) || !value.exclusions.every(item => isString(item, 500))) throw new Error("备份清单信息无效。");
  if (!value.data || typeof value.data !== "object" || Array.isArray(value.data)) throw new Error("备份数据区格式无效。");
  const data = value.data as Record<string, unknown>;
  exactKeys(data, ["savedSelections", "contextualMeanings", "reviewSchedules"], "词汇数据区");
  if (!Array.isArray(data.savedSelections) || data.savedSelections.length > 500 || !data.savedSelections.every(validateSelection)
    || !Array.isArray(data.contextualMeanings) || data.contextualMeanings.length > 2000 || !data.contextualMeanings.every(validateContext)
    || !Array.isArray(data.reviewSchedules) || data.reviewSchedules.length > 2000 || !data.reviewSchedules.every(validateSchedule)) throw new Error("备份中包含无效或不兼容的词汇记录。");
  if (!value.counts || typeof value.counts !== "object" || Array.isArray(value.counts)) throw new Error("备份清单数量无效。");
  const counts = value.counts as Record<string, unknown>;
  exactKeys(counts, ["vocabulary", "savedSelections", "contextualMeanings", "reviewSchedules"], "备份数量清单");
  const candidateData = data as unknown as VocabularyBackupData;
  const expectedCounts = { vocabulary: vocabularyCount(candidateData), savedSelections: candidateData.savedSelections.length, contextualMeanings: candidateData.contextualMeanings.length, reviewSchedules: candidateData.reviewSchedules.length };
  for (const [key, count] of Object.entries(expectedCounts)) if (counts[key] !== count) throw new Error("备份清单中的记录数量与实际内容不一致。");
  if (!value.integrity || typeof value.integrity !== "object" || Array.isArray(value.integrity)) throw new Error("备份缺少完整性校验信息。");
  const integrity = value.integrity as Record<string, unknown>;
  exactKeys(integrity, ["algorithm", "sha256", "payloadBytes", "fileBytes"], "完整性信息");
  if (integrity.algorithm !== "SHA-256" || !isString(integrity.sha256, 64) || !/^[a-f0-9]{64}$/.test(integrity.sha256)
    || !Number.isSafeInteger(integrity.payloadBytes) || !Number.isSafeInteger(integrity.fileBytes)) throw new Error("备份完整性信息格式无效。");
  const payload = { format: value.format, backupFormatVersion: value.backupFormatVersion, appVersion: value.appVersion, createdAt: value.createdAt, counts, exclusions: value.exclusions, data };
  const payloadText = canonicalVocabularyJson(payload);
  const actualHash = await sha256Hex(payloadText);
  if (actualHash !== integrity.sha256 || new TextEncoder().encode(payloadText).length !== integrity.payloadBytes) throw new Error("SHA-256 校验失败，备份文件可能已损坏；当前词汇数据未更改。");
  if (new TextEncoder().encode(serialized).length !== integrity.fileBytes) throw new Error("备份文件大小与清单不一致，当前词汇数据未更改。");
  return parsed as VocabularyBackupV1;
}

function selectionKey(item: SavedSelection): string { return selectionIdentity(item); }
function selectionByStableId(items: SavedSelection[], incoming: SavedSelection): number {
  return items.findIndex(item => item.id === incoming.id && selectionKey(item) === selectionKey(incoming));
}
function contextualKey(item: WordContextMeaningRecord): string {
  return wordContextOccurrenceKey({ document: item.document, paragraphIndex: item.paragraphIndex, startOffset: item.startOffset, text: item.text });
}

function mergeSelection(local: SavedSelection, backup: SavedSelection): { value: SavedSelection; conflict: boolean } {
  let conflict = false;
  let translationZh = local.translationZh;
  let translationSource = local.translationSource;
  if (!translationZh && backup.translationZh) { translationZh = backup.translationZh; translationSource = backup.translationSource; }
  else if (local.translationSource !== "user" && backup.translationSource === "user" && backup.translationZh) { translationZh = backup.translationZh; translationSource = "user"; }
  else if (local.translationSource === "user" && backup.translationSource === "user" && local.translationZh !== backup.translationZh) conflict = true;
  if (local.familiarity !== backup.familiarity) conflict = true;
  if (local.usageExplanationZh && backup.usageExplanationZh && local.usageExplanationZh !== backup.usageExplanationZh) conflict = true;
  return {
    value: {
      ...local,
      ...(translationZh ? { translationZh, translationSource } : {}),
      ...(local.usageExplanationZh || !backup.usageExplanationZh ? {} : { usageExplanationZh: backup.usageExplanationZh }),
      familiarity: local.familiarity ?? backup.familiarity,
    },
    conflict,
  };
}

function mergeContext(local: WordContextMeaningRecord, backup: WordContextMeaningRecord): { value: WordContextMeaningRecord; conflict: boolean } {
  let conflict = false;
  const localUser = local.meaningSource === "user";
  const backupUser = backup.meaningSource === "user";
  if (localUser && backupUser && local.meaningZh !== backup.meaningZh) conflict = true;
  const chosen = !localUser && backupUser ? backup : local;
  return {
    value: {
      ...chosen,
      meaningZh: localUser || !backupUser ? local.meaningZh : backup.meaningZh,
      explanationZh: chosen.explanationZh || local.explanationZh || backup.explanationZh,
      meaningEn: chosen.meaningEn || local.meaningEn || backup.meaningEn,
      explanationEn: chosen.explanationEn || local.explanationEn || backup.explanationEn,
      examplesEn: chosen.examplesEn.length ? chosen.examplesEn : local.examplesEn.length ? local.examplesEn : backup.examplesEn,
      sentenceTranslationZh: chosen.sentenceTranslationZh || local.sentenceTranslationZh || backup.sentenceTranslationZh,
      editedAt: local.editedAt || backup.editedAt,
      meaningSource: localUser || backupUser ? "user" : "ai",
    },
    conflict,
  };
}

function latestTime(value: string): number { return Date.parse(value); }

export function mergeVocabularyData(current: VocabularyBackupData, backup: VocabularyBackupData): VocabularyMergeResult {
  const selections = current.savedSelections.map(item => ({ ...item }));
  let addedSelections = 0, mergeableRecords = 0, conflictCount = 0;
  for (const incoming of backup.savedSelections) {
    let index = selectionByStableId(selections, incoming);
    // Cross-device matching needs a concrete character offset. Without one,
    // two identical words in the same paragraph may be different occurrences;
    // keep both records instead of silently merging their user data.
    if (index < 0 && Number.isInteger(incoming.startOffset)) index = selections.findIndex(item => Number.isInteger(item.startOffset) && selectionKey(item) === selectionKey(incoming));
    if (index < 0) {
      let id = incoming.id;
      if (selections.some(item => item.id === id)) id = `${id}~import-${addedSelections + 1}`;
      selections.push({ ...incoming, id }); addedSelections += 1; continue;
    }
    const merged = mergeSelection(selections[index]!, incoming);
    selections[index] = merged.value; mergeableRecords += 1; if (merged.conflict) conflictCount += 1;
  }

  const contexts = current.contextualMeanings.map(item => ({ ...item }));
  let mergedContextualMeanings = 0;
  for (const incoming of backup.contextualMeanings) {
    const index = contexts.findIndex(item => contextualKey(item) === contextualKey(incoming));
    if (index < 0) { contexts.push({ ...incoming }); continue; }
    const merged = mergeContext(contexts[index]!, incoming);
    contexts[index] = merged.value; mergedContextualMeanings += 1; if (merged.conflict) conflictCount += 1;
  }

  const schedules = current.reviewSchedules.map(item => ({ ...item }));
  let mergedReviewSchedules = 0;
  for (const incoming of backup.reviewSchedules) {
    const index = schedules.findIndex(item => vocabularyReviewKey(item.text) === vocabularyReviewKey(incoming.text));
    if (index < 0) { schedules.push({ ...incoming }); continue; }
    const local = schedules[index]!;
    const localTime = latestTime(local.lastReviewedAt), backupTime = latestTime(incoming.lastReviewedAt);
    if (local.familiarity !== incoming.familiarity) conflictCount += 1;
    const latest = backupTime > localTime ? incoming : local;
    schedules[index] = { ...latest, key: vocabularyReviewKey(latest.text), reviewCount: Math.max(local.reviewCount, incoming.reviewCount) };
    mergedReviewSchedules += 1;
  }
  const result: VocabularyBackupData = { savedSelections: selections, contextualMeanings: contexts, reviewSchedules: schedules };
  const currentTexts = new Set(current.savedSelections.map(item => normalizeText(item.text)));
  const backupTexts = new Set(backup.savedSelections.map(item => normalizeText(item.text)));
  const existingVocabularyCount = [...backupTexts].filter(text => currentTexts.has(text)).length;
  return {
    data: result,
    preview: {
      currentVocabularyCount: currentTexts.size,
      backupVocabularyCount: backupTexts.size,
      newVocabularyCount: [...backupTexts].filter(text => !currentTexts.has(text)).length,
      existingVocabularyCount,
      mergeableRecords,
      conflictCount,
      incompatibleCount: 0,
      addedSelections,
      mergedContextualMeanings,
      mergedReviewSchedules,
    },
  };
}

export function findMissingVocabularySources(
  data: VocabularyBackupData,
  availableBookIds: ReadonlySet<string>,
  availableIssueIds: ReadonlySet<string>,
): VocabularySourceAvailability {
  const documents = new Map(data.savedSelections.map(item => [savedSelectionDocument(item)?.documentId ?? item.id, savedSelectionDocument(item)]));
  const missingDocumentIds = [...documents.entries()]
    .filter(([, document]) => document && (document.kind === "article" ? !availableIssueIds.has(document.issueId) : !availableBookIds.has(document.bookId)))
    .map(([documentId]) => documentId);
  return { missingDocumentIds, documentCount: documents.size };
}

export function captureVocabularyStorageRaw(storage: VocabularyReadStorage): Record<string, string | null> {
  return Object.fromEntries(VOCABULARY_STORAGE_KEYS.map(key => [key, storage.getItem(key)]));
}

export function restoreVocabularyDataTransaction(
  storage: VocabularyTransactionStorage,
  incoming: VocabularyBackupData,
  writeData: (entries: Record<string, string | null>) => void,
  expectedRaw?: Record<string, string | null>,
  transactionId?: string,
): { preview: VocabularyMergePreview; recoveryJournalPending: boolean } {
  const before = captureVocabularyStorageRaw(storage);
  if (expectedRaw && VOCABULARY_STORAGE_KEYS.some(key => before[key] !== expectedRaw[key])) throw new Error("预览后词汇数据已有变化，请重新载入备份预览后再恢复。");
  const current = buildVocabularyBackupData(storage);
  const merged = mergeVocabularyData(current, incoming);
  const journal = { version: 1, phase: "PREPARED", ...(transactionId ? { transactionId } : {}), createdAt: new Date().toISOString(), original: before };
  storage.setItem(VOCABULARY_RESTORE_JOURNAL_KEY, JSON.stringify(journal));
  const mergedRaw = {
    [SAVED_SELECTIONS_KEY]: JSON.stringify(merged.data.savedSelections),
    [WORD_CONTEXT_MEANINGS_KEY]: JSON.stringify(merged.data.contextualMeanings),
    [VOCABULARY_REVIEW_SCHEDULE_KEY]: JSON.stringify(merged.data.reviewSchedules),
  };
  let committed = false;
  try {
    writeData(mergedRaw);
    const verified = buildVocabularyBackupData(storage);
    if (canonicalVocabularyJson(verified) !== canonicalVocabularyJson(merged.data)) throw new Error("恢复后的词汇记录与预期不一致。");
    storage.setItem(VOCABULARY_RESTORE_JOURNAL_KEY, JSON.stringify({ ...journal, phase: "COMMITTED" }));
    committed = true;
    try { storage.removeItem(VOCABULARY_RESTORE_JOURNAL_KEY); return { preview: merged.preview, recoveryJournalPending: false }; }
    catch { return { preview: merged.preview, recoveryJournalPending: true }; }
  } catch (error) {
    if (committed) return { preview: merged.preview, recoveryJournalPending: true };
    try {
      writeData(before);
      const restored = captureVocabularyStorageRaw(storage);
      if (VOCABULARY_STORAGE_KEYS.some(key => restored[key] !== before[key])) throw new Error("回滚校验不一致");
      storage.removeItem(VOCABULARY_RESTORE_JOURNAL_KEY);
    } catch (rollbackError) {
      if (typeof window !== "undefined") (window as Window & { __vantiloVocabularyRecoveryRequired?: string }).__vantiloVocabularyRecoveryRequired = rollbackError instanceof Error ? rollbackError.message : "词汇回滚失败";
      throw new Error(`词汇恢复失败，且自动回滚未能完成。恢复点已保留，应用会在下次启动时尝试恢复。${rollbackError instanceof Error ? ` ${rollbackError.message}` : ""}`, { cause: error });
    }
    throw error;
  }
}

export function currentVocabularySummary(storage: VocabularyReadStorage): { vocabularyCount: number; savedSelections: number; contextualMeanings: number; reviewSchedules: number } {
  const data = buildVocabularyBackupData(storage);
  return { vocabularyCount: vocabularyCount(data), savedSelections: data.savedSelections.length, contextualMeanings: data.contextualMeanings.length, reviewSchedules: data.reviewSchedules.length };
}
