import { describe, expect, it } from "vitest";
import { createReaderStorage } from "./reader-storage";
import { buildUserDataBackup } from "./user-data-backup";
import { NOTES_STATE_KEY } from "./notes-state";

describe("reader storage failure recovery", () => {
  it("keeps unsaved edits exportable and persists the latest edit on retry", () => {
    const data = new Map<string, string>();
    let blocked = true;
    const storage = createReaderStorage({
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => { if (blocked) throw new DOMException("full", "QuotaExceededError"); data.set(key, value); },
      removeItem: (key) => { data.delete(key); },
    });
    const note = { id: "n", issueId: "economist:2026-09-19", articleId: "a1", text: "Unsaved note", createdAt: "2026-10-15T00:00:00Z" };
    storage.setItem(NOTES_STATE_KEY, JSON.stringify({ version: 1, items: [note] }));
    expect(storage.getSnapshot().pendingCount).toBe(1);
    expect(buildUserDataBackup(storage).data[NOTES_STATE_KEY]).toEqual({ version: 1, items: [note] });
    note.text = "Latest note";
    storage.setItem(NOTES_STATE_KEY, JSON.stringify({ version: 1, items: [note] }));
    blocked = false;
    storage.retry();
    expect(storage.getSnapshot().pendingCount).toBe(0);
    expect(JSON.parse(data.get(NOTES_STATE_KEY)!).items[0].text).toBe("Latest note");
  });

  it("evicts reproducible caches without removing user meanings or unrelated keys", () => {
    const cache = "magazine-reader-paragraph-translations-v1";
    const data = new Map([[cache, "large"], ["economist-reader-word-context-v1", "user meaning"], ["unrelated", "keep"]]);
    const storage = createReaderStorage({
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => { if (data.has(cache)) throw new DOMException("full", "QuotaExceededError"); data.set(key, value); },
      removeItem: (key) => { data.delete(key); },
    });
    storage.setItem(NOTES_STATE_KEY, "notes");
    expect(data.get(NOTES_STATE_KEY)).toBe("notes");
    expect(data.get("economist-reader-word-context-v1")).toBe("user meaning");
    expect(data.get("unrelated")).toBe("keep");
    expect(storage.getSnapshot().pendingCount).toBe(0);
  });

  it("survives denied access without reporting a successful save", () => {
    const storage = createReaderStorage({
      getItem() { throw new DOMException("denied", "SecurityError"); },
      setItem() { throw new DOMException("denied", "SecurityError"); },
      removeItem() { throw new DOMException("denied", "SecurityError"); },
    });
    expect(storage.getItem("key")).toBeNull();
    expect(storage.getSnapshot().readFailed).toBe(true);
    storage.setItem("key", "session data");
    expect(storage.getItem("key")).toBe("session data");
    expect(storage.getSnapshot().pendingCount).toBe(1);
  });
});
