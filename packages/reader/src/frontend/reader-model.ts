import type { Article, IssueRecord } from "../shared/types";
import { fixedSectionNameZh } from "../shared/section-translations";

export interface ReaderArticle {
  id: string;
  issueId: string;
  author: string;
  section: string;
  sectionZh: string;
  title: string;
  titleZh: string;
  subtitle: string;
  subtitleZh: string;
  summaryZh: string;
  minutes: number;
  progress: number;
  paragraphs: string[];
  wordCount: number;
  sourceUrl: string | null;
}

export interface ReaderSection {
  name: string;
  nameZh: string;
  articles: ReaderArticle[];
}

export interface ReaderIssue {
  id: string;
  publicationId: IssueRecord["publicationId"];
  publicationName: string;
  date: string;
  displayDate: string;
  label: string;
  description: string;
  progress: number;
  coverKicker: string;
  coverMark: string;
  coverTitle: string;
  coverSubtitle: string;
  sections: ReaderSection[];
}


export function sectionNameZh(
  section: string,
  publicationId: IssueRecord["publicationId"] = "economist",
  translations: Record<string, string> = {},
): string {
  return translations[section] ?? fixedSectionNameZh(publicationId, section) ?? section;
}

export type ProgressMap = Record<string, number>;

export function articleKey(issueId: string, articleId: string): string {
  return `${issueId}:${articleId}`;
}

export function articleParagraphs(article: Pick<Article, "bodyText">): string[] {
  return article.bodyText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function articleMinutes(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 220));
}

export function displayIssueDate(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

function coverDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
    .format(parsed)
    .toUpperCase();
  return `${month}\n${parsed.getUTCDate()}`;
}

function readerArticle(
  article: Article,
  progress: ProgressMap,
  sectionTranslations: Record<string, string>,
): ReaderArticle {
  return {
    id: article.id,
    issueId: article.issueId,
    author: article.author ?? "",
    section: article.section,
    sectionZh: sectionNameZh(article.section, article.publicationId, sectionTranslations),
    title: article.title,
    titleZh: article.readerGuide?.titleZh ?? "",
    subtitle: article.subtitle ?? article.kicker ?? "",
    subtitleZh: article.readerGuide?.subtitleZh ?? "",
    summaryZh: article.readerGuide?.summaryZh ?? "",
    minutes: articleMinutes(article.wordCount),
    progress: progress[articleKey(article.issueId, article.id)] ?? 0,
    paragraphs: articleParagraphs(article),
    wordCount: article.wordCount,
    sourceUrl: article.sourceUrl,
  };
}

export function toReaderIssue(issue: IssueRecord, progress: ProgressMap): ReaderIssue {
  const sectionTranslations = issue.sectionTranslations ?? {};
  const mapped = issue.articles.map((article) => readerArticle(article, progress, sectionTranslations));
  const sectionNames = [
    ...issue.sections,
    ...mapped.map((article) => article.section).filter((section) => !issue.sections.includes(section)),
  ];
  const sections = sectionNames
    .map((name) => ({
      name,
      nameZh: sectionNameZh(name, issue.publicationId, sectionTranslations),
      articles: mapped.filter((article) => article.section === name),
    }))
    .filter((section) => section.articles.length > 0);
  const totalProgress = mapped.reduce((sum, article) => sum + article.progress, 0);
  const issueProgress = mapped.length ? Math.round(totalProgress / mapped.length) : 0;

  return {
    id: issue.id,
    publicationId: issue.publicationId,
    publicationName: issue.publicationName,
    date: issue.date,
    displayDate: displayIssueDate(issue.date),
    label: issue.label,
    description: `${issue.publicationName} · 真实 EPUB · ${mapped.length} 篇文章 · ${sections.length} 个栏目`,
    progress: issueProgress,
    coverKicker: issue.publicationName.toUpperCase(),
    coverMark: issue.publicationName.replace(/^The\s+/i, "").charAt(0).toUpperCase() || "M",
    coverTitle: coverDate(issue.date),
    coverSubtitle: `${mapped.length} articles · Local EPUB`,
    sections,
  };
}

export function flattenArticles(issue: ReaderIssue): ReaderArticle[] {
  return issue.sections.flatMap((section) => section.articles);
}

export function resolveIssueContinueArticle(
  issue: ReaderIssue,
  lastPosition: { issueId: string; articleId: string } | null | undefined,
): ReaderArticle | undefined {
  const articles = flattenArticles(issue);
  const exactLastArticle = lastPosition?.issueId === issue.id
    ? articles.find((article) => article.id === lastPosition.articleId)
    : undefined;
  return exactLastArticle
    ?? articles.find((article) => article.progress > 0 && article.progress < 100)
    ?? articles[0];
}

export function findIssue(issues: ReaderIssue[], issueId: string): ReaderIssue | undefined {
  return issues.find((issue) => issue.id === issueId);
}

export function findArticle(
  issues: ReaderIssue[],
  articleId: string,
  issueId?: string,
): { issue: ReaderIssue; article: ReaderArticle } | undefined {
  for (const issue of issues) {
    if (issueId && issue.id !== issueId) continue;
    const article = flattenArticles(issue).find((candidate) => candidate.id === articleId);
    if (article) return { issue, article };
  }
  return undefined;
}
