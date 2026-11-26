import { isChapterNumberParagraph, isTranslatableText } from "../shared/translation-text";
import {
  chineseTranslationStorage, findListeningTranslation, isListeningTranslationEngine, loadListeningTranslations, saveDocumentTranslation, translateListeningBatch, translateMissingListeningText, type TranslationTimings,
} from "./chinese-translation-reuse";
import { loadBookTranslations, loadIssueTranslations, readIssueTranslation } from "./issue-translation-cache";
import {
  loadParagraphTranslations, PARAGRAPH_TRANSLATIONS_KEY, headingTranslationTarget, paragraphTranslationTarget, titleTranslationTarget, translationCacheMetadata,
  type ParagraphTranslationRecord, type ParagraphTranslationTarget,
} from "./paragraph-translation-state";
import { flattenArticles, type ReaderIssue } from "./reader-model";
import { articleReadingDocumentIdentity } from "../shared/reading-document-identity";
import { getReaderStorage } from "./reader-storage";
import { magazineReaderCollection, type ReaderCollectionView, type ReaderDocumentView } from "./reading-document-view";

export function magazineTranslationTargets(article: ReaderDocumentView): ParagraphTranslationTarget[] {
  return [
    ...(!article.titleZh && isTranslatableText(article.title) ?
      [titleTranslationTarget({ document: article.identity, sourceText: article.title })] : []),
    ...article.paragraphs.flatMap((sourceText, paragraphIndex) => isTranslatableText(sourceText) ?
      [paragraphTranslationTarget({ document: article.identity, paragraphIndex, sourceText })] : []),
  ];
}

export function chapterTranslationTargets(chapter: ReaderDocumentView): ParagraphTranslationTarget[] {
  const targets: ParagraphTranslationTarget[] = [];
  if (!chapter.titleZh && isTranslatableText(chapter.title)) {
    targets.push(titleTranslationTarget({ document: chapter.identity, sourceText: chapter.title }));
  }
  let headingIndex = 0;
  for (const block of chapter.blocks) {
    if (block.kind !== "heading") continue;
    if (isTranslatableText(block.text) && block.text.trim() !== chapter.title.trim()) {
      targets.push(headingTranslationTarget({ document: chapter.identity, headingIndex, sourceText: block.text }));
    }
    headingIndex++;
  }
  const visuals = new Set((chapter.visuals ?? []).flatMap(visual =>
    visual.kind === "original" && visual.reason === "complex-layout"
      ? visual.captionParagraphIndexes
      : [...visual.coveredParagraphIndexes, ...visual.captionParagraphIndexes]));
  for (const [paragraphIndex, sourceText] of chapter.paragraphs.entries()) {
    if (visuals.has(paragraphIndex) || !isTranslatableText(sourceText)
      || isChapterNumberParagraph(sourceText, paragraphIndex, chapter.title, chapter.paragraphs[paragraphIndex + 1])) continue;
    targets.push(paragraphTranslationTarget({ document: chapter.identity, paragraphIndex, sourceText }));
  }
  return targets;
}

export type TranslationBatchSource =
  | { kind: "issue"; issue: ReaderIssue }
  | { kind: "book"; collection: ReaderCollectionView; startChapterId?: string };

export function translationBatchId(source: TranslationBatchSource) {
  return source.kind === "issue" ? source.issue.id : bookTranslationBatchId(source.collection.id);
}

function bookTranslationBatchId(bookId: string) {
  return `book-batch:${bookId}`;
}

export function savedBookTranslationEngine(bookId: string) {
  return savedIssueTranslationEngine(bookTranslationBatchId(bookId));
}

function savedEngineKey(issueId: string) {
  return `vantilo-issue-translation-engine-v1:${issueId}`;
}

export function savedIssueTranslationEngine(issueId: string) {
  const engineId = getReaderStorage().getItem(savedEngineKey(issueId));
  return isListeningTranslationEngine(engineId) ? engineId : undefined;
}

export function saveIssueTranslationEngine(issueId: string, engineId: string) {
  getReaderStorage().setItem(savedEngineKey(issueId), engineId);
}

function indexRecords(records: ParagraphTranslationRecord[]) {
  const index = new Map<string, ParagraphTranslationRecord[]>();
  for (const record of records) {
    const previous = index.get(record.key);
    if (previous) previous.push(record);
    else index.set(record.key, [record]);
  }
  return index;
}

export async function loadIssueArticleTitles(issue: ReaderIssue, engineId: string) {
  const cached = indexRecords([
    ...await loadIssueTranslations(engineId, issue.id),
    ...loadListeningTranslations(getReaderStorage(), engineId),
  ].filter(record => record.targetKind === "title"));
  const titles: Record<string, string> = Object.create(null);
  for (const article of flattenArticles(issue)) {
    const document = articleReadingDocumentIdentity(issue.id, article.id);
    const target = titleTranslationTarget({ document, sourceText: article.title });
    const record = findListeningTranslation(cached.get(target.key) ?? [], target, {}, true);
    if (record) titles[article.id] = record.translationZh;
  }
  return titles;
}

