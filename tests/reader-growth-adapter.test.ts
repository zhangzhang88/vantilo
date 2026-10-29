import {describe,it,expect} from 'vitest';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {adaptReaderGrowthBridge} from '../scripts/reader-growth-adapter.mjs';
const seam='  const currentSentence = articleSentences[Math.min(sentenceIndex, Math.max(articleSentences.length - 1, 0))];';
describe('Reader growth bridge adapter',()=>{
 it('injects correlated state/activity signals only into the Vantilo Reader build',()=>{const source=`function App() { return null; }\nfunction ReaderPage(){\n${seam}\n  return null;\n}`;const result=adaptReaderGrowthBridge(source,'/reader/src/frontend/App.tsx');const parsed=ts.transpileModule(result,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});expect(parsed.diagnostics?.filter(item=>item.category===ts.DiagnosticCategory.Error)).toEqual([]);expect(result).toContain('event.source!==window.parent');expect(result).toContain("action:'sentence'");expect(result).toContain("action:'lookup'");expect(result).toContain("action:'translation'");expect(result).toContain("type:'vantilo:growth-leave'");expect(result).toContain('pageId:growthPageId');expect(result).toContain('growthPageIdRef.current.documentId!==article.identity.documentId');expect(result).toContain('clearTimeout(growthLeaveTimerRef.current);growthLeaveTimerRef.current=null;');expect(result).toContain('window.setTimeout(()=>{growthLeaveTimerRef.current=null;window.parent.postMessage({type:\'vantilo:growth-leave\'');expect(result).toContain("Math.abs(current-last)<80");expect(adaptReaderGrowthBridge(source,'/reader/src/frontend/Other.tsx')).toBe(source);});
 it('does not inject into nonmatching App fixtures or unrelated modules',()=>{const source='function ReaderPage() {}';expect(adaptReaderGrowthBridge(source,'/reader/src/frontend/App.tsx')).toBe(source);expect(adaptReaderGrowthBridge(source,'/reader/src/frontend/Other.tsx')).toBe(source);});
 it('keeps the timer in Reader chrome with floored seconds and a growth entry in Reader navigation',()=>{
  const root=process.cwd(),frontend=path.join(root,'packages/reader/src/frontend');
  const app=adaptReaderGrowthBridge(readFileSync(path.join(frontend,'App.tsx'),'utf8'),path.join(frontend,'App.tsx'));
  const nav=adaptReaderGrowthBridge(readFileSync(path.join(frontend,'global-navigation.tsx'),'utf8'),path.join(frontend,'global-navigation.tsx'));
  const css=adaptReaderGrowthBridge(readFileSync(path.join(frontend,'styles.css'),'utf8'),path.join(frontend,'styles.css'));
  const diagnostics=(source:string)=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},reportDiagnostics:true}).diagnostics?.filter(item=>item.category===ts.DiagnosticCategory.Error)??[];
  expect(diagnostics(app)).toHaveLength(0);expect(diagnostics(nav)).toHaveLength(0);
  expect(app).toContain('Math.floor(Math.max(0,Number.isFinite(value)?value:0))');expect(app.match(/<VantiloGrowthHomeCard \/>/g)).toHaveLength(2);expect(app).toContain('export default function App()');expect(app).toContain('function VantiloGrowthHomeCard()');expect(app).toContain('eyebrow">Magazine shelf');expect(app).toContain('eyebrow">Bookshelf');expect(app).toContain('今日英文阅读');expect(app).toContain('growthReading.active || growthReading.canResume');expect(css).toContain('.reader-page-shell .reader-toolbar-center>.reader-growth-timer{display:inline-flex!important}');expect(app).toContain('{readerLanguage === "english" && (growthReading.active || growthReading.canResume)');
  expect(nav).toContain('aria-label="我的阅读成长"');expect(nav).toContain("type:'vantilo:growth-open-request'");
 });
});
