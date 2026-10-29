import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseVantiloNativeDictionary, VantiloDictionaryExpanded, VantiloDictionaryDisclosure, VantiloDictionaryQuickSummary } from '../scripts/reader-dictionary-entry';

const fullEntry = [
  'impose（原形） · A. transitive verb ① (enforce) 强制实行 qiángzhì shíxíng ‹restriction, penalty, sanctions›;',
  '强行收取 qiángxíng shōuqǔ ‹charge, fine›',
  '▸ to impose sth on sb; 把某事强加于某人',
  '▸ to impose a sentence of five years on sb 判处某人5年徒刑',
  '▸ to impose a tax 征税',
  '② (force on others) 将…强加于人 jiāng… qiángjiā yú rén',
  '▸ to impose one\'s opinions on sb; 勉强某人接受自己的想法',
  'B. intransitive verb 利用 lìyòng',
  '▸ to impose on sb\'s kindness/hospitality 利用某人的仁慈/好客',
  '▸ I do hope I\'m not imposing 真希望我没有添麻烦',
  'C. to impose oneself reflexive verb',
  '▸ to impose oneself on sb; 使某人接受自己 shǐ mǒu rén jiēshòu zìjǐ',
].join(' ');

const require = createRequire(import.meta.url);
const { createMacDictionaryLookup } = require('../electron/reader-system-dictionary.cjs');

