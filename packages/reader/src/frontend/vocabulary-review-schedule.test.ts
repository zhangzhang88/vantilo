import { describe, expect, it } from "vitest";
import {
  isVocabularyReviewDue,
  scheduleVocabularyAfterReview,
  vocabularyReviewIntervalDays,
} from "./vocabulary-review-schedule";

describe("vocabulary review schedule", () => {
  it("uses simple state-based intervals for learning states", () => {
    expect([1, 2, 3, 4].map((level) => vocabularyReviewIntervalDays(level as 1 | 2 | 3 | 4))).toEqual([1, 3, 7, 30]);
  });

  it("treats an unscheduled learning word as due and schedules it after review", () => {
    const now = new Date("2026-09-22T00:00:00.000Z");
    expect(isVocabularyReviewDue([], "signal", 2, now)).toBe(true);
    const records = scheduleVocabularyAfterReview([], "signal", 2, now);
    expect(records[0]).toMatchObject({ familiarity: 2, intervalDays: 3, reviewCount: 1 });
    expect(records[0]?.dueAt).toBe("2026-09-25T00:00:00.000Z");
    expect(isVocabularyReviewDue(records, "signal", 2, new Date("2026-09-24T23:59:59.000Z"))).toBe(false);
    expect(isVocabularyReviewDue(records, "signal", 2, new Date("2026-09-25T00:00:00.000Z"))).toBe(true);
  });

  it("uses exact elapsed durations rather than calendar-day boundaries", () => {
    const reviewedAt = new Date("2026-09-26T23:30:00.000Z");
    const records = scheduleVocabularyAfterReview([], "night", 1, reviewedAt);
    expect(records[0]?.dueAt).toBe("2026-09-27T23:30:00.000Z");
    expect(isVocabularyReviewDue(records, "night", 1, new Date("2026-09-27T08:00:00.000Z"))).toBe(false);
    expect(isVocabularyReviewDue(records, "night", 1, new Date("2026-09-27T23:30:00.000Z"))).toBe(true);
  });

  it("keeps the interval state-based even as reviewCount increases", () => {
    const first = scheduleVocabularyAfterReview([], "steady", 3, new Date("2026-09-01T00:00:00.000Z"));
    const second = scheduleVocabularyAfterReview(first, "steady", 3, new Date("2026-09-08T00:00:00.000Z"));
    expect(second[0]).toMatchObject({ familiarity: 3, intervalDays: 7, reviewCount: 2 });
    expect(second[0]?.dueAt).toBe("2026-09-15T00:00:00.000Z");
  });

  it("makes a word due immediately when its learning state changed outside review", () => {
    const now = new Date("2026-09-22T00:00:00.000Z");
    const records = scheduleVocabularyAfterReview([], "signal", 4, now);
    expect(isVocabularyReviewDue(records, "signal", 1, new Date("2026-09-23T00:00:00.000Z"))).toBe(true);
  });

  it("removes ignored and known words from the schedule", () => {
    const now = new Date("2026-09-22T00:00:00.000Z");
    const records = scheduleVocabularyAfterReview([], "signal", 3, now);
    expect(scheduleVocabularyAfterReview(records, "signal", 5, now)).toEqual([]);
    expect(scheduleVocabularyAfterReview(records, "signal", 0, now)).toEqual([]);
  });
});
