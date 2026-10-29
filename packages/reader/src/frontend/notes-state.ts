import { articleReadingDocumentIdentity, readingDocumentIdentityForInput, type ReadingDocumentIdentity, type ReadingDocumentIdentityInput } from "../shared/reading-document-identity.js";

export interface ReaderNoteParagraphAnchor {
  kind: "paragraph";
  paragraphIndex: number;
  paragraphText: string;
}

export interface ReaderNoteSelectionAnchor {
  kind: "selection";
  paragraphIndex: number;
  paragraphText: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
}

export type ReaderNoteAnchor = ReaderNoteParagraphAnchor | ReaderNoteSelectionAnchor;

export interface ResolvedNoteAnchor {
  kind: ReaderNoteAnchor["kind"];
  paragraphIndex: number;
  startOffset?: number;
  endOffset?: number;
  selectedText?: string;
  reanchored: boolean;
}

export interface ResolvedAnchoredNote {
  note: ReaderNote;
  resolved: ResolvedNoteAnchor;
}

export interface ReaderNote {
  id: string;
  document?: ReadingDocumentIdentity;
  issueId?: string;
  articleId?: string;
  text: string;
  createdAt: string;
  anchor?: ReaderNoteAnchor;
}

export interface NotesState {
  version: 1;
  items: ReaderNote[];
}

interface ReadStorage {
  getItem(key: string): string | null;
}

interface WriteStorage extends ReadStorage {
  setItem(key: string, value: string): void;
}

export const NOTES_STATE_KEY = "magazine-reader-notes-v1";

export function readerNoteDocument(note: ReaderNote | ReadingDocumentIdentityInput): ReadingDocumentIdentity | null {
  try { return readingDocumentIdentityForInput(note); } catch { return null; }
}

export function readerNoteBelongsToDocument(note: ReaderNote, document: ReadingDocumentIdentity): boolean {
  return readerNoteDocument(note)?.documentId === document.documentId;
}

export function emptyNotesState(): NotesState {
  return { version: 1, items: [] };
}

function validCreatedAt(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function normalizedAnchor(value: unknown): ReaderNoteAnchor | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ReaderNoteAnchor> & {
    startOffset?: unknown;
    endOffset?: unknown;
    selectedText?: unknown;
  };
  if ((candidate.kind !== "paragraph" && candidate.kind !== "selection")
    || !Number.isInteger(candidate.paragraphIndex)
    || (candidate.paragraphIndex ?? -1) < 0
    || typeof candidate.paragraphText !== "string"
    || !candidate.paragraphText.trim()) return undefined;

  if (candidate.kind === "paragraph") {
    return {
      kind: "paragraph",
      paragraphIndex: candidate.paragraphIndex as number,
      paragraphText: candidate.paragraphText,
    };
  }

  if (!Number.isInteger(candidate.startOffset)
    || !Number.isInteger(candidate.endOffset)
    || (candidate.startOffset as number) < 0
    || (candidate.endOffset as number) <= (candidate.startOffset as number)
    || typeof candidate.selectedText !== "string"
    || !candidate.selectedText) return undefined;

  return {
    kind: "selection",
    paragraphIndex: candidate.paragraphIndex as number,
    paragraphText: candidate.paragraphText,
    startOffset: candidate.startOffset as number,
    endOffset: candidate.endOffset as number,
    selectedText: candidate.selectedText,
  };
}

