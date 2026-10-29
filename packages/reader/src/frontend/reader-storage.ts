export interface ReaderStorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
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
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
  };
}

let browserStorage: ReturnType<typeof createReaderStorage> | undefined;
export function getReaderStorage() {
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
