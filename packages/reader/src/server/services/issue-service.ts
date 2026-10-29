import path from "node:path";
import { randomUUID } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";
import type { AnalyzerProvider } from "../../analysis/analyzer.js";
import { parsePublicationEpub, scanIssueFiles } from "../../epub/publication-parser.js";
import { openEpub, readEpubCover, type EpubCoverAsset, type OpenedEpub } from "../../epub/epub-core.js";
import { articleImageMetadata, extractArticleImagesFromOpenedEpub, readArticleImageAsset, type EpubArticleImage, type EpubArticleImageAsset } from "../../epub/article-images.js";
import type { Article, ArticleImage, ArticleStatus, IssueFile, IssueRecord, IssueSummary } from "../../shared/types.js";
import { JsonStorage } from "../../storage/json-storage.js";
import type { ReaderGuideProvider } from "./reader-guide-service.js";
import { fixedSectionNameZh, fixedSectionTranslations } from "../../shared/section-translations.js";
import type { SectionTranslationProvider } from "./section-translation-service.js";

export class IssueService {
  private readonly inFlight = new Map<string, Promise<IssueRecord>>();
  private readonly guideQueues = new Map<string, Promise<unknown>>();
  private readonly sectionTranslationInFlight = new Map<string, Promise<{ issue: IssueRecord; generated: number; remaining: number } | null>>();
  private readonly coverCache = new Map<string, Promise<EpubCoverAsset | null>>();
  private readonly openedEpubCache = new Map<string, Promise<OpenedEpub>>();
  private readonly articleImagesCache = new Map<string, Promise<EpubArticleImage[]>>();
  private readonly issueMutations = new Map<string, Promise<void>>();

  constructor(
    private readonly issuesDir: string,
    private readonly storage: JsonStorage,
    private readonly analyzer: AnalyzerProvider,
    private readonly sectionTranslationProvider: SectionTranslationProvider | null = null,
  ) {}

  async listIssues(): Promise<IssueSummary[]> {
    await this.waitForAllIssueMutations();
    const files = await scanIssueFiles(this.issuesDir);
    const records = await Promise.all(files.map((file) => this.ensureIssue(file)));
    return records.map((record) => this.toSummary(record));
  }

  async getIssue(issueId: string): Promise<IssueRecord | null> {
    await this.waitForAllIssueMutations();
    const files = await scanIssueFiles(this.issuesDir);
    const file = files.find((candidate) => candidate.id === issueId)
      ?? files.find((candidate) => candidate.publicationId === "economist" && candidate.date === issueId);
    return file ? this.ensureIssue(file) : null;
  }

  async deleteIssue(issueId: string): Promise<{ status: "deleted"; file: IssueFile } | { status: "busy" } | null> {
    const file = await this.findIssueFile(issueId);
    if (!file) return null;
    if (this.hasActiveIssueWork(file.id)) return { status: "busy" };

    await unlink(file.filePath);
    await this.storage.deleteIssue(file.id);
    if (file.publicationId === "economist") await this.storage.deleteIssue(file.date);
    this.clearIssueCaches(file.id);
    return { status: "deleted", file };
  }

  async replaceIssueSource(issueId: string, data: Buffer): Promise<{ status: "replaced"; file: IssueFile } | { status: "busy" } | null> {
    const files = await scanIssueFiles(this.issuesDir);
    const file = files.find((candidate) => candidate.id === issueId)
      ?? files.find((candidate) => candidate.publicationId === "economist" && candidate.date === issueId);
    if (!file) return null;
    if (this.hasActiveIssueWork(file.id)) return { status: "busy" };

    let releaseMutation!: () => void;
    const mutation = new Promise<void>((resolve) => { releaseMutation = resolve; });
    this.issueMutations.set(file.id, mutation);
    const tempPath = path.join(this.issuesDir, `.epub-replace-${randomUUID()}.tmp`);
    try {
      await writeFile(tempPath, data, { flag: "wx" });
      await rename(tempPath, file.filePath);
      this.clearIssueCaches(file.id);
      return { status: "replaced", file };
    } finally {
      await unlink(tempPath).catch(() => undefined);
      this.issueMutations.delete(file.id);
      releaseMutation();
    }
  }

