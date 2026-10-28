import {adaptCatalogPreview} from './reader-catalog-adapter.mjs';
import {adaptTranslationPreview} from './reader-translation-adapter.mjs';
import {adaptChineseAudioPlayer} from './reader-chinese-audio-adapter.mjs';
import {adaptScopedAssistant} from './reader-assistant-adapter.mjs';
import {adaptNativeDictionaryWordDetail} from './reader-word-detail-adapter.mjs';
import {adaptQwenWordDetail} from './reader-qwen-detail-adapter.mjs';
import ts from 'typescript';
import postcss from 'postcss';
import { readFileSync } from 'node:fs';

const scienceImports = /(?:content-discovery|science-article|science-article-auto-collector)(?:-service|-curation|-directory|-content)?(?:\.js)?$/;
const scienceFunctions = new Set(['formatScienceDate','discoveryDateLabel','savedArticleDateLabel','ScienceArticleLibraryPage','fetchContentDiscovery','refreshContentDiscovery','fetchScienceArticles','importScienceArticle','deleteScienceArticle','refreshScienceArticle']);
const scienceVariables = new Set(['sourceProxyUrl','sourceProxyEnv','sourceHttpTransport','contentDiscoveryService','scienceArticleService','scienceArticleAutoCollector','scienceContentRefreshInFlight','refreshScienceContent']);

