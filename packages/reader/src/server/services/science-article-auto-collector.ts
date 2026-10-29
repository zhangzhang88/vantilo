import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ContentDiscoverySnapshot } from "../../shared/content-discovery.js";
import { isScienceReadingCandidate } from "../../shared/science-article-curation.js";
import type { ScienceArticle } from "../../shared/science-article.js";
import { ScienceArticleService } from "./science-article-service.js";

interface AutoCollectionState {
  version: 1;
  day: string;
  attemptedCandidateIds: string[];
  rejectedCandidateIds: string[];
  importedCandidateIds: string[];
}

const DAILY_ARTICLE_LIMIT = 10;
const DAILY_ATTEMPT_LIMIT = 30;

function localDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date);
}

export class ScienceArticleAutoCollector {
  private inFlight: Promise<{ importedCount: number; rejectedCount: number; failedCount: number }> | null = null;

  constructor(
    private readonly statePath: string,
    private readonly articles: ScienceArticleService,
    private readonly onFailure: (candidateUrl: string, error: unknown) => void = () => {},
  ) {}

  collect(snapshot: ContentDiscoverySnapshot): Promise<{ importedCount: number; rejectedCount: number; failedCount: number }> {
    if (this.inFlight) return this.inFlight;
    const run = this.collectOnce(snapshot).finally(() => { this.inFlight = null; });
    this.inFlight = run;
    return run;
  }

  private async collectOnce(snapshot: ContentDiscoverySnapshot) {
    const day = localDay();
    const state = await this.readState(day);
    const saved = await this.articles.list();
    let savedToday = state.importedCandidateIds.length;
    let attempts = state.attemptedCandidateIds.length;
    let importedCount = 0;
    let rejectedCount = 0;
    let failedCount = 0;
    const savedUrls = new Set(saved.map((article) => article.sourceUrl));
    const candidates = snapshot.candidates
      .filter((candidate) => isScienceReadingCandidate(candidate)
        && !savedUrls.has(candidate.sourceUrl)
        && !state.rejectedCandidateIds.includes(candidate.id)
        && !state.attemptedCandidateIds.includes(candidate.id))
      .sort((a, b) => (b.publishedAt ?? b.discoveredAt).localeCompare(a.publishedAt ?? a.discoveredAt));
    const sourceOrder = ["nps-animals", "our-world-in-data", "bitcoin-org"];
    const sourceGroups = new Map<string, typeof candidates>();
    for (const candidate of candidates) sourceGroups.set(candidate.sourceId, [...(sourceGroups.get(candidate.sourceId) ?? []), candidate]);
    const diverseCandidates: typeof candidates = [];
    while ([...sourceGroups.values()].some((group) => group.length > 0)) {
      for (const sourceId of sourceOrder) {
        const candidate = sourceGroups.get(sourceId)?.shift();
        if (candidate) diverseCandidates.push(candidate);
      }
      for (const [sourceId, group] of sourceGroups) {
        if (sourceOrder.includes(sourceId) || group.length === 0) continue;
        diverseCandidates.push(group.shift()!);
      }
    }

    for (const candidate of diverseCandidates) {
      if (savedToday >= DAILY_ARTICLE_LIMIT || attempts >= DAILY_ATTEMPT_LIMIT) break;
      state.attemptedCandidateIds.push(candidate.id);
      attempts++;
      await this.writeState(state);
      try {
        const article = await this.articles.importAutomatically(candidate.sourceUrl);
        if (!article) {
          state.rejectedCandidateIds.push(candidate.id);
          rejectedCount++;
          await this.writeState(state);
          continue;
        }
        savedUrls.add(candidate.sourceUrl);
        importedCount++;
        savedToday++;
        state.importedCandidateIds.push(candidate.id);
        await this.writeState(state);
      } catch (error) {
        failedCount++;
        this.onFailure(candidate.sourceUrl, error);
      }
    }
    return { importedCount, rejectedCount, failedCount };
  }

  private async readState(day: string): Promise<AutoCollectionState> {
    let value: unknown;
    try { value = JSON.parse(await readFile(this.statePath, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { version: 1, day, attemptedCandidateIds: [], rejectedCandidateIds: [], importedCandidateIds: [] };
    }
    if (!value || typeof value !== "object" || (value as AutoCollectionState).version !== 1) {
      throw new Error("科普文章自动收录状态无效，已安全跳过本次自动收录");
    }
    const parsed = value as AutoCollectionState;
    const rejectedCandidateIds = Array.isArray(parsed.rejectedCandidateIds) ? parsed.rejectedCandidateIds.filter((id) => typeof id === "string") : [];
    if (parsed.day !== day) return { version: 1, day, attemptedCandidateIds: [], rejectedCandidateIds, importedCandidateIds: [] };
    return {
      version: 1,
      day,
      attemptedCandidateIds: Array.isArray(parsed.attemptedCandidateIds) ? parsed.attemptedCandidateIds.filter((id) => typeof id === "string") : [],
      rejectedCandidateIds,
      importedCandidateIds: Array.isArray(parsed.importedCandidateIds) ? parsed.importedCandidateIds.filter((id) => typeof id === "string") : [],
    };
  }

  private async writeState(state: AutoCollectionState): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(state, null, 2), { flag: "wx" });
      await rename(temporary, this.statePath);
    } finally { await rm(temporary, { force: true }); }
  }
}