  private hasActiveIssueWork(issueId: string): boolean {
    return this.inFlight.has(issueId)
      || this.guideQueues.has(issueId)
      || this.sectionTranslationInFlight.has(issueId)
      || this.issueMutations.has(issueId);
  }

  private async waitForAllIssueMutations(): Promise<void> {
    while (this.issueMutations.size) {
      await Promise.all([...this.issueMutations.values()].map((mutation) => mutation.catch(() => undefined)));
    }
  }

  private clearIssueCaches(issueId: string): void {
    this.inFlight.delete(issueId);
    this.guideQueues.delete(issueId);
    this.sectionTranslationInFlight.delete(issueId);
    for (const key of this.coverCache.keys()) if (key.startsWith(`${issueId}:`)) this.coverCache.delete(key);
    for (const key of this.openedEpubCache.keys()) if (key.startsWith(`${issueId}:`)) this.openedEpubCache.delete(key);
    for (const key of this.articleImagesCache.keys()) if (key.startsWith(`${issueId}:`)) this.articleImagesCache.delete(key);
  }

  async getIssueCover(issueId: string): Promise<EpubCoverAsset | null> {
    const files = await scanIssueFiles(this.issuesDir);
    const file = files.find((candidate) => candidate.id === issueId)
      ?? files.find((candidate) => candidate.publicationId === "economist" && candidate.date === issueId);
    if (!file) return null;
    const cacheKey = `${file.id}:${file.fingerprint}`;
    const existing = this.coverCache.get(cacheKey);
    if (existing) return existing;
    const cover = readEpubCover(file).catch(() => null);
    this.coverCache.set(cacheKey, cover);
    return cover;
  }

  async getArticleImages(issueId: string, articleId: string): Promise<ArticleImage[] | null> {
    const file = await this.findIssueFile(issueId);
    if (!file) return null;
    const issue = await this.ensureIssue(file);
    const article = issue.articles.find((candidate) => candidate.id === articleId);
    if (!article) return null;
    return articleImageMetadata(await this.loadArticleImages(file, article));
  }

  async getArticleImage(issueId: string, articleId: string, imageId: string): Promise<EpubArticleImageAsset | null> {
    const file = await this.findIssueFile(issueId);
    if (!file) return null;
    const issue = await this.ensureIssue(file);
    const article = issue.articles.find((candidate) => candidate.id === articleId);
    if (!article) return null;
    const images = await this.loadArticleImages(file, article);
    const image = images.find((candidate) => candidate.id === imageId);
    if (!image) return null;
    return readArticleImageAsset(await this.openedEpub(file), image);
  }

  async getArticle(issueId: string, articleId: string): Promise<Article | null> {
    const issue = await this.getIssue(issueId);
    return issue?.articles.find((article) => article.id === articleId) ?? null;
  }

  async updateStatus(issueId: string, articleId: string, status: ArticleStatus): Promise<Article | null> {
    const issue = await this.getIssue(issueId);
    if (!issue) return null;
    const article = issue.articles.find((candidate) => candidate.id === articleId);
    if (!article) return null;
    article.status = article.status === status && status !== null ? null : status;
    await this.storage.saveIssue(issue);
    return article;
  }

  async generateReaderGuideBatch(
    issueId: string,
    provider: ReaderGuideProvider,
    limit = 8,
  ): Promise<{ issue: IssueRecord; generated: number; remaining: number } | null> {
    return this.withGuideQueue(issueId, () => this.generateReaderGuideBatchUnlocked(issueId, provider, limit));
  }

  async generateReaderGuidesForArticles(
    issueId: string,
    provider: ReaderGuideProvider,
    articleIds: string[],
  ): Promise<{ issue: IssueRecord; generated: number; remaining: number; unresolvedIds: string[] } | null> {
    return this.withGuideQueue(issueId, () => this.generateReaderGuidesForArticlesUnlocked(issueId, provider, articleIds));
  }

  async generateSectionTranslations(
    issueId: string,
  ): Promise<{ issue: IssueRecord; generated: number; remaining: number } | null> {
    const existing = this.sectionTranslationInFlight.get(issueId);
    if (existing) return existing;
    const promise = this.generateSectionTranslationsUnlocked(issueId)
      .finally(() => this.sectionTranslationInFlight.delete(issueId));
    this.sectionTranslationInFlight.set(issueId, promise);
    return promise;
  }

