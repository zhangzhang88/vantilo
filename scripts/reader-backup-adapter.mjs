// Extend the Reader's version-1 backup to include Vantilo's model-specific caches.
// Old backups remain readable and never erase caches they could not contain.
export function adaptReaderBackup(source, filename) {
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('Reader backup seam changed: ' + before.slice(0, 45));
    source = source.replace(before, after);
  };
  if (filename.endsWith('/frontend/reader-storage.ts')) {
    replace('  removeItem(key: string): void;\n}', '  removeItem(key: string): void;\n  keys?(): string[];\n}');
    replace('    retry(): void {', '    keys(): string[] { return [...new Set([...(backend.keys?.() ?? []), ...pending.keys()])]; },\n    retry(): void {');
    replace('      removeItem: (key) => window.localStorage.removeItem(key),', '      removeItem: (key) => window.localStorage.removeItem(key),\n      keys: () => Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i)).filter((key): key is string => key !== null),');
    return source;
  }
  if (filename.endsWith('/frontend/storage-notice.tsx')) return adaptGrowthBackupTransport(source);
  if (filename.endsWith('/frontend/data-management-panel.tsx')) return source; // Vantilo replaces this panel with scripts/reader-data-management.tsx.
  if (!filename.endsWith('/frontend/user-data-backup.ts')) return source;
  replace('  removeItem(key: string): void;\n}', '  removeItem(key: string): void;\n  keys?(): string[];\n  readonly length?: number;\n  key?(index: number): string | null;\n}');
  replace('  exportedAt: string;\n  data: Record<string, unknown>;', '  exportedAt: string;\n  variantKeysIncluded?: boolean;\n  data: Record<string, unknown>;');
  replace('type BackupValueShape = "reader-state" | "lesson-state" | "preferences" | "versioned-items" | "records";', 'type BackupValueShape = "reader-state" | "lesson-state" | "preferences" | "versioned-items" | "records" | "growth-record";');
  replace('  count: number;\n}', '  count: number;\n  description?: string;\n}');
  replace('  { key: READING_ASSISTANT_CACHE_KEY, label: "AI 阅读助手固定问题缓存", shape: "records" },', '  { key: READING_ASSISTANT_CACHE_KEY, label: "AI 阅读助手固定问题缓存", shape: "records" },\n  { key: "vantilo-reading-growth-v1", label: "阅读成长记录", shape: "growth-record" },');
  const anchor = 'function isObject(value: unknown): value is Record<string, unknown> {';
  replace(anchor, `function variantEntry(key: string): UserDataBackupEntryDefinition | undefined {
  for (const base of [PARAGRAPH_TRANSLATIONS_KEY, SENTENCE_TRANSLATIONS_KEY]) {
    const prefix = base + ":vantilo-v2:";
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    if (!/^(?:custom-api:[a-f0-9]{12}|codex:[a-zA-Z0-9._-]{1,128}|qwen:[a-zA-Z0-9._@:-]{1,256})$/.test(id)) return undefined;
    return USER_DATA_BACKUP_ENTRIES.find(entry => entry.key === base);
  }
  return undefined;
}
function variantKeys(storage: Partial<BackupStorage>): string[] {
  let keys: string[] = [];
  if (storage.keys) keys = storage.keys();
  else if (typeof storage.length === "number" && storage.key) {
    for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (key !== null) keys.push(key); }
  }
  return [...new Set(keys.filter(key => Boolean(variantEntry(key))))];
}
function validGrowthRecord(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.days) || Object.keys(value.days).length > 20000) return false;
  for (const [date, raw] of Object.entries(value.days)) {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) return false;
    const parsed = new Date(date + "T00:00:00Z"); if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) return false;
    if (!isObject(raw) || typeof raw.seconds !== "number" || !Number.isFinite(raw.seconds) || raw.seconds < 0 || raw.seconds > 86400 || !isObject(raw.books) || Object.keys(raw.books).length > 1000) return false;
    let sum = 0;
    for (const [bookId, seconds] of Object.entries(raw.books)) { if (!bookId.trim() || bookId.length > 512 || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > 86400) return false; sum += seconds; }
    if (Math.abs(sum - raw.seconds) > 0.01) return false;
  }
  return true;
}
${anchor}`);
  replace('function validBackupValue(entry: UserDataBackupEntryDefinition, value: unknown): boolean {\n  if (entry.key === LEARNING_GAME_PREFERENCES_KEY)', 'function validBackupValue(entry: UserDataBackupEntryDefinition, value: unknown): boolean {\n  if (entry.shape === "growth-record") return validGrowthRecord(value);\n  if (entry.key === LEARNING_GAME_PREFERENCES_KEY)');
  replace('    const entry = definitions.get(key);', '    const entry = definitions.get(key) ?? variantEntry(key);');
  replace('  if (!isObject(value.data)) throw new Error("备份文件的数据区格式不正确。");', '  if (!isObject(value.data)) throw new Error("备份文件的数据区格式不正确。");\n  if (value.variantKeysIncluded !== undefined && typeof value.variantKeysIncluded !== "boolean") throw new Error("备份文件的模型译文标记无效。");');
  replace('export function buildUserDataBackup(storage: Pick<BackupStorage, "getItem">, now = new Date()): UserDataBackupV1 {', 'export function buildUserDataBackup(storage: Pick<BackupStorage, "getItem"> & Partial<BackupStorage>, now = new Date()): UserDataBackupV1 {');
  replace('  return {\n    app: "magazine-reader",\n    version: 1,\n    exportedAt: now.toISOString(),\n    data,\n  };', `  for (const key of variantKeys(storage)) {
    const entry = variantEntry(key)!;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error(\`本机的“\${entry.label}”数据已损坏，无法安全导出。\`); }
    if (!validBackupValue(entry, parsed)) throw new Error(\`本机的“\${entry.label}”格式异常，无法安全导出。\`);
    data[key] = parsed;
  }
  return { app: "magazine-reader", version: 1, exportedAt: now.toISOString(), variantKeysIncluded: true, data };`);
  replace('  return { exportedAt: valid.exportedAt, categoryCount: entries.length, entries };', `  for (const key of Object.keys(valid.data)) {
    const entry = variantEntry(key);
    if (entry) entries.push({ key, label: entry.label + "（按模型）", count: countBackupValue(entry, valid.data[key]) });
  }
  const growth = valid.data["vantilo-reading-growth-v1"];
  const growthEntry = entries.find(entry => entry.key === "vantilo-reading-growth-v1");
  if (isObject(growth) && isObject(growth.days) && growthEntry) {
    const days = Object.values(growth.days).filter(isObject);
    const seconds = days.reduce((sum, day) => sum + (typeof day.seconds === "number" ? day.seconds : 0), 0);
    const qualified = days.filter(day => typeof day.seconds === "number" && day.seconds >= 1800).length;
    growthEntry.description = days.length + " 天 · " + (seconds / 3600).toFixed(1) + " 小时 · " + qualified + " 个达标日";
  }
  return { exportedAt: valid.exportedAt, categoryCount: entries.length, entries };`);
  replace('function countBackupValue(entry: UserDataBackupEntryDefinition, value: unknown): number {\n  if (entry.shape === "records")', 'function countBackupValue(entry: UserDataBackupEntryDefinition, value: unknown): number {\n  if (entry.shape === "growth-record") return isObject(value) && isObject(value.days) ? Object.keys(value.days).length : 0;\n  if (entry.shape === "records")');
  const start = source.indexOf('export function restoreUserDataBackup(');
  const end = source.indexOf('export function clearUserData(', start);
  if (start < 0 || end < 0) throw new Error('Reader restore seam changed');
  source = source.slice(0, start) + `export function restoreUserDataBackup(storage: BackupStorage, backup: UserDataBackupV1): void {
  const valid = validateBackupObject(backup);
  const keys = [...USER_DATA_STORAGE_KEYS];
  if (valid.variantKeysIncluded) keys.push(...new Set([...variantKeys(storage), ...Object.keys(valid.data).filter(key => variantEntry(key))]));
  const previous = new Map(keys.map(key => [key, storage.getItem(key)]));
  try {
    for (const key of keys) {
      if (key === "vantilo-reading-growth-v1") continue; // Vantilo host is authoritative; legacy snapshots preserve it.
      if (Object.prototype.hasOwnProperty.call(valid.data, key)) storage.setItem(key, JSON.stringify(valid.data[key]));
      else storage.removeItem(key);
    }
  } catch (error) {
    for (const key of keys) {
      try { const old = previous.get(key); if (old == null) storage.removeItem(key); else storage.setItem(key, old); } catch { /* Best effort rollback. */ }
    }
    throw error;
  }
}

` + source.slice(end);
  replace('export function clearUserData(storage: Pick<BackupStorage, "removeItem">): void {\n  storage.removeItem(LEARNING_ACTIVE_KEY);\n  USER_DATA_BACKUP_ENTRIES.forEach((entry) => storage.removeItem(entry.key));\n}', `export function clearUserData(storage: Pick<BackupStorage, "removeItem"> & Partial<BackupStorage>): void {
  const keys = variantKeys(storage);
  storage.removeItem(LEARNING_ACTIVE_KEY);
  USER_DATA_BACKUP_ENTRIES.filter(entry => entry.key !== "vantilo-reading-growth-v1").forEach(entry => storage.removeItem(entry.key));
  keys.forEach(key => storage.removeItem(key));
}`);
  return source;
}

