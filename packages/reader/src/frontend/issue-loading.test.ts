import { describe, expect, it } from "vitest";
import type { IssueRecord } from "../shared/types";
import { loadIssueRecords } from "./issue-loading";

describe("isolated issue loading", () => {
  it("bounds simultaneous EPUB reads even for a much larger shelf", async () => {
    const summaries = Array.from({ length: 40 }, (_, index) => ({ id: String(index), label: String(index) }));
    let active = 0;
    let peak = 0;
    const result = await loadIssueRecords(summaries, async id => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return { id } as IssueRecord;
    });
    expect(peak).toBe(4);
    expect(result.records.map(record => record.id)).toEqual(summaries.map(issue => issue.id));
  });

  it("keeps successful issues in source order and records a failed issue for retry", async () => {
    const summaries = [{ id: "one", label: "First" }, { id: "broken", label: "Broken" }, { id: "two", label: "Second" }];
    const result = await loadIssueRecords(summaries, async (id) => {
      if (id === "broken") throw new Error("unreadable EPUB");
      return { id } as IssueRecord;
    });
    expect(result.records.map((record) => record.id)).toEqual(["one", "two"]);
    expect(result.failures).toEqual([{ issueId: "broken", label: "Broken", message: "unreadable EPUB" }]);
    expect((await loadIssueRecords(summaries, async (id) => ({ id }) as IssueRecord)).failures).toEqual([]);
  });
});
