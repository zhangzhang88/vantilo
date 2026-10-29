import type { ReaderArticle, ReaderIssue, ReaderSection } from "./reader-model";
import { isReadLater, type ReadLaterState } from "./read-later-state";

export type IssueReadingFilter = "all" | "unread" | "reading" | "read-later" | "read";

export interface FilteredIssueArticle {
  article: ReaderArticle;
  originalIndex: number;
}

export interface FilteredIssueSection extends Omit<ReaderSection, "articles"> {
  articles: FilteredIssueArticle[];
}

export interface IssueReadingFilterCounts {
  all: number;
  unread: number;
  reading: number;
  "read-later": number;
  read: number;
}

export function matchesIssueReadingFilter(
  article: ReaderArticle,
  issueId: string,
  readLaterState: ReadLaterState,
  filter: IssueReadingFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "unread") return article.progress === 0;
  if (filter === "reading") return article.progress > 0 && article.progress < 100;
  if (filter === "read") return article.progress === 100;
  return isReadLater(readLaterState, issueId, article.id);
}

export function matchesIssueTocQuery(article: ReaderArticle, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return [article.title, article.titleZh, article.subtitle, article.subtitleZh, article.summaryZh]
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

export function issueReadingFilterCounts(issue: ReaderIssue, readLaterState: ReadLaterState, query = ""): IssueReadingFilterCounts {
  const articles = issue.sections.flatMap((section) => section.articles).filter((article) => matchesIssueTocQuery(article, query));
  return {
    all: articles.length,
    unread: articles.filter((article) => article.progress === 0).length,
    reading: articles.filter((article) => article.progress > 0 && article.progress < 100).length,
    "read-later": articles.filter((article) => isReadLater(readLaterState, issue.id, article.id)).length,
    read: articles.filter((article) => article.progress === 100).length,
  };
}

export function filterIssueSections(
  issue: ReaderIssue,
  readLaterState: ReadLaterState,
  filter: IssueReadingFilter,
  query = "",
): FilteredIssueSection[] {
  return issue.sections
    .map((section) => ({
      name: section.name,
      nameZh: section.nameZh,
      articles: section.articles
        .map((article, originalIndex) => ({ article, originalIndex }))
        .filter(({ article }) => matchesIssueTocQuery(article, query) && matchesIssueReadingFilter(article, issue.id, readLaterState, filter)),
    }))
    .filter((section) => section.articles.length > 0);
}
