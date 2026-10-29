import { PUBLICATIONS } from "../shared/publication";
import type { PublicationId } from "../shared/types";
import { flattenArticles, type ReaderIssue } from "./reader-model";

export interface PublicationShelfItem {
  publicationId: PublicationId;
  publicationName: string;
  issues: ReaderIssue[];
  latestIssue: ReaderIssue;
  recentIssue: ReaderIssue;
  issueCount: number;
  latestArticleCount: number;
}

export function buildPublicationShelf(issues: ReaderIssue[]): PublicationShelfItem[] {
  const publicationOrder = Object.keys(PUBLICATIONS) as PublicationId[];
  return publicationOrder.flatMap((publicationId) => {
    const publicationIssues = issues
      .filter((issue) => issue.publicationId === publicationId)
      .sort((a, b) => b.date.localeCompare(a.date));
    const latestIssue = publicationIssues[0];
    if (!latestIssue) return [];
    const recentIssue = publicationIssues.find((issue) => issue.progress > 0 && issue.progress < 100)
      ?? publicationIssues.find((issue) => issue.progress > 0)
      ?? latestIssue;
    return [{
      publicationId,
      publicationName: latestIssue.publicationName,
      issues: publicationIssues,
      latestIssue,
      recentIssue,
      issueCount: publicationIssues.length,
      latestArticleCount: flattenArticles(latestIssue).length,
    }];
  });
}
