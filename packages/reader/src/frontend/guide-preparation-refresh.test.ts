import { describe, expect, it } from "vitest";
import type { GuidePreparationStatus } from "../shared/types";
import { guidePreparationIssueNeedsRefresh } from "./guide-preparation-refresh";

function status(overrides: Partial<GuidePreparationStatus> = {}): GuidePreparationStatus {
  return {
    issueId: "new-yorker:2026-09-28",
    state: "running",
    total: 22,
    completed: 0,
    remaining: 22,
    sectionTotal: 7,
    sectionCompleted: 7,
    sectionRemaining: 0,
    attemptCount: 1,
    failedArticleIds: [],
    lastAttemptAt: "2026-09-27T01:00:00.000Z",
    lastCompletedAt: null,
    lastError: null,
    updatedAt: "2026-09-27T01:00:00.000Z",
    ...overrides,
  };
}

describe("guidePreparationIssueNeedsRefresh", () => {
  it("does not refetch the full issue for status-only polling changes", () => {
    expect(guidePreparationIssueNeedsRefresh(
      status(),
      status({ attemptCount: 2, updatedAt: "2026-09-27T01:00:01.000Z" }),
    )).toBe(false);
  });

  it("refreshes when article-guide progress changes", () => {
    expect(guidePreparationIssueNeedsRefresh(status(), status({ completed: 8, remaining: 14 }))).toBe(true);
  });

  it("refreshes when section-translation progress changes", () => {
    expect(guidePreparationIssueNeedsRefresh(
      status({ sectionCompleted: 3, sectionRemaining: 4 }),
      status({ sectionCompleted: 7, sectionRemaining: 0 }),
    )).toBe(true);
  });

  it("refreshes once when a running preparation reaches a terminal state", () => {
    expect(guidePreparationIssueNeedsRefresh(status(), status({ state: "error", lastError: "stopped" }))).toBe(true);
    expect(guidePreparationIssueNeedsRefresh(status(), status({ state: "complete", completed: 22, remaining: 0 }))).toBe(true);
  });
});