describe('macOS Dictionary semantic entry presentation', () => {
  it.runIf(process.platform === 'darwin')('recognizes sections and example translations in the Mac installed Dictionary entry', async () => {
    const lookup = createMacDictionaryLookup({ assetsDir: path.resolve('build/reader') });
    const actual = await lookup('imposed');
    const complete = actual.definitionsZh.find((item: { source: string }) => item.source === 'macos-dictionary-full');
    expect(complete).toBeDefined();
    const tree = parseVantiloNativeDictionary(complete.definition);
    expect(tree.sections.map(section => section.letter)).toEqual(['A.', 'B.', 'C.']);
    expect(tree.sections[0].senses.map(sense => sense.number)).toEqual(['①', '②']);
    expect(tree.sections[0].senses[0].examples.length).toBeGreaterThanOrEqual(4);
    expect(tree.sections[0].senses[0].examples[0].chinese).toContain('把某事强加于某人');
    expect(tree.sections[1].senses[0].examples[0].chinese).toContain('利用某人的仁慈');
  });

  it('restores A/B/C grammar groups, ①② senses, and actual English/Chinese example pairs', () => {
    const tree = parseVantiloNativeDictionary(fullEntry);
    expect(tree.lemma).toBe('impose');
    expect(tree.sections.map(section => section.letter)).toEqual(['A.', 'B.', 'C.']);
    expect(tree.sections.map(section => section.heading)).toEqual([
      'transitive verb', 'intransitive verb', 'to impose oneself reflexive verb',
    ]);
    expect(tree.sections[0].senses.map(sense => sense.number)).toEqual(['①', '②']);
    expect(tree.sections[0].senses[0].description).toContain('强制实行');
    expect(tree.sections[0].senses[0].description).not.toContain('to impose a tax');
    expect(tree.sections[0].senses[0].examples).toHaveLength(3);
    expect(tree.sections[0].senses[0].examples[0]).toEqual({
      english: 'to impose sth on sb',
      chinese: '把某事强加于某人',
    });
    expect(tree.sections[0].senses[0].examples[1].chinese).toBe('判处某人5年徒刑');
    expect(tree.sections[0].senses[1].examples[0].chinese).toBe('勉强某人接受自己的想法');
    expect(tree.sections[1].senses[0].description).toContain('利用');
    expect(tree.sections[1].senses[0].examples).toHaveLength(2);
    expect(tree.sections[2].senses[0].examples[0].english).toBe('to impose oneself on sb');
  });

  it('renders distinct grammar headings and separated examples with typography hooks', () => {
    const html = renderToStaticMarkup(
      <VantiloDictionaryExpanded definition={fullEntry} phonetic="BrE ɪmˈpəʊz, AmE ɪmˈpoʊz" word="imposed" />,
    );
    expect(html).toContain('vantilo-dict-lemma-line');
    expect(html).toContain('BrE ɪmˈpəʊz');
    expect((html.match(/class="vantilo-dict-section"/g) || []).length).toBe(3);
    expect(html).toContain('class="vantilo-dict-number">①</span>');
    expect(html).toContain('class="vantilo-dict-number">②</span>');
    expect(html).toContain('class="vantilo-dict-example-en"');
    expect(html).toContain('class="vantilo-dict-example-zh"');
    expect(html).toContain('class="vantilo-dict-text-han" lang="zh-CN">强制实行</span>');
    expect(html).toContain('class="vantilo-dict-text-usage">‹restriction, penalty, sanctions›</span>');
    expect(html).toContain('class="vantilo-dict-text-phonetic">qiángzhì</span>');
  });

  it('never invents a meaning and renders unrecognized entries as plain text', () => {
    const entry = "hello | Used as a greeting.";
    const tree = parseVantiloNativeDictionary(entry);
    expect(tree.lemma).toBe('');
    expect(tree.sections[0].senses[0].description).toContain('Used as a greeting.');
    const html = renderToStaticMarkup(
      <VantiloDictionaryExpanded definition={entry} phonetic={null} word="hello" />,
    );
    expect(html.replace(/<[^>]*>/gu, '')).toContain('Used as a greeting.');
  });

  it('parses abbreviation, prefix, suffix, number and numeral sections without cross-group content', () => {
    const entry = 'A. abbreviation ① short form B. prefix ① beginning element C. suffix ① ending element D. number ① quantity E. numeral ① number word F. noun ① separate noun';
    const tree = parseVantiloNativeDictionary(entry);
    expect(tree.sections.map(section => section.heading)).toEqual(['abbreviation', 'prefix', 'suffix', 'number', 'numeral', 'noun']);
    expect(tree.sections.map(section => section.senses[0].description)).toEqual([
      'short form', 'beginning element', 'ending element', 'quantity', 'number word', 'separate noun',
    ]);
  });

  it('keeps synthetic long multiline entries intact in the parser and expanded renderer', () => {
    const longEntry = 'A. noun ① ' + '合成释义，包含多种标点；并保留原始内容。'.repeat(300) + '\nEND-OF-SYNTHETIC-ENTRY';
    const tree = parseVantiloNativeDictionary(longEntry);
    expect(tree.fallback).toBe(longEntry);
    expect(tree.sections[0].senses[0].description.length).toBeGreaterThan(4000);
    const html = renderToStaticMarkup(
      <VantiloDictionaryExpanded definition={longEntry} phonetic={null} word="synthetic" />,
    );
    expect(html.replace(/<[^>]*>/gu, '')).toContain('END-OF-SYNTHETIC-ENTRY');
  });

  it('renders the native dictionary preview independently of a context-meaning error', () => {
    const dictionary = {
      word: 'purred',
      phonetic: 'BrE /pɜːr/, AmE /pɝːr/',
      definitionsZh: [
        { source: 'macos-dictionary', definition: 'purr（原形） ·\nA. intransitive verb\n发出柔和的低鸣声' },
        { source: 'macos-dictionary-full', definition: 'purr（原形） ·\nA. intransitive verb ① 发出柔和的低鸣声。' },
      ],
      definitionsEn: [],
    };
    const html = renderToStaticMarkup(<div>
      <VantiloDictionaryQuickSummary dictionary={dictionary} />
      <div className="word-lookup-context"><p role="alert">语境释义暂不可用</p></div>
    </div>);
    expect(html).toContain('purr（原形）');
    expect(html).toContain('BrE /pɜːr/, AmE /pɝːr/');
    expect(html).toContain('查看完整词条与例句');
    expect(html).toContain('word-lookup-context');
    expect(html).toContain('语境释义暂不可用');
  });

  it('treats untrusted dictionary input only as text, never HTML or script', () => {
    const entry = 'test | noun ① <img src=x onerror=alert(1)> 假例';
    const html = renderToStaticMarkup(
      <VantiloDictionaryExpanded definition={entry} phonetic={null} word="test" />,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;');
    expect(html).not.toContain('onerror="');
  });

  it('uses the full native entry only inside a collapsed word-detail disclosure', () => {
    const dictionary = {
      word: 'imposed',
      phonetic: 'BrE ɪmˈpəʊz',
      definitionsZh: [
        { source: 'macos-dictionary', definition: '强制实行；强行收取' },
        { source: 'macos-dictionary-full', definition: fullEntry },
      ],
      definitionsEn: [],
    };
    const html = renderToStaticMarkup(
      <VantiloDictionaryDisclosure dictionary={dictionary} language="zh" />,
    );
    expect(html).toContain('class="vantilo-dictionary-full vantilo-detail-dictionary-full"');
    expect(html).toContain('查看完整词条与例句');
    expect(html).toContain('<details');
    expect(html).not.toMatch(/<details[^>]*\sopen/u);
    expect(html).toContain('class="vantilo-dict-section-title"');
    expect(html).toContain('强制实行');
    const withoutNativeFull = {
      ...dictionary,
      definitionsZh: dictionary.definitionsZh.slice(0, 1),
    };
    expect(renderToStaticMarkup(
      <VantiloDictionaryDisclosure dictionary={withoutNativeFull} language="zh" />,
    )).toBe('');
  });

  it('shows a concise English-only preview and keeps long multi-POS examples in the collapsed full entry', () => {
    const raw = 'A. noun ① A long first meaning that remains whole. ▸ A long illustrative sentence.' + ' additional source wording.'.repeat(80) + ' B. verb ① A separate second meaning.';
    const dictionary = {
      word: 'synthetic', phonetic: null, definitionsZh: [],
      definitionsEn: [
        { source: 'macos-dictionary', definition: 'A. noun\n① A long first meaning that remains whole.' },
        { source: 'macos-dictionary-full', definition: raw },
      ],
    };
    const html = renderToStaticMarkup(<VantiloDictionaryQuickSummary dictionary={dictionary} />);
    expect(html).toContain('A long first meaning that remains whole.');
    expect(html.slice(0, html.indexOf('<details'))).not.toContain('additional source wording.');
    expect(html).toContain('<details');
    expect(html).toContain('separate');
    expect(html).toContain('second');
    expect(html).toContain('A long illustrative sentence.');
  });

  it('prompts expansion when no reliable English summary is available', () => {
    const result = createRequire(import.meta.url)('../electron/reader-system-dictionary.cjs').formatMacDictionaryReply('test', {
      word: 'test', definition: 'test | noun | ▸ example-only unstructured entry',
    });
    expect(result.definitionsEn[0].definition).toBe('展开查看完整词条');
    expect(result.definitionsEn[1].definition).toContain('example-only unstructured entry');
  });

  it('supports an English-only native word detail without falsely adding a Chinese definition', () => {
    const dictionary = {
      word: 'hello',
      phonetic: null,
      definitionsZh: [],
      definitionsEn: [
        { source: 'macos-dictionary', definition: 'A greeting.' },
        { source: 'macos-dictionary-full', definition: 'hello | interjection | A greeting. ▸ Hello there!' },
      ],
    };
    const zh = renderToStaticMarkup(
      <VantiloDictionaryDisclosure dictionary={dictionary} language="zh" />,
    );
    const en = renderToStaticMarkup(
      <VantiloDictionaryDisclosure dictionary={dictionary} language="en" />,
    );
    expect(zh).toBe('');
    expect(en).toContain('查看完整词条与例句');
    expect(en).toContain('Hello there!');
  });

});