import { describe, expect, it } from 'vitest';
import { adaptReaderSource } from '../scripts/reader-variant.mjs';
import ts from 'typescript';
import postcss from 'postcss';
import {readFileSync} from 'node:fs';
import {readerSourceRoot} from '../scripts/reader-source-path.mjs';

describe('Reader build adaptation', () => {
  it('removes science pages, navigation, client APIs and CSS rather than hiding them', () => {
    const frontend = `import { fetchScienceArticles, fetchBookLessons } from "./api";
      import { ScienceArticleContent } from "./science-article-content";
      function ScienceArticleLibraryPage() { return <div>science</div>; }
      const items = [{id:"articles", label:"科普文章"},{id:"books",label:"电子书"}];
      const view = <div>{page === "articles" && <ScienceArticleLibraryPage />}</div>;`;
    const result = adaptReaderSource(frontend, '/source/src/frontend/App.tsx');
    expect(result).not.toMatch(/ScienceArticle|科普文章|id: "articles"/);
    expect(result).toContain('fetchBookLessons'); expect(result).toContain('电子书');
    const css=adaptReaderSource('.science-article {color:red}.book {color:blue}@media(max-width:600px){.discovery-list{display:grid}}', '/source/src/frontend/styles.css');
    expect(css).toMatch(/^\.book \{color:blue\}/);expect(css).toContain('.vantilo-growth-home-card');expect(css).toContain('.reader-growth-timer');
  });
  it('keeps English words intact in sentence reading mode', () => {
    const source = '.reader-page-shell.is-sentence-mode .sentence-reading-block > p{overflow-wrap:anywhere}';
    const result = postcss.parse(adaptReaderSource(source, '/source/src/frontend/styles.css'));
    const wrapRules = result.nodes.filter(node => node.type === 'rule' && node.selector === '.reader-page-shell.is-sentence-mode .sentence-reading-block > p');
    expect(wrapRules.at(-1)?.nodes?.map(node => node.toString())).toEqual([
      'overflow-wrap: normal', 'word-break: normal', 'hyphens: none',
    ]);
    const sentenceFocusRule = result.nodes.find(node => node.type === 'rule' && node.selector.includes('.reader-canvas .reading-page:focus'));
    expect(sentenceFocusRule?.nodes?.toString()).toContain('outline: none !important');
    expect(sentenceFocusRule?.selector).toContain('.sentence-reading-card:focus-visible');
  });
  it('keeps Reader toolbar labels horizontal on wide windows and applies the compact layout only on narrow windows', () => {
    const selectors = [
      '.is-reader-workspace:not(.book-prep-layout--single) .reader-toolbar',
      '.is-reader-workspace:not(.book-prep-layout--single) .reader-toolbar-actions',
      '.is-reader-workspace:not(.book-prep-layout--single) .reader-toolbar-actions > *',
      '.is-reader-workspace:not(.book-prep-layout--single) .toolbar-button span',
      '.is-reader-workspace:not(.book-prep-layout--single) :is(.reader-toolbar-left,.reader-breadcrumb)',
      '.is-reader-workspace:not(.book-prep-layout--single) .reader-breadcrumb :is(strong,span)',
    ];
    const source = selectors.map(selector => `${selector}{display:flex}`).join('');
    const result = postcss.parse(adaptReaderSource(source, '/source/src/frontend/global-navigation.css'));
    expect(result.nodes.filter(node => node.type === 'rule' && selectors.includes(node.selector))).toHaveLength(0);
    const media = result.nodes.find(node => node.type === 'atrule' && node.params === '(max-width: 1150px)');
    expect(media?.nodes?.filter(node => node.type === 'rule')).toHaveLength(selectors.length);
    expect(result.toString()).toContain('.reader-page-shell .reader-toolbar-actions .toolbar-button span{display:inline;white-space:nowrap}');
    expect(result.toString()).toContain('.reader-page-shell .reader-toolbar-actions>*{flex:0 0 auto}');
  });
  it('places Discover a Good Book in the Reader toolbar and routes it to the host discovery page', () => {
    const source = `function Reader(){
      return <div>
        <div className="reader-toolbar-actions"></div>
      </div>;
    }`;
    const result = adaptReaderSource(source, '/source/src/frontend/App.tsx');
    expect(result).toContain('className="toolbar-button vantilo-discovery-entry"');
    expect(result).toContain('type: "vantilo:open-discovery", token: (window as Window & {');expect(result).toContain('__vantiloGrowthDocumentId?: string;');expect(result).toContain('__vantiloGrowthBookId?: string;');expect(result).toContain('__vantiloGrowthPageId?: string;');
    expect(ts.createSourceFile('result.tsx', result, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics).toHaveLength(0);
  });
  it('shows whole-book progress on the resume card by aggregating saved chapter progress', () => {
    const source = `function BookContinueCard({ book, item, onContinue }: { book: BookSummary; item: ReadingEntryView; onContinue: () => void }) {
      return <div><div className="continue-progress"><ProgressBar value={item.progress} /><span>{item.progress}%</span></div></div>;
    }
    const card = <BookContinueCard key={bookContinue.key} book={continueBook} item={bookContinue} onContinue={() => openReadingEntry(bookContinue.entry)} />;`;
    const result = adaptReaderSource(source, '/source/src/frontend/App.tsx');
    expect(result).toContain('summedChapterProgress / Math.max(1, book.readableUnitCount)');
    expect(result).toContain('chapterProgress={readerState.bookProgress}');
    expect(result).toContain('ProgressBar value={wholeBookProgress}');
    expect(ts.createSourceFile('result.tsx', result, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics).toHaveLength(0);
  });
  it('removes crawlers, science routes and the second assistant login and rejects upstream seam changes', () => {
    const source = `const codexAuth = new CodexAuthService(paths.dataDir, options.aiFetchImpl);
      const scienceArticleService = new ScienceArticleService();
      const refreshScienceContent = () => scienceArticleService.refresh();
      app.get("/api/science-articles", () => scienceArticleService.list());
      app.post<{Params:{id:string}}>("/api/science-articles/:id/refresh", () => scienceArticleService.refresh());
      app.get("/api/prep/auth", () => codexAuth.status());
      app.post("/api/source-sync/github", async () => { const result = await sync(); void refreshScienceContent().then(log); return result; });
      app.get("/api/books", () => books.list());`;
    const result = adaptReaderSource(source, '/source/src/server/app.ts');
    expect(result).not.toMatch(/scienceArticleService|refreshScienceContent|\/api\/science/);
    expect(result).toContain('/api/books'); expect(result).toContain('/api/source-sync/github');
    expect(() => adaptReaderSource('export function newServer(){}', '/source/src/server/app.ts')).toThrow(/seam changed/);
  });
  it('retains the original independently scoped Reader assistant', () => {
    const result = adaptReaderSource(`import {CodexPrepPanel} from "./codex-prep-panel";
      const toggleAssistant = () => setOpen(true);
      const assistantVisible = open; const assistantPanel = <CodexPrepPanel />;`, '/source/src/frontend/App.tsx');
    expect(result).toContain('CodexPrepPanel');
    expect(result).not.toContain('vantilo:open-agent');
    expect(result).toContain('assistantVisible = open');
    expect(ts.createSourceFile('result.tsx', result, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics).toHaveLength(0);
  });
  it('removes the AI service configuration panel and configuration routes', () => {
    const frontend = 'import {AiProviderSettingsPanel} from "./ai-provider-settings-panel"; const settings=<div><AiProviderSettingsPanel /></div>;';
    expect(adaptReaderSource(frontend,'/source/src/frontend/App.tsx')).not.toContain('AiProviderSettingsPanel');
    const server = 'const codexAuth = new CodexAuthService(paths.dataDir, options.aiFetchImpl); app.get("/api/ai-settings",()=>settings()); app.put<{Body:{apiKey:string}}>("/api/ai-settings/profile",()=>writeConfig());';
    expect(adaptReaderSource(server,'/source/src/server/app.ts')).not.toContain('/api/ai-settings');
  });
  it('replaces the legacy Reader-wide backup panel with vocabulary-only backup and source reimport navigation', () => {
    const filename = `${readerSourceRoot}/src/frontend/data-management-panel.tsx`;
    const result = adaptReaderSource(readFileSync(filename, 'utf8'), filename);
    expect(result).toContain('data-testid="vocabulary-backup-panel"');
    expect(result).toContain('前往书库重新导入');
    expect(result).not.toContain('clearUserData');
    expect(result).not.toContain('parseUserDataBackup');
    expect(ts.createSourceFile('vocabulary-data-management.tsx', result, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics).toHaveLength(0);
  });

});

it('keeps unavailable documents in history but removes the unavailable primary continue card', () => {
  const source = 'export function GlobalContinueCard({item}) {\n  return <section className="continue-card">{item.title}</section>; }';
  const result = adaptReaderSource(source, '/source/src/frontend/global-reading-list.tsx');
  expect(result).toContain('if (!item.available) return null;');
  expect(result).toContain('item.title');
  expect(()=>adaptReaderSource('new layout', '/source/src/frontend/global-reading-list.tsx')).toThrow(/seam changed/);
});

it('restores the original assistant functionality while replacing its composer, login and external TTS',()=>{
  const filename=`${readerSourceRoot}/src/frontend/codex-prep-panel.tsx`;
  const adapted=adaptReaderSource(readFileSync(filename,'utf8'),filename);
  for(const feature of ['ReaderSharedComposer','PREP_QUICK_PROMPTS','READING_ASSISTANT_PRESETS','draftStorageKey','locateParagraph','重新回答','清空讨论记录','选择备课章节','确认内容并保存到精选阅读'])expect(adapted).toContain(feature);
  expect(adapted).not.toContain('void connect()');expect(adapted).not.toContain('/api/prep/tts');
  expect(adapted).toContain('SpeechSynthesisUtterance');
  expect(ts.createSourceFile('result.tsx',adapted,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX).parseDiagnostics).toHaveLength(0);
});

it('preserves previously saved native-Agent contextual meanings after a Reader reload', () => {
  const source = readFileSync(`${readerSourceRoot}/src/frontend/word-context-state.ts`, 'utf8');
  const adapted = adaptReaderSource(source, '/source/src/frontend/word-context-state.ts');
  expect(adapted).toContain('(item.provider as string) === "vantilo-agent"');
  expect(adapted).toContain('(item.provider as string) === "qwen-mlx"');
  expect(adapted).toContain('item.provider === "easycliproxy"');
  expect(source).not.toContain('vantilo-agent');
  expect(() => adaptReaderSource('export const value = 1', '/source/src/frontend/word-context-state.ts'))
    .toThrow(/storage seam changed/);
});

it('queues short dictionary lookup before slower contextual analysis on first word click', () => {
  const source = `function openWordLookup() {
    if (!cachedContext || !hasEnglishWordContext(cachedContext)) { void ensureWordContextMeaning("imposed"); }
    if (dictionaryEligible) { void lookupDictionary("imposed"); }
  }`;
  const transformed = adaptReaderSource(source, '/source/src/frontend/App.tsx');
  expect(transformed.indexOf('lookupDictionary("imposed")')).toBeLessThan(
    transformed.indexOf('ensureWordContextMeaning("imposed")'));
  expect(ts.createSourceFile('reader.tsx', transformed, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics).toHaveLength(0);
});


it('renders the Apple Dictionary card as a compact gloss with an expandable full entry', () => {
  const readerRoot = `${readerSourceRoot}/src/frontend`;
  const source = readFileSync(readerRoot + '/App.tsx', 'utf8');
  const result = adaptReaderSource(source, readerRoot + '/App.tsx');
  expect(result).toContain('className="vantilo-dictionary-quick"');
  expect(result).toContain('查看完整词条与例句');
  expect(result).toContain('className="vantilo-dictionary-full-body"');
  expect(result).toContain('VantiloDictionaryExpanded');
  expect(result).toContain('VantiloDictionaryDisclosure');
  expect(result).toContain('<VantiloDictionaryQuickSummary dictionary={dictionary}/>');
  const dictionaryBlockStart = result.indexOf('className="word-lookup-dictionary-summary"');
  const contextBlockStart = result.indexOf('<div className="word-lookup-context">', dictionaryBlockStart);
  const dictionaryBlock = result.slice(dictionaryBlockStart, contextBlockStart);
  expect(dictionaryBlock).toContain('<VantiloDictionaryQuickSummary dictionary={dictionary}/>');
  expect(dictionaryBlock).not.toContain('contextStatus');
  expect(result.slice(contextBlockStart, contextBlockStart + 700)).toContain('lookup.contextStatus === "error"');
  expect(result).toContain('vantilo-dict-section-title');
  expect(result).toContain('parseVantiloNativeDictionary');
  expect(result).not.toContain('.definition.split("▸")');
  expect(result).toContain('macos-dictionary-full');
  expect(result).not.toContain('{firstZh && <strong>{firstZh}</strong>}');
  expect(ts.createSourceFile('adapted.tsx', result, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics).toHaveLength(0);

  const stylesheet = adaptReaderSource(
    readFileSync(readerRoot + '/styles.css', 'utf8'), readerRoot + '/styles.css'
  );
  expect(stylesheet).toContain('.word-lookup-dictionary-summary .vantilo-dictionary-quick');
  expect(stylesheet).toContain('.vantilo-dictionary-full-body');
  expect(stylesheet).toContain('.vantilo-dict-section-title');
  expect(stylesheet).toContain('.vantilo-dict-example-zh');
  expect(stylesheet).toContain('.word-detail-content .vantilo-dict-article');
  expect(stylesheet).toContain('.theme-night .word-detail-content .vantilo-dict-article');
  const rules = postcss.parse(stylesheet);
  const properties = selector => {
    const result = {};
    rules.walkRules(rule => {
      if (rule.selector === selector) {
        rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
      }
    });
    return result;
  };
  expect(properties('.reader-page-shell .vocabulary-panel .word-detail-back').display).toBe('none');
  const article = '.word-lookup-dictionary-summary .vantilo-dict-article';
  const detail = '.word-detail-content .vantilo-dict-article';
  const detailLight = properties(detail);
  const detailNight = properties('.theme-night ' + detail);
  const light = properties(article);
  const night = properties('.theme-night ' + article);
  expect(light.background).toBe('var(--vantilo-dict-surface)');
  expect(light['--vantilo-dict-surface']).toBe('#f7f5f0');
  expect(light['--vantilo-dict-han']).toBe('#37312a');
  expect(light['--vantilo-dict-gold']).toBe('#8a682e');
  expect(night['--vantilo-dict-surface']).toBe('#2e3238');
  expect(night['--vantilo-dict-han']).toBe('#f0ece4');
  expect(night['--vantilo-dict-gold']).toBe('#dbbb78');
  expect(night.background).toBeUndefined();
  expect(detailLight['--vantilo-dict-surface']).toBe(light['--vantilo-dict-surface']);
  expect(detailLight.background).toBe(light.background);
  expect(detailNight['--vantilo-dict-surface']).toBe(night['--vantilo-dict-surface']);
  expect(detailNight['--vantilo-dict-han']).toBe(night['--vantilo-dict-han']);
  expect(properties('.word-detail-content .vantilo-dict-example-en').color).toBe('var(--vantilo-dict-english)');
  expect(properties('.word-lookup-dictionary-summary .vantilo-dict-example-en').color).toBe('var(--vantilo-dict-english)');
  expect(properties('.word-lookup-dictionary-summary .vantilo-dict-example-zh').color).toBe('var(--vantilo-dict-translation)');
  expect(stylesheet).not.toContain('background: #202022');
});


it('simplifies the word popup without removing real keyboard or dictionary functions', () => {
  const originalFile = `${readerSourceRoot}/src/frontend/App.tsx`;
  const adapted = adaptReaderSource(readFileSync(originalFile, 'utf8'), originalFile);
  // Entire shortcut legend and small provenance label vanish from the popup.
  expect(adapted).not.toContain('data-testid="word-lookup-shortcut-hint"');
  expect(adapted).not.toContain('className="vantilo-dictionary-source"');
  // Keyboard handlers and actionable familiarity controls are not removed.
  expect(adapted).toContain('aria-keyshortcuts="Escape"');
  expect(adapted).toContain('ariaKeyShortcuts={String(level)}');
  expect(adapted).toContain('onFamiliarityChange(level)');
  expect(adapted).toContain('onOpenDetails');
  expect(adapted).toContain('onMouseLeave={detailLookup ? onCloseDetail : undefined}');
  expect(adapted).toContain('closeWordDetailOnOutsidePointer');
  // Dictionary content and full entry still work.
  expect(adapted).toContain('className="vantilo-dictionary-quick"');
  expect(adapted).toContain('查看完整词条与例句');
  // Qwen belongs between the dictionary and meaningful saved context;
  // old empty/error context does not consume screen space.
  expect(adapted.indexOf('<VantiloLocalGloss')).toBeLessThan(adapted.indexOf('word-lookup-dictionary-summary'));
  expect(adapted).toContain('className="vantilo-dictionary-secondary"');
  expect(adapted).toContain('onQwenMeaningResolved={saveVantiloQwenWordContext}');
  expect(adapted).toContain('wordContextMeaningsRef.current = next');
  expect(adapted).toContain('false && (!cachedContext || !hasEnglishWordContext(cachedContext))');
  expect(adapted).toContain('context?.meaningSource === "user"');
  expect(adapted).toContain('word-detail-context-section');
  expect(ts.createSourceFile('result.tsx', adapted, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics).toHaveLength(0);
});

it('applies Reader growth additions after catalog JSX adaptation so development preview seams remain valid',()=>{
  const filename=`${readerSourceRoot}/src/frontend/App.tsx`;const original=readFileSync(filename,'utf8');
  const adapted=adaptReaderSource(original,filename,{qwenPreview:false,catalogPreview:true,translationPreview:true});
  expect(adapted).toContain('vantilo-growth-home-card');expect(adapted).toContain('reader-growth-timer');
  expect(adapted).toContain('VantiloCatalogControl');expect(adapted).toContain('vantilo-reader-translation-action');
  expect(ts.createSourceFile('catalog-growth.tsx',adapted,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX).parseDiagnostics).toHaveLength(0);
});

it('keeps automatic Qwen and collapsed dictionary exclusive to the separate preview build',()=>{
  const filename=`${readerSourceRoot}/src/frontend/App.tsx`;
  const adapted=adaptReaderSource(readFileSync(filename,'utf8'),filename,{qwenPreview:false});
  expect(adapted).not.toContain('<VantiloLocalGloss');
  expect(adapted).not.toContain('vantilo-dictionary-secondary');
  expect(adapted).not.toContain('saveVantiloQwenWordContext');
  expect(adapted).toContain('className="word-lookup-dictionary-summary"');
  expect(adapted).toContain('if (!cachedContext || !hasEnglishWordContext(cachedContext))');
  expect(ts.createSourceFile('result.tsx',adapted,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX).parseDiagnostics).toHaveLength(0);
});

it('includes the release translation adapter in translation-enabled builds without Qwen word-popup changes',()=>{
  const filename=`${readerSourceRoot}/src/frontend/App.tsx`;
  const original=readFileSync(filename,'utf8');
  const adapted=adaptReaderSource(original,filename,{qwenPreview:false,translationPreview:true});
  expect(adapted).toContain('/api/vantilo-translation/engines');
  expect(adapted).toContain('/api/vantilo-translation/translate');
  expect(adapted).toContain('vantilo-translation-bar');
  expect(adapted).not.toContain('<VantiloLocalGloss');
  expect(ts.createSourceFile('translation-enabled.tsx',adapted,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX).parseDiagnostics).toHaveLength(0);
});

it('keeps native full dictionary text out of both word-detail meaning lists while preserving ordinary entries', () => {
  const sourcePath = `${readerSourceRoot}/src/frontend/App.tsx`;
  const original = readFileSync(sourcePath, 'utf8');
  const adapted = adaptReaderSource(original, sourcePath);
  expect(adapted).toContain('macOS 本机词典');
  expect(adapted).toContain('dictionary.definitionsZh.filter((item) => (item.source as string) !== "macos-dictionary-full")');
  expect(adapted).toContain('const englishDefinitions = (dictionary?.definitionsEn ?? []).filter((item) => (item.source as string) !== "macos-dictionary-full");');
  expect(adapted).toContain('<VantiloDictionaryExpanded definition={dictionary.definitionsZh.find');
  expect(adapted).not.toContain('<VantiloDictionaryDisclosure dictionary={dictionary} language="zh"/>');
  expect(adapted).toContain('<VantiloDictionaryDisclosure dictionary={dictionary} language="en"/>');
  expect(adapted).toContain('function VantiloDictionaryDisclosure(');
  expect(adapted).toContain('查看完整词条与例句');
  expect(adapted).toContain('word-detail-user-meaning');
  expect(adapted).toContain('word-detail-context-section');
  expect(ts.createSourceFile('adapted.tsx', adapted, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics).toHaveLength(0);
});

it('builds the Reader storage notice without restoring the retired Reader-wide backup exporter', () => {
  const sourcePath = `${readerSourceRoot}/src/frontend/storage-notice.tsx`;
  const source = readFileSync(sourcePath, 'utf8');
  const adapted = adaptReaderSource(source, sourcePath);
  expect(adapted).toContain('export function StorageNotice()');
  expect(adapted).toContain('尚未保存到本机');
  expect(adapted).not.toContain('serializeUserDataBackup');
  expect(adapted).not.toContain('createObjectURL');
  expect(ts.createSourceFile('storage-notice.tsx', adapted, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics).toHaveLength(0);
});


it('keeps pronunciation preference only for automatic reading and binds both word-detail buttons to locale-selected voices', () => {
  const originalFile = `${readerSourceRoot}/src/frontend/App.tsx`;
  const original = readFileSync(originalFile, 'utf8');
  const adapted = adaptReaderSource(original, originalFile);
  expect(adapted).toContain('selectVantiloAccentVoice');
  expect(adapted).toContain('utterance.voice = voice;');
  expect(adapted).toContain('https://dict.youdao.com');
  expect(adapted).toContain('type = accent === "us" ? "2" : "1"');
  expect(adapted).toContain('ONLINE_AUDIO_TIMEOUT_MS = 1500');
  expect(adapted).toContain('attemptYoudaoAudio(youdao, generation)');
  expect(adapted).toContain('synthesis.speak(utterance)');
  expect(adapted).toContain('voice.lang.replaceAll("_", "-")');
  expect(adapted).toContain('详情播放 ');
  expect(adapted).toContain('playWordPronunciation(lookup.text, dictionary, "us")');
  expect(adapted).toContain('playWordPronunciation(lookup.text, dictionary, "uk")');
  expect(adapted).toContain('playWordPronunciation(text, dictionary, preferences.pronunciationAccent)');
  expect(adapted).toContain('playWordPronunciation(text, undefined, preferences.pronunciationAccent)');
  expect(adapted).toContain('点词自动发音口音');
  expect(adapted).toContain('详情页美式、英式按钮各自独立');
  expect(adapted).not.toContain('const utterance = new window.SpeechSynthesisUtterance(text);\n      utterance.lang = accent ===');
  expect(ts.createSourceFile('result.tsx', adapted, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics).toHaveLength(0);
});