export function adaptReaderSource(source, filename, {qwenPreview = true, translationPreview = false, catalogPreview = false} = {}) {
  if (catalogPreview) source=adaptCatalogPreview(source,filename);
  if (translationPreview) source=adaptTranslationPreview(source,filename);
  source=adaptChineseAudioPlayer(source,filename);
  if (filename.endsWith('/frontend/codex-prep-panel.tsx')) return adaptScopedAssistant(source, filename);
  if (filename.endsWith('/frontend/word-context-state.ts')) {
    // The original reader persists contextual glosses, but only accepts the
    // original EasyCLIProxy provider when reloading. Vantilo uses vantilo-agent.
    // Keep old reader records readable during a migration and allow native records.
    const seam = '&& item.provider === "easycliproxy"';
    if (!source.includes(seam)) throw new Error('Word-context storage seam changed; review Vantilo cache compatibility');
    return source.replace(seam, '&& (item.provider === "easycliproxy" || (item.provider as string) === "vantilo-agent" || (item.provider as string) === "qwen-mlx" || (item.provider as string) === "custom-api")');
  }

  if (filename.endsWith('.css')) {
    const root = postcss.parse(source);
    root.walkRules(rule => {
      const selectors = rule.selectors.filter(selector => !/(?:science|discovery|ai-settings|ai-provider-settings)/i.test(selector));
      if (!selectors.length) rule.remove(); else rule.selectors = selectors;
    });
    if (filename.endsWith('/frontend/global-navigation.css')) {
      // These reader-workspace toolbar rules are responsive, but upstream has
      // them at the stylesheet root. On wide release-sized windows that hides
      // every action label and squeezes the remaining icons into narrow columns.
      const selectors = new Set([
        '.is-reader-workspace:not(.book-prep-layout--single) .reader-toolbar',
        '.is-reader-workspace:not(.book-prep-layout--single) .reader-toolbar-actions',
        '.is-reader-workspace:not(.book-prep-layout--single) .reader-toolbar-actions > *',
        '.is-reader-workspace:not(.book-prep-layout--single) .toolbar-button span',
        '.is-reader-workspace:not(.book-prep-layout--single) :is(.reader-toolbar-left,.reader-breadcrumb)',
        '.is-reader-workspace:not(.book-prep-layout--single) .reader-breadcrumb :is(strong,span)',
      ]);
      const toolbarRules = root.nodes.filter(node => node.type === 'rule' && selectors.has(node.selector));
      if (toolbarRules.length !== selectors.size) throw new Error('Reader toolbar responsive CSS seam changed');
      const responsive = postcss.atRule({ name: 'media', params: '(max-width: 1150px)' });
      for (const rule of toolbarRules) { responsive.append(rule.clone()); rule.remove(); }
      root.append(responsive);
      root.append(postcss.parse(`
.reader-page-shell .reader-toolbar-actions{min-width:0;max-width:100%;flex-wrap:nowrap;justify-content:flex-start;overflow-x:auto;scrollbar-width:none}
.reader-page-shell .reader-toolbar-actions::-webkit-scrollbar{display:none}
.reader-page-shell .reader-toolbar-actions>*{flex:0 0 auto}
.reader-page-shell .reader-toolbar-actions .toolbar-button{white-space:nowrap}
.reader-page-shell .reader-toolbar-actions .toolbar-button span{display:inline;white-space:nowrap}
.reader-page-shell .reader-toolbar-actions .vantilo-discovery-entry{color:var(--theme-accent)}
`));
    }
    root.walkAtRules(rule => { if (rule.nodes && !rule.nodes.length) rule.remove(); });
    if (filename.endsWith('/frontend/styles.css') && source.includes('.word-lookup-dictionary-summary')) {
      const dictionaryStyles = postcss.parse(readFileSync(new URL('./reader-dictionary-card.css', import.meta.url), 'utf8'));
      // Share the same scoped rules across the word popup and detail pane.
      dictionaryStyles.walkRules(rule => {
        if (!rule.selector.includes('.word-lookup-dictionary-summary')) return;
        rule.after(rule.clone({
          selector: rule.selector.replaceAll('.word-lookup-dictionary-summary', '.word-detail-content'),
        }));
      });
      root.append(dictionaryStyles);
    }
    return root.toString();
  }
  if (filename.endsWith('/frontend/global-reading-list.tsx')) {
    // Origin-local history can survive switching to Vantilo's separate library.
    // Keep that history, but do not promote a missing document as the main continue action.
    const seam = '  return <section className="continue-card"';
    if (!source.includes(seam)) throw new Error('Reader continue card seam changed; review the Vantilo adapter');
    return source.replace(seam, '  if (!item.available) return null;\n' + seam).replace('["全部", "期刊", "电子书", "精选阅读"]', '["全部", "期刊", "电子书"]');
  }
  if (filename.endsWith('/frontend/data-management-panel.tsx')) {
    return source.replaceAll('EPUB 和 AI 服务配置不会变化', 'EPUB 和 ChatGPT 登录信息不会变化').replaceAll('EPUB 与 AI 服务配置不会删除', 'EPUB 与 ChatGPT 登录信息不会删除').replaceAll('不包含 EPUB、API Key 或服务端 AI 配置', '不包含 EPUB 或 ChatGPT 登录信息');
  }
  if (filename.endsWith('/server/services/codex-prep-runtime.ts')) {
    return `export const CODEX_PREP_SANDBOX_MODE = 'read-only';
      export class CodexPrepRuntime { close() {} forget() {} async listModels(){throw new Error('请使用统一 Agent 模型选择');} async run(){throw new Error('请使用统一 Agent 助手');} }
      export async function runCodexPrepTurn(){throw new Error('请使用统一 Agent 助手');}`;
  }
  if (/\/server\/services\/(?:active-ai-providers|translation-service|reader-guide-service|section-translation-service|selection-assist-service|reading-assistant-service|word-context-service|book-toc-chinese-service)\.ts$/.test(filename)) {
    return source.replaceAll('"easycliproxy"', '"vantilo-agent"').replaceAll('EasyCLIProxyAPI', 'Agent').replaceAll('AI 服务尚未配置', '请先登录 ChatGPT');
  }
  if (!/src\/(frontend\/(?:App\.tsx|global-navigation\.tsx|api\.ts)|server\/app\.ts|server\/services\/codex-auth-service\.ts)$/.test(filename.replaceAll('\\','/'))) return source;
  // Exact upstream seams fail at build time if a future Reader version changes them.
  if (filename.endsWith('/server/app.ts')) {
    const original = 'const codexAuth = new CodexAuthService(paths.dataDir, options.aiFetchImpl);';
    if (!source.includes(original)) throw new Error('Reader auth seam changed; review the Vantilo adapter');
    source = source.replace(original, 'const codexAuth = { load: async () => {}, close: async () => {}, status: async () => { const state = await (options as any).vantiloAccountStatus?.() || {connected:false,email:null}; return {...state,sharing:state.connected,pending:false}; }, accessToken: async () => { if (!(await (options as any).vantiloAccountStatus?.())?.connected) throw new Error("请先在窗口顶部登录 ChatGPT"); return "vantilo-native-account"; } } as unknown as CodexAuthService;');
  }
  if (filename.endsWith('/codex-auth-service.ts')) source = source.replaceAll('magazine_reader', 'vantilo').replaceAll('Magazine Reader', 'Vantilo');
  if (filename.endsWith('/frontend/App.tsx')) source = source.replace('initialNavigation.page);', '(initialNavigation.page === "articles" ? "library" : initialNavigation.page));');
  if (filename.endsWith('/frontend/App.tsx') && source.includes('function WordLookupCard(')) {
    const before = '{firstZh && <strong>{firstZh}</strong>}';
    if (!source.includes(before)) throw new Error('Reader dictionary card seam changed');
    source = source.replace(before, "{\n  firstZh && <strong className=\"vantilo-dictionary-quick\">{firstZh}</strong>\n}\n{dictionary?.definitionsZh.some((item) => (item.source as string) === \"macos-dictionary-full\") && (\n  <>\n    <details className=\"vantilo-dictionary-full\">\n      <summary>查看完整词条与例句</summary>\n      <div className=\"vantilo-dictionary-full-body\">\n        <VantiloDictionaryExpanded\n          definition={dictionary.definitionsZh.find((item) => (item.source as string) === \"macos-dictionary-full\")?.definition ?? \"\"}\n          phonetic={dictionary.phonetic}\n          word={dictionary.word}\n        />\n      </div>\n    </details>\n  </>\n)}");
    const pronunciationStart = source.indexOf('function playWordPronunciation(');
    const pronunciationEnd = source.indexOf('\nfunction WordLookupCard(', pronunciationStart);
    if (pronunciationStart < 0 || pronunciationEnd < 0) {
      throw new Error('Reader pronunciation playback seam changed; review Vantilo accent selection');
    }
    source = source.slice(0, pronunciationStart) + source.slice(pronunciationEnd);
    source += '\n' + readFileSync(new URL('./reader-pronunciation.ts', import.meta.url), 'utf8');
    // Accent preference still controls automatic pronunciation on word click.
    // Manual US/UK buttons use their explicitly requested accent independently.
    source = source.replace('统一控制默认口音，以及点击正文单词时是否自动播放发音。',
      '只控制正文点词自动朗读的口音和开关；详情页美式、英式按钮各自独立。');
    source = source.replace('<div className="settings-label">默认发音</div>',
      '<div className="settings-label">点词自动发音口音</div>');
    // Keep keyboard handlers and aria-keyshortcuts; remove only the redundant
    // always-visible help strip from Vantilo's word popup.
    const shortcutMarkup = `      <div className="contextual-shortcut-hint word-lookup-shortcut-hint" data-testid="word-lookup-shortcut-hint" aria-label="单词卡快捷键">
        <span><kbd>0</kbd> 忽视</span>
        <span><kbd>1–4</kbd> 学习程度</span>
        <span><kbd>5</kbd> 已知</span>
        <span><kbd>Enter</kbd> 更多</span>
        <span><kbd>Esc</kbd> 关闭</span>
      </div>
`;
    if (source.split(shortcutMarkup).length !== 2) throw new Error('Reader keyboard help seam changed; review Vantilo adapter');
    source = source.replace(shortcutMarkup, '');
    if (qwenPreview) {
    // Make Qwen the principal Chinese gloss; dictionary remains expandable.
    const contextStart = '      <div className="word-lookup-context">\n';
    if (source.split(contextStart).length !== 2) throw new Error('Reader contextual popup seam changed');
    source = source.replace(contextStart,
      '      {context?.meaningSource === "user" && <div className="word-lookup-context">\n');
    // Keep existing successful and user-edited contextual information; omit the
    // old empty/loading/error block, already redundant with the explicit Qwen action.
    const contextEnd = '      </div>\n\n      <div className="word-lookup-familiarity">';
    if (source.split(contextEnd).length !== 2) throw new Error('Reader word context closing seam changed');
    source = source.replace(contextEnd, '      </div>}\n\n      <div className="word-lookup-familiarity">');
    const mainMeaningSeam = '      {hasCustomVocabularyMeaning ? (';
    if (source.split(mainMeaningSeam).length !== 2) throw new Error('Word popup dictionary placement changed');
    source = source.replace(mainMeaningSeam,
      '      <VantiloLocalGloss key={lookup.key} word={lookup.text} sentence={sentenceForOccurrence(lookup.paragraph,lookup.startOffset,lookup.text.length)} cachedMeaning={context?.meaningSource === "user" ? context.meaningZh : undefined} preserveCached={context?.meaningSource === "user"} cachedProvider={context?.provider} cachedModel={context?.model} onResolved={(meaningZh,provider,model) => onQwenMeaningResolved(lookup,meaningZh,provider,model)} />\n' +
      '      <details className="vantilo-dictionary-secondary"><summary>查看词典释义与例句</summary>\n' +
      mainMeaningSeam);
    const dictionaryEnd = '      ) : null}\n\n      {context?.meaningSource === "user" && <div className="word-lookup-context">';
    if(source.split(dictionaryEnd).length !== 2)throw new Error('Word popup secondary dictionary end changed');
    source=source.replace(dictionaryEnd, '      ) : null}\n      </details>\n\n      {context?.meaningSource === "user" && <div className="word-lookup-context">');
    // Only local Qwen should launch automatically on preview word-clicks.
    // Full detail retains the existing on-demand Agent explanation.
    const oldAutostart = '    if (!cachedContext || !hasEnglishWordContext(cachedContext)) {';
    if(source.split(oldAutostart).length !== 2)throw new Error('Old automatic Agent word context seam changed');
    source=source.replace(oldAutostart,'    if (false && (!cachedContext || !hasEnglishWordContext(cachedContext))) {');
    const callbackArg = '  onVocabularyMeaningChange,\n}: {';
    if(source.split(callbackArg).length !== 2)throw new Error('WordLookupCard callback parameter seam changed');
    source=source.replace(callbackArg,'  onVocabularyMeaningChange,\n  onQwenMeaningResolved,\n}: {');
    const callbackType='  onVocabularyMeaningChange: (meaningZh: string) => void;\n}) {';
    if(source.split(callbackType).length !== 2)throw new Error('WordLookupCard callback type seam changed');
    source=source.replace(callbackType,'  onVocabularyMeaningChange: (meaningZh: string) => void;\n  onQwenMeaningResolved: (lookup: ActiveWordLookup, meaningZh: string, provider?: string, model?: string) => void;\n}) {');
    const parentCall='              onVocabularyMeaningChange={(meaningZh) => updateWordLookupVocabularyMeaning(activeWordLookup, meaningZh)}';
    if(source.split(parentCall).length !== 2)throw new Error('WordLookupCard parent call seam changed');
    source=source.replace(parentCall,parentCall+'\n              onQwenMeaningResolved={saveVantiloQwenWordContext}');
    const parentLocation='  function openActiveWordDetails() {';
    if(source.split(parentLocation).length !== 2)throw new Error('Qwen persisted context insertion seam changed');
    source=source.replace(parentLocation,`
  // Qwen meanings belong to this word occurrence, not a global dictionary item.
  // Keep any explicit user-edited meaning, and persist for the small inline Chinese.
  function saveVantiloQwenWordContext(lookup: ActiveWordLookup, meaningZh: string, provider = 'qwen-mlx', modelName = 'Qwen3.5 4B MLX') {
    const latest=wordContextMeaningsRef.current.find(item=>item.key===lookup.key);
    if(latest?.meaningSource==='user')return;
    const record:WordContextMeaningRecord={
      ...(latest ?? {}),
      document:article.identity,
      key:lookup.key,
      text:lookup.text,paragraph:lookup.paragraph,
      paragraphIndex:lookup.paragraphIndex,startOffset:lookup.startOffset,
      sentence:sentenceForOccurrence(lookup.paragraph,lookup.startOffset,lookup.text.length),
      meaningZh,explanationZh:'',meaningEn:'',explanationEn:'',examplesEn:[],
      partOfSpeech:latest?.partOfSpeech ?? '',
      model:modelName,provider:provider as WordContextMeaningRecord['provider'],
      generatedAt:new Date().toISOString(),meaningSource:'ai',
    };
    const next=upsertWordContextMeaning(wordContextMeaningsRef.current,record);
    wordContextMeaningsRef.current=next;
    saveWordContextMeanings(getReaderStorage(),next);
    setWordContextMeanings(next);
    const update=(current:ActiveWordLookup|null):ActiveWordLookup|null=>
      current?.key===lookup.key?{...current,contextMeaning:record,contextStatus:'ready'}:current;
    setActiveWordLookup(update);setWordDetailLookup(update);
  }

`+parentLocation);
    source += '\n' + readFileSync(new URL('./reader-qwen-gloss.tsx', import.meta.url), 'utf8');
    } // Only the isolated Qwen preview gets automatic local inference UI.
    source = adaptNativeDictionaryWordDetail(source);
    if (qwenPreview) source = adaptQwenWordDetail(source);
    source += '\n' + readFileSync(new URL('./reader-dictionary-entry.tsx', import.meta.url), 'utf8');
  }

  source = source.replaceAll('\"Dictionary\"','\"Agent 释义\"').replaceAll('\"AI fallback\"','\"Agent 语境释义\"').replaceAll('Dictionary · base form','Agent · 词形').replaceAll('请配置 AI 服务', '请登录 ChatGPT').replaceAll('所有杂志共用一套阅读偏好与 AI 服务配置。这里集中管理阅读辅助、外观、发音、数据备份和模型连接。', '阅读辅助与工作台共用 ChatGPT 登录；Reader 独立保存对话与模型选择。这里管理外观、阅读偏好和本机数据备份。').replaceAll('阅读偏好在浏览器 · AI 配置在本机', '阅读偏好保存在本机 · AI 使用统一 Agent').replaceAll('词典：有道 / Free Dictionary API · 语境：EasyCLIProxy', '释义与语境：统一 Agent · AI 生成，请结合原文核对');
  if (filename.endsWith('/frontend/App.tsx') && source.includes('reader-toolbar-actions')) {
    const toolbar = '        <div className="reader-toolbar-actions">';
    if (source.split(toolbar).length !== 2) throw new Error('Reader toolbar discovery insertion seam changed');
    source = source.replace(toolbar, toolbar + `\n          <button className="toolbar-button vantilo-discovery-entry" type="button" aria-label="发现好书" title="发现好书" onClick={() => window.parent.postMessage({type:"vantilo:open-discovery"}, "*")}>▧ <span>发现好书</span></button>`);
  }
  if (filename.endsWith('/frontend/global-navigation.tsx')) {
    const nav = '<div className="global-nav-primary">{items.filter(item => primaryIds.includes(item.id)).map(item => renderItem(item))}</div>';
    if (source.split(nav).length !== 2) throw new Error('Global navigation discovery insertion seam changed');
    source = source.replace(nav, '<div className="global-nav-primary">{items.filter(item => primaryIds.includes(item.id)).map(item => renderItem(item))}<button className="global-nav-link vantilo-discovery-link" type="button" aria-label="发现好书" onClick={() => window.parent.postMessage({type:"vantilo:open-discovery"}, "*")}><span>发现好书</span></button></div>');
  }
  if (filename.endsWith('/frontend/App.tsx') && qwenPreview) {
    source = source.replaceAll('释义与语境：统一 Agent · AI 生成，请结合原文核对',
      '当前语境：本地 Qwen · 词典为补充，请结合原文核对');
  }
  if (filename.endsWith('/server/app.ts')) {
    source = source.replace(/const aiSettingsService = await AiProviderSettingsService.create\([^]*?\n  \}\);/, `const aiSettingsService = {
      hasConfiguredActiveProfile: () => Boolean(options.aiFetchImpl),
      getActiveProfile: () => options.aiFetchImpl ? ({id:'vantilo-agent',model:'Agent 当前模型',responsesUrl:'vantilo:agent',apiKey:''}) : null,
    } as unknown as AiProviderSettingsService;`);
    source = source.replace('const codexPrep = new CodexPrepService(options.projectRoot, codexAuth);', 'const codexPrep = new CodexPrepService(options.projectRoot, codexAuth, (options as any).vantiloRunTurn, (options as any).vantiloListModels);');
    source = source.replace('await codexPrep.load();', 'await codexPrep.load(); (options as any).vantiloModelPreferencesChanged?.(codexPrep.getModelPreferences());');
    source = source.replace('return await codexPrep.saveModelPreferences(request.body);', 'const value = await codexPrep.saveModelPreferences(request.body); (options as any).vantiloModelPreferencesChanged?.(value); return value;');
    // AI jobs only run on explicit Reader actions, never merely because the library starts or a book imports.
    source = source.replace('if (readerGuideAvailable() || sectionTranslationAvailable()) {\n    queueMicrotask', 'if (false) {\n    queueMicrotask');
    source = source.replace('if (result.status === "imported" && result.bookId && aiSettingsService.hasConfiguredActiveProfile())', 'if (false)');
  }
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const result = ts.transform(tree, [context => {
    const visit = node => {
      if (filename.endsWith('/frontend/App.tsx') &&
          ts.isFunctionDeclaration(node) && node.name?.text === 'openWordLookup' && node.body) {
        const statements = [...node.body.statements];
        const condition = statement => ts.isIfStatement(statement)
          ? statement.expression.getText(tree) : null;
        const contextIndex = statements.findIndex(statement =>
          condition(statement) === '!cachedContext || !hasEnglishWordContext(cachedContext)');
        const dictionaryIndex = statements.findIndex(statement =>
          condition(statement) === 'dictionaryEligible');
        if (contextIndex >= 0 && dictionaryIndex > contextIndex) {
          const [dictionary] = statements.splice(dictionaryIndex, 1);
          statements.splice(contextIndex, 0, dictionary);
          const reordered = ts.factory.updateFunctionDeclaration(
            node, node.modifiers, node.asteriskToken, node.name, node.typeParameters,
            node.parameters, node.type, ts.factory.updateBlock(node.body, statements),
          );
          // Word definitions should start before the more elaborate contextual analysis.
          return ts.visitEachChild(reordered, visit, context);
        }
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        if (scienceImports.test(node.moduleSpecifier.text) || ['./ai-provider-settings-panel'].includes(node.moduleSpecifier.text)) return undefined;
        if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
          const entries = node.importClause.namedBindings.elements.filter(item => !scienceFunctions.has(item.name.text));
          if (entries.length !== node.importClause.namedBindings.elements.length) {
            if (!entries.length && !node.importClause.name) return undefined;
            return ts.factory.updateImportDeclaration(node, node.modifiers, ts.factory.updateImportClause(node.importClause, node.importClause.isTypeOnly, node.importClause.name, ts.factory.updateNamedImports(node.importClause.namedBindings, entries)), node.moduleSpecifier, node.attributes);
          }
        }
      }
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'AiProviderSettingsPanel') return undefined;
      if (ts.isFunctionDeclaration(node) && scienceFunctions.has(node.name?.text)) return undefined;
      if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => ts.isIdentifier(item.name) && scienceVariables.has(item.name.text))) return undefined;
      if (ts.isIfStatement(node) && node.expression.getText(tree) === 'sourceHttpTransport') return undefined;
      if (ts.isExpressionStatement(node)) {
        const text = node.getText(tree);
        if (/^app\.(get|post|delete|put)(?:<[^]*?>)?\([\s]*["']\/api\/(science-articles|content-discovery|ai-settings)/.test(text)) return undefined;
        if (/^app\.(get|post|delete|put)(?:<[^]*?>)?\([\s]*[\"']\/api\/prep\/auth\/(?:start|disconnect)/.test(text)) return undefined;
        if (/^void refreshScienceContent\(/.test(text)) return undefined;
      }
      if (ts.isObjectLiteralExpression(node) && node.properties.some(item => ts.isPropertyAssignment(item) && item.name.getText(tree) === 'id' && ts.isStringLiteral(item.initializer) && item.initializer.text === 'articles')) return undefined;
      if (ts.isJsxExpression(node) && node.expression && /^page === "articles" &&/.test(node.expression.getText(tree))) return undefined;
      if (ts.isConditionalExpression(node) && node.condition.getText(tree) === 'page === "articles"') return ts.visitNode(node.whenFalse, visit);
      if (ts.isStringLiteral(node)) {
        if (node.text === '统一续读期刊、电子书和精选阅读。阅读进度与学习数据留在本机。') return ts.factory.createStringLiteral('统一续读期刊和电子书。阅读进度与学习数据留在本机。');
      }
      return ts.visitEachChild(node, visit, context);
    };
    return root => ts.visitNode(root, visit);
  }]);
  const output = ts.createPrinter().printFile(result.transformed[0]);
  result.dispose();
  return output.replace('content-discovery|science-articles|source-sync', 'source-sync');
}

export function readerVariantPlugin() {
  return { name: 'vantilo-reader-without-science', enforce: 'pre', transform(source, id) {
    if (id.includes('/src/')) { const qwenPreview=process.env.VANTILO_QWEN_READER_PREVIEW==='1'; const catalogPreview=qwenPreview||process.env.VANTILO_CATALOG_READER_PREVIEW==='1'; const code = adaptReaderSource(source, id.split('?')[0], {qwenPreview,translationPreview:qwenPreview||process.env.VANTILO_TRANSLATION_READER==='1',catalogPreview}); return code === source ? null : { code, map: null }; }
  } };
}
