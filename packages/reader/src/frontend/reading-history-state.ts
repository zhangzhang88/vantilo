import { normalizeReadingEntry, readingEntryKey, type ReadingEntry } from "./reading-entry";
import { canonicalIssueId } from "../shared/publication";

export interface ReadingHistoryItem extends ReadingEntry {
  lastOpenedAt: string;
}

export interface ReadingHistoryState {
  version: 1;
  items: ReadingHistoryItem[];
  lastRead?: ReadingHistoryItem;
}

interface ReadStorage {
  getItem(key: string): string | null;
}

interface WriteStorage extends ReadStorage {
  setItem(key: string, value: string): void;
}

export const READING_HISTORY_STATE_KEY = "magazine-reader-reading-history-v1";

export function emptyReadingHistoryState(): ReadingHistoryState {
  return { version: 1, items: [] };
}

export function readingHistoryKey(issueId: string, articleId: string): string {
  return `${canonicalIssueId(issueId)}:${articleId}`;
}

function validOpenedAt(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function normalizedItems(items: unknown): ReadingHistoryItem[] {
  if (!Array.isArray(items)) return [];
  const byKey = new Map<string, ReadingHistoryItem>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Partial<ReadingHistoryItem>;
    const entry = normalizeReadingEntry(raw);
    if (!entry) continue;
    if (!validOpenedAt(candidate.lastOpenedAt)) continue;
    const normalized: ReadingHistoryItem = {
      ...entry,
      lastOpenedAt: candidate.lastOpenedAt,
    };
    const key = readingEntryKey(normalized);
    const existing = byKey.get(key);
    if (!existing || Date.parse(normalized.lastOpenedAt) > Date.parse(existing.lastOpenedAt)) {
      byKey.set(key, normalized);
    }
  }
  return [...byKey.values()].sort((a, b) => Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt));
}

export function loadReadingHistoryState(storage: ReadStorage): ReadingHistoryState {
  const raw = storage.getItem(READING_HISTORY_STATE_KEY);
  if (!raw) return emptyReadingHistoryState();
  try {
    const parsed = JSON.parse(raw) as Partial<ReadingHistoryState> | null;
    if (!parsed || parsed.version !== 1) return emptyReadingHistoryState();
    return { version: 1, items: normalizedItems(parsed.items), ...(normalizedItems([parsed.lastRead])[0] ? { lastRead: normalizedItems([parsed.lastRead])[0] } : {}) };
  } catch {
    return emptyReadingHistoryState();
  }
}

export function saveReadingHistoryState(storage: WriteStorage, state: ReadingHistoryState): void {
  storage.setItem(READING_HISTORY_STATE_KEY, JSON.stringify({ version: 1, items: normalizedItems(state.items), ...(state.lastRead ? { lastRead: normalizedItems([state.lastRead])[0] } : {}) }));
}

export function recordReadingHistory(
  state: ReadingHistoryState,
  issueId: string,
  articleId: string,
  lastOpenedAt = new Date().toISOString(),
): ReadingHistoryState {
  return recordDocumentHistory(state, { issueId: canonicalIssueId(issueId), articleId }, lastOpenedAt);
}

export function clearReadingHistory(state?: ReadingHistoryState): ReadingHistoryState {
  const lastRead = state?.lastRead ?? state?.items[0];
  return { ...emptyReadingHistoryState(), ...(lastRead ? { lastRead } : {}) };
}

export function recordDocumentHistory(state: ReadingHistoryState, entry: ReadingEntry, lastOpenedAt = new Date().toISOString()): ReadingHistoryState {
  const normalized = normalizeReadingEntry(entry);
  if (!normalized || !validOpenedAt(lastOpenedAt)) return state;
  return { version: 1, lastRead: { ...normalized, lastOpenedAt }, items: normalizedItems([{ ...normalized, lastOpenedAt }, ...state.items.filter((item) => readingEntryKey(item) !== readingEntryKey(normalized))]) };
}
