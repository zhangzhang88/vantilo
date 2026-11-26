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

function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCache<T>(read: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const database = await openCache();
  try {
    return await read(database.transaction("paragraphs").objectStore("paragraphs"));
  } finally {
    database.close();
  }
}

export async function loadIssueTranslations(engineId: string, issueId: string) {
  const entries = await readCache<CachedTranslation[]>(store => readRequest(store.index("byIssue").getAll([engineId, issueId])));
  return entries.map(entry => entry.record);
}

export async function loadBookTranslations(engineId: string, documentIds: string[]) {
  const chapters = await readCache<CachedTranslation[][]>(store => {
    const index = store.index("byDocument");
    return Promise.all(documentIds.map(documentId => readRequest(index.getAll([engineId, documentId]))));
  });
  return chapters.flatMap(entries => entries.map(entry => entry.record));
}

export async function loadIssueDocumentTranslations(engineId: string, documentId: string) {
  const entries = await readCache<CachedTranslation[]>(store => readRequest(store.index("byDocument").getAll([engineId, documentId])));
  return entries.map(entry => entry.record);
}

export async function readIssueTranslation(engineId: string, key: string) {
  const entry = await readCache<CachedTranslation | undefined>(store => readRequest(store.get([engineId, key])));
  return entry?.record;
}

export async function listCachedTranslationEngines(): Promise<string[]> {
  if (typeof indexedDB === "undefined") return [];
  return readCache<string[]>(store => new Promise((resolve, reject) => {
    const engines: string[] = [];
    const request = store.openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(engines);
        return;
      }
      const key = cursor.key;
      if (Array.isArray(key) && typeof key[0] === "string") {
        engines.push(key[0]);
        cursor.continue([key[0], "\uffff"]);
      } else {
        cursor.continue();
      }
    };
    request.onerror = () => reject(request.error);
  }));
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
