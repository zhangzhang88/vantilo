import type { IssueRecord, IssueSummary } from "../shared/types";

export interface IssueLoadFailure { issueId: string; label: string; message: string }
export async function loadIssueRecords(
  summaries: Pick<IssueSummary, "id" | "label">[],
  fetchIssue: (id: string) => Promise<IssueRecord>,
): Promise<{ records: IssueRecord[]; failures: IssueLoadFailure[] }> {
  const results = await Promise.allSettled(summaries.map((summary) => fetchIssue(summary.id)));
  const records: IssueRecord[] = [];
  const failures: IssueLoadFailure[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") records.push(result.value);
    else failures.push({ issueId: summaries[index].id, label: summaries[index].label, message: result.reason instanceof Error ? result.reason.message : "读取失败" });
  });
  return { records, failures };
}
