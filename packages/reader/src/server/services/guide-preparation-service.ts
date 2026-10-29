import type {
  GuidePreparationStatus,
  IssueRecord,
} from "../../shared/types.js";
import { JsonStorage } from "../../storage/json-storage.js";
import { IssueService } from "./issue-service.js";
import type { ReaderGuideProvider } from "./reader-guide-service.js";
import type { SectionTranslationProvider } from "./section-translation-service.js";

interface GuidePreparationServiceOptions {
  retryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class GuidePreparationService {
  private readonly jobs = new Map<string, Promise<void>>();
  private statusWriteQueue: Promise<void> = Promise.resolve();
  private readonly retryDelaysMs: number[];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(
    private readonly issueService: IssueService,
    private readonly storage: JsonStorage,
    private readonly readerGuideProvider: ReaderGuideProvider | null,
    private readonly sectionTranslationProvider: SectionTranslationProvider | null,
    options: GuidePreparationServiceOptions = {},
  ) {
    this.retryDelaysMs = options.retryDelaysMs ?? [350, 1_000];
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => new Date());
  }

  isRunning(issueId: string): boolean {
    return this.jobs.has(issueId);
  }

  async removeStatus(issueId: string): Promise<void> {
    const task = this.statusWriteQueue.catch(() => undefined).then(async () => {
      const cache = await this.storage.loadGuidePreparationStatuses();
      if (!(issueId in cache.issues)) return;
      delete cache.issues[issueId];
      await this.storage.saveGuidePreparationStatuses(cache);
    });
    this.statusWriteQueue = task;
    await task;
  }

  async getStatus(issueId: string): Promise<GuidePreparationStatus | null> {
    await this.statusWriteQueue.catch(() => undefined);
    const issue = await this.issueService.getIssue(issueId);
    if (!issue) return null;
    const cache = await this.storage.loadGuidePreparationStatuses();
    return this.statusFromIssue(issue, cache.issues[issueId]);
  }

  async start(issueId: string): Promise<GuidePreparationStatus | null> {
    const existing = this.jobs.get(issueId);
    if (existing) return this.getStatus(issueId);

    const status = await this.getStatus(issueId);
    if (!status) return null;
    if (status.remaining === 0 && status.sectionRemaining === 0) {
      const complete = { ...status, state: "complete" as const, lastError: null, updatedAt: this.now().toISOString() };
      await this.persistStatus(complete);
      return complete;
    }

    const running: GuidePreparationStatus = {
      ...status,
      state: "running",
      lastError: null,
      failedArticleIds: [],
      updatedAt: this.now().toISOString(),
    };
    await this.persistStatus(running);

    const job = this.run(issueId)
      .catch(async (error) => {
        await this.finishWithError(issueId, error instanceof Error ? error.message : "中文导读后台准备失败", []);
      })
      .finally(() => {
        this.jobs.delete(issueId);
      });
    this.jobs.set(issueId, job);
    void job;
    return running;
  }

  async resumeAllIncomplete(): Promise<void> {
    const issues = await this.issueService.listIssues();
    for (const issue of issues) {
      const status = await this.getStatus(issue.id);
      if (status && (status.remaining > 0 || status.sectionRemaining > 0)) {
        await this.start(issue.id);
      }
    }
  }