export type IssueCatalogTitles = { articles: Record<string, string>; sections: Record<string, string> };

export function issueWithTranslationTitles(issue: ReaderIssue, batchTitles: Record<string, string>, catalog?: IssueCatalogTitles) {
  if (!catalog && !Object.keys(batchTitles).length) return issue;
  const titleFor = (titles: Record<string, string> | undefined, id: string) =>
    titles && Object.hasOwn(titles, id) ? titles[id] : undefined;
  return {
    ...issue,
    sections: issue.sections.map(section => ({
      ...section, nameZh: titleFor(catalog?.sections, section.name) || section.nameZh,
      articles: section.articles.map(article => ({
        ...article, titleZh: titleFor(catalog?.articles, article.id) || titleFor(batchTitles, article.id) || article.titleZh,
      })),
    })),
  };
}

type IssueTranslationDocument = Awaited<ReturnType<typeof planIssueTranslation>>["documents"][number];

export interface BookChapterTranslationStatus {
  translated: number;
  total: number;
}

export async function loadBookChapterTranslationStatus(
  collection: ReaderCollectionView,
  engineId: string,
): Promise<Record<string, BookChapterTranslationStatus>> {
  const persisted = await loadBookTranslations(
    engineId,
    collection.documents.map(document => document.identity.documentId),
  );
  const storage = getReaderStorage();
  const cached = indexRecords([...persisted, ...loadListeningTranslations(storage, engineId)]);
  const status: Record<string, BookChapterTranslationStatus> = Object.create(null);
  for (const chapter of collection.documents) {
    const targets = chapterTranslationTargets(chapter);
    let translated = 0;
    for (const target of targets) {
      const context = {
        contextBefore: target.targetKind ? undefined : chapter.paragraphs[target.paragraphIndex - 1],
        contextAfter: target.targetKind ? undefined : chapter.paragraphs[target.paragraphIndex + 1],
      };
      if (findListeningTranslation(cached.get(target.key) ?? [], target, context, true)) {
        translated++;
      }
    }
    status[chapter.id] = { translated, total: targets.length };
  }
  return status;
}

export async function ensureBookChineseCatalog(
  bookId: string,
  engineId: string,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, string> | undefined> {
  const url = `/api/vantilo-catalog/book/${encodeURIComponent(bookId)}`;
  try {
    const statusResponse = await fetch(url, { cache: "no-store", signal });
    if (!statusResponse.ok) return undefined;
    const status = await statusResponse.json() as {
      state?: string;
      titles?: { chapters?: Record<string, string> };
    };
    if (status?.state === "ready") return status.titles?.chapters;
  } catch (error) {
    if (signal.aborted) throw error;
    return undefined;
  }

  let catalogEngineId: string | undefined;
  try {
    const settingsResponse = await fetch("/api/vantilo-catalog/settings", { cache: "no-store", signal });
    if (!settingsResponse.ok) return undefined;
    const settings = await settingsResponse.json() as {
      engineId?: string;
      savedEngineId?: string | null;
      defaultEngineId?: string | null;
      engines?: Array<{ id?: string }>;
    };
    if (!settings || typeof settings !== "object" || !Array.isArray(settings.engines)) {
      return undefined;
    }
    const available = (id: unknown): id is string =>
      typeof id === "string" && Boolean(id.trim()) && settings.engines!.some(item => item?.id === id.trim());
    const savedCatalogEngine = typeof settings.savedEngineId === "string" ? settings.savedEngineId.trim() : "";
    const legacyEngineId = typeof settings.engineId === "string" ? settings.engineId.trim() : "";
    const requestedBodyEngine = typeof engineId === "string" ? engineId.trim() : "";
    if (savedCatalogEngine) {
      if (!available(savedCatalogEngine)) return undefined;
      catalogEngineId = savedCatalogEngine;
    } else if (settings.savedEngineId === null) {
      if (requestedBodyEngine) {
        if (!available(requestedBodyEngine)) return undefined;
        catalogEngineId = requestedBodyEngine;
      } else if (available(settings.defaultEngineId)) {
        catalogEngineId = settings.defaultEngineId.trim();
      } else {
        return undefined;
      }
    } else if (legacyEngineId) {
      if (!available(legacyEngineId)) return undefined;
      catalogEngineId = legacyEngineId;
    } else if (requestedBodyEngine) {
      if (!available(requestedBodyEngine)) return undefined;
      catalogEngineId = requestedBodyEngine;
    } else {
      return undefined;
    }
  } catch (error) {
    if (signal.aborted) throw error;
    return undefined;
  }

  onProgress?.(0, 0);
  while (true) {
    signal.throwIfAborted();
    let value: {
      state?: string;
      done?: number;
      total?: number;
      titles?: { chapters?: Record<string, string> };
    };
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engineId: catalogEngineId, regenerate: false, preserveSetting: true }),
        signal,
      });
      if (!response.ok) return undefined;
      value = await response.json();
    } catch (error) {
      if (signal.aborted) throw error;
      return undefined;
    }
    if (signal.aborted) signal.throwIfAborted();
    if (value?.state === "pending") {
      onProgress?.(Number(value.done ?? 0), Number(value.total ?? 0));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("vantilo-catalog-updated", { detail: { kind: "book", id: bookId, record: value } }));
      }
      continue;
    }
    if (value?.state === "ready") {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("vantilo-catalog-updated", { detail: { kind: "book", id: bookId, record: value } }));
      }
      return value.titles?.chapters;
    }
    return undefined;
  }
}