function adaptGrowthBackupTransport(source) {
  const helper = `const VANTILO_GROWTH_KEY = "vantilo-reading-growth-v1";
async function requestHostGrowth(operation: "snapshot" | "replace" | "clear", record?: unknown): Promise<any> {
  const token = (window as Window & { __vantiloGrowthToken?: string }).__vantiloGrowthToken;
  if (!token) throw new Error("阅读成长备份通道未就绪，请重新打开阅读空间后重试。");
  const requestId = crypto.randomUUID();
  return await new Promise((resolve, reject) => {
    const finish = (error?: Error, value?: unknown) => { window.removeEventListener("message", receive); window.clearTimeout(timer); if (error) reject(error); else resolve(value); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || !["file://", "null", "http://127.0.0.1:5173"].includes(event.origin)) return;
      const data = event.data;
      if (data?.type !== "vantilo:growth-backup-response" || data.token !== token || data.requestId !== requestId) return;
      if (data.ok !== true) finish(new Error(typeof data.error === "string" ? data.error : "宿主窗口无法读取阅读成长数据。"));
      else finish(undefined, data.record);
    };
    const timer = window.setTimeout(() => finish(new Error("读取阅读成长数据超时；未生成不完整备份。")), 10000);
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "vantilo:growth-backup-request", token, requestId, operation, ...(record === undefined ? {} : { record }) }, "*");
  });
}
export const requestHostGrowthSnapshot = () => requestHostGrowth("snapshot");
export const replaceHostGrowthRecord = (record: unknown) => requestHostGrowth("replace", record);
export const clearHostGrowthRecord = () => requestHostGrowth("clear");
`;
  const seam='export function downloadReaderBackup() {';
  if(source.split(seam).length!==2)throw new Error("Reader growth backup export seam changed");
  source=source.replace(seam,helper+`export async function downloadReaderBackup() {`);
  const old='  const backup = buildUserDataBackup(getReaderStorage());';
  if(source.split(old).length!==2)throw new Error("Reader growth backup storage seam changed");
  source=source.replace(old,`  const growth = await requestHostGrowthSnapshot();
  const storage = getReaderStorage();
  const backup = buildUserDataBackup({ ...storage, getItem: key => key === VANTILO_GROWTH_KEY ? JSON.stringify(growth) : storage.getItem(key) });`);
  source=source.replace('onClick={() => { try { downloadReaderBackup(); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "导出失败"); } }}','onClick={() => { void downloadReaderBackup().then(() => setError("")).catch(cause => setError(cause instanceof Error ? cause.message : "导出失败")); }}');
  return source;
}
