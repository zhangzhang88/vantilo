import type { IssueRecord, IssueSummary } from "../shared/types";

export interface IssueLoadFailure { issueId: string; label: string; message: string }
export async function loadIssueRecords(
  summaries: Pick<IssueSummary, "id" | "label">[],
  fetchIssue: (id: string) => Promise<IssueRecord>,
): Promise<{ records: IssueRecord[]; failures: IssueLoadFailure[] }> {
  const results: PromiseSettledResult<IssueRecord>[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < summaries.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await fetchIssue(summaries[index].id) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, summaries.length) }, worker));
  const records: IssueRecord[] = [];
  const failures: IssueLoadFailure[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") records.push(result.value);
    else failures.push({ issueId: summaries[index].id, label: summaries[index].label, message: result.reason instanceof Error ? result.reason.message : "读取失败" });
  });
  return { records, failures };
}
