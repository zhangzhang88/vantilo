import { describe, expect, it } from "vitest";
import { LESSON_READER_STATE_KEY, lessonReadingKey, loadLessonReaderState, saveLessonReaderState } from "./lesson-reader-state";

describe("lesson reading progress", () => {
  it("persists and restores lesson anchors without writing original book or magazine state", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const key = lessonReadingKey("book:test", "lesson:test");
    const state = { version: 1 as const, progress: { [key]: 35 }, positions: { [key]: { paragraphIndex: 1, paragraphText: "Lesson paragraph.", viewportOffset: 25 } } };
    saveLessonReaderState(storage, state);
    expect([...values.keys()]).toEqual([LESSON_READER_STATE_KEY]);
    expect(loadLessonReaderState(storage)).toEqual(state);
    values.set(LESSON_READER_STATE_KEY, JSON.stringify({ ...state, progress: { ...state.progress, "reading:book:original": 90, [key]: 120 } }));
    expect(loadLessonReaderState(storage).progress).toEqual({ [key]: 100 });
  });
  it("recovers from corrupt preference data without modifying it", () => {
    expect(loadLessonReaderState({ getItem: () => "invalid json" })).toEqual({ version: 1, progress: {}, positions: {} });
  });
});
