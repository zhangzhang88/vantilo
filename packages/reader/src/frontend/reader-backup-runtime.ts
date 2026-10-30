import { buildUserDataBackup } from "./user-data-backup";
import { getReaderStorage, freezeReaderPersistence, resumeReaderPersistence } from "./reader-storage";

let excludedIndexedDbBlobs: Array<{ mimeType: string; size: number }> = [];

function requestHostGrowthSnapshot(): Promise<unknown> {
  const token = (window as Window & { __vantiloGrowthToken?: string }).__vantiloGrowthToken;
  if (!token) return Promise.reject(new Error("阅读成长备份通道未就绪，请重新打开阅读空间后重试。"));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, value?: unknown) => {
      window.removeEventListener("message", receive); window.clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || !["file://", "null", "http://127.0.0.1:5173"].includes(event.origin)) return;
      const data = event.data;
      if (data?.type !== "vantilo:growth-backup-response" || data.token !== token || data.requestId !== requestId) return;
      if (data.ok !== true) finish(new Error(typeof data.error === "string" ? data.error : "宿主窗口无法读取阅读成长数据。"));
      else finish(undefined, data.record);
    };
    const timer = window.setTimeout(() => finish(new Error("读取阅读成长数据超时；未生成不完整备份。")), 10000);
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "vantilo:growth-backup-request", token, requestId, operation: "snapshot" }, "*");
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function encodeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "undefined") return { $vantiloType: "undefined" };
  if (typeof value === "bigint") return { $vantiloType: "bigint", value: value.toString() };
  if (typeof value !== "object") throw new Error("IndexedDB 含有无法安全备份的数据类型。");
  if (seen.has(value)) throw new Error("IndexedDB 含有循环引用，已停止备份以避免数据丢失。");
  seen.add(value);
  try {
    if (value instanceof Date) return { $vantiloType: "date", value: value.toISOString() };
    if (value instanceof Blob) return { $vantiloType: "blob", mimeType: value.type, base64: "__blob__" };
    if (value instanceof ArrayBuffer) return { $vantiloType: "array-buffer", base64: bytesToBase64(new Uint8Array(value)) };
    if (ArrayBuffer.isView(value)) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return { $vantiloType: value.constructor.name, base64: bytesToBase64(bytes) };
    }
    if (Array.isArray(value)) return value.map(item => encodeValue(item, seen));
    if (value instanceof Map) return { $vantiloType: "map", entries: [...value].map(([key, item]) => [encodeValue(key, seen), encodeValue(item, seen)]) };
    if (value instanceof Set) return { $vantiloType: "set", values: [...value].map(item => encodeValue(item, seen)) };
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`IndexedDB 含有不支持的对象类型：${prototype?.constructor?.name || "unknown"}`);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item, seen)]));
  } finally { seen.delete(value); }
}

async function encodeBlob(value: unknown, seen = new WeakSet<object>()): Promise<unknown> {
  if (value instanceof Blob) {
    if (/^(?:image|audio|video)\//i.test(value.type) || /(?:epub|zip)/i.test(value.type) || value.size > 8 * 1024 * 1024) {
      excludedIndexedDbBlobs.push({ mimeType: value.type || "unknown", size: value.size });
      return { $vantiloType: "excluded-original-blob", mimeType: value.type || "unknown", size: value.size };
    }
    const bytes = new Uint8Array(await value.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return { $vantiloType: "blob", mimeType: value.type, base64: btoa(binary) };
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const prefix = bytes.subarray(0, 16);
    const ascii = String.fromCharCode(...prefix);
    const binaryType =
      prefix.length >= 8 && prefix[0] === 0x89 && ascii.slice(1, 4) === "PNG" ? "image/png" :
      prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff ? "image/jpeg" :
      ascii.startsWith("GIF8") ? "image/gif" :
      ascii.slice(0, 4) === "RIFF" && ascii.slice(8, 12) === "WEBP" ? "image/webp" :
      ascii.startsWith("ID3") ? "audio/mpeg" :
      ascii.startsWith("OggS") ? "audio/ogg" :
      ascii.startsWith("%PDF-") ? "application/pdf" :
      ascii.slice(0, 4) === "PK\u0003\u0004" ? "application/zip" :
      ascii.slice(4, 8) === "ftyp" ? "video/mp4" : null;
    if (binaryType || bytes.byteLength > 8 * 1024 * 1024) {
      excludedIndexedDbBlobs.push({ mimeType: binaryType || "application/octet-stream", size: bytes.byteLength });
      return { $vantiloType: "excluded-original-blob", mimeType: binaryType || "application/octet-stream", size: bytes.byteLength };
    }
    return encodeValue(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("IndexedDB 含有循环引用，已停止备份以避免数据丢失。");
    seen.add(value);
    try { const output = []; for (const item of value) output.push(await encodeBlob(item, seen)); return output; }
    finally { seen.delete(value); }
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) throw new Error("IndexedDB 含有循环引用，已停止备份以避免数据丢失。");
    seen.add(value);
    try {
      if (value instanceof Date) return encodeValue(value);
      if (value instanceof Map) {
        const entries = [];
        for (const [key, item] of value) entries.push([await encodeBlob(key, seen), await encodeBlob(item, seen)]);
        return { $vantiloType: "map", entries };
      }
      if (value instanceof Set) { const values = []; for (const item of value) values.push(await encodeBlob(item, seen)); return { $vantiloType: "set", values }; }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new Error(`IndexedDB 含有不支持的对象类型：${prototype?.constructor?.name || "unknown"}`);
      const pairs = [];
      for (const [key, item] of Object.entries(value)) pairs.push([key, await encodeBlob(item, seen)] as const);
      return Object.fromEntries(pairs);
    } finally { seen.delete(value); }
  }
  return encodeValue(value);
}

function openExistingDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error(`IndexedDB ${name} 的版本状态无法安全读取。`)); };
    request.onerror = () => reject(request.error || new Error(`无法打开 IndexedDB ${name}`));
    request.onsuccess = () => resolve(request.result);
  });
}

