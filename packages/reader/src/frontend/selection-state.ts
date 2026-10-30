import { readingDocumentIdentityForInput, type ReadingDocumentIdentity, type ReadingDocumentIdentityInput } from "../shared/reading-document-identity.js";

export type FamiliarityLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type SavedSelectionTranslationSource = "auto" | "dictionary" | "user";

export interface SavedSelection {
  id: string;
  document?: ReadingDocumentIdentity;
  issueId?: string;
  articleId?: string;
  articleTitle: string;
  text: string;
  context: string;
  paragraphIndex: number;
  createdAt: string;
  startOffset?: number;
  usageExplanationZh?: string;
  meaningVersion?: 2;
  translationZh?: string;
  translationSource?: SavedSelectionTranslationSource;
  familiarity?: FamiliarityLevel;
  mastered?: boolean;
}

interface ReadStorage {
  getItem(key: string): string | null;
}

interface WriteStorage extends ReadStorage {
  setItem(key: string, value: string): void;
}

export const SAVED_SELECTIONS_KEY = "economist-reader-selections-v1";

export function savedSelectionDocument(selection: SavedSelection | ReadingDocumentIdentityInput): ReadingDocumentIdentity | null {
  try { return readingDocumentIdentityForInput(selection); } catch { return null; }
}

export function savedSelectionBelongsToDocument(selection: SavedSelection, document: ReadingDocumentIdentity): boolean {
  return savedSelectionDocument(selection)?.documentId === document.documentId;
}

export interface SavedHighlightSegment {
  text: string;
  saved: boolean;
  startOffset?: number;
  translationZh?: string;
  translationSource?: SavedSelectionTranslationSource;
  familiarity?: FamiliarityLevel;
}

export interface SavedTextOccurrence {
  paragraphIndex: number;
  startOffset: number;
  endOffset: number;
}

interface SavedHighlightTerm {
  source: string;
  lower: string;
  translationZh?: string;
  translationSource?: SavedSelectionTranslationSource;
  familiarity: FamiliarityLevel;
}

function isAsciiWordChar(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9_]/.test(char));
}

export function findSavedTextOccurrences(paragraphs: string[], text: string): SavedTextOccurrence[] {
  const source = text.trim();
  if (!source) return [];
  const lowerSource = source.toLocaleLowerCase("en-US");
  const startsWithWord = isAsciiWordChar(source[0]);
  const endsWithWord = isAsciiWordChar(source[source.length - 1]);
  const occurrences: SavedTextOccurrence[] = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const lowerParagraph = paragraph.toLocaleLowerCase("en-US");
    let cursor = 0;
    while (cursor <= paragraph.length - source.length) {
      const startOffset = lowerParagraph.indexOf(lowerSource, cursor);
      if (startOffset < 0) break;
      const endOffset = startOffset + source.length;
      const before = startOffset > 0 ? paragraph[startOffset - 1] : undefined;
      const after = endOffset < paragraph.length ? paragraph[endOffset] : undefined;
      if ((!startsWithWord || !isAsciiWordChar(before)) && (!endsWithWord || !isAsciiWordChar(after))) {
        occurrences.push({ paragraphIndex, startOffset, endOffset });
      }
      cursor = startOffset + Math.max(source.length, 1);
    }
  });

  return occurrences;
}

export function savedSelectionFamiliarity(selection: Pick<SavedSelection, "familiarity" | "mastered">): FamiliarityLevel {
  const value = selection.familiarity;
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5) return value;
  return selection.mastered ? 5 : 1;
}

export function isLearningFamiliarity(familiarity: FamiliarityLevel): familiarity is 1 | 2 | 3 | 4 {
  return familiarity >= 1 && familiarity <= 4;
}