function normalizedNotes(items: unknown): ReaderNote[] {
  if (!Array.isArray(items)) return [];
  const byId = new Map<string, ReaderNote>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Partial<ReaderNote>;
    if (typeof candidate.id !== "string" || !candidate.id) continue;
    let document: ReadingDocumentIdentity;
    try { document = readingDocumentIdentityForInput(candidate as ReadingDocumentIdentityInput); } catch { continue; }
    if (typeof candidate.text !== "string" || !candidate.text.trim()) continue;
    if (!validCreatedAt(candidate.createdAt)) continue;
    const note: ReaderNote = {
      id: candidate.id,
      document,
      ...(document.kind === "article" ? { issueId: document.issueId, articleId: document.articleId } : { issueId: undefined, articleId: undefined }),
      text: candidate.text.trim(),
      createdAt: candidate.createdAt,
      ...(normalizedAnchor(candidate.anchor) ? { anchor: normalizedAnchor(candidate.anchor) } : {}),
    };
    const existing = byId.get(note.id);
    if (!existing || Date.parse(note.createdAt) > Date.parse(existing.createdAt)) byId.set(note.id, note);
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function loadNotesState(storage: ReadStorage): NotesState {
  const raw = storage.getItem(NOTES_STATE_KEY);
  if (!raw) return emptyNotesState();
  try {
    const parsed = JSON.parse(raw) as Partial<NotesState> | null;
    if (!parsed || parsed.version !== 1) return emptyNotesState();
    return { version: 1, items: normalizedNotes(parsed.items) };
  } catch {
    return emptyNotesState();
  }
}

export function saveNotesState(storage: WriteStorage, state: NotesState): void {
  storage.setItem(NOTES_STATE_KEY, JSON.stringify({ version: 1, items: normalizedNotes(state.items) }));
}

export function notesStateFromItems(items: ReaderNote[]): NotesState {
  return { version: 1, items: normalizedNotes(items) };
}

export function addNoteToState(
  state: NotesState,
  note: ReaderNote,
): NotesState {
  return notesStateFromItems([note, ...state.items]);
}

export function resolveNoteAnchor(anchor: ReaderNoteAnchor | undefined, paragraphs: string[]): ResolvedNoteAnchor | null {
  if (!anchor) return null;
  let paragraphIndex = anchor.paragraphIndex;
  let reanchored = false;

  if (paragraphs[paragraphIndex] !== anchor.paragraphText) {
    const matches = paragraphs.reduce<number[]>((indexes, paragraph, index) => {
      if (paragraph === anchor.paragraphText) indexes.push(index);
      return indexes;
    }, []);
    if (matches.length !== 1) return null;
    paragraphIndex = matches[0];
    reanchored = paragraphIndex !== anchor.paragraphIndex;
  }

  if (anchor.kind === "paragraph") return { kind: "paragraph", paragraphIndex, reanchored };

  const paragraph = paragraphs[paragraphIndex] ?? "";
  let startOffset = anchor.startOffset;
  let endOffset = anchor.endOffset;
  if (paragraph.slice(startOffset, endOffset) !== anchor.selectedText) {
    const offsets: number[] = [];
    let cursor = 0;
    while (cursor <= paragraph.length - anchor.selectedText.length) {
      const match = paragraph.indexOf(anchor.selectedText, cursor);
      if (match < 0) break;
      offsets.push(match);
      cursor = match + Math.max(anchor.selectedText.length, 1);
    }
    if (offsets.length !== 1) return null;
    startOffset = offsets[0];
    endOffset = startOffset + anchor.selectedText.length;
    reanchored = true;
  }

  return {
    kind: "selection",
    paragraphIndex,
    startOffset,
    endOffset,
    selectedText: anchor.selectedText,
    reanchored,
  };
}

export function resolvedAnchoredNotesForDocument(
  notes: ReaderNote[],
  document: ReadingDocumentIdentity,
  paragraphs: string[],
): ResolvedAnchoredNote[] {
  return notes.flatMap((note) => {
    if (!readerNoteBelongsToDocument(note, document) || !note.anchor) return [];
    const resolved = resolveNoteAnchor(note.anchor, paragraphs);
    return resolved ? [{ note, resolved }] : [];
  });
}

export function resolvedAnchoredNotesForArticle(
  notes: ReaderNote[],
  issueId: string,
  articleId: string,
  paragraphs: string[],
): ResolvedAnchoredNote[] {
  return resolvedAnchoredNotesForDocument(notes, articleReadingDocumentIdentity(issueId, articleId), paragraphs);
}

export function updateNoteText(state: NotesState, noteId: string, text: string): NotesState {
  const normalizedText = text.trim();
  if (!normalizedText) return state;
  return notesStateFromItems(state.items.map((note) => note.id === noteId ? { ...note, text: normalizedText } : note));
}

export function removeNoteFromState(state: NotesState, noteId: string): NotesState {
  return notesStateFromItems(state.items.filter((note) => note.id !== noteId));
}
