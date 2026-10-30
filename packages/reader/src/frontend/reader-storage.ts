export interface ReaderStorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let persistenceFrozen = false;
let guardsInstalled = false;
let guardedLocalStorage: Storage | null = null;
const activeIndexedDbWrites = new Set<Promise<void>>();
const frozenStorageKeys = new Set<string>();
const bypassedFrozenStorageKeys = new Set<string>();

function vocabularyRecoveryRequired(): boolean {
  return typeof window !== "undefined"
    && Boolean((window as Window & { __vantiloVocabularyRecoveryRequired?: string }).__vantiloVocabularyRecoveryRequired);
}

function storageKeyIsFrozen(key: string): boolean {
  return persistenceFrozen || frozenStorageKeys.has(key) || (vocabularyRecoveryRequired() && isVocabularyStorageKey(key));
}

function isVocabularyStorageKey(key: string): boolean {
  return key === "economist-reader-selections-v1"
    || key === "economist-reader-word-context-v1"
    || key === "magazine-reader-vocabulary-review-v1";
}

function installPersistenceGuards(): void {
  if (guardsInstalled) return;
  if (typeof window === "undefined") return;
  try {
    guardedLocalStorage = window.localStorage;
    const storagePrototype = Object.getPrototypeOf(guardedLocalStorage) as Storage;
    for (const method of ["setItem", "removeItem", "clear"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(storagePrototype, method);
      if (!descriptor || typeof descriptor.value !== "function") throw new Error("Storage guard unavailable");
      const original = descriptor.value as (...args: unknown[]) => unknown;
      Object.defineProperty(storagePrototype, method, {
        ...descriptor,
        value: function (this: Storage, ...args: unknown[]) {
          if (this === guardedLocalStorage) {
            const key = method === "clear" ? null : String(args[0] ?? "");
            const blocked = method === "clear"
              ? persistenceFrozen || frozenStorageKeys.size > 0 || vocabularyRecoveryRequired()
              : storageKeyIsFrozen(key!) && !bypassedFrozenStorageKeys.has(key!);
            if (blocked) throw new DOMException(vocabularyRecoveryRequired() ? "词汇恢复状态需要先处理，已暂停词汇数据写入。" : "数据维护期间已暂停相关数据写入。", "InvalidStateError");
          }
          return Reflect.apply(original, this, args);
        },
      });
    }
    if (typeof indexedDB !== "undefined" && typeof IDBDatabase !== "undefined") {
      const prototype = IDBDatabase.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "transaction");
      if (!descriptor || typeof descriptor.value !== "function") throw new Error("IndexedDB guard unavailable");
      const original = descriptor.value as (...args: unknown[]) => IDBTransaction;
      Object.defineProperty(prototype, "transaction", {
        ...descriptor,
        value: function (this: IDBDatabase, ...args: unknown[]) {
          const mode = args[1] ?? "readonly";
          if (persistenceFrozen && mode !== "readonly") throw new DOMException("Reader 备份期间已暂停 IndexedDB 写入。", "InvalidStateError");
          const transaction = Reflect.apply(original, this, args) as IDBTransaction;
          if (mode !== "readonly") {
            let finish!: () => void;
            const done = new Promise<void>(resolve => { finish = resolve; });
            activeIndexedDbWrites.add(done);
            const release = () => { if (!activeIndexedDbWrites.delete(done)) return; finish(); };
            transaction.addEventListener("complete", release, { once: true });
            transaction.addEventListener("abort", release, { once: true });
            transaction.addEventListener("error", release, { once: true });
          }
          return transaction;
        },
      });
    }
    guardsInstalled = true;
  } catch (error) {
    throw new Error("无法安装 Reader 备份写入保护；为避免不一致，已停止备份。", { cause: error });
  }
}

export async function freezeReaderPersistence(): Promise<() => void> {
  installPersistenceGuards();
  const storage = getReaderStorage();
  // Flush the Reader's existing retry queue before the synchronous freeze edge.
  storage.retry();
  if (storage.getSnapshot().pendingCount) throw new Error("存在尚未写入本机的阅读数据，请先确认阅读内容已保存后重试。");
  persistenceFrozen = true;
  try {
    await Promise.all([...activeIndexedDbWrites]);
    if (storage.getSnapshot().pendingCount) throw new Error("备份期间出现未完成的阅读写入，已中止备份。");
  } catch (error) {
    persistenceFrozen = false;
    throw error;
  }
  let resumed = false;
  return () => { if (!resumed) { resumed = true; persistenceFrozen = false; } };
}

