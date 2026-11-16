import { isTranslatableText } from "../shared/translation-text";
import {
  chineseTranslationStorage, findListeningTranslation, isListeningTranslationEngine, loadListeningTranslations, saveDocumentTranslation, translateMissingListeningText,
} from "./chinese-translation-reuse";
import { loadIssueTranslations, readIssueTranslation } from "./issue-translation-cache";
import {
  loadParagraphTranslations, PARAGRAPH_TRANSLATIONS_KEY, paragraphTranslationTarget, titleTranslationTarget, translationCacheMetadata,
  type ParagraphTranslationRecord, type ParagraphTranslationTarget,
} from "./paragraph-translation-state";
import { flattenArticles, type ReaderIssue } from "./reader-model";
import { articleReadingDocumentIdentity } from "../shared/reading-document-identity";
import { getReaderStorage } from "./reader-storage";
import { magazineReaderCollection, type ReaderDocumentView } from "./reading-document-view";

export function magazineTranslationTargets(article: ReaderDocumentView): ParagraphTranslationTarget[] {
  return [
    ...(!article.titleZh && isTranslatableText(article.title) ?
      [titleTranslationTarget({ document: article.identity, sourceText: article.title })] : []),
    ...article.paragraphs.flatMap((sourceText, paragraphIndex) => isTranslatableText(sourceText) ?
      [paragraphTranslationTarget({ document: article.identity, paragraphIndex, sourceText })] : []),
  ];
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

export async function planIssueTranslation(issue: ReaderIssue, engineId: string) {
  const persisted = await loadIssueTranslations(engineId, issue.id);
  const storage = getReaderStorage();
  const cached = indexRecords([...persisted, ...loadListeningTranslations(storage, engineId)]);
  const documents = magazineReaderCollection(issue).documents.map(article => {
    const targets = magazineTranslationTargets(article);
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
  waiting?: boolean;
}

function waitForTranslationEngine(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => {
      window.clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, 900);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

function errorStatus(error: unknown) {
  return error instanceof Error && "status" in error ? error.status : undefined;
}

async function translateEntry(
  entry: IssueTranslationDocument["missing"][number],
  engineId: string,
  signal: AbortSignal,
  readLegacy: (key: string) => ParagraphTranslationRecord[],
  onWaiting: (waiting: boolean) => void,
) {
  const { target, context } = entry;
  while (!signal.aborted) {
    // A reader or the player may have filled this hole after the initial scan.
    const persisted = await readIssueTranslation(engineId, target.key);
    const cached = findListeningTranslation(persisted ? [persisted] : [], target, context, true)
      ?? findListeningTranslation(readLegacy(target.key), target, context, true);
    if (cached) return;
    signal.throwIfAborted();
    let result: Awaited<ReturnType<typeof translateMissingListeningText>>;
    try {
      result = await translateMissingListeningText(target.sourceText, engineId, signal, true);
    } catch (error) {
      if (errorStatus(error) !== 409) throw error;
      onWaiting(true);
      await waitForTranslationEngine(signal);
      continue;
    }
    await saveDocumentTranslation(getReaderStorage(), {
      ...target,
      model: result.model,
      profileId: result.profileId,
      provider: result.provider,
      translationZh: result.translation,
      ...translationCacheMetadata({
        ...context, model: result.model, profileId: result.profileId,
        provider: "easycliproxy", targetLanguage: "zh-CN", promptVersion: "paragraph-translation-v1",
      }),
      generatedAt: new Date().toISOString(),
    }, engineId);
    return;
  }
  signal.throwIfAborted();
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
  for (const { article, missing } of plan.documents) {
    if (!missing.length) continue;
    signal.throwIfAborted();
    update({ currentTitle: article.title, waiting: false });
    let failure: string | undefined;
    for (const entry of missing) {
      try {
        await translateEntry(entry, engineId, signal, readLegacy, waiting => update({ waiting }));
        update({ translated: progress.translated + 1, waiting: false });
      } catch (error) {
        signal.throwIfAborted();
        if ([401, 403, 429, 503].includes(Number(errorStatus(error))) || error instanceof DOMException) throw error;
        failure ??= error instanceof Error ? error.message : "译文生成失败";
        update({ waiting: false });
      }
    }
    update(failure
      ? { failedArticles: [...progress.failedArticles, { title: article.title, error: failure }] }
      : { completedArticles: progress.completedArticles + 1 });
  }
  return progress;
}
