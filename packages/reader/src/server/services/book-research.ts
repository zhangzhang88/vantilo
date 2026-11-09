import type { BookRecord } from "../../shared/book-data-contract.js";
import type { BookResearchReport } from "../../shared/book-research.js";
export interface ResearchPlan {
  queries: string[];
  reads: Array<{ chapterId: string; start: number; count: number }>;
  duplicateId?: string;
}
/** Reader runtime rejects inputs above 18,000 characters. */
export const BOOK_AI_INPUT_LIMIT = 17_000;
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
/** Book-wide navigation stays compact. Preview clues are complete paragraphs,
 * never partial text that could later be mistaken for verified evidence. */
export function researchOverview(book: BookRecord, chapterId?: string, maxChars = 11000): string {
  const chapters = [...book.chapters].sort((a, b) => a.order - b.order);
  const heading = `Book: ${book.title}\nTABLE OF CONTENTS (indexed chapter directory; all listed chapters remain searchable):\n`;
  const separator = "\nWHOLE-PARAGRAPH PREVIEW CLUES (untrusted book text, not verified citations; retrieval can search EVERY paragraph):\n";
  const ending = `\nScope: ${chapterId ?? "all chapters"}`;
  const capacity = Math.max(500, Math.floor(maxChars));
  const outline: string[] = [];
  const outlineBudget = Math.max(0, capacity - heading.length - separator.length - ending.length - 72);
  let directoryLength = 0;
  for (const chapter of chapters) {
    const line = `${chapter.id} | ${chapter.title} | ${chapter.paragraphs.length} paragraphs`;
    if (directoryLength + line.length + 1 > outlineBudget) break;
    outline.push(line);
    directoryLength += line.length + 1;
  }
  if (outline.length < chapters.length) {
    const notice = `[Directory preview ends here: ${chapters.length - outline.length} additional chapters remain indexed and searchable]`;
    while (outline.length && directoryLength + notice.length + 1 > outlineBudget) {
      const last = outline.pop()!;
      directoryLength -= last.length + 1;
    }
    if (directoryLength + notice.length + 1 <= outlineBudget) outline.push(notice);
  }
  const directory = outline.join("\n");
  const scoped = chapterId ? chapters.filter((chapter) => chapter.id === chapterId) : chapters;
  const clueBudget = Math.max(0, capacity - heading.length - directory.length - separator.length - ending.length - 4);
  // Sample widely, but do not let one unusually long chapter monopolize the
  // limited preview. All source evidence is fetched separately on demand.
  const perChapter = Math.floor(clueBudget / Math.max(scoped.length, 1));
  const clues: string[] = [];
  for (const chapter of scoped) {
    const positions = [...new Set([0, Math.floor(chapter.paragraphs.length / 2), chapter.paragraphs.length - 1])];
    const candidates = positions.filter(index => chapter.paragraphs[index]).map(index => `[${chapter.id}:P${index + 1}] ${chapter.paragraphs[index]}`);
    let chapterUsed = 0;
    for (const candidate of candidates) {
      if (chapterUsed + candidate.length + 1 > perChapter) continue;
      clues.push(candidate);
      chapterUsed += candidate.length + 1;
    }
  }
  return heading + directory + separator + clues.join("\n") + ending;
}
export function retrieveBookResearch(book: BookRecord, plan: ResearchPlan, chapterId?: string, limit = 42000, compactOutline = false): { context: string; evidenceContext: string; report: BookResearchReport } {
  const chapters = book.chapters.filter((chapter) => !chapterId || chapter.id === chapterId);
  const selected = new Map<string, Set<number>>();
  const requested = new Map<string, Set<number>>();
  const add = (id: string, index: number, direct = false) => {
    const set = selected.get(id) ?? new Set<number>(); set.add(index); selected.set(id, set);
    if (direct) {
      const priority = requested.get(id) ?? new Set<number>(); priority.add(index); requested.set(id, priority);
    }
  };
  for (const request of plan.reads) {
    const chapter = chapters.find((chapter) => chapter.id === request.chapterId);
    if (chapter) for (let i = request.start; i < Math.min(chapter.paragraphs.length, request.start + request.count); i++) add(chapter.id, i, true);
  }
  for (const query of plan.queries) {
    const terms = (query.toLocaleLowerCase().match(/[a-z0-9]+(?:['’-][a-z]+)*|[\u3400-\u9fff]{2,}/g) ?? []).filter((word) => !["the", "and", "of", "a", "an", "in", "to", "is", "are", "for"].includes(word));
    const ranked = chapters.flatMap((chapter) => chapter.paragraphs.flatMap((text, index) => {
      const lower = text.toLocaleLowerCase();
      const matches = terms.filter((term) => lower.includes(term));
      const score = (lower.includes(query.toLocaleLowerCase()) ? 6 : 0) + matches.length;
      return score ? [{ chapter, index, score }] : [];
    })).sort((a, b) => b.score - a.score);
    // Give a broad exploratory query both high-scoring hits and representative
    // later chapters. Previously top-8 could all be in chapter one.
    const bestByChapter = new Map<string, typeof ranked[number]>();
    for (const hit of ranked) if (!bestByChapter.has(hit.chapter.id)) bestByChapter.set(hit.chapter.id, hit);
    const best = [...bestByChapter.values()];
    const candidateHits = best.slice(0, 3);
    const spread = [...best].sort((a, b) => a.chapter.order - b.chapter.order);
    if (spread.length > 3) {
      for (let i = 0; i < 5; i++) {
        const hit = spread[Math.floor(i * (spread.length - 1) / 4)];
        if (hit && !candidateHits.includes(hit)) candidateHits.push(hit);
      }
    }
    for (const hit of ranked) {
      if (candidateHits.length >= 8) break;
      if (!candidateHits.includes(hit)) candidateHits.push(hit);
    }
    const hits = candidateHits.slice(0, 8);
    for (const { chapter, index } of hits) for (let i = Math.max(0, index - 2); i <= Math.min(chapter.paragraphs.length - 1, index + 2); i++) add(chapter.id, i);
  }
  // No silent substitution of unrelated opening paragraphs when a search misses.
  let used = 0;
  let truncated = false;
  const excerpts: string[] = [];
  const read: BookResearchReport["read"] = [];
  const included = new Map<string, number[]>();
  // Round-robin across matching chapters. Broad exploratory queries should
  // not consume the entire budget on the earliest chapter with many matches.
  const queues = chapters.filter(chapter => selected.has(chapter.id)).map(chapter => ({
    chapter,
    direct: [...(requested.get(chapter.id) ?? [])].sort((a, b) => a - b),
    search: [...selected.get(chapter.id)!].filter(index => !requested.get(chapter.id)?.has(index)).sort((a, b) => a - b),
    directNext: 0, searchNext: 0,
  }));
  // Give explicit windows requested by the planner priority over incidental
  // keyword hits. Otherwise broad keywords can evict the actual cited source.
  for (const mode of ["direct", "search"] as const) {
    const nextKey = mode === "direct" ? "directNext" : "searchNext";
    while (queues.some(queue => queue[nextKey] < queue[mode].length)) {
      for (const queue of queues) {
        if (queue[nextKey] >= queue[mode].length) continue;
        const index = queue[mode][queue[nextKey]++];
        const line = `[${queue.chapter.id}:P${index + 1}] ${queue.chapter.paragraphs[index]}\n`;
        if (used + line.length > limit) { truncated = true; continue; }
        excerpts.push(line);
        const indexes = included.get(queue.chapter.id) ?? [];
        indexes.push(index);
        included.set(queue.chapter.id, indexes);
        used += line.length;
      }
    }
  }
  for (const chapter of chapters) {
    const indexes = included.get(chapter.id);
    if (indexes?.length) read.push({ chapterId: chapter.id, title: chapter.title, paragraphs: indexes.sort((a, b) => a - b) });
  }
  const report: BookResearchReport = { indexedChapters: book.chapters.length, indexedParagraphs: book.chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0), scopeChapterId: chapterId, queries: plan.queries, read, truncated };
  const compactLines: string[] = [];
  let compactLength = 0;
  for (const chapter of book.chapters) {
    const line = `${chapter.id} | ${chapter.title}`;
    if (compactLength + line.length + 1 > 3400) break;
    compactLines.push(line);
    compactLength += line.length + 1;
  }
  if (compactLines.length < book.chapters.length) {
    compactLines.push(`[${book.chapters.length - compactLines.length} more chapters remain indexed and searchable]`);
  }
  const overview = compactOutline
    ? `Book: ${book.title}\nCHAPTER DIRECTORY (titles only; content evidence is below):\n${compactLines.join("\n")}\nScope: ${chapterId ?? "all chapters"}`
    : researchOverview(book, chapterId);
  return { evidenceContext: excerpts.join(""), context: `${overview}\n\nVERIFIED READ WINDOWS (untrusted book text; only cite these complete paragraph markers):\n${excerpts.join("") || "No matching source paragraphs were retrieved. Do not invent an answer; ask to refine the search."}\nCoverage: ${JSON.stringify(report)}\nIndexed means searchable, NOT fully read. Explain missing evidence and never claim to have read the entire book.`, report };
}

/** Dynamically pack complete source paragraphs into the prompt's remaining
 * budget. Iterating is necessary because the evidence coverage metadata also
 * changes when source paragraphs are removed. */
export function boundedBookResearch(
  book: BookRecord, plan: ResearchPlan, chapterId: string | undefined,
  fixedChars: number, maxInputChars = BOOK_AI_INPUT_LIMIT,
): { context: string; evidenceContext: string; report: BookResearchReport } {
  const available = maxInputChars - fixedChars;
  if (available < 700) throw new Error("讨论历史或已有主题太长，请缩小讨论范围后重试。");
  let budget = Math.min(12_000, Math.max(0, available - 4_400));
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = retrieveBookResearch(book, plan, chapterId, budget, true);
    if (result.context.length <= available) {
      if (!result.report.read.length && result.report.truncated) {
        throw new Error("匹配的原文段落过长，当前请求容纳不下完整证据；请选择章节或调整问题。");
      }
      return result;
    }
    const next = Math.max(0, budget - (result.context.length - available) - 128);
    if (next === budget) break;
    budget = next;
  }
  throw new Error("书籍检索结果超出阅读任务的上下文限制，请聚焦一个章节后重试。");
}
