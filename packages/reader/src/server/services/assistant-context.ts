import { createHash } from "node:crypto";
import type { AssistantScope } from "../../shared/assistant-scope.js";
import type { BookImportService } from "./book-import-service.js";
import type { IssueService } from "./issue-service.js";
import type { CodexPrepService } from "./codex-prep-service.js";
import { bookCategoryLabel } from "../../shared/book-category.js";
import type { BookCategoryService } from "./book-category-service.js";
import { lessonParagraphs } from "../../shared/book-lesson.js";

interface Source { id: string; title: string; paragraphs: string[]; }
export interface AssistantContext {
  key: string; fingerprint: string; label: string; overview: string;
  document?: { paragraphCount: number; fullText?: string };
  read: (plan: string, currentParagraphIndex?: number) => string;
}

/** Directory entries are not evidence. Only complete bounded paragraphs enter READ WINDOWS. */
export function readAssistantSources(sources: Source[], raw: string, currentParagraphIndex?: number): string {
  let plan: { queries?: unknown; reads?: unknown };
  try { plan = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new Error("未能取得有效的原文读取计划，请重试。"); }
  if (!plan || typeof plan !== "object") throw new Error("原文读取计划无效");
  const queries = Array.isArray(plan.queries) ? plan.queries.filter((q): q is string => typeof q === "string" && q.trim().length >= 2).slice(0, 6).map(q => q.toLocaleLowerCase().slice(0, 120)) : [];
  const windows = new Map<string, { source: Source; indexes: Set<number> }>();
  const add = (source: Source, start: number, count: number) => {
    const item = windows.get(source.id) ?? { source, indexes: new Set<number>() };
    for (let i = Math.max(0, start); i < Math.min(source.paragraphs.length, start + count); i++) item.indexes.add(i);
    windows.set(source.id, item);
  };
  if (sources.length === 1 && currentParagraphIndex !== undefined) add(sources[0]!, Math.max(0, currentParagraphIndex - 1), 3);
  if (Array.isArray(plan.reads)) for (const entry of plan.reads.slice(0, 6)) {
    const source = sources.find(source => source.id === entry?.id);
    if (source && Number.isInteger(entry.start) && entry.start >= 0) add(source, entry.start, Math.min(6, Math.max(1, Number.isInteger(entry.count) ? entry.count : 3)));
  }
  if (queries.length) {
    const hits = sources.flatMap(source => source.paragraphs.map((text, i) => ({ source, i, score: queries.filter(q => text.toLocaleLowerCase().includes(q)).length }))).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score).slice(0, 10);
    for (const hit of hits) add(hit.source, Math.max(0, hit.i - 1), 3);
  }
  let remaining = 24000;
  const text: string[] = [];
  for (const { source, indexes } of windows.values()) for (const i of indexes) {
    const paragraph = source.paragraphs[i]!;
    if (paragraph.length > remaining) continue; // Never silently cut an evidence paragraph.
    text.push(`${source.title} [${source.id}:P${i + 1}]\n${paragraph}`); remaining -= paragraph.length;
  }
  return text.length ? `VERIFIED READ WINDOWS (only these paragraphs were read; other material remains unread):\n${text.join("\n\n")}` : "VERIFIED READ WINDOWS: none. Answer directory/recommendation questions only from metadata; ask for a more specific source before making content claims.";
}

