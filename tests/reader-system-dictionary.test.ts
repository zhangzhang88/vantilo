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
    expect(result.definitionsZh[0].definition).toBe('impose（原形） ·\nA. transitive verb\n① 强制实行');
    expect(result.definitionsZh[1].definition).toContain('A. transitive verb');
    expect(result.definitionsEn).toEqual([]);
    expect(result.phonetic).toContain('BrE');
  });

  it('never labels English-only source text as a Chinese translation', () => {
    const result = formatMacDictionaryReply('hello', {word:'hello',definition:'hello | interjection | Used when greeting someone.'});
    expect(result.definitionsZh).toEqual([]);
    expect(result.definitionsEn[0]).toMatchObject({source:'macos-dictionary'});
  });


  it('groups bilingual senses by part of speech and excludes pinyin and examples from the preview', () => {
    const raw = 'impose | BrE ɪmˈpəʊz, AmE ɪmˈpoʊz | A. transitive verb ① (enforce) 强制实行 qiángzhì shíxíng ‹restriction, penalty, sanctions›; 强行收取 qiángxíng shōuqǔ ‹charge, fine›▸ to impose sth on sb; 把某事强加于某人▸ to impose a tax 征税 ② (force on others) 将…强加于人';
    const result = formatMacDictionaryReply('imposed', {word:'imposed',definition:raw});
    expect(result.definitionsZh[0].definition).toBe('impose（原形） ·\nA. transitive verb\n① 强制实行；强行收取\n② 将…强加于人');
    expect(result.definitionsZh[0].definition).not.toMatch(/qiáng|▸|penalty|tax/);
    expect(result.definitionsZh[1]).toMatchObject({source:'macos-dictionary-full'});
    expect(result.definitionsZh[1].definition).toContain('to impose a tax');
  });

  it('keeps one-character Chinese glosses and skips long examples in complex native entries', () => {
    const raw = "lump | BrE lʌmp, AmE ləmp | A. noun ① (of rock, cheese, concrete) 块 kuài▸ to get or take one's lumps figurative 吃苦头 ② (on body) 肿块 zhǒngkuài▸ she had a lump in her breast 她乳房里长了个肿块▸ to have a lump in one's throat figurative 喉咙哽住 ③ informal derogatory (person) 傻大个 shǎdàgè B. transitive verb 把…归并在一起 bǎ… guībìng zài yīqǐ▸ these two things shouldn't be lumped together 这二者不应该混为一谈";
    const result = formatMacDictionaryReply('lump', {word:'lump',definition:raw});
    expect(result.definitionsZh[0].definition).toBe('A. noun\n① 块\n② 肿块\n③ 傻大个\nB. transitive verb\n把…归并在一起');
    expect(result.definitionsZh[0].definition).not.toMatch(/lumps|figurative|乳房|throat|guībìng/);
    expect(result.definitionsZh[1].definition).toContain('she had a lump in her breast');
  });

  it('keeps English-only summary compact while retaining the complete entry', () => {
    const result = formatMacDictionaryReply('hello', {
      word:'hello',definition:'hello | interjection | Used as a greeting when meeting someone.▸ Hello there!'
    });
    expect(result.definitionsZh).toEqual([]);
    expect(result.definitionsEn[0].definition).toBe('interjection\nUsed as a greeting when meeting someone.');
    expect(result.definitionsEn[1].definition).toContain('Hello there!');
  });

  it('summarizes only the first English sense while keeping the whole multi-POS entry', () => {
    const body = 'A. noun ① First complete English meaning. ▸ A useful example sentence. B. verb ① A second part-of-speech meaning.';
    const result = formatMacDictionaryReply('synthetic', { word: 'synthetic', definition: `synthetic | noun | ${body}` });
    expect(result.definitionsEn[0].definition).toBe('A. noun\n① First complete English meaning.');
    expect(result.definitionsEn[1].definition).toContain('A useful example sentence.');
    expect(result.definitionsEn[1].definition).toContain('B. verb');
  });

  it('recognizes newly supported POS and structural labels without merging groups', () => {
    for (const [label, gloss] of [['abbreviation', '缩写释义'], ['prefix', '前缀释义'], ['suffix', '后缀释义'], ['number', '数字释义'], ['numeral', '数词释义']]) {
      const result = formatMacDictionaryReply('test', { word: 'test', definition: `A. ${label} ① ${gloss} B. noun ① 独立名词释义` });
      expect(result.definitionsZh[0].definition).toContain(`A. ${label}\n① ${gloss}`);
      expect(result.definitionsZh[0].definition).toContain('B. noun\n① 独立名词释义');
    }
  });

  it('keeps a first POS heading embedded in a Dictionary Services head field out of the lemma', () => {
    const raw = 'suffix A. noun | BrE ˈsʌfɪks, AmE ˈsəfɪks | 后缀 hòuzhuì B. transitive verb | BrE ˈsʌfɪks | 在末尾附加 zài';
    const result = formatMacDictionaryReply('suffix', { word: 'suffix', definition: raw });
    expect(result.definitionsZh[0].definition).toBe('A. noun\n后缀\nB. transitive verb\n在末尾附加');
    expect(result.definitionsZh[0].definition).not.toContain('（原形）');
    expect(result.definitionsZh[1].definition).toContain('B. transitive verb');
    expect(result.definitionsZh[1].definition).toContain('BrE ˈsʌfɪks');
    expect(result.definitionsZh[1].definition).toContain('zài');
  });

  it('maps a synthetic inflected entry to its lemma and keeps every part of speech readable', () => {
    const raw = [
      'purr | BrE /pɜːr/, AmE /pɝːr/ |',
      'A. intransitive verb ① make a quiet vibration; 轻柔地发出连续声响 qīngróu de fāchū shēngxiǎng; 机器发出稳定嗡鸣 jīqì fāchū wěndìng wēngmíng',
      'B. transitive verb ① say something softly; 低声说出完整短句，包含标点！',
      'C. noun ① a soft continuous sound; 连续而轻柔的震动声',
    ].join('\n');
    const result = formatMacDictionaryReply('purred', { word: 'purred', definition: raw });
    expect(result.word).toBe('purred');
    expect(result.phonetic).toBe('BrE /pɜːr/, AmE /pɝːr/');
    expect(result.definitionsZh[0].definition).toContain('purr（原形）');
    expect(result.definitionsZh[0].definition).toContain('A. intransitive verb\n① 轻柔地发出连续声响；机器发出稳定嗡鸣');
    expect(result.definitionsZh[0].definition).toContain('B. transitive verb\n① 低声说出完整短句，包含标点！');
    expect(result.definitionsZh[0].definition).toContain('C. noun\n① 连续而轻柔的震动声');
    expect(result.definitionsZh[0].definition).not.toMatch(/qīngróu|wěndìng|make a quiet|say something/);
    expect(result.definitionsZh[1].definition).toContain('say something softly; 低声说出完整短句，包含标点！');
  });

  it('preserves multiline dictionary results longer than the former preview and parser limits', () => {
    const longGloss = '这是完整合成释义，包含标点；不应截断。'.repeat(420);
    const raw = `synthetic | BrE /sɪnˈθetɪk/ | A. noun\n${longGloss}\nEND-OF-SYNTHETIC-ENTRY`;
    const result = formatMacDictionaryReply('synthetic', { word: 'synthetic', definition: raw });
    expect(result.definitionsZh[1].definition.length).toBeGreaterThan(4000);
    expect(result.definitionsZh[1].definition).toContain('\n');
    expect(result.definitionsZh[1].definition.endsWith('END-OF-SYNTHETIC-ENTRY')).toBe(true);
    expect(result.definitionsZh[0].definition).toContain('不应截断。');
    expect(() => formatMacDictionaryReply('synthetic', {
      word: 'synthetic', definition: 'x'.repeat(1024 * 1024 + 1),
    })).toThrow(/安全显示上限/);
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
