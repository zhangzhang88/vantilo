import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {readerSourceRoot} from '../scripts/reader-source-path.mjs';
import {adaptReaderSource} from '../scripts/reader-variant.mjs';
const filename=`${readerSourceRoot}/src/frontend/App.tsx`;
const original=readFileSync(filename,'utf8');
const detail=source=>{
  const start=source.indexOf('function WordDetailContent({');
  const end=source.indexOf('\nfunction vocabularyTextKey(',start);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  return source.slice(start,end);
};
describe('Vantilo Qwen Word Detail isolated preview',()=>{
  it('renders per-occurrence Qwen meaning first, then an always-expanded, nonduplicated full dictionary article',()=>{
    const adapted=adaptReaderSource(original,filename,{qwenPreview:true});
    const card=detail(adapted);
    expect(card).toContain('当前语境 · 本地 Qwen');
    expect(card).toContain('<VantiloLocalGloss key={lookup.key}');
    expect(card).toContain('sentence={sentenceForOccurrence(lookup.paragraph, lookup.startOffset, lookup.text.length)}');
    // The original sentence is still supplied to Qwen, but no longer duplicated visually.
    const primary = card.slice(card.indexOf('<section className="word-detail-section vantilo-detail-context">'), card.indexOf('{(personalMeaning || editingVocabulary)'));
    expect(primary).not.toContain('word-detail-source-sentence');
    expect(primary).not.toContain('<blockquote');
    // Older Agent details may retain hidden legacy JSX, but Qwen's visible section must not show the source sentence.
    expect(card).toContain('onQwenMeaningResolved?.(lookup, meaningZh)');
    expect(card).toContain('const personalMeaning = vocabularyMeaningSource === "user"');
    expect(card).toContain('{(personalMeaning || editingVocabulary) && <section className="word-detail-section word-detail-user-section">');
    expect(card).toContain('<section className="word-detail-section vantilo-detail-dictionary">');
    expect(card).not.toContain('<details className="word-detail-section vantilo-detail-dictionary">');
    expect(card).not.toContain('查看中文词典释义与完整词条');
    expect(card).not.toContain('<VantiloDictionaryDisclosure dictionary={dictionary} language="zh"');
    expect(card).not.toContain('查看完整词条与例句');
    expect(card).toContain('<VantiloDictionaryExpanded definition={dictionary.definitionsZh.find');
    expect(card).toContain('!dictionary.definitionsZh.some((item) => (item.source as string) === "macos-dictionary-full")');
    expect(card.indexOf('当前语境 · 本地 Qwen')).toBeLessThan(card.indexOf('中文词典释义'));
    expect(card).toContain('dictionary.definitionsZh.filter');
    expect(card).toContain('onClick={() => playWordPronunciation(lookup.text, dictionary, "us")}');
    expect(card).toContain('onClick={() => playWordPronunciation(lookup.text, dictionary, "uk")}');
    expect(card).toContain('word-detail-familiarity');
  });
  it('does not trigger obsolete Agent analysis on More, does not show empty explanation sections, and preserves edit features',()=>{
    const adapted=adaptReaderSource(original,filename,{qwenPreview:true});
    const card=detail(adapted);
    expect(adapted).toContain('if (false && (!lookup.contextMeaning || !hasEnglishWordContext(lookup.contextMeaning))) {');
    expect(card).toContain('{(englishDefinitions.length > 0 || Boolean(aiEnglishDefinition)) && <section');
    expect(card).toContain('{examples.length > 0 && <section');
    expect(card).toContain('{false && <section className="word-detail-section word-detail-context-section">');
    expect(card).toContain('修改语境释义');
    expect(card).toContain('setContextDraft(event.target.value)');
    expect(card).toContain('onQwenMeaningResolved?.(lookup, meaningZh)');
    expect(card).toContain('添加个人释义');
    expect(card).toContain('onContextMeaningChange(next)');
    expect(adapted).toContain('onWordDetailQwenMeaningResolved={saveVantiloQwenWordContext}');
    expect(adapted).toContain('onDetailQwenMeaningResolved={saveVantiloQwenWordContext}');
    expect(adapted).toContain('wordDetailVocabularyMeaningSource={wordDetailVocabulary?.translationSource}');
    expect(adapted).toContain('vocabularyMeaningSource={detailItem.translationSource}');
    const tree=ts.createSourceFile('adapted.tsx',adapted,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    expect(tree.parseDiagnostics).toHaveLength(0);
  });
  it('never changes normal Reader WordDetailContent with experimental Qwen UI',()=>{
    const adapted=adaptReaderSource(original,filename,{qwenPreview:false});
    const card=detail(adapted);
    expect(card).not.toContain('vantilo-detail-context');
    expect(card).not.toContain('onQwenMeaningResolved');
    expect(card).not.toContain('vantilo-detail-dictionary');
    expect(card).toContain('word-detail-user-section');
    expect(adapted).toContain('if (!lookup.contextMeaning || !hasEnglishWordContext(lookup.contextMeaning)) {');
  });
});