export async function buildAssistantContext(scope: AssistantScope, books: BookImportService, issues: IssueService, prep: CodexPrepService, categories: BookCategoryService): Promise<AssistantContext> {
  const sources: Source[] = [], directory: string[] = [], fingerprints: string[] = [];
  const categoryAssignments = ["all", "books", "chapter", "lesson"].includes(scope.kind) ? await categories.assignments() : {};
  let label = "全部书刊";
  const source = (title: string, paragraphs: string[]) => { const id = `S${sources.length + 1}`; sources.push({ id, title, paragraphs }); return `${id} ${title} (${paragraphs.length} paragraphs)`; };
  if (["all", "books", "chapter", "lesson"].includes(scope.kind)) {
    const selected = "bookId" in scope ? [await books.getBook(scope.bookId)] : await Promise.all((await books.listBooks()).map(book => books.getBook(book.id)));
    if (selected.some(book => !book)) throw new Error("所选图书已不存在");
    for (const book of selected) {
      if (!book) continue;
      fingerprints.push(book.id, book.sourceFingerprint);
      directory.push(`BOOK ${JSON.stringify({ title: book.title, authors: book.authors, category: bookCategoryLabel(categoryAssignments[book.id]) })}`);
      if (scope.kind === "lesson") {
        const lesson = prep.list(book.id).find(item => item.id === scope.lessonId && item.sourceFingerprint === book.sourceFingerprint);
        if (!lesson) throw new Error("所选精选阅读已不存在");
        label = lesson.titleZh; fingerprints.push(JSON.stringify(lesson));
        directory.push(source(`《${book.title}》精选阅读《${lesson.titleZh}》（改编材料）`, lessonParagraphs(lesson)));
      } else {
        const chapters = scope.kind === "chapter" ? book.chapters.filter(chapter => chapter.id === scope.chapterId) : book.chapters;
        if (!chapters.length && scope.kind === "chapter") throw new Error("所选章节已不存在");
        for (const chapter of chapters) directory.push(source(`《${book.title}》 / ${chapter.title}`, chapter.paragraphs));
        if (scope.kind === "chapter") label = `${book.title} · ${chapters[0]!.title}`;
      }
    }
    if (scope.kind === "books") label = "电子书书架";
  }
  if (["all", "magazines", "publication", "issue", "article"].includes(scope.kind)) {
    const selected = "issueId" in scope ? [await issues.getIssue(scope.issueId)] : await Promise.all((await issues.listIssues()).filter(issue => scope.kind !== "publication" || issue.publicationId === scope.publicationId).map(issue => issues.getIssue(issue.id)));
    if (selected.some(issue => !issue)) throw new Error("所选期刊已不存在");
    if (scope.kind === "publication" && !selected.length) throw new Error("所选刊物已不存在");
    for (const issue of selected) {
      if (!issue) continue;
      fingerprints.push(issue.id, issue.sourceFingerprint);
      directory.push(`ISSUE ${JSON.stringify({ title: issue.title, publication: issue.publicationName, date: issue.date })}`);
      const articles = scope.kind === "article" ? issue.articles.filter(article => article.id === scope.articleId) : issue.articles;
      if (!articles.length && scope.kind === "article") throw new Error("所选文章已不存在");
      for (const article of articles) directory.push(source(`${issue.publicationName} ${issue.date} / ${article.section} / ${article.title}`, article.bodyText.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)));
      if (scope.kind === "issue") label = `${issue.publicationName} · ${issue.label}`;
      if (scope.kind === "article") label = articles[0]!.title;
      if (scope.kind === "publication") label = issue.publicationName;
    }
    if (scope.kind === "magazines") label = "期刊书架";
  }
  // Always prioritize the catalog of books/issues before the potentially very long TOC.
  const ordered = [...directory.filter(row => /^(BOOK|ISSUE) /.test(row)), ...directory.filter(row => !/^(BOOK|ISSUE) /.test(row))];
  const visible: string[] = []; let size = 0;
  for (const row of ordered) { if (size + row.length > 50000) break; visible.push(row); size += row.length + 1; }
  const overview = visible.join("\n");
  const documentSource = ["article", "chapter", "lesson"].includes(scope.kind) ? sources[0] : undefined;
  const fullText = documentSource?.paragraphs.map((paragraph, index) => `${documentSource.title} [S1:P${index + 1}]\n${paragraph}`).join("\n\n");
  return { key: `assistant:${JSON.stringify(scope)}`, fingerprint: createHash("sha256").update(JSON.stringify(fingerprints)).update(directory.join("\n")).digest("hex"), label,
    overview: `Current scope: ${label}. DIRECTORY ONLY (titles/authors/categories, not proof of reading):\n${overview}${visible.length < directory.length ? "\nDirectory truncated; some entries are not shown." : ""}`,
    ...(documentSource ? { document: { paragraphCount: documentSource.paragraphs.length, ...(fullText && fullText.length <= 24000 ? { fullText: `VERIFIED READ WINDOWS (complete current text):\n${fullText}` } : {}) } } : {}),
    read: (plan, currentParagraphIndex) => readAssistantSources(sources, plan, currentParagraphIndex) };
}
