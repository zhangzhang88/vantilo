import type { IssueRecord, IssueSummary } from "../shared/types";

export function issueNeedsSearchRefresh(issue: IssueRecord): boolean {
  return issue.articles.some((article) => !article.readerGuide);
}

export function searchRefreshIssueIds(summaries: IssueSummary[], current: IssueRecord[]): string[] {
  const currentById = new Map(current.map((issue) => [issue.id, issue]));
  return summaries.flatMap((summary) => {
    const issue = currentById.get(summary.id);
    return !issue || issueNeedsSearchRefresh(issue) ? [summary.id] : [];
  });
}

export function mergeSearchRefreshedIssues(
  summaries: IssueSummary[],
  current: IssueRecord[],
  refreshed: IssueRecord[],
): IssueRecord[] {
  const currentById = new Map(current.map((issue) => [issue.id, issue]));
  const refreshedById = new Map(refreshed.map((issue) => [issue.id, issue]));
  return summaries.flatMap((summary) => {
    const issue = refreshedById.get(summary.id) ?? currentById.get(summary.id);
    return issue ? [issue] : [];
  });
}
