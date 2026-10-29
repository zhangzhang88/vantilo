import { describe, expect, it } from "vitest";
import {
  addToReadLater,
  emptyReadLaterState,
  isReadLater,
  loadReadLaterState,
  READ_LATER_STATE_KEY,
  removeFromReadLater,
  saveReadLaterState,
  toggleReadLater,
} from "./read-later-state";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("read later state", () => {
  it("persists items newest first", () => {
    const storage = new MemoryStorage();
    let state = addToReadLater(emptyReadLaterState(), "economist:2026-09-19", "a1", "2026-09-23T01:00:00.000Z");
    state = addToReadLater(state, "wired:2026-09-02", "w1", "2026-09-23T02:00:00.000Z");
    saveReadLaterState(storage, state);

    expect(loadReadLaterState(storage).items.map((item) => item.articleId)).toEqual(["w1", "a1"]);
    expect(storage.getItem(READ_LATER_STATE_KEY)).toContain("savedAt");
  });

  it("uses issueId plus articleId as identity", () => {
    let state = addToReadLater(emptyReadLaterState(), "economist:2026-09-19", "shared", "2026-09-23T01:00:00.000Z");
    state = addToReadLater(state, "wired:2026-09-02", "shared", "2026-09-23T02:00:00.000Z");

    expect(isReadLater(state, "economist:2026-09-19", "shared")).toBe(true);
    expect(isReadLater(state, "wired:2026-09-02", "shared")).toBe(true);
    state = removeFromReadLater(state, "economist:2026-09-19", "shared");
    expect(isReadLater(state, "economist:2026-09-19", "shared")).toBe(false);
    expect(isReadLater(state, "wired:2026-09-02", "shared")).toBe(true);
  });

  it("canonicalizes legacy Economist issue ids and keeps the newest duplicate", () => {
    const storage = new MemoryStorage();
    storage.setItem(READ_LATER_STATE_KEY, JSON.stringify({
      version: 1,
      items: [
        { issueId: "2026-09-19", articleId: "a1", savedAt: "2026-09-23T01:00:00.000Z" },
        { issueId: "economist:2026-09-19", articleId: "a1", savedAt: "2026-09-23T03:00:00.000Z" },
      ],
    }));

    expect(loadReadLaterState(storage)).toEqual({
      version: 1,
      items: [{ issueId: "economist:2026-09-19", articleId: "a1", savedAt: "2026-09-23T03:00:00.000Z" }],
    });
  });

  it("toggles items and survives malformed storage", () => {
    let state = toggleReadLater(emptyReadLaterState(), "economist:2026-09-19", "a1", "2026-09-23T01:00:00.000Z");
    expect(isReadLater(state, "economist:2026-09-19", "a1")).toBe(true);
    state = toggleReadLater(state, "economist:2026-09-19", "a1");
    expect(state).toEqual(emptyReadLaterState());

    const storage = new MemoryStorage();
    storage.setItem(READ_LATER_STATE_KEY, "not-json");
    expect(loadReadLaterState(storage)).toEqual(emptyReadLaterState());
  });
});
