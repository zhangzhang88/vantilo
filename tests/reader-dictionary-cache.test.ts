import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createDictionaryCache, CACHE_FILENAME } = require('../electron/reader-dictionary-cache.cjs');

function definition(word: string) {
  return {
    word, phonetic: null, usPhonetic: null, ukPhonetic: null,
    definitionsZh: [{ definition: word + ' 的中文释义', partOfSpeech: null, source: 'agent' }],
    definitionsEn: [{ definition: 'Synthetic English meaning of ' + word, partOfSpeech: null, source: 'agent' }],
  };
}

describe('Native Reader dictionary cache', () => {
  it('deduplicates simultaneous lookups and reuses case-insensitive word entries', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vantilo-dictionary-cache-'));
    try {
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const lookup = vi.fn(async (word: string) => { await gate; return definition(word); });
      const cache = createDictionaryCache({ dataDir: root, lookup });
      const requests = [cache.lookup('Imposed'), cache.lookup('imposed'), cache.lookup('IMPOSED')];
      await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
      release();
      const values = await Promise.all(requests);
      expect(values.every(value => value.word === 'imposed')).toBe(true);
      expect(await cache.lookup('imposed')).toEqual(values[0]);
      expect(lookup).toHaveBeenCalledTimes(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('persists dictionary meanings between Reader service instances', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vantilo-dictionary-persist-'));
    try {
      const first = vi.fn(async (word: string) => definition(word));
      expect((await createDictionaryCache({ dataDir: root, lookup: first }).lookup('imposed')).word).toBe('imposed');
      const saved = JSON.parse(await readFile(path.join(root, CACHE_FILENAME), 'utf8'));
      expect(saved).toMatchObject({ version: 1, entries: [{ word: 'imposed' }] });
      const next = vi.fn();
      const restored = createDictionaryCache({ dataDir: root, lookup: next });
      expect((await restored.lookup('imposed')).definitionsZh[0].definition).toContain('中文释义');
      expect(next).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('does not cache errors, never sends invalid words to AI, and distinguishes vocabulary items', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vantilo-dictionary-failure-'));
    try {
      const lookup = vi.fn().mockRejectedValueOnce(new Error('model unavailable')).mockImplementation(async (word: string) => definition(word));
      const cache = createDictionaryCache({ dataDir: root, lookup });
      await expect(cache.lookup('imposed')).rejects.toThrow(/unavailable/);
      await expect(cache.lookup('word with spaces')).rejects.toThrow(/Invalid/);
      expect(await cache.lookup('imposed')).toEqual(definition('imposed'));
      expect(await cache.lookup('impose')).toEqual(definition('impose'));
      expect(lookup).toHaveBeenCalledTimes(3);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
