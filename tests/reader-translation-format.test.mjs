import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {readerSourceRoot} from '../scripts/reader-source-path.mjs';
import path from 'node:path';
import {buildSync} from 'esbuild';
import {adaptTranslationPreview} from '../scripts/reader-translation-adapter.mjs';
const require=createRequire(import.meta.url);
const {normalizeTranslation}=require('../electron/reader-translation-format.cjs');
describe('plain translation and existing cache repair',()=>{
 it('unwraps only recognized single-string wrappers and complete fences',()=>{
  for(const key of ['source','translation','translationZh'])expect(normalizeTranslation(JSON.stringify({[key]:'示例文章'}),'Fixture article')).toBe('示例文章');
  expect(normalizeTranslation('```json\n{"source":"示例文章"}\n```','Fixture article')).toBe('示例文章');
  expect(normalizeTranslation('普通译文。','A paragraph.')).toBe('普通译文。');
  for(const bad of ['{"source":12}','{"source":""}','{"source":"文章","extra":"x"}','{"source":','["文章"]'])expect(normalizeTranslation(bad,'Title')).toBeNull();
  expect(normalizeTranslation('{"source":"文章"}','{"source":"Article"}')).toBe('{"source":"文章"}');
 });
 it('adapts the current profile-aware paragraph request for the packaged translation preview',()=>{
  const filename=`${readerSourceRoot}/src/frontend/App.tsx`;
  const adapted=adaptTranslationPreview(readFileSync(filename,'utf8'),filename);
  expect(adapted).toContain("fetch('/api/vantilo-translation/translate'");
  expect(adapted).not.toContain('Translate request seam changed');
 });
 it('repairs a cached title without discarding a successful paragraph or changing storage',()=>{
  const filename=`${readerSourceRoot}/src/frontend/paragraph-translation-state.ts`;
  const adapted=adaptTranslationPreview(readFileSync(filename,'utf8'),filename);
  const bundled=buildSync({stdin:{contents:adapted,loader:'ts',resolveDir:path.dirname(filename)},bundle:true,format:'cjs',platform:'node',write:false});
  const mod={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(mod,mod.exports,require);
  const api=mod.exports;const storage=new Map();
  const target=api.paragraphTranslationTarget({issueId:'fixture',articleId:'article',paragraphIndex:0,sourceText:'Fixture article'});
  const body=api.paragraphTranslationTarget({issueId:'fixture',articleId:'article',paragraphIndex:1,sourceText:'A paragraph.'});
  const records=[{...target,translationZh:'{"source":"示例文章"}'},{...body,translationZh:'正常段落译文。'}].map(r=>({...r,model:'gpt-test',provider:'vantilo-agent',generatedAt:'2026-10-26T12:00:00Z'}));
  const raw=JSON.stringify(records);storage.set(api.PARAGRAPH_TRANSLATIONS_KEY,raw);
  const result=api.loadParagraphTranslations({getItem:k=>storage.get(k)??null});
  expect(result.map(r=>r.translationZh)).toEqual(['示例文章','正常段落译文。']);
  expect(storage.get(api.PARAGRAPH_TRANSLATIONS_KEY)).toBe(raw);
  const longQwen={...body,sourceText:'A long synthetic passage.',translationZh:'译'.repeat(21000),model:'qwen-test',provider:'qwen-mlx',generatedAt:'2026-10-26T12:00:00Z'};
  storage.set(api.PARAGRAPH_TRANSLATIONS_KEY,JSON.stringify([longQwen]));
  expect(api.loadParagraphTranslations({getItem:k=>storage.get(k)??null})[0].translationZh).toBe(longQwen.translationZh);
 });
});