  private async generateReaderGuideBatchUnlocked(
    issueId: string,
    provider: ReaderGuideProvider,
    limit: number,
  ): Promise<{ issue: IssueRecord; generated: number; remaining: number } | null> {
    const issue = await this.getIssue(issueId);
    if (!issue) return null;
    const missing = issue.articles.filter((article) => !article.readerGuide);
    if (!missing.length) return { issue, generated: 0, remaining: 0 };

    const batch = missing.slice(0, Math.max(1, Math.min(limit, 12)));
    const result = await this.generateReaderGuidesForArticlesUnlocked(issueId, provider, batch.map((article) => article.id), issue);
    return result ? { issue: result.issue, generated: result.generated, remaining: result.remaining } : null;
  }

  private async generateReaderGuidesForArticlesUnlocked(
    issueId: string,
    provider: ReaderGuideProvider,
    articleIds: string[],
    loadedIssue?: IssueRecord,
  ): Promise<{ issue: IssueRecord; generated: number; remaining: number; unresolvedIds: string[] } | null> {
    const issue = loadedIssue ?? await this.getIssue(issueId);
    if (!issue) return null;
    const requestedIds = new Set(articleIds);
    const batch = issue.articles.filter((article) => requestedIds.has(article.id) && !article.readerGuide);
    if (!batch.length) {
      return {
        issue,
        generated: 0,
        remaining: issue.articles.filter((article) => !article.readerGuide).length,
        unresolvedIds: [],
      };
    }

    const guides = await provider.generate(batch);
    let generated = 0;
    for (const article of batch) {
      const guide = guides.get(article.id);
      if (!guide) continue;
      article.readerGuide = guide;
      generated += 1;
    }
    if (generated > 0) await this.storage.saveIssue(issue);
    const unresolvedIds = batch.filter((article) => !article.readerGuide).map((article) => article.id);
    const remaining = issue.articles.filter((article) => !article.readerGuide).length;
    return { issue, generated, remaining, unresolvedIds };
  }

