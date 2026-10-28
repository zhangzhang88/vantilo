import format from '../electron/reader-translation-format.cjs';
const {normalizeTranslation}=format;
const localId='qwen:qwen3.5-4b-mlx-4bit@32f3e8ecf65426fc3306969496342d504bfa13f3';
export function adaptTranslationPreview(source,filename) {
  const exact=(a,b)=>{if(source.split(a).length!==2)throw new Error('Translation seam changed: '+a.slice(0,100));source=source.replace(a,b);};
  if(filename.endsWith('/frontend/paragraph-translation-state.ts')) {
    // Existing records stay in their original key and are never promoted without provenance.
    source=source.replace('provider: "easycliproxy"','provider: "easycliproxy" | "qwen-mlx" | "qwen-gguf" | "vantilo-agent" | "custom-api"');
    source=source.replace('item.provider === "easycliproxy"','["easycliproxy", "qwen-mlx", "qwen-gguf", "vantilo-agent", "custom-api"].includes(item.provider ?? "")');
    exact('      .filter(isParagraphTranslationRecord)',
      '      .filter(isParagraphTranslationRecord)\n      .filter((item:any) => ["qwen-mlx","qwen-gguf"].includes(item.provider) ? item.translationZh.length <= 80000 : normalizeTranslation(item.translationZh,item.sourceText) !== null)');
    exact('const stored = item as ParagraphTranslationRecord',
      'const stored = { ...item, translationZh: ["qwen-mlx","qwen-gguf"].includes(item.provider) ? item.translationZh : normalizeTranslation(item.translationZh,item.sourceText)! } as ParagraphTranslationRecord');
    return source+'\n'+normalizeTranslation.toString();
  }
  if(filename.endsWith('/frontend/sentence-translation-state.ts')) {
    const provider='provider: "easycliproxy" | "learning-material";';
    if(!source.includes(provider))throw new Error('Sentence provider seam changed');
    source=source.replace(provider,'provider: "easycliproxy" | "learning-material" | "vantilo-agent" | "qwen-mlx" | "qwen-gguf" | "custom-api";\n  engineId?: string;');
    const accepted='(item.provider === "easycliproxy" || item.provider === "learning-material")';
    if(!source.includes(accepted))throw new Error('Sentence cache validation seam changed');
    return source.replace(accepted,'(item.provider === "easycliproxy" || item.provider === "learning-material" || item.provider === "vantilo-agent" || item.provider === "qwen-mlx" || item.provider === "qwen-gguf" || item.provider === "custom-api")');
  }
  if(filename.endsWith('/frontend/styles.css'))return source+`
.reader-page-shell {--vantilo-translation-bar-top:62px;--vantilo-translation-bar-height:66px;}
.reader-page-shell.is-focus-mode {--vantilo-translation-bar-top:48px;}
.vantilo-translation-bar {position:sticky;top:var(--vantilo-translation-bar-top);z-index:29;display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:8px 20px;background:var(--ui-surface,#f7f6f2);color:var(--ui-ink,#222);border-bottom:1px solid var(--ui-line,#d9d6cf);font-size:13px;}
.reader-page-shell.is-chinese-mode .chinese-player {top:calc(var(--vantilo-translation-bar-top) + var(--vantilo-translation-bar-height) + 12px);}
@media(max-width:640px){.reader-page-shell{--vantilo-translation-bar-height:78px;}}
.vantilo-translation-engine {display:flex;align-items:center;gap:10px;white-space:nowrap;}
.vantilo-translation-engine select {max-width:min(330px,55vw);padding:5px 8px;border:1px solid var(--ui-line,#ccc);border-radius:7px;background:var(--ui-soft,#fff);color:inherit;font:inherit;}
.vantilo-translation-note {font-size:12px;color:var(--ui-muted,#666);line-height:1.5;}
.reader-page-shell.is-focus-mode .vantilo-translation-bar {top:var(--vantilo-translation-bar-top);}
.reader-page-shell .vantilo-sentence-provenance {display:block;margin:5px 0 8px;color:var(--ui-muted,#777);font-size:11px;}
.reader-page-shell .vantilo-sentence-heading,.reader-page-shell .vantilo-expression-row {display:flex;align-items:center;justify-content:space-between;gap:12px;}
.reader-page-shell .vantilo-sentence-heading {margin-bottom:10px;}
.reader-page-shell .vantilo-sentence-heading > span {color:var(--sentence-muted,#777);font:800 10px/1.4 Inter,"PingFang SC",sans-serif;letter-spacing:.1em;}
.reader-page-shell .vantilo-expression-row {margin-top:18px;padding-top:12px;border-top:1px solid var(--sentence-line,#d9d6cf);}
.reader-page-shell .vantilo-expression-row .sentence-expression-details {flex:1;min-width:0;margin:0;}
.reader-page-shell .vantilo-expression-row > span {color:var(--sentence-muted,#777);font:700 12px/1.4 Inter,"PingFang SC",sans-serif;}
.reader-page-shell .vantilo-sentence-heading .text-button,.reader-page-shell .vantilo-expression-row .text-button {flex:none;padding:4px 0;color:var(--sentence-accent,#806825);font:600 12px/1.4 Inter,"PingFang SC",sans-serif;white-space:nowrap;}
.reader-page-shell .vantilo-sentence-heading .text-button:disabled,.reader-page-shell .vantilo-expression-row .text-button:disabled {opacity:.45;cursor:default;}
`;
  if(!filename.endsWith('/frontend/App.tsx'))return source;
  const sentenceStateAnchor='  const [sentenceTranslationRecords, setSentenceTranslationRecords]';
  const sentenceStateIndex=source.indexOf(sentenceStateAnchor);
  if(sentenceStateIndex<0)throw new Error('Sentence state seam changed');
  source=source.slice(0,sentenceStateIndex)+`  const [vantiloEngine, setVantiloEngine] = useState(()=>{
    let saved:string|null=null;try{saved=getReaderStorage().getItem('vantilo-translation-engine-v1');}catch{}
    return saved===${JSON.stringify(localId)} || /^custom-api:[a-f0-9]{12}$/.test(saved||'') || /^codex:[a-zA-Z0-9._-]{1,128}$/.test(saved||'') ? saved! : ${JSON.stringify(localId)};
  });
  const vantiloEngineRef=useRef(vantiloEngine);vantiloEngineRef.current=vantiloEngine;
  const [vantiloEngines,setVantiloEngines] = useState([{id:${JSON.stringify(localId)},label:'本地 Qwen3.5 4B'}]);
  const [vantiloEngineError,setVantiloEngineError] = useState('');
  const vantiloEpoch = useRef(0);
  const vantiloRequests = useRef(new Set<AbortController>());
  const vantiloSelectionRequest = useRef<AbortController|null>(null);
  const vantiloBusy = useRef(false);
  const [vantiloChunkProgress,setVantiloChunkProgress] = useState<{status:string;engineId:string|null;completedChunks:number;totalChunks:number;failedChunk?:number}|null>(null);
  const vantiloTranslationStorage = {
    getItem:(key:string)=>getReaderStorage().getItem(key+':vantilo-v2:'+vantiloEngine),
    setItem:(key:string,value:string)=>getReaderStorage().setItem(key+':vantilo-v2:'+vantiloEngine,value),
  };
  function cancelVantiloTranslation() {
    vantiloEpoch.current++;
    fullArticleTranslationRunRef.current++;
    for(const ctl of vantiloRequests.current)ctl.abort();
    vantiloRequests.current.clear();vantiloBusy.current=false;
    setVantiloChunkProgress(null);
    setFullArticleTranslationRunning(false);setFullArticleTranslationExpanded(false);setTranslations({});
    setSentenceTranslationRequests({});
  }
  function changeVantiloEngine(id:string) {
    cancelVantiloTranslation();
    setVantiloChunkProgress(null);
    vantiloEngineRef.current=id;
    setVantiloEngine(id);
    try{getReaderStorage().setItem('vantilo-translation-engine-v1',id);}catch{}
    window.dispatchEvent(new Event('vantilo-translation-engine-change'));
    setParagraphTranslationRecords(loadParagraphTranslations({getItem:key=>getReaderStorage().getItem(key+':vantilo-v2:'+id)}));
    setSentenceTranslationRecords(loadSentenceTranslations({getItem:key=>getReaderStorage().getItem(key+':vantilo-v2:'+id)}));
    setSentenceTranslationRequests({});
    setFullArticleTranslationExpanded(false);
  }
  useEffect(()=>{
    let ctl:AbortController|null=null;
    const load=()=>{ctl?.abort();ctl=new AbortController();setVantiloEngineError('');fetch('/api/vantilo-translation/engines',{signal:ctl.signal}).then(async r=>{if(!r.ok)throw new Error('无法读取引擎列表');return r.json();})
      .then(data=>{setVantiloEngines(data.engines);if(!data.engines.some((engine:any)=>engine.id===vantiloEngineRef.current))changeVantiloEngine(data.defaultId);})
      .catch(e=>{if(!ctl?.signal.aborted)setVantiloEngineError(e.message);});};
    load();window.addEventListener('vantilo-custom-api-updated',load);return ()=>{ctl?.abort();window.removeEventListener('vantilo-custom-api-updated',load);};
  },[]);
  useEffect(()=>{
    cancelVantiloTranslation();
    return ()=>{vantiloEpoch.current++;fullArticleTranslationRunRef.current++;for(const ctl of vantiloRequests.current)ctl.abort();};
  },[article.identity.documentId]);
  `+source.slice(sentenceStateIndex);
  const selectionState='  const [activeSelection, setActiveSelection] = useState<ActiveTextSelection | null>(null);';
  if(!source.includes(selectionState))throw new Error('Selection state seam changed');
  source=source.replace(selectionState,selectionState+'\n  useEffect(()=>()=>{vantiloSelectionRequest.current?.abort();},[activeSelection]);');
  const closeSelection='  function closeSelectionAssist() {\n';
  if(!source.includes(closeSelection))throw new Error('Selection close seam changed');
  source=source.replace(closeSelection,closeSelection+'    vantiloSelectionRequest.current?.abort();\n');
  // Translation history is partitioned by the exact engine/model selection.
  source=source.replaceAll('loadParagraphTranslations(getReaderStorage())','loadParagraphTranslations(vantiloTranslationStorage)');
  source=source.replaceAll('saveParagraphTranslations(getReaderStorage(), next)','saveParagraphTranslations(vantiloTranslationStorage, next)');
  source=source.replace('loadSentenceTranslations(getReaderStorage())','loadSentenceTranslations(vantiloTranslationStorage)');
  for(let i=0;i<5;i++)source=source.replace('saveSentenceTranslations(getReaderStorage(),','saveSentenceTranslations(vantiloTranslationStorage,');
  source=source.replace('loadSentenceTranslations(getReaderStorage()), target)','loadSentenceTranslations(vantiloTranslationStorage), target)');
  const start=source.indexOf('  async function ensureReadingTextTranslation('),end=source.indexOf('\n  async function ensureParagraphTranslation(',start);
  if(start<0||end<0)throw new Error('Translation boundaries changed');
  let part=source.slice(start,end);
  part=part.replace('    if (!isTranslatableText(text)) return false;','    if (!isTranslatableText(text) || vantiloBusy.current) return false;\n    const epoch=vantiloEpoch.current;\n    const ctl=new AbortController();\n    const requestEngineId=vantiloEngine;');
  part=part.replace('    try {\n      const result = await translateParagraph({\n        text,\n        contextBefore,\n        contextAfter,\n      });',`    vantiloBusy.current=true;vantiloRequests.current.add(ctl);
    const timer=window.setTimeout(()=>ctl.abort(),vantiloEngine.startsWith('qwen:')?600000:115000);
    const progressPoll=vantiloEngine.startsWith('qwen:')?window.setInterval(()=>{
      fetch('/api/vantilo-translation/progress',{signal:ctl.signal}).then(r=>r.ok?r.json():null).then(value=>{
        if(value&&epoch===vantiloEpoch.current&&value.engineId===requestEngineId)setVantiloChunkProgress(value);
      }).catch(()=>{});
    },700):null;
    try {
      const response = await fetch('/api/vantilo-translation/translate',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({text,engineId:requestEngineId}),signal:ctl.signal,
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'翻译失败');
      if(epoch!==vantiloEpoch.current || ctl.signal.aborted)return false;
      if(result.engineId!==requestEngineId)throw new Error('翻译引擎不匹配');
      if(result.chunkProgress)setVantiloChunkProgress({status:'complete',engineId:result.engineId,...result.chunkProgress});`);
  part=part.replace('    } catch (error) {','    } catch (error) {\n      if(epoch!==vantiloEpoch.current)return false;\n      if(vantiloEngineRef.current.startsWith(\'qwen:\'))fetch(\'/api/vantilo-translation/progress\').then(r=>r.ok?r.json():null).then(value=>{if(value?.engineId===requestEngineId)setVantiloChunkProgress(value);}).catch(()=>{});');
  part=part.replace('      return false;\n    }\n  }','      return false;\n    } finally {\n      window.clearTimeout(timer);if(progressPoll)window.clearInterval(progressPoll);vantiloRequests.current.delete(ctl);\n      if(epoch===vantiloEpoch.current)vantiloBusy.current=false;\n    }\n  }');
  if(!part.includes('/api/vantilo-translation/translate'))throw new Error('Translate request seam changed');
  source=source.slice(0,start)+part+source.slice(end);
  const sentenceStart=source.indexOf('  function toggleCurrentSentenceTranslation(');
  const sentenceEnd=source.indexOf('\n  async function saveCurrentSentenceExpression(',sentenceStart);
  if(sentenceStart<0||sentenceEnd<0)throw new Error('Sentence translation boundaries changed');
  let sentencePart=source.slice(sentenceStart,sentenceEnd);
  const requestStart=sentencePart.indexOf('    void translateParagraph({\n      mode: "sentence",');
  const requestEnd=sentencePart.indexOf('    }).then((result) => {',requestStart);
  if(requestStart<0||requestEnd<0)throw new Error('Sentence request seam changed');
  sentencePart=sentencePart.slice(0,requestStart)+`    const task = regenerate === "expressions" && currentSentenceTranslation ? "expressions" : regenerate === "translation" && currentSentenceTranslation ? "translation" : "both";
    const requestEngineId = vantiloEngine;
    const ctl=new AbortController();vantiloRequests.current.add(ctl);
    const responsePromise = fetch('/api/vantilo-translation/sentence',{
      method:'POST',headers:{'Content-Type':'application/json'},
      signal:ctl.signal,
      body:JSON.stringify({engineId:vantiloEngine,task,text:currentSentence.text,paragraphContext:paragraph,
        contextBefore:article.paragraphs[currentSentence.paragraphIndex-1],contextAfter:article.paragraphs[currentSentence.paragraphIndex+1],
        ...(paragraphTranslationReference?{paragraphTranslationReference}:{})}),
    }).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||'逐句翻译失败');if(body.engineId!==vantiloEngine)throw new Error('翻译引擎不匹配');return body;});
    void responsePromise.then((result) => {if(vantiloEngineRef.current!==requestEngineId)return;`+sentencePart.slice(requestEnd+'    }).then((result) => {'.length);
  sentencePart=sentencePart.replace('translationZh: regenerate === "expressions" ? previous?.translationZh ?? result.translation : result.translation,','translationZh: regenerate === "expressions" && previous ? previous.translationZh : result.translation,');
  sentencePart=sentencePart.replace('        provider: result.provider,\n        generatedAt:', '        provider: result.provider,\n        engineId: result.engineId,\n        generatedAt:');
  sentencePart=sentencePart.replace('saveSentenceTranslations(getReaderStorage(), nextRecords);','saveSentenceTranslations(vantiloTranslationStorage, nextRecords);');
  sentencePart=sentencePart.replace('    }).catch((error) => {','    }).catch((error) => {if(ctl.signal.aborted||vantiloEngineRef.current!==requestEngineId)return;');
  sentencePart=sentencePart.replace('    });\n  }','    }).finally(()=>vantiloRequests.current.delete(ctl));\n  }');
  source=source.slice(0,sentenceStart)+sentencePart+source.slice(sentenceEnd);
  const selectionRequest=`        const result = await translateParagraph({
          mode: "sentence",
          paragraphContext: activeSelection.context,
          text: sentenceRange.text,
          contextBefore: article.paragraphs[activeSelection.paragraphIndex - 1],
          contextAfter: article.paragraphs[activeSelection.paragraphIndex + 1],
        });`;
  if(!source.includes(selectionRequest))throw new Error('Selected sentence request seam changed');
  source=source.replace(selectionRequest,`        const requestEngineId=vantiloEngine;
        const selectionCtl=new AbortController();
        vantiloSelectionRequest.current?.abort();vantiloSelectionRequest.current=selectionCtl;vantiloRequests.current.add(selectionCtl);
        const result=await (async()=>{
          try {
            const response=await fetch('/api/vantilo-translation/sentence',{
              method:'POST',headers:{'Content-Type':'application/json'},signal:selectionCtl.signal,
              body:JSON.stringify({engineId:requestEngineId,task:'both',paragraphContext:activeSelection.context,text:sentenceRange.text,
                contextBefore:article.paragraphs[activeSelection.paragraphIndex-1],contextAfter:article.paragraphs[activeSelection.paragraphIndex+1]}),
            });
            const body=await response.json();
            if(!response.ok)throw new Error(body.error||'句子翻译失败');
            if(selectionCtl.signal.aborted||body.engineId!==requestEngineId||vantiloEngineRef.current!==requestEngineId)throw new DOMException('已取消','AbortError');
            return body;
          } finally {
            vantiloRequests.current.delete(selectionCtl);
            if(vantiloSelectionRequest.current===selectionCtl)vantiloSelectionRequest.current=null;
          }
        })();`);
  const selectionCatch='      } catch (error) {\n        setSelectionAssistState({';
  if(!source.includes(selectionCatch))throw new Error('Selection error seam changed');
  source=source.replace(selectionCatch,'      } catch (error) {\n        if(error instanceof Error && error.name === "AbortError"){selectionAssistRequestPendingRef.current=false;return;}\n        setSelectionAssistState({');
  const selectionRecord='          provider: result.provider,\n          generatedAt: new Date().toISOString(),';
  if(!source.includes(selectionRecord))throw new Error('Selected sentence provenance seam changed');
  source=source.replace(selectionRecord,'          provider: result.provider,\n          engineId: result.engineId,\n          generatedAt: new Date().toISOString(),');
  const consistencyStart=source.indexOf('      if (verifyConsistency && result.sentenceTranslationZh && meaningDocumentRef.current === occurrence.document.documentId) {');
  const consistencyEnd=source.indexOf('\n      return record;',consistencyStart);
  if(consistencyStart<0||consistencyEnd<0)throw new Error('Context gloss sentence cache seam changed');
  source=source.slice(0,consistencyStart)+source.slice(consistencyEnd);
  const provenanceSeam='                      {currentSentenceTranslation && <><p>{currentSentenceTranslation.translationZh}</p>';
  const provenanceIndex=source.indexOf(provenanceSeam);
  if(provenanceIndex<0)throw new Error('Sentence provenance seam changed');
  source=source.slice(0,provenanceIndex)+source.slice(provenanceIndex).replace(provenanceSeam,`                      {currentSentenceTranslation && <><small className="vantilo-sentence-provenance">{currentSentenceTranslation.model} · {["qwen-mlx","qwen-gguf"].includes(currentSentenceTranslation.provider) ? "本地 Qwen" : currentSentenceTranslation.provider === "custom-api" ? "自定义 API" : "Codex / ChatGPT"} · 已保存</small><p>{currentSentenceTranslation.translationZh}</p>`);
  const noExpressionsSeam='{currentSentenceTranslation && !currentSentenceTranslation.expressions?.length && <p className="muted-text">本句暂无需要单独学习的关键表达。</p>}';
  if(!source.includes(noExpressionsSeam))throw new Error('Sentence expression help seam changed');
  source=source.replace(noExpressionsSeam,'{currentSentenceTranslation && !currentSentenceTranslation.expressions?.length && <p className="muted-text">{["qwen-mlx","qwen-gguf"].includes(currentSentenceTranslation.provider) ? "本地 Qwen 当前只生成逐句译文；如需关键表达，请切换 GPT 后点击“重新推荐关键表达”。" : "本句暂无需要单独学习的关键表达。"}</p>}');
  const headingSeam='                      <span>句子翻译</span>';
  if(!source.includes(headingSeam))throw new Error('Sentence heading seam changed');
  source=source.replace(headingSeam,'                      <div className="vantilo-sentence-heading"><span>句子翻译</span>{currentSentenceTranslationRequest?.status === "loading" ? <button className="text-button" onClick={cancelVantiloTranslation}>停止</button> : <button className="text-button" onClick={() => toggleCurrentSentenceTranslation("translation")}>↻ {currentSentenceTranslation ? "重新翻译本句" : "重试翻译"}</button>}</div>');
  const expressionSeam='<SentenceExpressionList translation={currentSentenceTranslation} target={currentSentenceTarget} selections={savedSelections} onSave={saveCurrentSentenceExpression} onFamiliarityChange={updateSavedExpressionFamiliarity} />';
  if(!source.includes(expressionSeam))throw new Error('Sentence expression row seam changed');
  source=source.replace(expressionSeam,'<div className="vantilo-expression-row">{!currentSentenceTranslation.expressions?.length && <span>关键表达</span>}'+expressionSeam+'<button className="text-button" disabled={currentSentenceTranslationRequest?.status === "loading" || vantiloEngine.startsWith("qwen:")} title={vantiloEngine.startsWith("qwen:") ? "本地 Qwen 当前不支持推荐关键表达，请切换 GPT 模型" : undefined} onClick={() => toggleCurrentSentenceTranslation("expressions")}>↻ 重新推荐关键表达</button></div>');
  const oldActions='                      <div className="sentence-translation-actions">\n                        <button className="text-button" disabled={currentSentenceTranslationRequest?.status === "loading"} onClick={() => toggleCurrentSentenceTranslation("translation")}>重新翻译本句</button>\n                        <button className="text-button" disabled={currentSentenceTranslationRequest?.status === "loading"} onClick={() => toggleCurrentSentenceTranslation("expressions")}>重新推荐关键表达</button>\n                      </div>';
  if(!source.includes(oldActions))throw new Error('Sentence bottom actions seam changed');
  source=source.replace(oldActions,'');
  source=source.replace('{currentSentenceTranslation ? "更新失败，已保留上次内容，请重试。" : "句子翻译暂时失败，请重试。"}','{currentSentenceTranslationRequest.error || (currentSentenceTranslation ? "更新失败，已保留上次内容，请重试。" : "句子翻译暂时失败，请重试。")}');
  exact('        await ensureParagraphTranslation(item.index, item.paragraph, false, true);','        if(!await ensureParagraphTranslation(item.index, item.paragraph, false, true)) break;');
  exact('Math.min(3, missing.length)','Math.min(1, missing.length)');
  exact('      <div className="reader-progress-line">', `      <aside className="vantilo-translation-bar" aria-label="阅读翻译设置">
          <label className="vantilo-translation-engine">
            <span>阅读翻译模型</span>
            <select aria-label="阅读翻译引擎，适用于段落、全文和逐句模式" value={vantiloEngine} onChange={e=>changeVantiloEngine(e.target.value)}>
              {vantiloEngines.map(engine=><option key={engine.id} value={engine.id}>{engine.label}</option>)}
            </select>
          </label>
          {vantiloEngineError && <span role="status">{vantiloEngineError}</span>}
          <span className="vantilo-translation-note">{vantiloChunkProgress?.engineId===vantiloEngine&&vantiloChunkProgress.totalChunks>1?('本地 Qwen 分段 '+vantiloChunkProgress.completedChunks+'/'+vantiloChunkProgress.totalChunks+(vantiloChunkProgress.status==='failed'&&vantiloChunkProgress.failedChunk?' · 第 '+vantiloChunkProgress.failedChunk+' 段失败':'')):vantiloEngine.startsWith('qwen:')?'本地 Qwen · 长段落按句子分段翻译':vantiloEngine.startsWith('custom-api:')?'自定义 API · 使用所选模型':'Codex / ChatGPT · 使用所选模型'} · 记住所选模型，译文分别保存</span>
          {(fullArticleTranslationRunning || currentArticleTranslationLoading) && <button className="toolbar-button" onClick={cancelVantiloTranslation}>停止翻译</button>}
      </aside>
      <div className="reader-progress-line">`);
  return source;
}
