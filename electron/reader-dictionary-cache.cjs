// Native Reader dictionary cache. It is isolated from the source magazine-reader
// project and never stores account credentials, article text, or user prompts.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_ENTRIES = 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DEFINITION_CHARS = 1_000_000;
// Do not reuse v2 previews, which could contain lossy/truncated dictionary formatting.
const CACHE_FILENAME = 'vantilo-system-dictionary-cache-v3.json';

function validEntry(value) {
  if (!value || typeof value !== 'object' || typeof value.word !== 'string' ||
      !/^[a-z]+(?:[-'][a-z]+)*$/.test(value.word) || value.word.length > 120) return false;
  const result = value.result;
  if (!result || typeof result !== 'object' || typeof result.word !== 'string') return false;
  const validDefinitions = items => Array.isArray(items) && items.length <= 8 &&
    items.every(item => item && typeof item.definition === 'string' &&
      item.definition.length > 0 && item.definition.length <= MAX_DEFINITION_CHARS);
  return validDefinitions(result.definitionsZh) &&
    validDefinitions(result.definitionsEn) &&
    (result.definitionsZh.length + result.definitionsEn.length > 0);
}

function createDictionaryCache({ dataDir, lookup }) {
  if (typeof lookup !== 'function') throw new Error('Dictionary lookup provider is required');
  const file = path.join(dataDir, CACHE_FILENAME);
  const entries = new Map();
  const pending = new Map();
  let saved = Promise.resolve();

  const loaded = (async () => {
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return;
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return;
      for (const item of parsed.entries.slice(-MAX_ENTRIES)) {
        if (validEntry(item)) entries.set(item.word, item.result);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        // Damaged caches are ignored, not deleted or overwritten on read.
      }
    }
  })();

  const persist = () => {
    const snapshot = JSON.stringify({
      version: 1, entries: [...entries].map(([word, result]) => ({ word, result })),
    });
    if (Buffer.byteLength(snapshot) > MAX_FILE_BYTES) return Promise.resolve();
    saved = saved.catch(() => {}).then(async () => {
      await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
      const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(temporary, snapshot, { mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, file);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
    });
    return saved;
  };

  return {
    async lookup(word) {
      const key = String(word).trim().toLocaleLowerCase('en-US').replaceAll('’', "'");
      if (!/^[a-z]+(?:[-'][a-z]+)*$/.test(key) || key.length > 120) {
        throw new Error('Invalid dictionary word');
      }
      await loaded;
      if (entries.has(key)) {
        const result = entries.get(key);
        entries.delete(key); entries.set(key, result);
        return result;
      }
      if (pending.has(key)) return pending.get(key);

      const work = (async () => {
        const result = await lookup(key);
        if (!validEntry({ word: key, result })) throw new Error('Invalid dictionary response');
        entries.set(key, result);
        while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
        // Persist before responding so reopening the word or restarting the app is a cache hit.
        // A disk/cache error must not make an otherwise successful definition disappear.
        await persist().catch(() => {});
        return result;
      })();
      pending.set(key, work);
      try { return await work; } finally { pending.delete(key); }
    },
  };
}

module.exports = { createDictionaryCache, CACHE_FILENAME };