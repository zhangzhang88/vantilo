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
  if (!filename.endsWith('/frontend/user-data-backup.ts')) return source;
  replace('  removeItem(key: string): void;\n}', '  removeItem(key: string): void;\n  keys?(): string[];\n  readonly length?: number;\n  key?(index: number): string | null;\n}');
  replace('  exportedAt: string;\n  data: Record<string, unknown>;', '  exportedAt: string;\n  variantKeysIncluded?: boolean;\n  data: Record<string, unknown>;');
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
${anchor}`);
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
  return { exportedAt: valid.exportedAt, categoryCount: entries.length, entries };`);
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
  USER_DATA_BACKUP_ENTRIES.forEach(entry => storage.removeItem(entry.key));
  keys.forEach(key => storage.removeItem(key));
}`);
  return source;
}