function highlightTerms(selections: SavedSelection[]): SavedHighlightTerm[] {
  const unique = new Map<string, { source: string; translationZh?: string; translationSource?: SavedSelectionTranslationSource; familiarity: FamiliarityLevel }>();
  for (const item of selections) {
    const source = item.text.trim();
    if (!source) continue;
    const lower = source.toLocaleLowerCase("en-US");
    const translationZh = item.translationZh?.trim() || undefined;
    const familiarity = savedSelectionFamiliarity(item);
    const existing = unique.get(lower);
    if (!existing) {
      unique.set(lower, { source, translationZh, translationSource: item.translationSource, familiarity });
    } else {
      if (item.translationSource === "user" && existing.translationSource !== "user" && translationZh) {
        existing.translationZh = translationZh;
        existing.translationSource = "user";
      } else if (!existing.translationZh && translationZh) {
        existing.translationZh = translationZh;
        existing.translationSource = item.translationSource;
      }
      if (familiarity > existing.familiarity) existing.familiarity = familiarity;
    }
  }
  return [...unique.entries()]
    .map(([lower, item]) => ({ lower, ...item }))
    .filter((item) => isLearningFamiliarity(item.familiarity))
    .sort((a, b) => b.source.length - a.source.length);
}

export function savedHighlightSegments(
  text: string,
  selections: SavedSelection[],
): SavedHighlightSegment[] {
  if (!text) return [];
  const terms = highlightTerms(selections);
  if (!terms.length) return [{ text, saved: false, startOffset: 0 }];

  const lowerText = text.toLocaleLowerCase("en-US");
  const segments: SavedHighlightSegment[] = [];
  let cursor = 0;
  let plainStart = 0;

  while (cursor < text.length) {
    const term = terms.find((candidate) => {
      if (!lowerText.startsWith(candidate.lower, cursor)) return false;
      const before = cursor > 0 ? text[cursor - 1] : undefined;
      const afterIndex = cursor + candidate.source.length;
      const after = afterIndex < text.length ? text[afterIndex] : undefined;
      const startsWithWord = isAsciiWordChar(candidate.source[0]);
      const endsWithWord = isAsciiWordChar(candidate.source[candidate.source.length - 1]);
      if (startsWithWord && isAsciiWordChar(before)) return false;
      if (endsWithWord && isAsciiWordChar(after)) return false;
      return true;
    });

    if (!term) {
      cursor += 1;
      continue;
    }

    if (plainStart < cursor) {
      segments.push({ text: text.slice(plainStart, cursor), saved: false, startOffset: plainStart });
    }
    const end = cursor + term.source.length;
    segments.push({
      text: text.slice(cursor, end),
      saved: true,
      startOffset: cursor,
      translationZh: term.translationZh,
      translationSource: term.translationSource,
      familiarity: term.familiarity,
    });
    cursor = end;
    plainStart = end;
  }

  if (plainStart < text.length) {
    segments.push({ text: text.slice(plainStart), saved: false, startOffset: plainStart });
  }
  return segments.length ? segments : [{ text, saved: false, startOffset: 0 }];
}

function isSavedSelection(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SavedSelection> & { issueId?: unknown; articleId?: unknown };
  let hasIdentity = false;
  try { hasIdentity = Boolean(readingDocumentIdentityForInput(item as ReadingDocumentIdentityInput)); } catch { hasIdentity = false; }
  return typeof item.id === "string"
    && hasIdentity
    && typeof item.articleTitle === "string"
    && typeof item.text === "string"
    && typeof item.context === "string"
    && typeof item.paragraphIndex === "number"
    && typeof item.createdAt === "string"
    && (item.translationZh === undefined || typeof item.translationZh === "string")
    && (item.translationSource === undefined || item.translationSource === "auto" || item.translationSource === "dictionary" || item.translationSource === "user")
    && (item.mastered === undefined || typeof item.mastered === "boolean")
    && (item.familiarity === undefined || [0, 1, 2, 3, 4, 5].includes(item.familiarity));
}

export function loadSavedSelections(storage: ReadStorage): SavedSelection[] {
  const raw = storage.getItem(SAVED_SELECTIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedSelection).slice(0, 500).map((item) => {
      const stored = item as SavedSelection;
      const document = readingDocumentIdentityForInput(stored);
      const { mastered: _legacyMastered, ...rest } = stored;
      return {
        ...rest,
        document,
        ...(document.kind === "article" ? { issueId: document.issueId, articleId: document.articleId } : { issueId: undefined, articleId: undefined }),
        familiarity: savedSelectionFamiliarity(stored),
      };
    });
  } catch {
    return [];
  }
}

export function saveSavedSelections(storage: WriteStorage, selections: SavedSelection[]): void {
  storage.setItem(SAVED_SELECTIONS_KEY, JSON.stringify(selections.slice(0, 500)));
}

