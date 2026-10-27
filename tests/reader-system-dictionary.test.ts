import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createMacDictionaryLookup, formatMacDictionaryReply } = require('../electron/reader-system-dictionary.cjs');

describe('macOS system dictionary provider', () => {
  it('keeps native Chinese definitions separate from contextual AI and identifies the lemma', () => {
    const result = formatMacDictionaryReply('imposed', {
      word: 'imposed',
      definition: 'impose | BrE ɪmˈpəʊz, AmE ɪmˈpoʊz | A. transitive verb ① (enforce) 强制实行 qiángzhì shíxíng',
    });
    expect(result.definitionsZh[0]).toMatchObject({ source: 'macos-dictionary' });
    expect(result.definitionsZh[0].definition).toContain('强制实行');
    expect(result.definitionsZh[0].definition).toBe('impose（原形） · 强制实行');
    expect(result.definitionsZh[1].definition).toContain('A. transitive verb');
    expect(result.definitionsEn).toEqual([]);
    expect(result.phonetic).toContain('BrE');
  });

  it('never labels English-only source text as a Chinese translation', () => {
    const result = formatMacDictionaryReply('hello', {word:'hello',definition:'hello | interjection | Used when greeting someone.'});
    expect(result.definitionsZh).toEqual([]);
    expect(result.definitionsEn[0]).toMatchObject({source:'macos-dictionary'});
  });


  it('summarizes bilingual senses without pinyin, grammar or example text in the collapsed card', () => {
    const raw = 'impose | BrE ɪmˈpəʊz, AmE ɪmˈpoʊz | A. transitive verb ① (enforce) 强制实行 qiángzhì shíxíng ‹restriction, penalty, sanctions›; 强行收取 qiángxíng shōuqǔ ‹charge, fine›▸ to impose sth on sb; 把某事强加于某人▸ to impose a tax 征税 ② (force on others) 将…强加于人';
    const result = formatMacDictionaryReply('imposed', {word:'imposed',definition:raw});
    expect(result.definitionsZh[0].definition).toBe('impose（原形） · 强制实行；强行收取');
    expect(result.definitionsZh[0].definition).not.toMatch(/qiáng|transitive|▸|penalty|tax/);
    expect(result.definitionsZh[1]).toMatchObject({source:'macos-dictionary-full'});
    expect(result.definitionsZh[1].definition).toContain('to impose a tax');
  });

  it('keeps an English-only source entry in expandable form', () => {
    const result = formatMacDictionaryReply('hello', {
      word:'hello',definition:'hello | interjection | Used as a greeting when meeting someone.▸ Hello there!'
    });
    expect(result.definitionsZh).toEqual([]);
    expect(result.definitionsEn[0].definition.length).toBeLessThan(175);
    expect(result.definitionsEn[1].definition).toContain('Hello there!');
  });

  it('invokes only a fixed native helper and rejects input rather than shell interpreting it', async () => {
    const execImpl = vi.fn(async (_executable: string, _args: string[], _options: Record<string, unknown>) => ({
      stdout: JSON.stringify({word:'imposed',definition:'impose | verb | 强制实行'}),
    }));
    const lookup = createMacDictionaryLookup({assetsDir:'/test/reader', platform:'darwin',execImpl});
    expect((await lookup('imposed')).definitionsZh[0].source).toBe('macos-dictionary');
    expect(execImpl).toHaveBeenCalledOnce();
    expect(execImpl.mock.calls[0]![0]).toBe(path.join('/test/reader','native','vantilo-dictionary'));
    expect(execImpl.mock.calls[0]![1]).toEqual(['imposed']);
    await expect(lookup('imposed;rm -rf /')).rejects.toThrow(/无效/);
    expect(execImpl).toHaveBeenCalledOnce();
  });

  it('does not invent a meaning when macOS has no dictionary entry', async () => {
    const lookup = createMacDictionaryLookup({assetsDir:'/fixtures',platform:'darwin',
      execImpl: async () => ({stdout:JSON.stringify({word:'nonwordzzz',definition:null})})});
    await expect(lookup('nonwordzzz')).rejects.toThrow(/未收录/);
  });

  it.runIf(process.platform === 'darwin')('finds the installed Chinese dictionary on this Mac without an AI API', async () => {
    const lookup = createMacDictionaryLookup({assetsDir:path.resolve('build/reader')});
    const actual = await lookup('imposed');
    expect(actual.definitionsZh[0].definition).toContain('强制');
    expect(actual.definitionsZh[0].source).toBe('macos-dictionary');
  });
});