function readStore(database: IDBDatabase, storeName: string): Promise<{ count: number; records: unknown[] }> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const keysRequest = store.getAllKeys();
    const valuesRequest = store.getAll();
    let keys: IDBValidKey[] | null = null;
    let values: unknown[] | null = null;
    let failed = false;
    const fail = () => { if (failed) return; failed = true; reject(transaction.error || keysRequest.error || valuesRequest.error || new Error("IndexedDB 导出失败")); };
    keysRequest.onerror = fail; valuesRequest.onerror = fail; transaction.onerror = fail; transaction.onabort = fail;
    transaction.oncomplete = () => {
      if (failed || !keys || !values || keys.length !== values.length) return fail();
      void Promise.all(values.map(async (value, index) => ({ key: await encodeBlob(keys![index]), value: await encodeBlob(value) })))
        .then(records => resolve({ count: records.length, records }), reject);
    };
    keysRequest.onsuccess = () => { keys = keysRequest.result; };
    valuesRequest.onsuccess = () => { values = valuesRequest.result; };
  });
}

export async function exportReaderIndexedDb(): Promise<Array<{ name: string; version: number; stores: Array<{ name: string; count: number; records: unknown[] }> }>> {
  if (typeof indexedDB === "undefined") return [];
  if (typeof indexedDB.databases !== "function") throw new Error("当前 Reader 环境无法枚举 IndexedDB；为避免漏备份，已停止备份。");
  excludedIndexedDbBlobs = [];
  const databases = (await indexedDB.databases()).filter((item): item is IDBDatabaseInfo & { name: string } => typeof item.name === "string");
  if (!databases.length) return [];
  const result = [];
  for (const info of databases) {
    const database = await openExistingDatabase(info.name);
    try {
      const stores = [];
      for (const storeName of Array.from(database.objectStoreNames).sort()) stores.push({ name: storeName, ...await readStore(database, storeName) });
      result.push({ name: database.name, version: database.version, stores });
    } finally { database.close(); }
  }
  return result;
}

export type ReaderBrowserSnapshot = {
  version: 1;
  origins: string[];
  localStorage: ReturnType<typeof buildUserDataBackup>;
  indexedDB: Awaited<ReturnType<typeof exportReaderIndexedDb>>;
  excludedIndexedDbBlobs: Array<{ mimeType: string; size: number }>;
};

export async function createReaderBrowserSnapshot(growthRecord: unknown, origins: string[]): Promise<ReaderBrowserSnapshot> {
  const storage = getReaderStorage();
  if (storage.getSnapshot().pendingCount) throw new Error("存在尚未保存的阅读内容，已停止备份。");
  const backupStorage = {
    getItem: (key: string) => key === "vantilo-reading-growth-v1" ? JSON.stringify(growthRecord) : storage.getItem(key),
    keys: () => Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter((key): key is string => key !== null),
  };
  const readerBackup = buildUserDataBackup(backupStorage as Parameters<typeof buildUserDataBackup>[0]);
  const indexedDB = await exportReaderIndexedDb();
  return { version: 1, origins, localStorage: readerBackup, indexedDB, excludedIndexedDbBlobs };
}

let activeBackupId: string | null = null;
let releasePersistence: (() => void) | null = null;
if (typeof window !== "undefined" && window.parent !== window) {
  window.addEventListener("message", event => {
    if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
    const data = event.data as Record<string, unknown>;
    const token = (window as Window & { __vantiloGrowthToken?: string }).__vantiloGrowthToken;
    if (!token || data.token !== token || typeof data.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.requestId)) return;
    if (data.type === "vantilo:reader-backup-resume" && data.requestId === activeBackupId) {
      releasePersistence?.(); releasePersistence = null; resumeReaderPersistence(); activeBackupId = null; return;
    }
    if (data.type !== "vantilo:reader-backup-freeze" || activeBackupId || activeBackupId === data.requestId) return;
    activeBackupId = data.requestId;
    void (async () => {
      try {
        releasePersistence = await freezeReaderPersistence();
        const growth = await requestHostGrowthSnapshot();
        const snapshot = await createReaderBrowserSnapshot(growth, ["http://127.0.0.1:5175"]);
        window.parent.postMessage({ type: "vantilo:reader-backup-snapshot", token, requestId: data.requestId, snapshot }, "*");
      } catch (error) {
        window.parent.postMessage({ type: "vantilo:reader-backup-error", token, requestId: data.requestId, message: error instanceof Error ? error.message : "无法安全读取 Reader 阅读数据" }, "*");
      }
    })();
  });
}
