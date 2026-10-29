import { describe, expect, it } from "vitest";
import { bookChapterReadingDocumentIdentity } from "../shared/reading-document-identity.js";
import {
  addNoteToState,
  emptyNotesState,
  loadNotesState,
  NOTES_STATE_KEY,
  notesStateFromItems,
  removeNoteFromState,
  resolveNoteAnchor,
  resolvedAnchoredNotesForArticle,
  resolvedAnchoredNotesForDocument,
  saveNotesState,
  updateNoteText,
} from "./notes-state";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("notes state", () => {
  it("persists notes newest first while allowing multiple notes on one article", () => {
    const storage = new MemoryStorage();
    let state = addNoteToState(emptyNotesState(), {
      id: "n1",
      issueId: "economist:2026-09-19",
      articleId: "a1",
      text: "First note",
      createdAt: "2026-09-23T01:00:00.000Z",
    });
    state = addNoteToState(state, {
      id: "n2",
      issueId: "economist:2026-09-19",
      articleId: "a1",
      text: "Second note",
      createdAt: "2026-09-23T02:00:00.000Z",
    });
    saveNotesState(storage, state);

    expect(loadNotesState(storage).items.map((note) => note.id)).toEqual(["n2", "n1"]);
    expect(storage.getItem(NOTES_STATE_KEY)).toContain("createdAt");
  });

  it("canonicalizes legacy Economist issue ids without collapsing separate notes", () => {
    const storage = new MemoryStorage();
    storage.setItem(NOTES_STATE_KEY, JSON.stringify({
      version: 1,
      items: [
        { id: "n1", issueId: "2026-09-19", articleId: "a1", text: "One", createdAt: "2026-09-23T01:00:00.000Z" },
        { id: "n2", issueId: "economist:2026-09-19", articleId: "a1", text: "Two", createdAt: "2026-09-23T02:00:00.000Z" },
      ],
    }));

    expect(loadNotesState(storage).items).toMatchObject([
      { id: "n2", issueId: "economist:2026-09-19", articleId: "a1", text: "Two", createdAt: "2026-09-23T02:00:00.000Z" },
      { id: "n1", issueId: "economist:2026-09-19", articleId: "a1", text: "One", createdAt: "2026-09-23T01:00:00.000Z" },
    ]);
  });

  it("deduplicates only by note id and keeps the newest duplicate", () => {
    const state = notesStateFromItems([
      { id: "same", issueId: "economist:2026-09-19", articleId: "a1", text: "Old", createdAt: "2026-09-23T01:00:00.000Z" },
      { id: "same", issueId: "wired:2026-09-02", articleId: "w1", text: "New", createdAt: "2026-09-23T03:00:00.000Z" },
    ]);

    expect(state.items).toMatchObject([
      { id: "same", issueId: "wired:2026-09-02", articleId: "w1", text: "New", createdAt: "2026-09-23T03:00:00.000Z" },
    ]);
  });

  it("edits note text without changing its identity, created time or order", () => {
    const state = notesStateFromItems([
      { id: "n2", issueId: "wired:2026-09-02", articleId: "w1", text: "Newer", createdAt: "2026-09-23T03:00:00.000Z" },
      { id: "n1", issueId: "economist:2026-09-19", articleId: "a1", text: "Original", createdAt: "2026-09-23T01:00:00.000Z" },
    ]);

    const edited = updateNoteText(state, "n1", "  Revised note  ");
    expect(edited.items).toMatchObject([
      { id: "n2", issueId: "wired:2026-09-02", articleId: "w1", text: "Newer", createdAt: "2026-09-23T03:00:00.000Z" },
      { id: "n1", issueId: "economist:2026-09-19", articleId: "a1", text: "Revised note", createdAt: "2026-09-23T01:00:00.000Z" },
    ]);
    expect(updateNoteText(edited, "n1", "   ")).toBe(edited);
  });

  it("removes only the requested note id", () => {
    const state = notesStateFromItems([
      { id: "n2", issueId: "economist:2026-09-19", articleId: "a1", text: "Keep", createdAt: "2026-09-23T02:00:00.000Z" },
      { id: "n1", issueId: "economist:2026-09-19", articleId: "a1", text: "Delete", createdAt: "2026-09-23T01:00:00.000Z" },
    ]);

    expect(removeNoteFromState(state, "n1").items.map((note) => note.id)).toEqual(["n2"]);
  });

  it("persists paragraph and selection anchors without changing the notes v1 envelope", () => {
    const storage = new MemoryStorage();
    const state = notesStateFromItems([
      {
        id: "paragraph-note",
        issueId: "economist:2026-09-19",
        articleId: "a1",
        text: "Paragraph note",
        createdAt: "2026-09-23T03:00:00.000Z",
        anchor: { kind: "paragraph", paragraphIndex: 2, paragraphText: "Stable paragraph." },
      },
      {
        id: "selection-note",
        issueId: "economist:2026-09-19",
        articleId: "a1",
        text: "Selection note",
        createdAt: "2026-09-23T02:00:00.000Z",
        anchor: {
          kind: "selection",
          paragraphIndex: 1,
          paragraphText: "Alpha beta gamma.",
          startOffset: 6,
          endOffset: 10,
          selectedText: "beta",
        },
      },
    ]);
    saveNotesState(storage, state);

    const loaded = loadNotesState(storage);
    expect(loaded.items[0].anchor).toEqual({ kind: "paragraph", paragraphIndex: 2, paragraphText: "Stable paragraph." });
    expect(loaded.items[1].anchor).toEqual({
      kind: "selection",
      paragraphIndex: 1,
      paragraphText: "Alpha beta gamma.",
      startOffset: 6,
      endOffset: 10,
      selectedText: "beta",
    });
    expect(JSON.parse(storage.getItem(NOTES_STATE_KEY) ?? "null")?.version).toBe(1);
  });

  it("re-finds a uniquely moved paragraph and validates selection offsets", () => {
    const paragraphs = ["Inserted paragraph.", "Alpha beta gamma.", "Stable paragraph."];
    expect(resolveNoteAnchor({ kind: "paragraph", paragraphIndex: 1, paragraphText: "Stable paragraph." }, paragraphs)).toEqual({
      kind: "paragraph",
      paragraphIndex: 2,
      reanchored: true,
    });
    expect(resolveNoteAnchor({
      kind: "selection",
      paragraphIndex: 1,
      paragraphText: "Alpha beta gamma.",
      startOffset: 0,
      endOffset: 4,
      selectedText: "beta",
    }, paragraphs)).toEqual({
      kind: "selection",
      paragraphIndex: 1,
      startOffset: 6,
      endOffset: 10,
      selectedText: "beta",
      reanchored: true,
    });
  });

  it("keeps the note but degrades an invalid or stale anchor to article level", () => {
    const state = notesStateFromItems([{
      id: "stale",
      issueId: "economist:2026-09-19",
      articleId: "a1",
      text: "Keep this note",
      createdAt: "2026-09-23T03:00:00.000Z",
      anchor: { kind: "paragraph", paragraphIndex: 4, paragraphText: "Old paragraph." },
    }]);
    expect(resolveNoteAnchor(state.items[0].anchor, ["Completely different paragraph."])).toBeNull();
    expect(state.items[0].text).toBe("Keep this note");

    const storage = new MemoryStorage();
    storage.setItem(NOTES_STATE_KEY, JSON.stringify({
      version: 1,
      items: [{
        id: "bad-anchor",
        issueId: "economist:2026-09-19",
        articleId: "a1",
        text: "Still keep this note",
        createdAt: "2026-09-23T04:00:00.000Z",
        anchor: { kind: "selection", paragraphIndex: -1, paragraphText: "x", startOffset: 3, endOffset: 1, selectedText: "x" },
      }],
    }));
    expect(loadNotesState(storage).items).toMatchObject([{
      id: "bad-anchor",
      issueId: "economist:2026-09-19",
      articleId: "a1",
      text: "Still keep this note",
      createdAt: "2026-09-23T04:00:00.000Z",
    }]);
  });

  it("returns only reliably resolved anchored notes for the current article", () => {
    const notes = notesStateFromItems([
      {
        id: "moved",
        issueId: "economist:2026-09-19",
        articleId: "a1",
        text: "Moved paragraph note",
        createdAt: "2026-09-23T04:00:00.000Z",
        anchor: { kind: "paragraph", paragraphIndex: 0, paragraphText: "Stable paragraph." },
      },
      {
        id: "selection",
        issueId: "economist:2026-09-19",
        articleId: "a1",
        text: "Selection note",
        createdAt: "2026-09-23T03:00:00.000Z",
        anchor: { kind: "selection", paragraphIndex: 0, paragraphText: "Alpha beta.", startOffset: 6, endOffset: 10, selectedText: "beta" },
      },
      {
        id: "stale",
        issueId: "economist:2026-09-19",
        articleId: "a1",
        text: "Stale note",
        createdAt: "2026-09-23T02:00:00.000Z",
        anchor: { kind: "paragraph", paragraphIndex: 5, paragraphText: "Missing paragraph." },
      },
      { id: "article-level", issueId: "economist:2026-09-19", articleId: "a1", text: "No anchor", createdAt: "2026-09-23T01:00:00.000Z" },
      { id: "other-article", issueId: "economist:2026-09-19", articleId: "a2", text: "Other", createdAt: "2026-09-23T00:30:00.000Z", anchor: { kind: "paragraph", paragraphIndex: 0, paragraphText: "Inserted." } },
    ]).items;

    const resolved = resolvedAnchoredNotesForArticle(notes, "economist:2026-09-19", "a1", ["Inserted.", "Alpha beta.", "Stable paragraph."]);
    expect(resolved.map(({ note, resolved: anchor }) => [note.id, anchor.paragraphIndex, anchor.reanchored])).toEqual([
      ["moved", 2, true],
      ["selection", 1, true],
    ]);
  });

  it("stores and resolves a Book note without manufacturing Magazine identity", () => {
    const document = bookChapterReadingDocumentIdentity("book:test", "chapter:001:one");
    const state = notesStateFromItems([{
      id: "book-note",
      document,
      text: "Book note",
      createdAt: "2026-09-23T05:00:00.000Z",
      anchor: { kind: "paragraph", paragraphIndex: 0, paragraphText: "Book paragraph." },
    }]);
    expect(state.items[0]).toMatchObject({ id: "book-note", document });
    expect(state.items[0].issueId).toBeUndefined();
    expect(state.items[0].articleId).toBeUndefined();
    expect(resolvedAnchoredNotesForDocument(state.items, document, ["Book paragraph."])).toHaveLength(1);
  });

  it("filters malformed entries and safely falls back from broken storage", () => {
    const storage = new MemoryStorage();
    storage.setItem(NOTES_STATE_KEY, "not-json");
    expect(loadNotesState(storage)).toEqual(emptyNotesState());

    storage.setItem(NOTES_STATE_KEY, JSON.stringify({
      version: 1,
      items: [
        { id: "bad-time", issueId: "economist:2026-09-19", articleId: "a1", text: "Bad", createdAt: "刚刚" },
        { id: "empty", issueId: "economist:2026-09-19", articleId: "a1", text: "   ", createdAt: "2026-09-23T01:00:00.000Z" },
      ],
    }));
    expect(loadNotesState(storage)).toEqual(emptyNotesState());
  });
});
