import {readFileSync} from 'node:fs';
export function adaptCatalogPreview(source,filename) {
  const exact=(a,b)=>{if(source.split(a).length!==2)throw new Error('Catalog seam changed: '+a.slice(0,90));source=source.replace(a,b);};
  if(filename.endsWith('/server/app.ts')) {
    source=source.replaceAll('if (readerGuideAvailable() || sectionTranslationAvailable())','if (false)');
    source=source.replaceAll('if (result.status === "imported" && result.issueId && (readerGuideAvailable() || sectionTranslationAvailable()))','if (false)');
    return source;
  }
  if(filename.endsWith('/frontend/global-navigation.tsx')) {
    // Use Vantilo's existing colored Codex mark in the Reader assistant control.
    const reactImport='import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";';
    exact(reactImport,reactImport+'\nimport codexIcon from '+JSON.stringify(new URL('../src/ui/vendor-icons/codex.svg',import.meta.url).pathname)+';');
    const assistantSvg='<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="m9 9-2 2 2 2m6-4 2 2-2 2"/></svg>';
    exact(assistantSvg,'<img src={codexIcon} alt="" aria-hidden="true" width="20" height="20" draggable={false}/>');
    // The desktop rail owns the single settings entry, including on small screens.
    const button='          <button className={`global-nav-icon${page === "settings" ? " is-active" : ""}`} aria-label="设置" title="设置" onClick={() => navigate("settings")}><NavIcon name="settings" /></button>\n';
    exact(button,'');
    return source;
  }
  if(filename.endsWith('/frontend/api.ts')) {
    // Reads now use the explicitly generated directory cache, with legacy fallback.
    exact('return request<BookTocChineseStatus>(`/api/books/${encodeURIComponent(bookId)}/toc-chinese`);',
      'return request<BookTocChineseStatus>(`/api/vantilo-catalog/book/${encodeURIComponent(bookId)}`);');
    exact('return request<IssueRecord>(`/api/issues/${encodeURIComponent(issueId)}`);',
      `return request<IssueRecord>('/api/issues/'+encodeURIComponent(issueId)).then(async issue=>{
        try {const record=await request<any>('/api/vantilo-catalog/issue/'+encodeURIComponent(issueId));
          if(record.state==='ready'&&!record.legacy)return {...issue,sectionTranslations:{...issue.sectionTranslations,...record.titles.sections},articles:issue.articles.map(article=>record.titles.articles[article.id]?{...article,readerGuide:{...article.readerGuide,titleZh:record.titles.articles[article.id],subtitleZh:article.readerGuide?.subtitleZh??null,summaryZh:article.readerGuide?.summaryZh??'',model:record.model,provider:'vantilo-agent',generatedAt:record.generatedAt} as any}:article)};
        }catch{}return issue;
      });`);
    return source;
  }
  if(filename.endsWith('/frontend/styles.css'))return source+`
.vantilo-update-settings {margin:20px 0;}
.vantilo-update-settings p {font-size:14px;line-height:1.7;}
.vantilo-update-settings small {display:block;line-height:1.6;margin-top:12px;color:var(--ui-muted,#666);}
.vantilo-update-toggle {display:flex;align-items:center;gap:10px;margin:14px 0;}
.vantilo-update-error {color:#b22;}

.vantilo-catalog-control {margin:16px 0;padding:16px;border:1px solid var(--ui-line,#ddd);border-radius:12px;background:var(--ui-soft,#faf9f5);color:var(--ui-ink,#222);}
.vantilo-catalog-control p {font-size:13px;line-height:1.6;margin:8px 0;color:var(--ui-muted,#666);}
.vantilo-catalog-picker label {display:flex;flex-wrap:wrap;align-items:center;gap:12px;font-size:14px;}
.vantilo-catalog-picker select {font:inherit;color:inherit;background:var(--ui-surface,#fff);border:1px solid var(--ui-line,#ccc);border-radius:7px;padding:6px 9px;max-width:100%;}
.vantilo-custom-api-settings>label {display:grid;gap:6px;margin:12px 0;font-size:13px;}
.vantilo-custom-api-settings input,.vantilo-custom-api-settings select {font:inherit;color:inherit;background:var(--ui-surface,#fff);border:1px solid var(--ui-line,#ccc);border-radius:7px;padding:9px 11px;max-width:720px;}
.vantilo-custom-api-settings .settings-help {max-width:850px;line-height:1.65;}
.vantilo-custom-api-actions {display:flex;gap:9px;flex-wrap:wrap;margin:14px 0;}
.vantilo-custom-api-actions button {border:1px solid var(--ui-line,#ccc);border-radius:8px;padding:9px 14px;background:var(--ui-surface,#fff);color:inherit;cursor:pointer;font:inherit;}
.vantilo-custom-api-actions button:disabled {opacity:.55;cursor:wait;}
.vantilo-custom-api-error {color:#b22;}


.reader-toolbar-menu {position:relative;flex:0 0 auto;}
.reader-toolbar-menu > summary {list-style:none;cursor:pointer;}
.reader-toolbar-menu > summary::-webkit-details-marker {display:none;}
.reader-toolbar-menu-panel {position:absolute;top:calc(100% + 6px);right:0;z-index:50;min-width:188px;max-height:min(70vh,480px);overflow:auto;padding:6px;display:grid;gap:3px;border:1px solid var(--ui-line,#d9d6cf);border-radius:10px;background:var(--ui-surface,#fff);box-shadow:0 12px 32px rgba(0,0,0,.18);}
.reader-toolbar-menu-panel > .toolbar-button {width:100%;min-height:38px;flex:0 0 auto;justify-content:flex-start;white-space:nowrap;text-align:left;}
.reader-toolbar-menu-panel > .toolbar-button span {display:inline!important;white-space:nowrap;}
.reader-page-shell .reader-toolbar-actions:has(.reader-toolbar-menu[open]) {overflow:visible;}
.reader-page-shell .reader-toolbar-actions > .vantilo-reader-translation-action {flex:0 0 auto;white-space:nowrap;}
.reader-page-shell .reader-toolbar-center .vantilo-reader-exit-chinese {display:none;}

/* Keep the article toolbar readable when its many actions share one row. */
@media (min-width:1081px) {
  .reader-page-shell .reader-toolbar {grid-template-columns:minmax(220px,1fr) auto minmax(0,2fr);gap:clamp(8px,1vw,18px);}
  .reader-page-shell .reader-toolbar-left {min-width:0;}
  .reader-page-shell .reader-toolbar-center {white-space:nowrap;}
  .reader-page-shell .reader-toolbar-actions {min-width:0;flex-wrap:nowrap;gap:clamp(4px,.45vw,9px);overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;}
  .reader-page-shell .reader-toolbar-actions::-webkit-scrollbar {display:none;}
  .reader-page-shell .reader-toolbar-actions > .toolbar-button {flex:0 0 auto;white-space:nowrap;}
  .reader-page-shell .reader-toolbar-actions > .toolbar-button span {white-space:nowrap;}
}
.vantilo-catalog-import {padding:12px 20px;display:grid;gap:12px;border-bottom:1px solid var(--ui-line,#ddd);}
`;
  if(!filename.endsWith('/frontend/App.tsx'))return source;
  exact('  const [assistantOpen, setAssistantOpen] = useState(() => window.matchMedia("(min-width: 1151px)").matches);',
    '  const [assistantOpen, setAssistantOpen] = useState(false);');
  source=source.replaceAll('所有杂志共用一套阅读偏好与 AI 服务配置。这里集中管理阅读辅助、外观、发音、数据备份和模型连接。','管理阅读环境、杂志与软件更新、外观、数据备份和自定义 API。').replaceAll('阅读偏好在浏览器 · AI 配置在本机','阅读偏好保存在本机 · 翻译模型独立选择');
  exact('    { id: \"settings\", label: \"设置\", icon: \"⚙\" },\n','');
  const modeSwitchEnd='          </div>\n        </div>\n        <div className=\"reader-toolbar-actions\">';
  exact(modeSwitchEnd,'          </div>\n          {readerLanguage === \"chinese\" && <button className=\"toolbar-button vantilo-reader-exit-chinese\" aria-label=\"退出中文阅读并返回英文原文\" title=\"退出中文阅读，返回对应英文段落\" onClick={toggleChineseReader}>返回英文</button>}\n        </div>\n        <div className=\"reader-toolbar-actions\">');
  // Keep directory, translation, Codex and a compact More menu on the article toolbar.
  const toolbarStart=source.indexOf('        <div className="reader-toolbar-actions">');
  const toolbarEnd=source.indexOf('\n        </div>\n      </div>',toolbarStart);
  if(toolbarStart<0||toolbarEnd<0)throw new Error('Reader toolbar boundaries changed');
  let actions=source.slice(toolbarStart,toolbarEnd);
  function take(start,end){
    const from=actions.indexOf(start);if(from<0)throw new Error('Toolbar action missing: '+start.slice(0,65));
    const at=actions.indexOf(end,from);if(at<0)throw new Error('Toolbar action end missing: '+end.slice(0,40));
    const stop=at+end.length,chunk=actions.slice(from,stop);actions=actions.slice(0,from)+actions.slice(stop);return chunk;
  }
  const readLater=take('          {(\n            <button\n              className={`toolbar-button reader-focus-hidden ${queuedForLater','          )}');
  const jumpBack=take('          {jumpBackTarget && (','          )}');
  const chinese=take('          {<button className={`toolbar-button reader-chinese-button','</button>}')
    .replaceAll('reader-chinese-button','reader-chinese-button vantilo-reader-translation-action')
    .replaceAll('中文阅读','听书版')
    .replace('{readerLanguage === "chinese" ? "A" : "中"}','');
  const full=take('          <button\n            className={`toolbar-button reader-full-translation-button','          </button>')
    .replaceAll('reader-full-translation-button','reader-full-translation-button vantilo-reader-translation-action')
    .replace(': fullArticleTranslationExpanded ? "译文" : "全文"', ': "全文翻译"')
    .replace(': fullArticleTranslationExpanded ? "收" : "译"}', ': fullArticleTranslationExpanded ? "收" : ""}');
  const sourceButton=take('          {issue.kind === "book" && <BookSourceButton','\n');
  const learning=take('          {onOpenLearning && <button','\n');
  const notes=take('          <button className={`toolbar-button ${drawer === "notes"','\n');
  const find=take('          <button\n            className={`toolbar-button reader-find-button','</button>');
  const shortcuts=take('          <button\n            className={`toolbar-button reader-shortcuts-button','</button>');
  const immersion=take('          <button\n            className={`toolbar-button reader-focus-toggle','</button>');
  const vocabulary=take('          <button className={`toolbar-button reader-focus-hidden mobile-vocabulary-button','</button>');
  const tocEnd='>☰ <span>目录</span></button>';
  if(!actions.includes(tocEnd))throw new Error('Table of contents toolbar action changed');
  const menus=`
          <details className="reader-toolbar-menu reader-more-menu" onClick={(event)=>{if((event.target as HTMLElement).closest(".reader-toolbar-menu-panel button"))event.currentTarget.open=false;}}>
            <summary className="toolbar-button reader-toolbar-menu-trigger" aria-label="更多阅读操作">⋯ <span>更多</span></summary>
            <div className="reader-toolbar-menu-panel" aria-label="更多阅读操作">${readLater}${jumpBack}${notes}${find}${shortcuts}${immersion}${sourceButton}${learning}${vocabulary}</div>
          </details>`;
  actions=actions.replace(tocEnd,tocEnd+chinese+full+menus);
  source=source.slice(0,toolbarStart)+actions+source.slice(toolbarEnd);
  const settingsStart=source.indexOf('function SettingsPage('),settingsEnd=source.indexOf('\nexport default function App',settingsStart+10);
  if(settingsStart<0||settingsEnd<0)throw new Error('Settings boundaries changed');
  let settings=source.slice(settingsStart,settingsEnd);
  const grid='      <div className="settings-grid">';
  if(settings.split(grid).length!==2)throw new Error('Settings grid seam changed');
  settings=settings.replace(grid,'      <VantiloUpdateSettings/>\n'+grid);
  source=source.slice(0,settingsStart)+settings+source.slice(settingsEnd);
  exact('        <DataManagementPanel />','        <VantiloCustomApiSettings/>\n\n        <DataManagementPanel />');
  exact('export default function App() {',`export default function App() {
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.source!==window.parent||!['null','file://','http://127.0.0.1:5173'].includes(event.origin))return;
      if(event.data?.type==='vantilo:navigate'&&['settings','library'].includes(event.data.target)){if(event.data.target==='settings')setAssistantOpen(false);handleNav(event.data.target);}
    };
    window.addEventListener('message',receive);
    if(window.parent!==window)window.parent.postMessage({type:'vantilo:reader-ready'},'*');
    return ()=>window.removeEventListener('message',receive);
  },[]);`);
  // Opening a document is a read, never permission to translate.
  const autoStart=`        if (status.state === "idle") {
          try {
            const started = await generateBookTocChinese(bookId);
            if (active) setBookTocStatus(started);
          } catch (error) {
            if (active) setBookTocError(error instanceof Error ? error.message : "中文目录生成不可用");
          }
        }`;
  exact(autoStart,'        // Chinese directory generation requires the explicit catalog button.');
  source=source.replaceAll(/    void prepare(?:Guides|Sections)\((?:issueId|found\.issue\.id)\);/g,'    // No automatic model tasks when opening issues or articles.');
  exact('    const bookId = selectedBookRecord.id;\n    const initialize = async () => {', '    const bookId = selectedBookRecord.id;\n    const initialize = async () => {');
  const initEffect='  useEffect(() => {\n    if (!selectedBookRecord) return;\n    let active = true;\n    const bookId = selectedBookRecord.id;';
  exact(initEffect,`  useEffect(()=>{
    const changed=(event:Event)=>{const detail=(event as CustomEvent).detail;
      if(detail?.kind==='issue')void fetchIssue(detail.id).then(updated=>setRecords(items=>items.map(item=>item.id===detail.id?updated:item))).catch(()=>{});
      if(detail?.kind==='book'&&detail.id===selectedBookRecord?.id)void fetchBookTocChinese(detail.id).then(setBookTocStatus).catch(()=>{});
    };
    window.addEventListener('vantilo-catalog-updated',changed);return ()=>window.removeEventListener('vantilo-catalog-updated',changed);
  },[selectedBookRecord?.id]);
`+initEffect);
  // Append new issues to current Reader state without remounting the iframe,
  // resetting a reading position, or submitting any model work.
  exact('  const [records, setRecords] = useState<IssueRecord[]>([]);', `  const [records, setRecords] = useState<IssueRecord[]>([]);
  useEffect(()=>{
    let active=true,pending=false;
    const refreshNewIssues=async()=>{
      if(pending||document.visibilityState==='hidden')return;
      pending=true;
      try{
        const summaries=await fetchIssues();if(!active)return;
        const added=summaries.filter(summary=>!records.some(record=>record.id===summary.id));
        if(!added.length)return;
        const loaded=await Promise.all(added.map(summary=>fetchIssue(summary.id)));
        if(active)setRecords(current=>[...current,...loaded.filter(record=>!current.some(item=>item.id===record.id))]);
      }catch{}finally{pending=false;}
    };
    void refreshNewIssues();
    const timer=window.setInterval(()=>void refreshNewIssues(),15000);
    const focus=()=>void refreshNewIssues();window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
    return ()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
  },[records]);`);
  // Import remains successful even if an explicitly requested translation fails.
  const bookStart=source.indexOf('function BookEpubImportControl('),bookEnd=source.indexOf('\nfunction BookContinueCard(',bookStart);
  let book=source.slice(bookStart,bookEnd);
  book=book.replace('  const readyCount = items.filter((item) => item.preview.status === "ready").length;\n  const importedCount = items.filter((item) => item.preview.status === "imported").length;\n\n  function closeDialog()',
    `  const [vantiloGenerateCatalog,setVantiloGenerateCatalog]=useState(false);
  const [vantiloImportEngine,setVantiloImportEngine]=useState('');
  const [vantiloImportModelBusy,setVantiloImportModelBusy]=useState(false);
  const readyCount = items.filter((item) => item.preview.status === "ready").length;
  const importedCount = items.filter((item) => item.preview.status === "imported").length;

  function closeDialog()`);

  book=book.replace('    setOpen(true);','    setOpen(true);setVantiloGenerateCatalog(false);');
  book=book.replace('    if (!readyCount || importing) return;',"    if (!readyCount || importing || vantiloImportModelBusy) return;\n    if(vantiloGenerateCatalog&&!vantiloImportEngine){setError('请先选择目录翻译模型');return;}");
  book=book.replace('        if (result.status === "imported") imported += 1;',`        if (result.status === "imported") {
          imported += 1;
          if(vantiloGenerateCatalog&&result.bookId) {
            try {let generated;do{generated=await vantiloCatalogRequest('/api/vantilo-catalog/book/'+encodeURIComponent(result.bookId),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({engineId:vantiloImportEngine,regenerate:false})});}while(generated.state==='pending');}
            catch(e){setError('书籍已成功导入；中文目录未生成：'+(e instanceof Error?e.message:'请在目录页重试'));}
          }
        }`);
  book=book.replace('            {preparing ? (',`            <section className="vantilo-catalog-import" aria-label="导入时的目录翻译设置">
              <label><input type="radio" name="vantilo-import-mode" checked={!vantiloGenerateCatalog} disabled={importing} onChange={()=>setVantiloGenerateCatalog(false)}/>仅导入（保留英文目录）</label>
              <label><input type="radio" name="vantilo-import-mode" checked={vantiloGenerateCatalog} disabled={importing} onChange={()=>setVantiloGenerateCatalog(true)}/>导入并生成中文目录</label>
              {vantiloGenerateCatalog&&<VantiloCatalogPicker value={vantiloImportEngine} onChange={setVantiloImportEngine} disabled={importing} onBusy={setVantiloImportModelBusy}/>}
              <small>目录模型单独保存，不跟随助手或正文翻译模型；千问在本机运行；选择 GPT 时需要登录 ChatGPT。</small>
            </section>
            {preparing ? (`);
  book=book.replace('disabled={preparing || importing} onClick={() => void confirmImport()}', 'disabled={preparing || importing || vantiloImportModelBusy || (vantiloGenerateCatalog&&!vantiloImportEngine)} onClick={() => void confirmImport()}');
  book=book.replace('`导入 ${readyCount} 本`','`${vantiloGenerateCatalog?"导入并生成中文目录":"仅导入"} ${readyCount} 本`');
  source=source.slice(0,bookStart)+book+source.slice(bookEnd);
  // Books display cached generation provenance and a direct model picker.
  exact('  const groups = buildBookTocGroups(book);','  const groups = buildBookTocGroups(book);');
  const detailStart=source.indexOf('function BookDetailPage('),detailEnd=source.indexOf('\nfunction ',detailStart+10);
  let detail=source.slice(detailStart,detailEnd);
  detail=detail.replace('  if (loading) return',"  const [vantiloBookCatalog,setVantiloBookCatalog]=useState<any>(null);\n  useEffect(()=>setVantiloBookCatalog(null),[book?.id]);\n  if (loading) return");
  detail=detail.replace('const tocTitles = tocStatus?.titles;',"const tocTitles = vantiloBookCatalog?.state==='ready'?vantiloBookCatalog.titles:tocStatus?.titles;");
  const barStart=detail.indexOf('        <div className="book-toc-status"'),barEnd=detail.indexOf('\n        {groups.map',barStart);
  if(barStart<0||barEnd<0)throw new Error('Book catalog status boundaries changed');
  detail=detail.slice(0,barStart)+'        <VantiloCatalogControl key={book.id} kind="book" id={book.id} onResolved={setVantiloBookCatalog}/>\n'+detail.slice(barEnd);
  source=source.slice(0,detailStart)+detail+source.slice(detailEnd);
  // Magazine title overlays do not replace historical summaries or edit source files.
  exact('  const articles = flattenArticles(issue);\n  const continueArticle = resolveIssueContinueArticle(issue, lastPosition);',`  const [vantiloIssueCatalog,setVantiloIssueCatalog]=useState<any>(null);
  useEffect(()=>setVantiloIssueCatalog(null),[issue.id]);
  if(vantiloIssueCatalog?.state==='ready')issue={...issue,sections:issue.sections.map(section=>({...section,nameZh:vantiloIssueCatalog.titles.sections[section.name]??section.nameZh,articles:section.articles.map(article=>({...article,titleZh:vantiloIssueCatalog.titles.articles[article.id]??article.titleZh}))}))};
  const articles = flattenArticles(issue);
  const continueArticle = resolveIssueContinueArticle(issue, lastPosition);`);
  const issueStart=source.indexOf('function IssuePage('),issueEnd=source.indexOf('\nfunction ',issueStart+10);let issue=source.slice(issueStart,issueEnd);
  const statusStart=issue.indexOf('          <div className="guide-status-group">'),statusEnd=issue.indexOf('\n        </div>\n\n        <div className="issue-toc-search">',statusStart);
  if(statusStart<0||statusEnd<0)throw new Error('Magazine catalog status boundaries changed');
  issue=issue.slice(0,statusStart)+issue.slice(statusEnd);
  issue=issue.replace('        <div className="issue-toc-search">','        <VantiloCatalogControl key={issue.id} kind="issue" id={issue.id} onResolved={setVantiloIssueCatalog}/>\n        <div className="issue-toc-search">');
  issue=issue.replace('中文标题准备中…','保留英文标题；可在上方生成中文目录');
  source=source.slice(0,issueStart)+issue+source.slice(issueEnd);
  source+='\n'+readFileSync(new URL('../src/reader/custom-api-settings.tsx',import.meta.url),'utf8');
  source+='\n'+readFileSync(new URL('./reader-catalog-controls.tsx',import.meta.url),'utf8');
  source+='\n'+readFileSync(new URL('./reader-update-settings.tsx',import.meta.url),'utf8');
  return source;
}