  private async withGuideQueue<T>(issueId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.guideQueues.get(issueId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.guideQueues.set(issueId, current);
    try {
      return await current;
    } finally {
      if (this.guideQueues.get(issueId) === current) this.guideQueues.delete(issueId);
    }
  }

  private async generateSectionTranslationsUnlocked(
    issueId: string,
  ): Promise<{ issue: IssueRecord; generated: number; remaining: number } | null> {
    const issue = await this.getIssue(issueId);
    if (!issue) return null;
    const missing = issue.sections.filter((section) => !issue.sectionTranslations?.[section]);
    if (!missing.length) return { issue, generated: 0, remaining: 0 };
    if (!this.sectionTranslationProvider) {
      return { issue, generated: 0, remaining: missing.length };
    }

    const generated = await this.sectionTranslationProvider.translate(issue.publicationId, missing);
    const cache = await this.storage.loadSectionTranslations();
    const publicationCache = { ...(cache.publications[issue.publicationId] ?? {}) };
    let saved = 0;
    for (const section of missing) {
      const translated = generated.get(section);
      if (!translated) continue;
      publicationCache[section] = translated;
      saved += 1;
    }
    if (saved > 0) {
      cache.publications[issue.publicationId] = publicationCache;
      await this.storage.saveSectionTranslations(cache);
    }
    await this.attachSectionTranslations(issue);
    const remaining = issue.sections.filter((section) => !issue.sectionTranslations?.[section]).length;
    return { issue, generated: saved, remaining };
  }

  private async findIssueFile(issueId: string): Promise<IssueFile | null> {
    await this.waitForAllIssueMutations();
    const files = await scanIssueFiles(this.issuesDir);
    return files.find((candidate) => candidate.id === issueId)
      ?? files.find((candidate) => candidate.publicationId === "economist" && candidate.date === issueId)
      ?? null;
  }

  private openedEpub(file: IssueFile): Promise<OpenedEpub> {
    const cacheKey = `${file.id}:${file.fingerprint}`;
    const existing = this.openedEpubCache.get(cacheKey);
    if (existing) return existing;
    for (const key of this.openedEpubCache.keys()) {
      if (key.startsWith(`${file.id}:`) && key !== cacheKey) this.openedEpubCache.delete(key);
    }
    const opened = openEpub(file);
    this.openedEpubCache.set(cacheKey, opened);
    return opened;
  }

  private loadArticleImages(file: IssueFile, article: Article): Promise<EpubArticleImage[]> {
    const cacheKey = `${file.id}:${file.fingerprint}:${article.id}`;
    const existing = this.articleImagesCache.get(cacheKey);
    if (existing) return existing;
    for (const key of this.articleImagesCache.keys()) {
      if (key.startsWith(`${file.id}:`) && !key.startsWith(`${file.id}:${file.fingerprint}:`)) this.articleImagesCache.delete(key);
    }
    const images = this.openedEpub(file).then((opened) => extractArticleImagesFromOpenedEpub(opened, article));
    this.articleImagesCache.set(cacheKey, images);
    return images;
  }

  private async attachSectionTranslations(issue: IssueRecord): Promise<IssueRecord> {
    const cache = await this.storage.loadSectionTranslations();
    const dynamic = cache.publications[issue.publicationId] ?? {};
    const fixed = fixedSectionTranslations(issue.publicationId, issue.sections);
    issue.sectionTranslations = Object.fromEntries(
      issue.sections.flatMap((section) => {
        const translated = fixed[section] ?? dynamic[section] ?? fixedSectionNameZh(issue.publicationId, section);
        return translated ? [[section, translated] as const] : [];
      }),
    );
    return issue;
  }

  private async ensureIssue(file: IssueFile): Promise<IssueRecord> {
    const mutation = this.issueMutations.get(file.id);
    if (mutation) {
      await mutation.catch(() => undefined);
      const refreshed = (await scanIssueFiles(this.issuesDir)).find((candidate) => candidate.id === file.id);
      if (refreshed) file = refreshed;
    }
    const existingPromise = this.inFlight.get(file.id);
    if (existingPromise) return existingPromise;

    const promise = this.loadOrParse(file).finally(() => this.inFlight.delete(file.id));
    this.inFlight.set(file.id, promise);
    return promise;
  }

  private async loadOrParse(file: IssueFile): Promise<IssueRecord> {
    const currentCache = await this.storage.loadIssue(file.id);
    const legacyCache = !currentCache && file.publicationId === "economist"
      ? await this.storage.loadIssue(file.date)
      : null;
    const cached = currentCache ?? legacyCache;
    const currentShape = cached?.schemaVersion === 1
      && cached.id === file.id
      && cached.publicationId === file.publicationId
      && cached.publicationName === file.publicationName;
    if (currentShape && cached.sourceFingerprint === file.fingerprint) return this.attachSectionTranslations(cached);

    const parsed = await parsePublicationEpub(file);
    const previousById = new Map(cached?.articles.map((article) => [article.id, article]) ?? []);
    parsed.articles.forEach((article) => {
      const previous = previousById.get(article.id);
      article.status = previous?.status ?? null;
      article.readerGuide = null;
      article.analysis = this.analyzer.analyze(article);
    });
    this.analyzer.rank(parsed.articles);
    await this.storage.saveIssue(parsed);
    return this.attachSectionTranslations(parsed);
  }

  private toSummary(issue: IssueRecord): IssueSummary {
    const statusCounts = { save: 0, process: 0, skip: 0 };
    issue.articles.forEach((article) => {
      if (article.status) statusCounts[article.status] += 1;
    });
    return {
      id: issue.id,
      publicationId: issue.publicationId,
      publicationName: issue.publicationName,
      filename: issue.filename,
      title: issue.title,
      date: issue.date,
      label: issue.label,
      articleCount: issue.articles.length,
      sections: issue.sections,
      markedCount: statusCounts.save + statusCounts.process + statusCounts.skip,
      statusCounts,
    };
  }
}

export function defaultProjectPaths(projectRoot: string) {
  return {
    issuesDir: path.join(projectRoot, "issues"),
    booksDir: path.join(projectRoot, "books"),
    dataDir: path.join(projectRoot, "data"),
  };
}