export async function planIssueTranslation(source: TranslationBatchSource, engineId: string) {
  const persisted = await (source.kind === "issue"
    ? loadIssueTranslations(engineId, source.issue.id)
    : loadBookTranslations(engineId, source.collection.documents.map(document => document.identity.documentId)));
  const collection = source.kind === "issue" ? magazineReaderCollection(source.issue) : source.collection;
  // Always translate in original TOC/reading order from the first document so early chapters
  // are cached first and can be read immediately without waiting for the entire book to finish.
  const ordered = collection.documents;
  const storage = getReaderStorage();
  const cached = indexRecords([...persisted, ...loadListeningTranslations(storage, engineId)]);
  const documents = ordered.map(article => {
    const targets = source.kind === "issue" ? magazineTranslationTargets(article) : chapterTranslationTargets(article);
    const missing = targets.flatMap(target => {
      const context = {
        contextBefore: target.targetKind ? undefined : article.paragraphs[target.paragraphIndex - 1],
        contextAfter: target.targetKind ? undefined : article.paragraphs[target.paragraphIndex + 1],
      };
      return findListeningTranslation(cached.get(target.key) ?? [], target, context, true) ? [] : [{ target, context }];
    });
    return { article, missing, total: targets.length };
  });
  return {
    documents,
    useBatches: source.kind === "book" && engineId.startsWith("codex:"),
    remainingArticles: documents.filter(document => document.missing.length > 0).length,
    remainingCharacters: documents.reduce((sum, document) =>
      sum + document.missing.reduce((count, entry) => count + entry.target.sourceText.length, 0), 0),
  };
}

export interface IssueTranslationProgress {
  total: number;
  translated: number;
  articles: number;
  completedArticles: number;
  failedArticles: Array<{ title: string; error: string }>;
  currentTitle?: string;
  currentDocumentId?: string;
  waiting?: boolean;
  retrying?: boolean;
  timings?: TranslationTimings & { count: number };
}

function waitForTranslationEngine(signal: AbortSignal, delay = 900) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => {
      window.clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, delay);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

function errorStatus(error: unknown) {
  return error instanceof Error && "status" in error ? error.status : undefined;
}

type TranslationEntry = IssueTranslationDocument["missing"][number];

async function hasCachedEntry(entry: TranslationEntry, engineId: string, readLegacy: (key: string) => ParagraphTranslationRecord[]) {
  const { target, context } = entry;
  const persisted = await readIssueTranslation(engineId, target.key);
  return findListeningTranslation(persisted ? [persisted] : [], target, context, true)
    ?? findListeningTranslation(readLegacy(target.key), target, context, true);
}

function saveEntry(entry: TranslationEntry, engineId: string, result: Awaited<ReturnType<typeof translateMissingListeningText>>) {
  return saveDocumentTranslation(getReaderStorage(), {
    ...entry.target,
    model: result.model,
    profileId: result.profileId,
    provider: result.provider,
    translationZh: result.translation,
    ...translationCacheMetadata({
      ...entry.context, model: result.model, profileId: result.profileId,
      provider: "easycliproxy", targetLanguage: "zh-CN", promptVersion: "paragraph-translation-v1",
    }),
    generatedAt: new Date().toISOString(),
  }, engineId);
}

function groupEntries(entries: TranslationEntry[], useBatches: boolean) {
  if (!useBatches) return entries.map(entry => [entry]);
  const groups: TranslationEntry[][] = [];
  let group: TranslationEntry[] = [];
  let length = 0;
  for (const entry of entries) {
    const size = entry.target.sourceText.length;
    if (group.length && (group.length === 6 || length + size > 4800)) {
      groups.push(group);
      group = [];
      length = 0;
    }
    group.push(entry);
    length += size;
  }
  if (group.length) groups.push(group);
  return groups;
}