export function isReaderPersistenceFrozen(): boolean { return persistenceFrozen; }
export function resumeReaderPersistence(): void { persistenceFrozen = false; }

/** Freeze only the vocabulary records that participate in the portable vocabulary archive. */
export function freezeReaderStorageKeys(keys: readonly string[]): () => void {
  installPersistenceGuards();
  if (!keys.length || keys.some(key => !isVocabularyStorageKey(key))) throw new Error("只允许冻结已登记的词汇数据项");
  if (persistenceFrozen) throw new Error("Reader 数据维护已经进行中，不能同时启动词汇操作。");
  if (vocabularyRecoveryRequired()) throw new Error("词汇恢复状态尚未解决，不能开始新的备份或恢复。");
  const storage = getReaderStorage();
  const pendingKeys = storage.getPendingKeys().filter(key => keys.includes(key));
  if (pendingKeys.length) throw new Error("词汇数据仍有尚未写入的更改，请先确认保存完成后重试。");
  for (const key of keys) {
    if (frozenStorageKeys.has(key)) throw new Error("词汇备份或恢复已在进行中。");
  }
  keys.forEach(key => frozenStorageKeys.add(key));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    keys.forEach(key => frozenStorageKeys.delete(key));
  };
}

/** Apply a previously validated vocabulary transaction while its keys are frozen. */
export function writeFrozenReaderStorageKeys(entries: Record<string, string | null>): void {
  const keys = Object.keys(entries);
  if (!keys.length || keys.some(key => !frozenStorageKeys.has(key) || !isVocabularyStorageKey(key))) {
    throw new Error("词汇数据写入未持有完整的专属写入冻结");
  }
  keys.forEach(key => bypassedFrozenStorageKeys.add(key));
  try {
    for (const [key, value] of Object.entries(entries)) {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    }
  } finally {
    keys.forEach(key => bypassedFrozenStorageKeys.delete(key));
  }
}

export function isReaderStorageKeysFrozen(keys: readonly string[]): boolean {
  return keys.some(key => frozenStorageKeys.has(key));
}

// Only generated, reproducible caches may be evicted. User-edited context meanings are protected.
const disposableCacheKeys = [
  "magazine-reader-paragraph-translations-v1",
  "magazine-reader-sentence-translations-v1",
  "magazine-reader-selection-assist-cache-v1",
  "magazine-reader-reading-assistant-cache-v1",
];

export function createReaderStorage(backend: ReaderStorageBackend) {
  const pending = new Map<string, string>();
  const listeners = new Set<() => void>();
  let snapshot = { pendingCount: 0, readFailed: false };
  const publish = () => {
    snapshot = { pendingCount: pending.size, readFailed: snapshot.readFailed };
    // Saves also occur inside React state updaters; notify after the current render.
    queueMicrotask(() => listeners.forEach((listener) => listener()));
  };
  const write = (key: string, value: string): boolean => {
    try {
      backend.setItem(key, value);
      return true;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "QuotaExceededError") return false;
      for (const cacheKey of disposableCacheKeys) {
        if (cacheKey === key) continue;
        try { backend.removeItem(cacheKey); } catch { /* Keep original user data. */ }
      }
      try { backend.setItem(key, value); return true; } catch { return false; }
    }
  };
  return {
    getItem(key: string): string | null {
      if (pending.has(key)) return pending.get(key)!;
      try { return backend.getItem(key); } catch {
        if (!snapshot.readFailed) { snapshot = { ...snapshot, readFailed: true }; publish(); }
        return null;
      }
    },
    setItem(key: string, value: string): void {
      if (storageKeyIsFrozen(key) && !bypassedFrozenStorageKeys.has(key)) throw new DOMException(vocabularyRecoveryRequired() ? "词汇恢复状态需要先处理，已暂停词汇数据写入。" : "数据维护期间已暂停相关数据写入。", "InvalidStateError");
      if (write(key, value)) pending.delete(key);
      else pending.set(key, value);
      publish();
    },
    retry(): void {
      for (const [key, value] of pending) {
        if (write(key, value)) pending.delete(key);
      }
      publish();
    },
    discardPending(): void { pending.clear(); publish(); },
    getPendingKeys(): string[] { return [...pending.keys()]; },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
  };
}

let browserStorage: ReturnType<typeof createReaderStorage> | undefined;
export function getReaderStorage() {
  installPersistenceGuards();
  if (!browserStorage) {
    // Resolve localStorage inside each method: a browser can deny access to the property itself.
    browserStorage = createReaderStorage({
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: (key) => window.localStorage.removeItem(key),
    });
  }
  return browserStorage;
}
