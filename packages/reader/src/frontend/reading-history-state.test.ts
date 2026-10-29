import { describe, expect, it } from "vitest";
import {
  clearReadingHistory,
  emptyReadingHistoryState,
  loadReadingHistoryState,
  READING_HISTORY_STATE_KEY,
  recordReadingHistory,
  saveReadingHistoryState,
} from "./reading-history-state";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("reading history state", () => {
  it("persists unique articles newest first", () => {
    const storage = new MemoryStorage();
    let state = recordReadingHistory(emptyReadingHistoryState(), "economist:2026-09-19", "a1", "2026-09-23T01:00:00.000Z");
    state = recordReadingHistory(state, "wired:2026-09-02", "w1", "2026-09-23T02:00:00.000Z");
    saveReadingHistoryState(storage, state);

    expect(loadReadingHistoryState(storage).items.map((item) => item.articleId)).toEqual(["w1", "a1"]);
    expect(storage.getItem(READING_HISTORY_STATE_KEY)).toContain("lastOpenedAt");
  });

  it("reopening an article updates its timestamp instead of duplicating it", () => {
    let state = recordReadingHistory(emptyReadingHistoryState(), "economist:2026-09-19", "a1", "2026-09-23T01:00:00.000Z");
    state = recordReadingHistory(state, "wired:2026-09-02", "w1", "2026-09-23T02:00:00.000Z");
    state = recordReadingHistory(state, "economist:2026-09-19", "a1", "2026-09-23T03:00:00.000Z");

    expect(state.items).toHaveLength(2);
    expect(state.items[0]).toEqual({ issueId: "economist:2026-09-19", articleId: "a1", lastOpenedAt: "2026-09-23T03:00:00.000Z" });
  });

  it("canonicalizes legacy Economist issue ids and keeps the newest duplicate", () => {
    const storage = new MemoryStorage();
    storage.setItem(READING_HISTORY_STATE_KEY, JSON.stringify({
      version: 1,
      items: [
        { issueId: "2026-09-19", articleId: "a1", lastOpenedAt: "2026-09-23T01:00:00.000Z" },
        { issueId: "economist:2026-09-19", articleId: "a1", lastOpenedAt: "2026-09-23T04:00:00.000Z" },
      ],
    }));

    expect(loadReadingHistoryState(storage).items).toEqual([
      { issueId: "economist:2026-09-19", articleId: "a1", lastOpenedAt: "2026-09-23T04:00:00.000Z" },
    ]);
  });

  it("clears history and safely falls back from broken storage", () => {
    const storage = new MemoryStorage();
    storage.setItem(READING_HISTORY_STATE_KEY, "not-json");
    expect(loadReadingHistoryState(storage)).toEqual(emptyReadingHistoryState());

    recordReadingHistory(emptyReadingHistoryState(), "wired:2026-09-02", "w1", "2026-09-23T02:00:00.000Z");
    expect(clearReadingHistory()).toEqual(emptyReadingHistoryState());
  });
});
