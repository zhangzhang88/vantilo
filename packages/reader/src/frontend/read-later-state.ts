import { normalizeReadingEntry, readingEntryKey, type ReadingEntry } from "./reading-entry";
import { canonicalIssueId } from "../shared/publication";

export interface ReadLaterItem extends ReadingEntry {
  savedAt: string;
}

export interface ReadLaterState {
  version: 1;
  items: ReadLaterItem[];
}

interface ReadStorage {
  getItem(key: string): string | null;
}

interface WriteStorage extends ReadStorage {
  setItem(key: string, value: string): void;
}

export const READ_LATER_STATE_KEY = "magazine-reader-read-later-v1";

export function emptyReadLaterState(): ReadLaterState {
  return { version: 1, items: [] };
}

export function readLaterKey(issueId: string, articleId: string): string {
  return `${canonicalIssueId(issueId)}:${articleId}`;
}

function validSavedAt(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function normalizedItems(items: unknown): ReadLaterItem[] {
  if (!Array.isArray(items)) return [];
  const byKey = new Map<string, ReadLaterItem>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Partial<ReadLaterItem>;
    const entry = normalizeReadingEntry(raw);
    if (!entry) continue;
    if (!validSavedAt(candidate.savedAt)) continue;
    const item: ReadLaterItem = {
      ...entry,
      savedAt: candidate.savedAt,
    };
    const key = readingEntryKey(item);
    const existing = byKey.get(key);
    if (!existing || Date.parse(item.savedAt) > Date.parse(existing.savedAt)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
}

export function loadReadLaterState(storage: ReadStorage): ReadLaterState {
  const raw = storage.getItem(READ_LATER_STATE_KEY);
  if (!raw) return emptyReadLaterState();
  try {
    const parsed = JSON.parse(raw) as Partial<ReadLaterState> | null;
    if (!parsed || parsed.version !== 1) return emptyReadLaterState();
    return { version: 1, items: normalizedItems(parsed.items) };
  } catch {
    return emptyReadLaterState();
  }
}

export function saveReadLaterState(storage: WriteStorage, state: ReadLaterState): void {
  storage.setItem(READ_LATER_STATE_KEY, JSON.stringify({ version: 1, items: normalizedItems(state.items) }));
}

export function isReadLater(state: ReadLaterState, issueId: string, articleId: string): boolean {
  const key = readLaterKey(issueId, articleId);
  return state.items.some((item) => readingEntryKey(item) === `reading:article:${key}`);
}

export function addToReadLater(
  state: ReadLaterState,
  issueId: string,
  articleId: string,
  savedAt = new Date().toISOString(),
): ReadLaterState {
  const normalizedIssueId = canonicalIssueId(issueId);
  const key = readLaterKey(normalizedIssueId, articleId);
  const items = state.items.filter((item) => readingEntryKey(item) !== `reading:article:${key}`);
  return {
    version: 1,
    items: normalizedItems([{ issueId: normalizedIssueId, articleId, savedAt }, ...items]),
  };
}

export function removeFromReadLater(state: ReadLaterState, issueId: string, articleId: string): ReadLaterState {
  const key = readLaterKey(issueId, articleId);
  return {
    version: 1,
    items: state.items.filter((item) => readingEntryKey(item) !== `reading:article:${key}`),
  };
}

export function toggleReadLater(
  state: ReadLaterState,
  issueId: string,
  articleId: string,
  savedAt = new Date().toISOString(),
): ReadLaterState {
  return isReadLater(state, issueId, articleId)
    ? removeFromReadLater(state, issueId, articleId)
    : addToReadLater(state, issueId, articleId, savedAt);
}

export function isDocumentReadLater(state: ReadLaterState, entry: ReadingEntry): boolean {
  return state.items.some((item) => readingEntryKey(item) === readingEntryKey(entry));
}
export function toggleDocumentReadLater(state: ReadLaterState, entry: ReadingEntry, savedAt = new Date().toISOString()): ReadLaterState {
  const normalized = normalizeReadingEntry(entry);
  if (!normalized) return state;
  return { version: 1, items: normalizedItems(isDocumentReadLater(state, normalized)
    ? state.items.filter((item) => readingEntryKey(item) !== readingEntryKey(normalized))
    : [{ ...normalized, savedAt }, ...state.items]) };
}
