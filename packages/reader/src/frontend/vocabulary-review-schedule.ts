import { isLearningFamiliarity, type FamiliarityLevel } from "./selection-state";

interface ReadStorage {
  getItem(key: string): string | null;
}

interface WriteStorage extends ReadStorage {
  setItem(key: string, value: string): void;
}

export interface VocabularyReviewScheduleRecord {
  key: string;
  text: string;
  familiarity: 1 | 2 | 3 | 4;
  intervalDays: number;
  reviewCount: number;
  lastReviewedAt: string;
  dueAt: string;
}

export const VOCABULARY_REVIEW_SCHEDULE_KEY = "magazine-reader-vocabulary-review-v1";
const MAX_RECORDS = 2_000;

export function vocabularyReviewKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function vocabularyReviewIntervalDays(familiarity: 1 | 2 | 3 | 4): number {
  if (familiarity === 1) return 1;
  if (familiarity === 2) return 3;
  if (familiarity === 3) return 7;
  return 30;
}

function isScheduleRecord(value: unknown): value is VocabularyReviewScheduleRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<VocabularyReviewScheduleRecord>;
  return typeof item.key === "string"
    && typeof item.text === "string"
    && (item.familiarity === 1 || item.familiarity === 2 || item.familiarity === 3 || item.familiarity === 4)
    && typeof item.intervalDays === "number"
    && typeof item.reviewCount === "number"
    && typeof item.lastReviewedAt === "string"
    && typeof item.dueAt === "string";
}

export function loadVocabularyReviewSchedules(storage: ReadStorage): VocabularyReviewScheduleRecord[] {
  const raw = storage.getItem(VOCABULARY_REVIEW_SCHEDULE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isScheduleRecord).slice(0, MAX_RECORDS).map((record) => ({
      ...record,
      key: vocabularyReviewKey(record.text),
    }));
  } catch {
    return [];
  }
}

export function saveVocabularyReviewSchedules(storage: WriteStorage, records: VocabularyReviewScheduleRecord[]): void {
  storage.setItem(VOCABULARY_REVIEW_SCHEDULE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
}

export function findVocabularyReviewSchedule(
  records: VocabularyReviewScheduleRecord[],
  text: string,
): VocabularyReviewScheduleRecord | undefined {
  const key = vocabularyReviewKey(text);
  return records.find((record) => record.key === key);
}

export function isVocabularyReviewDue(
  records: VocabularyReviewScheduleRecord[],
  text: string,
  familiarity: FamiliarityLevel,
  now = new Date(),
): boolean {
  if (!isLearningFamiliarity(familiarity)) return false;
  const record = findVocabularyReviewSchedule(records, text);
  if (!record || record.familiarity !== familiarity) return true;
  const due = new Date(record.dueAt).getTime();
  return !Number.isFinite(due) || due <= now.getTime();
}

export function scheduleVocabularyAfterReview(
  records: VocabularyReviewScheduleRecord[],
  text: string,
  familiarity: FamiliarityLevel,
  now = new Date(),
): VocabularyReviewScheduleRecord[] {
  const key = vocabularyReviewKey(text);
  if (!key) return records;
  const withoutCurrent = records.filter((record) => record.key !== key);
  if (!isLearningFamiliarity(familiarity)) return withoutCurrent;

  const previous = records.find((record) => record.key === key);
  const intervalDays = vocabularyReviewIntervalDays(familiarity);
  const dueAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  const record: VocabularyReviewScheduleRecord = {
    key,
    text: text.trim(),
    familiarity,
    intervalDays,
    reviewCount: (previous?.reviewCount ?? 0) + 1,
    lastReviewedAt: now.toISOString(),
    dueAt: dueAt.toISOString(),
  };
  return [record, ...withoutCurrent].slice(0, MAX_RECORDS);
}
