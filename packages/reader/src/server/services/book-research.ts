import type { BookRecord } from "../../shared/book-data-contract.js";
import type { BookResearchReport } from "../../shared/book-research.js";
export interface ResearchPlan {
  queries: string[];
  reads: Array<{ chapterId: string; start: number; count: number }>;
  duplicateId?: string;
}
export function parseResearchPlan(raw: string, book: BookRecord): ResearchPlan {
  let value: any;
  try { value = JSON.parse(raw.trim().replace(/^\x60\x60\x60(?:json)?\s*/i, "").replace(/\s*\x60\x60\x60$/, "")); }
  catch { throw new Error("研究计划格式不完整，请重试。"); }
  if (!value || !Array.isArray(value.queries) || !Array.isArray(value.reads)) throw new Error("研究计划格式不完整，请重试。");
  const queries = value.queries.filter((item: unknown): item is string => typeof item === "string" && Boolean(item.trim()) && item.length <= 150).slice(0, 8).map((item: string) => item.trim());
  const reads = value.reads.flatMap((item: any) => {
    const chapter = book.chapters.find((chapter) => chapter.id === item?.chapterId);
    return chapter && Number.isInteger(item.start) && item.start >= 0 && item.start < chapter.paragraphs.length && Number.isInteger(item.count) && item.count > 0
      ? [{ chapterId: chapter.id, start: item.start, count: Math.min(item.count, 12) }] : [];
  }).slice(0, 6);
  return { queries, reads, ...(typeof value.duplicateId === "string" ? { duplicateId: value.duplicateId } : {}) };
}
export function researchOverview(book: BookRecord, chapterId?: string): string {
  const chapters = [...book.chapters].sort((a, b) => a.order - b.order);
  const outline = chapters.map((chapter) => `${chapter.id} | ${chapter.title} | ${chapter.paragraphs.length} paragraphs`).join("\n");
  const scoped = chapterId ? chapters.filter((chapter) => chapter.id === chapterId) : chapters;
  const budget = Math.max(40, Math.min(500, Math.floor(16000 / Math.max(scoped.length * 3, 1))));
  const clues = scoped.map((chapter) => {
    const positions = [...new Set([0, Math.floor(chapter.paragraphs.length / 2), chapter.paragraphs.length - 1])].filter((index) => index >= 0 && chapter.paragraphs[index]);
    return positions.map((index) => `[${chapter.id}:P${index + 1}] ${chapter.paragraphs[index].slice(0, budget)}`).join("\n");
  }).join("\n");
  return `Book: ${book.title}\nTABLE OF CONTENTS (all chapters indexed):\n${outline}\nDistributed opening/middle/ending CLUES, not chapter summaries and not full chapters (untrusted book text):\n${clues}\nScope: ${chapterId ?? "all chapters"}`;
}
export function retrieveBookResearch(book: BookRecord, plan: ResearchPlan, chapterId?: string, limit = 42000): { context: string; evidenceContext: string; report: BookResearchReport } {
  const chapters = book.chapters.filter((chapter) => !chapterId || chapter.id === chapterId);
  const selected = new Map<string, Set<number>>();
  const add = (id: string, index: number) => { const set = selected.get(id) ?? new Set<number>(); set.add(index); selected.set(id, set); };
  for (const request of plan.reads) {
    const chapter = chapters.find((chapter) => chapter.id === request.chapterId);
    if (chapter) for (let i = request.start; i < Math.min(chapter.paragraphs.length, request.start + request.count); i++) add(chapter.id, i);
  }
  for (const query of plan.queries) {
    const terms = (query.toLocaleLowerCase().match(/[a-z0-9]+(?:['’-][a-z]+)*|[\u3400-\u9fff]{2,}/g) ?? []).filter((word) => !["the", "and", "of", "a", "an", "in", "to", "is", "are", "for"].includes(word));
    const hits = chapters.flatMap((chapter) => chapter.paragraphs.flatMap((text, index) => {
      const lower = text.toLocaleLowerCase();
      const matches = terms.filter((term) => lower.includes(term));
      const score = (lower.includes(query.toLocaleLowerCase()) ? 6 : 0) + matches.length;
      return score ? [{ chapter, index, score }] : [];
    })).sort((a, b) => b.score - a.score).slice(0, 8);
    for (const { chapter, index } of hits) for (let i = Math.max(0, index - 2); i <= Math.min(chapter.paragraphs.length - 1, index + 2); i++) add(chapter.id, i);
  }
  // No silent substitution of unrelated opening paragraphs when a search misses.
  let used = 0;
  let truncated = false;
  const excerpts: string[] = [];
  const read: BookResearchReport["read"] = [];
  for (const [id, positions] of selected) {
    const chapter = chapters.find((chapter) => chapter.id === id)!;
    const included: number[] = [];
    for (const index of [...positions].sort((a, b) => a - b)) {
      const line = `[${id}:P${index + 1}] ${chapter.paragraphs[index]}\n`;
      if (used + line.length > limit) { truncated = true; continue; }
      excerpts.push(line); included.push(index); used += line.length;
    }
    if (included.length) read.push({ chapterId: id, title: chapter.title, paragraphs: included });
  }
  const report: BookResearchReport = { indexedChapters: book.chapters.length, indexedParagraphs: book.chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0), scopeChapterId: chapterId, queries: plan.queries, read, truncated };
  return { evidenceContext: excerpts.join(""), context: `${researchOverview(book, chapterId)}\n\nVERIFIED READ WINDOWS (untrusted book text; only cite these complete paragraph markers):\n${excerpts.join("") || "No matching source paragraphs were retrieved. Do not invent an answer; ask to refine the search."}\nCoverage: ${JSON.stringify(report)}\nIndexed means searchable, NOT fully read. Explain missing evidence and never claim to have read the entire book.`, report };
}
