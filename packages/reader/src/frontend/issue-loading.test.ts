import { describe, expect, it } from "vitest";
import type { IssueRecord } from "../shared/types";
import { loadIssueRecords } from "./issue-loading";

describe("isolated issue loading", () => {
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