function setSavedSelectionTranslationValue(
  selections: SavedSelection[],
  text: string,
  translationZh: string,
  translationSource: SavedSelectionTranslationSource | undefined,
): SavedSelection[] {
  const normalizedText = text.trim().toLocaleLowerCase("en-US");
  const normalizedTranslation = translationZh.trim();
  if (!normalizedText || !normalizedTranslation) return selections;

  let changed = false;
  const next = selections.map((item) => {
    if (item.text.trim().toLocaleLowerCase("en-US") !== normalizedText) return item;
    if (item.translationSource === "user" && translationSource !== "user") return item;
    if (item.translationZh === normalizedTranslation && item.translationSource === translationSource) return item;
    changed = true;
    return { ...item, translationZh: normalizedTranslation, translationSource };
  });
  return changed ? next : selections;
}

export function setSavedSelectionTranslation(
  selections: SavedSelection[],
  text: string,
  translationZh: string,
): SavedSelection[] {
  return setSavedSelectionTranslationValue(selections, text, translationZh, "user");
}

export function setSavedSelectionFamiliarity(
  selections: SavedSelection[],
  text: string,
  familiarity: FamiliarityLevel,
): SavedSelection[] {
  const normalizedText = text.trim().toLocaleLowerCase("en-US");
  if (!normalizedText) return selections;

  let changed = false;
  const next = selections.map((item) => {
    if (item.text.trim().toLocaleLowerCase("en-US") !== normalizedText) return item;
    if (savedSelectionFamiliarity(item) === familiarity && item.mastered === undefined) return item;
    const { mastered: _legacyMastered, ...rest } = item;
    changed = true;
    return { ...rest, familiarity };
  });
  return changed ? next : selections;
}

export function addSavedSelection(
  selections: SavedSelection[],
  input: Omit<SavedSelection, "id" | "createdAt">,
  now = new Date(),
): SavedSelection[] {
  const document = readingDocumentIdentityForInput(input);
  const duplicate = selections.some((item) =>
    savedSelectionDocument(item)?.documentId === document.documentId
    && item.text === input.text
    && item.paragraphIndex === input.paragraphIndex,
  );
  const familiarity = input.familiarity ?? 1;
  if (duplicate) {
    let next = setSavedSelectionFamiliarity(selections, input.text, familiarity);
    if (input.translationZh) {
      next = setSavedSelectionTranslationValue(next, input.text, input.translationZh, input.translationSource);
    }
    return next;
  }

  const resetFamiliarity = setSavedSelectionFamiliarity(selections, input.text, familiarity);
  const { mastered: _legacyMastered, ...normalizedInput } = input;
  const item: SavedSelection = {
    ...normalizedInput,
    document,
    ...(document.kind === "article" ? { issueId: document.issueId, articleId: document.articleId } : { issueId: undefined, articleId: undefined }),
    familiarity,
    id: `${document.documentId}:${now.getTime()}`,
    createdAt: now.toISOString(),
  };
  return [item, ...resetFamiliarity].slice(0, 500);
}

/** Remove this text from one document, retaining other documents and other words. */
export function removeSavedSelectionFromDocument(selections: SavedSelection[], document: ReadingDocumentIdentity, text: string): { remaining: SavedSelection[]; removed: SavedSelection[] } {
  const key = text.trim().toLocaleLowerCase("en-US");
  const matches = (item: SavedSelection) => savedSelectionBelongsToDocument(item, document) && item.text.trim().toLocaleLowerCase("en-US") === key;
  return { remaining: selections.filter((item) => !matches(item)), removed: selections.filter(matches) };
}

/** Undo only the removed entries; preserve later additions and edits. */
export function restoreRemovedSelections(selections: SavedSelection[], removed: SavedSelection[]): SavedSelection[] {
  const restored = [...selections];
  for (const item of [...removed].reverse()) {
    if (restored.some((current) => current.id === item.id || (savedSelectionDocument(current)?.documentId === savedSelectionDocument(item)?.documentId
      && current.paragraphIndex === item.paragraphIndex && current.text.trim().toLocaleLowerCase("en-US") === item.text.trim().toLocaleLowerCase("en-US")))) continue;
    restored.unshift(item);
  }
  return restored;
}
