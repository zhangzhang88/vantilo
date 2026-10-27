import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseVantiloNativeDictionary, VantiloDictionaryExpanded, VantiloDictionaryDisclosure } from '../scripts/reader-dictionary-entry';

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
  });

  it('never invents a meaning and renders unrecognized entries as plain text', () => {
    const entry = "hello | Used as a greeting.";
    const tree = parseVantiloNativeDictionary(entry);
    expect(tree.lemma).toBe('');
    expect(tree.sections[0].senses[0].description).toContain('Used as a greeting.');
    const html = renderToStaticMarkup(
      <VantiloDictionaryExpanded definition={entry} phonetic={null} word="hello" />,
    );
    expect(html).toContain('Used as a greeting.');
  });

  it('treats untrusted dictionary input only as text, never HTML or script', () => {
    const entry = 'test | noun ① <img src=x onerror=alert(1)> 假例';
    const html = renderToStaticMarkup(
      <VantiloDictionaryExpanded definition={entry} phonetic={null} word="test" />,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
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