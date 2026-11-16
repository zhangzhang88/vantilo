import type { ParagraphTranslationRecord } from "./paragraph-translation-state";

type CachedTranslation = { engineId: string; record: ParagraphTranslationRecord };

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vantilo-issue-translations", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("paragraphs", { keyPath: ["engineId", "record.key"] });
      store.createIndex("byIssue", ["engineId", "record.issueId"]);
      store.createIndex("byDocument", ["engineId", "record.document.documentId"]);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCache<T>(read: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openCache();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = read(database.transaction("paragraphs").objectStore("paragraphs"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function loadIssueTranslations(engineId: string, issueId: string) {
  const entries = await readCache<CachedTranslation[]>(store => store.index("byIssue").getAll([engineId, issueId]));
  return entries.map(entry => entry.record);
}

export async function loadIssueDocumentTranslations(engineId: string, documentId: string) {
  const entries = await readCache<CachedTranslation[]>(store => store.index("byDocument").getAll([engineId, documentId]));
  return entries.map(entry => entry.record);
}

export async function readIssueTranslation(engineId: string, key: string) {
  const entry = await readCache<CachedTranslation | undefined>(store => store.get([engineId, key]));
  return entry?.record;
}

export async function saveIssueTranslation(engineId: string, record: ParagraphTranslationRecord) {
  const database = await openCache();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("paragraphs", "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("译文缓存写入已中断"));
      transaction.objectStore("paragraphs").put({ engineId, record } satisfies CachedTranslation);
    });
  } finally {
    database.close();
  }
}