export function initialIssueTranslationProgress(plan: Awaited<ReturnType<typeof planIssueTranslation>>): IssueTranslationProgress {
  return {
    total: plan.documents.reduce((sum, document) => sum + document.total, 0),
    translated: plan.documents.reduce((sum, document) => sum + document.total - document.missing.length, 0),
    articles: plan.documents.length,
    completedArticles: plan.documents.length - plan.remainingArticles,
    failedArticles: [],
  };
}

export async function runIssueTranslation(
  plan: Awaited<ReturnType<typeof planIssueTranslation>>,
  engineId: string,
  signal: AbortSignal,
  onProgress: (progress: IssueTranslationProgress) => void,
) {
  const storage = chineseTranslationStorage(getReaderStorage(), engineId);
  let source: string | null | undefined;
  let index = new Map<string, ParagraphTranslationRecord[]>();
  const readLegacy = (key: string) => {
    const value = storage.getItem(PARAGRAPH_TRANSLATIONS_KEY);
    if (source !== value) {
      source = value;
      index = indexRecords(loadParagraphTranslations(storage));
    }
    return index.get(key) ?? [];
  };
  let progress = initialIssueTranslationProgress(plan);
  const update = (changes: Partial<IssueTranslationProgress>) => {
    progress = { ...progress, ...changes };
    onProgress(progress);
  };
  let waitedMs = 0;
  const request = async <T>(send: () => Promise<T>): Promise<T> => {
    let retries = 0;
    while (true) {
      signal.throwIfAborted();
      try {
        return await send();
      } catch (error) {
        signal.throwIfAborted();
        const status = errorStatus(error);
        const retry = plan.useBatches && [429, 503].includes(Number(status)) && retries < 2;
        if (status !== 409 && !retry) throw error;
        update({ waiting: status === 409, retrying: retry });
        const started = performance.now();
        await waitForTranslationEngine(signal, retry ? 2000 * ++retries : 900);
        waitedMs += performance.now() - started;
      }
    }
  };
  const countTranslation = () => update({ translated: progress.translated + 1, waiting: false, retrying: false });
  for (const { article, missing } of plan.documents) {
    if (!missing.length) continue;
    signal.throwIfAborted();
    update({ currentTitle: article.title, currentDocumentId: article.identity.documentId, waiting: false, retrying: false });
    let failure: string | undefined;
    for (const group of groupEntries(missing, plan.useBatches)) {
      const pending: TranslationEntry[] = [];
      waitedMs = 0;
      for (const entry of group) {
        signal.throwIfAborted();
        if (await hasCachedEntry(entry, engineId, readLegacy)) countTranslation();
        else pending.push(entry);
      }
      if (plan.useBatches && pending.length && pending[0].target.sourceText.length <= 4800) {
        let batch: Awaited<ReturnType<typeof translateListeningBatch>> | undefined;
        try {
          batch = await request(() => translateListeningBatch(pending.map(entry => entry.target.sourceText), engineId, signal));
        } catch (error) {
          signal.throwIfAborted();
          if (![408, 502].includes(Number(errorStatus(error)))) throw error;
        }
        if (batch?.timings) {
          const previous = progress.timings;
          const { queueMs, preparationMs, modelMs } = batch.timings;
          update({ timings: {
            count: (previous?.count ?? 0) + 1,
            queueMs: (previous?.queueMs ?? 0) + queueMs + waitedMs,
            preparationMs: (previous?.preparationMs ?? 0) + preparationMs,
            modelMs: (previous?.modelMs ?? 0) + modelMs,
          } });
        }
        const untranslated: TranslationEntry[] = [];
        for (const [index, entry] of pending.entries()) {
          const result = batch?.results[index];
          if (!result) untranslated.push(entry);
          else {
            await saveEntry(entry, engineId, result);
            countTranslation();
          }
        }
        pending.splice(0, pending.length, ...untranslated);
        if (pending.length) update({ waiting: false, retrying: true });
      }
      for (const entry of pending) {
        try {
          // A foreground reader may have saved this segment while the batch was running.
          if (!await hasCachedEntry(entry, engineId, readLegacy)) {
            const result = await request(() => translateMissingListeningText(entry.target.sourceText, engineId, signal, true, plan.useBatches));
            await saveEntry(entry, engineId, result);
          }
          countTranslation();
        } catch (error) {
          signal.throwIfAborted();
          if ([401, 403, 429, 503].includes(Number(errorStatus(error))) || error instanceof DOMException) throw error;
          failure ??= error instanceof Error ? error.message : "译文生成失败";
          update({ waiting: false, retrying: false });
        }
      }
    }
    update(failure
      ? { failedArticles: [...progress.failedArticles, { title: article.title, error: failure }] }
      : { completedArticles: progress.completedArticles + 1 });
  }
  update({ currentTitle: undefined, currentDocumentId: undefined, waiting: false, retrying: false });
  return progress;
}
