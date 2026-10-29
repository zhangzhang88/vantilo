import {adaptCatalogPreview} from './reader-catalog-adapter.mjs';
import {adaptTranslationPreview} from './reader-translation-adapter.mjs';
import {adaptChineseAudioPlayer} from './reader-chinese-audio-adapter.mjs';
import {adaptScopedAssistant} from './reader-assistant-adapter.mjs';
import {adaptNativeDictionaryWordDetail} from './reader-word-detail-adapter.mjs';
import {adaptQwenWordDetail} from './reader-qwen-detail-adapter.mjs';
import {adaptReaderBackup} from './reader-backup-adapter.mjs';
import {adaptReaderGrowthBridge} from './reader-growth-adapter.mjs';
import ts from 'typescript';
import postcss from 'postcss';
import { readFileSync } from 'node:fs';

const scienceImports = /(?:content-discovery|science-article|science-article-auto-collector)(?:-service|-curation|-directory|-content)?(?:\.js)?$/;
const scienceFunctions = new Set(['formatScienceDate','discoveryDateLabel','savedArticleDateLabel','ScienceArticleLibraryPage','fetchContentDiscovery','refreshContentDiscovery','fetchScienceArticles','importScienceArticle','deleteScienceArticle','refreshScienceArticle']);
const scienceVariables = new Set(['sourceProxyUrl','sourceProxyEnv','sourceHttpTransport','contentDiscoveryService','scienceArticleService','scienceArticleAutoCollector','scienceContentRefreshInFlight','refreshScienceContent']);

