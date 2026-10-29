import type { PublicationId } from "../shared/types";
import { flattenArticles, type ReaderArticle, type ReaderIssue } from "./reader-model";

export type SearchPublicationFilter = "all" | PublicationId;
export type SearchMatchField = "title" | "titleZh" | "subtitle" | "subtitleZh" | "summaryZh" | "body";

export interface LibrarySearchResult {
  issueId: string;
  articleId: string;
  publicationId: PublicationId;
  publicationName: string;
  issueDate: string;
  displayDate: string;
  title: string;
  titleZh: string;
  subtitle: string;
  summaryZh: string;
  section: string;
  sectionZh: string;
  snippet: string;
  matchField: SearchMatchField;
  score: number;
}

interface SearchField {
  field: SearchMatchField;
  value: string;
  weight: number;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase();
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function metadataFields(article: ReaderArticle): SearchField[] {
  return [
    { field: "title", value: article.title, weight: 100 },
    { field: "titleZh", value: article.titleZh, weight: 95 },
    { field: "subtitle", value: article.subtitle, weight: 75 },
    { field: "subtitleZh", value: article.subtitleZh, weight: 70 },
    { field: "summaryZh", value: article.summaryZh, weight: 60 },
  ];
}

function bodyMatch(article: ReaderArticle, normalizedQuery: string): SearchField | undefined {
  const paragraph = article.paragraphs.find((candidate) => normalize(candidate).includes(normalizedQuery));
  return paragraph ? { field: "body", value: paragraph, weight: 30 } : undefined;
}

function snippetAround(value: string, query: string, maxLength = 220): string {
  const text = compactText(value);
  if (!text) return "";
  const matchIndex = normalize(text).indexOf(normalize(query));
  if (matchIndex < 0) return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
  if (text.length <= maxLength) return text;

  const context = Math.floor((maxLength - query.length) / 2);
  let start = Math.max(0, matchIndex - context);
  let end = Math.min(text.length, start + maxLength);
  if (end === text.length) start = Math.max(0, end - maxLength);

  const leftBoundary = text.lastIndexOf(" ", start);
  if (leftBoundary > 0 && matchIndex - leftBoundary < maxLength) start = leftBoundary + 1;
  const rightBoundary = text.indexOf(" ", end);
  if (rightBoundary > end && rightBoundary - start <= maxLength + 24) end = rightBoundary;

  const excerpt = text.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${excerpt}${end < text.length ? "…" : ""}`;
}

function preferredSnippetField(matches: SearchField[]): SearchField {
  const body = matches.find((candidate) => candidate.field === "body");
  if (body) return body;
  const summary = matches.find((candidate) => candidate.field === "summaryZh");
  if (summary) return summary;
  const subtitle = matches.find((candidate) => candidate.field === "subtitle" || candidate.field === "subtitleZh");
  return subtitle ?? matches[0];
}

export function searchMagazineLibrary(
  issues: ReaderIssue[],
  query: string,
  publicationFilter: SearchPublicationFilter = "all",
): LibrarySearchResult[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];
  const normalizedQuery = normalize(trimmedQuery);
  const results: LibrarySearchResult[] = [];

  for (const issue of issues) {
    if (publicationFilter !== "all" && issue.publicationId !== publicationFilter) continue;
    for (const article of flattenArticles(issue)) {
      const matches = metadataFields(article).filter((candidate) =>
        candidate.value && normalize(candidate.value).includes(normalizedQuery),
      );
      const body = bodyMatch(article, normalizedQuery);
      if (body) matches.push(body);
      if (!matches.length) continue;

      const exactTitle = normalize(article.title) === normalizedQuery || normalize(article.titleZh) === normalizedQuery;
      const strongestMatch = matches.reduce((best, candidate) => candidate.weight > best.weight ? candidate : best);
      const score = strongestMatch.weight + (exactTitle ? 40 : 0) + Math.min(matches.length - 1, 4) * 3;
      const snippetField = preferredSnippetField(matches);
      results.push({
        issueId: issue.id,
        articleId: article.id,
        publicationId: issue.publicationId,
        publicationName: issue.publicationName,
        issueDate: issue.date,
        displayDate: issue.displayDate,
        title: article.title,
        titleZh: article.titleZh,
        subtitle: article.subtitle,
        summaryZh: article.summaryZh,
        section: article.section,
        sectionZh: article.sectionZh,
        snippet: snippetAround(snippetField.value, trimmedQuery),
        matchField: strongestMatch.field,
        score,
      });
    }
  }

  return results.sort((left, right) =>
    right.score - left.score
    || right.issueDate.localeCompare(left.issueDate)
    || left.title.localeCompare(right.title),
  );
}

export function searchMatchLabel(field: SearchMatchField): string {
  if (field === "body") return "正文";
  if (field === "summaryZh") return "中文摘要";
  if (field === "titleZh") return "中文标题";
  if (field === "subtitleZh") return "中文副标题";
  if (field === "subtitle") return "副标题";
  return "标题";
}