  private async run(issueId: string): Promise<void> {
    let sectionError: string | null = null;
    if (this.sectionTranslationProvider) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await this.getStatus(issueId);
        if (!current || current.sectionRemaining === 0) break;
        try {
          await this.markAttempt(issueId);
          const result = await this.issueService.generateSectionTranslations(issueId);
          await this.refreshRunningStatus(issueId, null);
          if (!result || result.remaining === 0) break;
          if (result.generated === 0) throw new Error("栏目中文没有继续生成");
        } catch (error) {
          sectionError = error instanceof Error ? error.message : "栏目中文生成失败";
          await this.refreshRunningStatus(issueId, sectionError);
          if (attempt === 0) await this.sleep(this.retryDelaysMs[0] ?? 0);
        }
      }
    }

    const issue = await this.issueService.getIssue(issueId);
    if (!issue) return;
    const missingIds = issue.articles.filter((article) => !article.readerGuide).map((article) => article.id);
    const failedArticleIds: string[] = [];

    if (this.readerGuideProvider && missingIds.length) {
      for (let index = 0; index < missingIds.length; index += 8) {
        const group = missingIds.slice(index, index + 8);
        failedArticleIds.push(...await this.processGroup(issueId, group));
      }
    } else if (!this.readerGuideProvider && missingIds.length) {
      failedArticleIds.push(...missingIds);
    }

    const final = await this.getStatus(issueId);
    if (!final) return;
    const finalError = failedArticleIds.length
      ? `仍有 ${failedArticleIds.length} 篇文章未能生成中文导读`
      : final.sectionRemaining > 0
        ? sectionError ?? `仍有 ${final.sectionRemaining} 个栏目未能生成中文`
        : null;

    if (final.remaining === 0 && final.sectionRemaining === 0) {
      await this.persistStatus({
        ...final,
        state: "complete",
        failedArticleIds: [],
        lastError: null,
        lastCompletedAt: this.now().toISOString(),
        updatedAt: this.now().toISOString(),
      });
      return;
    }

    await this.finishWithError(issueId, finalError ?? "中文导读尚未完成", failedArticleIds);
  }

  private async processGroup(issueId: string, articleIds: string[]): Promise<string[]> {
    if (!articleIds.length || !this.readerGuideProvider) return articleIds;
    let pending = [...articleIds];
    const maxAttempts = articleIds.length === 1 ? 3 : 2;
    let lastError: string | null = null;

    for (let attempt = 0; attempt < maxAttempts && pending.length; attempt += 1) {
      await this.markAttempt(issueId);
      try {
        const result = await this.issueService.generateReaderGuidesForArticles(issueId, this.readerGuideProvider, pending);
        if (!result) return pending;
        pending = result.unresolvedIds;
        lastError = pending.length ? `模型返回不完整，遗漏 ${pending.length} 篇` : null;
        await this.refreshRunningStatus(issueId, lastError);
        if (!pending.length) return [];
      } catch (error) {
        lastError = error instanceof Error ? error.message : "中文导读生成失败";
        await this.refreshRunningStatus(issueId, lastError);
      }

      if (attempt + 1 < maxAttempts) {
        await this.sleep(this.retryDelaysMs[Math.min(attempt, this.retryDelaysMs.length - 1)] ?? 0);
      }
    }

    if (pending.length === 1 && articleIds.length > 1) {
      return this.processGroup(issueId, pending);
    }
    if (pending.length <= 1) return pending;

    const midpoint = Math.ceil(pending.length / 2);
    const left = await this.processGroup(issueId, pending.slice(0, midpoint));
    const right = await this.processGroup(issueId, pending.slice(midpoint));
    return [...left, ...right];
  }

  private async markAttempt(issueId: string): Promise<void> {
    const current = await this.getStatus(issueId);
    if (!current) return;
    await this.persistStatus({
      ...current,
      state: "running",
      attemptCount: current.attemptCount + 1,
      lastAttemptAt: this.now().toISOString(),
      updatedAt: this.now().toISOString(),
    });
  }

  private async refreshRunningStatus(issueId: string, lastError: string | null): Promise<void> {
    const current = await this.getStatus(issueId);
    if (!current) return;
    await this.persistStatus({
      ...current,
      state: "running",
      lastError,
      updatedAt: this.now().toISOString(),
    });
  }

  private async finishWithError(issueId: string, error: string, failedArticleIds: string[]): Promise<void> {
    const current = await this.getStatus(issueId);
    if (!current) return;
    await this.persistStatus({
      ...current,
      state: "error",
      failedArticleIds,
      lastError: error,
      updatedAt: this.now().toISOString(),
    });
  }

  private statusFromIssue(issue: IssueRecord, persisted?: GuidePreparationStatus): GuidePreparationStatus {
    const total = issue.articles.length;
    const completed = issue.articles.filter((article) => Boolean(article.readerGuide)).length;
    const sectionTotal = issue.sections.length;
    const sectionCompleted = issue.sections.filter((section) => Boolean(issue.sectionTranslations?.[section])).length;
    const remaining = total - completed;
    const sectionRemaining = sectionTotal - sectionCompleted;
    const isRunning = this.jobs.has(issue.id);
    const defaultState = remaining === 0 && sectionRemaining === 0
      ? "complete"
      : isRunning
        ? "running"
        : completed > 0 || sectionCompleted > 0
          ? "partial"
          : "idle";
    const state = isRunning
      ? "running"
      : remaining === 0 && sectionRemaining === 0
        ? "complete"
        : persisted?.state === "error"
          ? "error"
          : defaultState;

    return {
      issueId: issue.id,
      state,
      total,
      completed,
      remaining,
      sectionTotal,
      sectionCompleted,
      sectionRemaining,
      attemptCount: persisted?.attemptCount ?? 0,
      failedArticleIds: persisted?.failedArticleIds ?? [],
      lastAttemptAt: persisted?.lastAttemptAt ?? null,
      lastCompletedAt: persisted?.lastCompletedAt ?? null,
      lastError: persisted?.lastError ?? null,
      updatedAt: persisted?.updatedAt ?? this.now().toISOString(),
    };
  }

  private async persistStatus(status: GuidePreparationStatus): Promise<void> {
    const task = this.statusWriteQueue.catch(() => undefined).then(async () => {
      const cache = await this.storage.loadGuidePreparationStatuses();
      cache.issues[status.issueId] = status;
      await this.storage.saveGuidePreparationStatuses(cache);
    });
    this.statusWriteQueue = task;
    await task;
  }
}