export function adaptReaderSource(source, filename, {qwenPreview = true, translationPreview = false, catalogPreview = false} = {}) {
  source = adaptReaderBackup(source, filename);
  if (catalogPreview) source=adaptCatalogPreview(source,filename);
  if (translationPreview) source=adaptTranslationPreview(source,filename);
  source=adaptChineseAudioPlayer(source,filename);
  // Catalog owns exact JSX seams in App.tsx; apply the growth additions only after it.
  source = adaptReaderGrowthBridge(source, filename);
  if (filename.endsWith('/frontend/codex-prep-panel.tsx')) return adaptScopedAssistant(source, filename);
  if (filename.endsWith('/frontend/reader-preferences.ts')) {
    const changes = [
      ['export type ReaderTheme = "paper" | "sepia" | "green" | "night";', 'export type ReaderTheme = "paper" | "sepia" | "green" | "blue" | "night";'],
      ['export type AppThemePreset = "light" | "sepia" | "green" | "dark" | "system";', 'export type AppThemePreset = "light" | "sepia" | "green" | "blue" | "dark" | "system";'],
      ['value === "green" || value === "night"', 'value === "green" || value === "blue" || value === "night"'],
      ['mode === "sepia" || mode === "green" ? mode : "paper"', 'mode === "sepia" || mode === "green" || mode === "blue" ? mode : "paper"'],
      ['["light", "sepia", "green", "dark", "system"]', '["light", "sepia", "green", "blue", "dark", "system"]'],
      ['if (parsed.theme === "green") return "green";', 'if (parsed.theme === "green" || parsed.theme === "blue") return parsed.theme;'],
      ['  autoPronounceOnWordClick: false,', '  autoPronounceOnWordClick: true,'],
      ['return Math.max(15, Math.min(24, Math.round(value)));', 'return Math.max(12, Math.min(24, Math.round(value)));'],
    ];
    for (const [before, after] of changes) {
      if (source.split(before).length !== 2) throw new Error('Reader blue theme preference seam changed');
      source = source.replace(before, after);
    }
    const preferenceSeam = '    if (!parsed || typeof parsed !== "object") return DEFAULT_READER_PREFERENCES;\n    return {';
    if (source.split(preferenceSeam).length !== 2) throw new Error('Reader pronunciation preference migration seam changed');
    const emptyPreferencesSeam = '  if (!raw) return DEFAULT_READER_PREFERENCES;';
    if (source.split(emptyPreferencesSeam).length !== 2) throw new Error('Reader empty preference migration seam changed');
    source = source.replace(emptyPreferencesSeam, `  if (!raw) {
    try { (storage as WriteStorage).setItem("vantilo-auto-pronounce-default-v1", "1"); } catch {}
    return DEFAULT_READER_PREFERENCES;
  }`);
    source = source.replace(preferenceSeam, `    if (!parsed || typeof parsed !== "object") return DEFAULT_READER_PREFERENCES;
    // Earlier Vantilo builds inherited the upstream "off" default into user
    // storage. Enable it once on upgrade, then respect future explicit choices.
    const pronunciationMigrationKey = "vantilo-auto-pronounce-default-v1";
    if (!storage.getItem(pronunciationMigrationKey)) {
      const writable = storage as WriteStorage;
      try {
        if (parsed.autoPronounceOnWordClick === false) {
          parsed.autoPronounceOnWordClick = true;
          writable.setItem(READER_PREFERENCES_KEY, JSON.stringify(parsed));
        }
        writable.setItem(pronunciationMigrationKey, "1");
      } catch {
        // The in-memory value below still defaults on; retry migration next load.
        parsed.autoPronounceOnWordClick = true;
      }
    }
    return {`);
    return source;
  }
  if (filename.endsWith('/frontend/user-data-backup.ts')) {
    const theme = 'value.theme === "green" || value.theme === "night"';
    const presets = '["light", "sepia", "green", "dark", "system"]';
    const fontSize = 'value.fontSize >= 15 && value.fontSize <= 24';
    if (source.split(theme).length !== 2 || source.split(presets).length !== 2 || source.split(fontSize).length !== 2) throw new Error('Reader blue theme backup seam changed');
    return source.replace(theme, 'value.theme === "green" || value.theme === "blue" || value.theme === "night"').replace(presets, '["light", "sepia", "green", "blue", "dark", "system"]').replace(fontSize, 'value.fontSize >= 12 && value.fontSize <= 24')
      .replaceAll('当前浏览器中的', '本机的').replace('magazine-reader-backup-${date.toISOString().slice(0, 10)}.json', 'vantilo-reading-backup-${date.toISOString().slice(0, 10)}.json');
  }
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
.app-shell .reader-page-shell.is-chinese-mode .reader-toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:12px;min-height:62px;height:auto;padding:8px 20px}
.app-shell .reader-page-shell.is-chinese-mode .reader-toolbar-left{min-width:0}
.app-shell .reader-page-shell.is-chinese-mode .reader-toolbar-center{display:flex;align-items:center;gap:8px;white-space:nowrap}
.app-shell .reader-page-shell.is-chinese-mode .reader-toolbar-actions{grid-column:auto;display:flex;width:auto;min-width:0;align-items:center;justify-content:flex-end;gap:8px;overflow:visible}
.app-shell .reader-page-shell.is-chinese-mode .reader-breadcrumb{min-width:0;overflow:hidden}
.app-shell .reader-page-shell.is-chinese-mode .reader-breadcrumb :is(strong,span,h1){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:600px){
  .app-shell .reader-page-shell.is-chinese-mode .reader-toolbar{grid-template-columns:minmax(0,1fr) auto;gap:7px 8px;padding:8px 12px}
  .app-shell .reader-page-shell.is-chinese-mode .reader-toolbar-left{grid-column:1 / -1}
  .app-shell .reader-page-shell.is-chinese-mode .reader-toolbar-center{grid-column:1}
  .app-shell .reader-page-shell.is-chinese-mode .reader-toolbar-actions{grid-column:2}
  .app-shell .reader-page-shell.is-chinese-mode .chinese-player{top:118px}
}
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
    if (filename.endsWith('/frontend/styles.css') && source.includes('.reader-page-shell.is-sentence-mode .sentence-reading-block > p')) {
      let sentenceTextRuleFound = false;
      root.walkRules(rule => {
        if (rule.selector === '.reader-page-shell.is-sentence-mode .sentence-reading-block > p') sentenceTextRuleFound = true;
      });
      if (!sentenceTextRuleFound) throw new Error('Sentence reading text CSS seam changed');
      // `anywhere` can split English words at the line edge (for example Major
      // into “Majo” and “r”). Sentence copy should wrap at word boundaries.
      root.append(postcss.parse(`
.reader-page-shell.is-sentence-mode .sentence-reading-block > p {
  overflow-wrap: normal;
  word-break: normal;
  hyphens: none;
}
`));
      root.append(postcss.parse(`
.reader-page-shell.is-sentence-mode .vantilo-sentence-stage .sentence-reading-block > p { font-size:clamp(26px,2em,48px); }
.reader-page-shell.is-sentence-mode .reader-canvas .reading-page { max-width: none; }
.reader-page-shell.is-sentence-mode .sentence-reading-card { padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.reader-page-shell.is-sentence-mode .reader-canvas .reading-page:focus,
.reader-page-shell.is-sentence-mode .reader-canvas .reading-page:focus-visible,
.reader-page-shell.is-sentence-mode .sentence-reading-card:focus,
.reader-page-shell.is-sentence-mode .sentence-reading-card:focus-visible { outline: none !important; }
.reader-page-shell.is-sentence-mode .sentence-reading-meta { max-width: 940px; margin: 0 auto 40px; }
.reader-page-shell.is-sentence-mode .sentence-reading-tools { max-width: 940px; margin: 24px auto 0; }
.reader-page-shell.is-sentence-mode .sentence-reading-translation { max-width: 940px; margin-left: auto; margin-right: auto; }
.reader-page-shell.is-sentence-mode .vantilo-sentence-stage { display: grid; grid-template-columns: 44px minmax(0,940px) 44px; justify-content: space-between; align-items: center; gap: clamp(10px,2vw,28px); }
.reader-page-shell.is-sentence-mode .vantilo-sentence-stage > .sentence-reading-block { grid-column: 2; min-width: 0; }
.reader-page-shell.is-sentence-mode .vantilo-sentence-arrow { display: inline-flex; align-items: center; justify-content: center; width: 42px; height: 48px; padding: 0; border: 0; border-radius: 12px; background: transparent; color: var(--sentence-muted); cursor: pointer; font: 300 34px/1 Inter,sans-serif; transition: color 120ms ease,background 120ms ease; }
.reader-page-shell.is-sentence-mode .vantilo-sentence-arrow:hover:not(:disabled) { color: var(--sentence-accent); background: var(--sentence-soft); }
.reader-page-shell.is-sentence-mode .vantilo-sentence-arrow:disabled { opacity: .28; cursor: default; }
.reader-page-shell.is-sentence-mode .sentence-translation-toggle { min-height: 32px; gap: 0; padding: 4px 9px; border-radius: 8px; font-size: 12px; }
.reader-page-shell.is-sentence-mode .sentence-translation-toggle > span { font-size: 15px; }
.reader-page-shell.is-sentence-mode .reader-toolbar-center { display:flex; align-items:center; gap:6px; }
.vantilo-sentence-appearance { position:relative; flex:none; }
.vantilo-sentence-appearance-trigger { min-width:40px; min-height:36px; padding:5px 8px; border:1px solid var(--sentence-line); border-radius:8px; background:var(--sentence-surface); color:var(--sentence-ink); cursor:pointer; font:600 14px/1.3 Georgia,serif; }
.vantilo-sentence-appearance-panel { position:absolute; top:calc(100% + 6px); right:0; z-index:50; box-sizing:border-box; width:min(320px,calc(100vw - 32px)); max-height:min(70vh,560px); overflow:auto; padding:16px; border:1px solid var(--sentence-line); border-radius:12px; background:var(--sentence-surface); color:var(--sentence-ink); box-shadow:0 8px 28px #0002; font:13px/1.4 Inter,"PingFang SC",sans-serif; }
.vantilo-sentence-appearance-heading { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; font-size:15px; }
.vantilo-sentence-appearance-heading button { border:0; background:transparent; color:var(--sentence-muted); cursor:pointer; font-size:20px; }
.vantilo-sentence-appearance-label,.vantilo-sentence-size-label { display:block; margin:14px 0 8px; font-weight:600; }
.vantilo-sentence-size-label { display:flex; justify-content:space-between; }
.vantilo-sentence-size-label span,.vantilo-sentence-appearance-panel small { color:var(--sentence-muted); font-weight:400; }
.vantilo-sentence-theme-options { display:flex; flex-wrap:wrap; gap:9px; }
.vantilo-sentence-theme-option { width:34px; height:34px; border:1px solid #b7c4bd; border-radius:50%; cursor:pointer; color:#334b46; background:#f2f2ef; }
.vantilo-sentence-theme-option.theme-light { background:#fffefa; } .vantilo-sentence-theme-option.theme-sepia { background:#faf4e7; } .vantilo-sentence-theme-option.theme-green { background:#d9ebdc; } .vantilo-sentence-theme-option.theme-blue { background:#30477e; } .vantilo-sentence-theme-option.theme-dark { background:#212a2d; }
.vantilo-sentence-theme-option[aria-pressed="true"] { outline:2px solid var(--sentence-accent); outline-offset:2px; }
.vantilo-sentence-appearance-panel input[type="range"] { display:block; width:100%; accent-color:var(--sentence-accent); }
.vantilo-sentence-font-options { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.vantilo-sentence-font-option { display:flex; align-items:center; gap:9px; min-height:44px; padding:6px 9px; border:1px solid var(--sentence-line); border-radius:8px; background:transparent; color:inherit; cursor:pointer; text-align:left; font-size:12px; }
.vantilo-sentence-font-option span { font:22px/1 Georgia,serif; color:var(--sentence-accent); } .vantilo-sentence-font-option.font-sans span { font-family:Arial,sans-serif; }
.vantilo-sentence-font-option[aria-pressed="true"] { border-color:var(--sentence-accent); background:var(--sentence-soft); }
.vantilo-sentence-appearance-reset { margin:14px 12px 0 0; padding:4px 0; border:0; background:transparent; color:var(--sentence-accent); cursor:pointer; }
`));
      root.append(postcss.parse(`
@media (max-width: 640px) {
  .reader-page-shell.is-sentence-mode .vantilo-sentence-stage { grid-template-columns: 28px minmax(0,1fr) 28px; gap: 6px; }
  .reader-page-shell.is-sentence-mode .vantilo-sentence-arrow { width: 28px; height: 40px; font-size: 25px; }
  .reader-page-shell.is-sentence-mode .vantilo-sentence-stage .sentence-reading-block > p { font-size:clamp(24px,2em,48px); }
  .reader-page-shell.is-sentence-mode .reader-toolbar-center { flex-wrap:wrap; justify-content:flex-end; }
}
`));
    }
    if (filename.endsWith('/frontend/styles.css') && source.includes('.vocabulary-panel') && source.includes('.word-detail-back')) {
      root.append(postcss.parse(`
.reader-page-shell .vocabulary-panel .word-detail-back { display: none; }
`));
    }
    if (filename.endsWith('/frontend/app-theme.css')) root.append(postcss.parse(`
html[data-color-mode="blue"] { color-scheme:dark; --theme-bg:#30477e; --theme-surface:#223666; --theme-raised:#2c4275; --theme-soft:#263c70; --theme-selected:#425e9a; --theme-ink:#f5f7ff; --theme-secondary:#e0e8fa; --theme-muted:#c3d1ed; --theme-line:#6681b1; --theme-line-soft:#4b6397; --theme-accent:#9ed3ed; --theme-on-accent:#102747; --theme-danger:#ffc1b9; --theme-danger-soft:#513b56; --theme-shadow:0 8px 28px #081a4440; }
[data-theme-swatch="blue"] .theme-swatch { background:#30477e; }
`));
    return root.toString();
  }
  if (filename.endsWith('/frontend/global-reading-list.tsx')) {
    // Origin-local history can survive switching to Vantilo's separate library.
    // Keep that history, but do not promote a missing document as the main continue action.
    const seam = '  return <section className="continue-card"';
    if (!source.includes(seam)) throw new Error('Reader continue card seam changed; review the Vantilo adapter');
    const progress = '<span>{item.progress}%</span></div>';
    if (source.includes('data-testid="continue-reading"') && source.split(progress).length !== 2) throw new Error('Magazine continue progress label seam changed');
    return source.replace(seam, '  if (!item.available) return null;\n' + seam).replace(progress, '<span>本期 {item.progress}%</span></div>').replace('["全部", "期刊", "电子书", "精选阅读"]', '["全部", "期刊", "电子书"]');
  }
  if (filename.endsWith('/frontend/data-management-panel.tsx')) {
    if (!source.includes('export function DataManagementPanel()')) throw new Error('Reader data management seam changed');
    return readFileSync(new URL('./reader-data-management.tsx', import.meta.url), 'utf8');
  }
  if (filename.endsWith('/frontend/storage-notice.tsx')) {
    const blob = '  const url = URL.createObjectURL(new Blob([serializeUserDataBackup(backup)], { type: "application/json;charset=utf-8" }));';
    if (source.split(blob).length !== 2) throw new Error('Reader backup download seam changed');
    return source.replace(blob, '  const file = new Blob([serializeUserDataBackup(backup)], { type: "application/json;charset=utf-8" });\n  if (file.size > 25 * 1024 * 1024) throw new Error("阅读备份超过 25 MB，暂时无法导出；请保留当前数据。");\n  const url = URL.createObjectURL(file);').replaceAll('尚未保存到浏览器', '尚未保存到本机').replaceAll('无法读取浏览器保存的数据，请检查浏览器存储权限', '无法读取本机阅读数据，请检查存储空间和权限');
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
  if (filename.endsWith('/frontend/App.tsx') && source.includes('data-testid="sentence-reading-card"')) {
    const smallerFontSize = 'Math.max(15, preferences.fontSize - 1)';
    if (source.split(smallerFontSize).length !== 2) throw new Error('Reader minimum font size seam changed');
    source = source.replace(smallerFontSize, 'Math.max(12, preferences.fontSize - 1)');
    const globalThemeOption = '{ id: "green", label: "浅绿" }, { id: "dark", label: "深色" }';
    if (source.split(globalThemeOption).length !== 2) throw new Error('Reader theme choices seam changed');
    source = source.replace(globalThemeOption, '{ id: "green", label: "浅绿" }, { id: "blue", label: "蓝色" }, { id: "dark", label: "深色" }');
    const globalAppearanceEffect = `  useLayoutEffect(() => {
    document.documentElement.dataset.colorMode = appTheme === "night" ? "dark" : appTheme === "paper" ? "light" : appTheme;
  }, [appTheme]);`;
    if (source.split(globalAppearanceEffect).length !== 2) throw new Error('Reader global appearance sync seam changed');
    source = source.replace(globalAppearanceEffect, `  useLayoutEffect(() => {
    document.documentElement.dataset.colorMode = appTheme === "night" ? "dark" : appTheme === "paper" ? "light" : appTheme;
    if (window.parent !== window) window.parent.postMessage({type:"vantilo:reader-appearance", theme:appTheme, fontSize:readerPreferences.fontSize, fontFamily:readerPreferences.fontFamily}, "*");
  }, [appTheme, readerPreferences.fontSize, readerPreferences.fontFamily]);`);
    const readerPreferenceArgument = '  preferences,\n  onBack,';
    const readerPreferenceType = '  preferences: ReaderPreferences;\n  onBack: () => void;';
    if (source.split(readerPreferenceArgument).length !== 2 || source.split(readerPreferenceType).length !== 2) throw new Error('Reader global preference seam changed');
    source = source.replace(readerPreferenceArgument, '  preferences,\n  onPreferencesChange,\n  onBack,');
    source = source.replace(readerPreferenceType, '  preferences: ReaderPreferences;\n  onPreferencesChange: (patch: Partial<ReaderPreferences>) => void;\n  onBack: () => void;');
    if (source.split('preferences={effectiveReaderPreferences}').length !== 4) throw new Error('Reader preference binding seam changed');
    source = source.replaceAll('preferences={effectiveReaderPreferences}', 'preferences={effectiveReaderPreferences} onPreferencesChange={updateReaderPreferences}');
    const readerModeSwitch = '          <div className="reader-mode-switch" aria-label="阅读模式">';
    if (source.split(readerModeSwitch).length !== 2) throw new Error('Sentence appearance toolbar seam changed');
    source = source.replace(readerModeSwitch, '          {readerMode === "sentence" && <VantiloSentenceAppearanceMenu value={preferences} onChange={onPreferencesChange} />}\n' + readerModeSwitch);
    const sentenceCount = '<span>第 {sentenceIndex + 1} / {articleSentences.length} 句</span>';
    if (source.split(sentenceCount).length !== 2) throw new Error('Sentence count seam changed');
    source = source.replace(sentenceCount, '<span>{sentenceIndex + 1} / {articleSentences.length}</span>');
    const sentenceBlockAnchor = '                  <div\n                    className={`reading-paragraph-block sentence-reading-block';
    const sentenceBlockStart = source.indexOf(sentenceBlockAnchor);
    const sentenceToolsAnchor = '\n                  <div className="sentence-reading-tools">';
    const sentenceToolsStart = source.indexOf(sentenceToolsAnchor, sentenceBlockStart);
    if (sentenceBlockStart < 0 || sentenceToolsStart < 0) throw new Error('Sentence stage layout seam changed');

    source = source.slice(0, sentenceBlockStart) + `                  <div className="vantilo-sentence-stage">
                    <button className="vantilo-sentence-arrow" type="button" aria-label="上一句" disabled={sentenceIndex <= 0} onClick={() => moveSentence(-1)}>‹</button>
` + source.slice(sentenceBlockStart);

    const updatedToolsStart = source.indexOf(sentenceToolsAnchor, sentenceBlockStart);
    const sentenceBlockClose = source.lastIndexOf('\n                  </div>', updatedToolsStart);
    if (updatedToolsStart < 0 || sentenceBlockClose < sentenceBlockStart) throw new Error('Sentence stage closing seam changed');
    source = source.slice(0, sentenceBlockClose) + `
                  </div>
                    <button className="vantilo-sentence-arrow" type="button" aria-label={sentenceIndex >= articleSentences.length - 1 ? "完成阅读并返回上一页" : "下一句"} onClick={() => sentenceIndex >= articleSentences.length - 1 ? onBack() : moveSentence(1)}>›</button>
                  </div>` + source.slice(sentenceBlockClose + '\n                  </div>'.length);

    const translationStart = source.indexOf('                  <div className="sentence-reading-tools">', sentenceBlockStart);
    const translationButtonEnd = source.indexOf('\n                  </div>', translationStart);
    if (translationStart < 0 || translationButtonEnd < 0) throw new Error('Sentence translation button seam changed');
    const translationMarkup = source.slice(translationStart, translationButtonEnd);
    const translationButton = /<button className="sentence-translation-toggle"[\s\S]*?<\/button>/.exec(translationMarkup);
    if (!translationButton) throw new Error('Sentence translation button markup changed');
    source = source.replace(translationButton[0], translationButton[0]
      .replace('aria-expanded={sentenceTranslationVisible}', 'aria-expanded={sentenceTranslationVisible} aria-keyshortcuts="T"')
      .replace('                      <span aria-hidden="true">译</span>{sentenceTranslationVisible ? "收起翻译" : "查看翻译"}<kbd aria-hidden="true">T</kbd>', '                      <span aria-hidden="true">译</span>'));

    const navStart = source.indexOf('                  <nav className="sentence-reading-nav" aria-label="逐句导航">');
    const hintEndMarker = '                  <p className="sentence-reading-hint">← → 切换句子<span>·</span>T 查看翻译<span>·</span>点击单词查词</p>';
    const hintEnd = source.indexOf(hintEndMarker, navStart);
    if (navStart < 0 || hintEnd < 0) throw new Error('Sentence footer navigation seam changed');
    source = source.slice(0, navStart) + source.slice(hintEnd + hintEndMarker.length);
    source += '\n' + readFileSync(new URL('./reader-sentence-appearance.tsx', import.meta.url), 'utf8');
  }
  if (filename.endsWith('/frontend/App.tsx') && source.includes('function WordLookupCard(')) {
    const vocabularyPanelSeam = '<aside className={`vocabulary-panel ${panelClassName ?? ""}`.trim()} data-testid="vocabulary-panel">';
    if (source.split(vocabularyPanelSeam).length !== 2) throw new Error('Reader vocabulary panel seam changed');
    source = source.replace(vocabularyPanelSeam,
      '<aside className={`vocabulary-panel ${panelClassName ?? ""}`.trim()} data-testid="vocabulary-panel" onMouseLeave={detailLookup ? onCloseDetail : undefined}>');
    const wordDetailState = '  const [wordDetailLookup, setWordDetailLookup] = useState<ActiveWordLookup | null>(null);';
    if (source.split(wordDetailState).length !== 2) throw new Error('Reader word detail state seam changed');
    source = source.replace(wordDetailState, wordDetailState + `
  useEffect(() => {
    if (!wordDetailLookup) return;
    const closeWordDetailOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-testid="vocabulary-panel"]')) return;
      setWordDetailLookup(null);
    };
    document.addEventListener("pointerdown", closeWordDetailOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeWordDetailOnOutsidePointer, true);
  }, [wordDetailLookup]);
`);
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
    const oldAutostart = translationPreview ? '    if (!vantiloContextMatches(cachedContext) || !hasEnglishWordContext(cachedContext!)) {' : '    if (!cachedContext || !hasEnglishWordContext(cachedContext)) {';
    if(source.split(oldAutostart).length !== 2)throw new Error('Old automatic Agent word context seam changed');
    source=source.replace(oldAutostart,translationPreview ? '    if (false && (!vantiloContextMatches(cachedContext) || !hasEnglishWordContext(cachedContext!))) {' : '    if (false && (!cachedContext || !hasEnglishWordContext(cachedContext))) {');
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
    source = source.replace(toolbar, toolbar + `\n          <button className="toolbar-button vantilo-discovery-entry" type="button" aria-label="发现好书" title="发现好书" onClick={() => window.parent.postMessage({type:"vantilo:open-discovery",token:(window as Window & {__vantiloGrowthToken?:string}).__vantiloGrowthToken,documentId:(window as Window & {__vantiloGrowthDocumentId?:string}).__vantiloGrowthDocumentId,bookId:(window as Window & {__vantiloGrowthBookId?:string}).__vantiloGrowthBookId,pageId:(window as Window & {__vantiloGrowthPageId?:string}).__vantiloGrowthPageId}, "*")}>▧ <span>发现好书</span></button>`);
  }
  if (filename.endsWith('/frontend/App.tsx') && source.includes('function BookContinueCard(')) {
    const signature = 'function BookContinueCard({ book, item, onContinue }: { book: BookSummary; item: ReadingEntryView; onContinue: () => void }) {';
    const renderCall = '<BookContinueCard key={bookContinue.key} book={continueBook} item={bookContinue} onContinue={() => openReadingEntry(bookContinue.entry)} />';
    if (source.split(signature).length !== 2 || source.split(renderCall).length !== 2) throw new Error('Book continue progress seam changed');
    source = source.replace(signature, `function BookContinueCard({ book, item, onContinue, chapterProgress }: { book: BookSummary; item: ReadingEntryView; onContinue: () => void; chapterProgress: Record<string, number> }) {
  const bookPrefix = \`reading:book:\${book.id}:\`;
  const summedChapterProgress = Object.entries(chapterProgress)
    .filter(([documentId]) => documentId.startsWith(bookPrefix))
    .reduce((sum, [, value]) => sum + Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)), 0);
  const wholeBookProgress = item.category === "电子书"
    ? Math.round(summedChapterProgress / Math.max(1, book.readableUnitCount))
    : item.progress;`);
    const progressMarkup = '<div className="continue-progress"><ProgressBar value={item.progress} /><span>{item.progress}%</span></div>';
    if (source.split(progressMarkup).length !== 2) throw new Error('Book continue progress display seam changed');
    source = source.replace(progressMarkup, '<div className="continue-progress"><ProgressBar value={wholeBookProgress} /><span>{wholeBookProgress}%</span></div>');
    source = source.replace(renderCall, '<BookContinueCard key={bookContinue.key} book={continueBook} item={bookContinue} chapterProgress={readerState.bookProgress} onContinue={() => openReadingEntry(bookContinue.entry)} />');
  }
  if (filename.endsWith('/frontend/App.tsx') && source.includes('continueCard={magazineContinue ? <GlobalContinueCard')) {
    const card = '<GlobalContinueCard item={magazineContinue} onOpen={openReadingEntry}';
    const fallback = '<ProgressBar value={currentArticle.progress} /><span>{currentArticle.progress}%</span>';
    if (source.split(card).length !== 2 || source.split(fallback).length !== 2) throw new Error('Magazine issue progress seam changed');
    source = source.replace(card, '<GlobalContinueCard item={{...magazineContinue, progress: continueIssue?.progress ?? magazineContinue.progress}} onOpen={openReadingEntry}')
      .replace(fallback, '<ProgressBar value={current.progress} /><span>本期 {current.progress}%</span>');
  }
  if (filename.endsWith('/frontend/global-navigation.tsx')) {
    const nav = '<div className="global-nav-primary">{items.filter(item => primaryIds.includes(item.id)).map(item => renderItem(item))}</div>';
    if (source.split(nav).length !== 2) throw new Error('Global navigation discovery insertion seam changed');
    source = source.replace(nav, '<div className="global-nav-primary">{items.filter(item => primaryIds.includes(item.id)).map(item => renderItem(item))}<button className="global-nav-link vantilo-discovery-link" type="button" aria-label="发现好书" onClick={() => window.parent.postMessage({type:"vantilo:open-discovery",token:(window as Window & {__vantiloGrowthToken?:string}).__vantiloGrowthToken,documentId:(window as Window & {__vantiloGrowthDocumentId?:string}).__vantiloGrowthDocumentId,bookId:(window as Window & {__vantiloGrowthBookId?:string}).__vantiloGrowthBookId,pageId:(window as Window & {__vantiloGrowthPageId?:string}).__vantiloGrowthPageId}, "*")}><span>发现好书</span></button></div>');
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
