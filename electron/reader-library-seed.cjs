const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { constants } = require('node:fs');
const digest = data => createHash('sha256').update(data).digest('hex');
const validName = name => typeof name === 'string' && name.length <= 240 && !name.startsWith('.') && !/[\\/\x00-\x1f]/.test(name) && name.toLowerCase().endsWith('.epub');

function validateManifest(value, { distribution = false } = {}) {
  if (value?.version !== 1 || !['personal-development', 'redistributable'].includes(value.audience) || !Array.isArray(value.entries) || !value.entries.length || value.entries.length > 500) throw new Error('预置书库清单无效');
  if (distribution && value.audience !== 'redistributable') throw new Error('当前书库仅用于个人开发；正式分发需提供已确认授权的内容清单');
  const names = new Set();
  for (const entry of value.entries) {
    if (!['issues', 'books'].includes(entry.kind) || !validName(entry.filename) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > 100 * 1024 * 1024) throw new Error('预置书库条目无效');
    const name = `${entry.kind}/${entry.filename.toLowerCase()}`;
    if (names.has(name)) throw new Error('预置书库文件名重复');
    names.add(name);
    if (distribution && (typeof entry.rights !== 'string' || !entry.rights.trim() || typeof entry.rightsEvidence !== 'string' || !entry.rightsEvidence.trim())) throw new Error('分发条目缺少授权说明或依据');
  }
  return value;
}

async function ensureDirectory(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (!(await fs.lstat(dir)).isDirectory()) throw new Error('书库目录不能是符号链接');
}
async function readRegular(file) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 100 * 1024 * 1024) throw new Error('预置内容必须是有大小限制的普通文件');
    return await handle.readFile();
  } finally { await handle.close(); }
}
async function writeState(file, state) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

async function initializeReaderLibrary({ seedDir, libraryRoot }) {
  const manifest = validateManifest(JSON.parse(await readRegular(path.join(seedDir, 'manifest.json'))));
  await ensureDirectory(libraryRoot);
  for (const dir of ['issues', 'books', 'data']) await ensureDirectory(path.join(libraryRoot, dir));
  const stateFile = path.join(libraryRoot, 'data/vantilo-library-seed.json');
  let state = { version: 1, installed: {} };
  try {
    state = JSON.parse(await readRegular(stateFile));
    if (state.version !== 1 || !state.installed || Array.isArray(state.installed) || typeof state.installed !== 'object') throw new Error('书库初始化记录无效');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let installedCount = 0, preservedCount = 0, skippedCount = 0;
  for (const entry of manifest.entries) {
    const key = `${entry.kind}:${entry.sha256}`;
    if (Object.hasOwn(state.installed, key)) { skippedCount++; continue; }
    const source = await readRegular(path.join(seedDir, entry.kind, entry.filename));
    if (source.length !== entry.bytes || digest(source) !== entry.sha256) throw new Error('预置 EPUB 完整性检查失败');
    const directory = path.join(libraryRoot, entry.kind);
    let exists = false;
    for (const existing of await fs.readdir(directory, { withFileTypes: true })) {
      if (!existing.isFile() || !validName(existing.name)) continue;
      if ((await fs.stat(path.join(directory, existing.name))).size === entry.bytes && digest(await readRegular(path.join(directory, existing.name))) === entry.sha256) { exists = true; break; }
    }
    const target = path.join(directory, entry.filename);
    if (exists) preservedCount++;
    else {
      // Link a complete temporary file into place atomically, without replacing user files.
      const temporary = path.join(directory, '.seed-' + randomUUID() + '.tmp');
      try {
        await fs.writeFile(temporary, source, { mode: 0o600, flag: 'wx' });
        try { await fs.link(temporary, target); installedCount++; }
        catch (error) { if (error.code !== 'EEXIST') throw error; preservedCount++; }
      } finally { await fs.rm(temporary, { force: true }); }
    }
    // Track handled hashes even when a same-name user file won. Deletion remains respected.
    state.installed[key] = { filename: entry.filename, kind: entry.kind };
    await writeState(stateFile, state);
  }
  return { installedCount, preservedCount, skippedCount, entryCount: manifest.entries.length };
}
module.exports = { initializeReaderLibrary, validateManifest };
