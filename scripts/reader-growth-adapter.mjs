export function adaptReaderGrowthBridge(source, filename) {
  if (filename.endsWith('/frontend/styles.css')) return source + `\n.vantilo-growth-home-card{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:16px 0;padding:14px 18px;border:1px solid #dce3dc;border-radius:14px;background:linear-gradient(135deg,#f4f7f2,#fffefa);color:#34433a}.vantilo-growth-home-card strong{display:block;font-size:14px}.vantilo-growth-home-card p{margin:4px 0 0;color:#748078;font-size:12px}.vantilo-growth-home-progress{width:min(220px,32vw);height:7px;margin-top:9px;overflow:hidden;border-radius:8px;background:#e4e9e2}.vantilo-growth-home-progress i{display:block;height:100%;border-radius:8px;background:#47857b}.vantilo-growth-home-card button{flex:none;padding:8px 12px;border:1px solid #d6dfd7;border-radius:8px;background:white;color:#3e6558;cursor:pointer}.reader-growth-timer{display:inline-flex;align-items:center;flex:0 0 auto;min-height:30px;margin-left:4px;padding:0 7px;border:1px solid var(--sentence-line,#e3e8e2);border-radius:8px;background:var(--sentence-surface,#fffefa);color:var(--sentence-accent,#247780);font:600 10px ui-monospace,monospace;cursor:pointer;white-space:nowrap}.reader-page-shell .reader-toolbar-center>.reader-growth-timer{display:inline-flex!important}\n`;
  if (filename.endsWith('/frontend/global-navigation.tsx')) {
    const assistantButton='      {onToggleAssistant && <button className={`global-nav-icon global-nav-assistant${assistantOpen ? " is-active" : ""}`} aria-label="Codex 助手" title={assistantOpen ? "收起 Codex 助手" : "打开 Codex 助手"} aria-pressed={assistantOpen} onClick={onToggleAssistant}>';
    if(source.split(assistantButton).length!==2)throw new Error('Reader navigation growth entry seam changed');
    return source.replace(assistantButton,`      <button className="global-nav-icon vantilo-growth-nav" aria-label="我的阅读成长" title="我的阅读成长" onClick={()=>window.parent.postMessage({type:'vantilo:growth-open-request',token:(window as Window & {__vantiloGrowthToken?:string}).__vantiloGrowthToken},'*')}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19V5m0 14h16"/><path d="m7 15 4-4 3 2 5-6"/></svg></button>\n${assistantButton}`);
  }
  if (!filename.endsWith('/frontend/App.tsx')) return source;
  const appSeam='function App() {';
  const appBridge=`function App() {
  useEffect(() => {
    const receive=(event:MessageEvent)=>{
      if(event.source!==window.parent || (event.origin!=='file://' && event.origin!=='null' && event.origin!=='http://127.0.0.1:5173'))return;
      if(event.data?.type!=='vantilo:growth-init'||typeof event.data.token!=='string'||event.data.token.length<24||event.data.token.length>128)return;
      const w=window as Window & {__vantiloGrowthToken?:string};w.__vantiloGrowthToken=event.data.token;
      window.parent.postMessage({type:'vantilo:growth-ready',token:w.__vantiloGrowthToken},'*');
      window.dispatchEvent(new Event('vantilo:growth-token'));
    };
    window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
  }, []);`;
  if(source.split(appSeam).length===2)source=source.replace(appSeam,appBridge);
  const seam='  const currentSentence = articleSentences[Math.min(sentenceIndex, Math.max(articleSentences.length - 1, 0))];';
  if(source.split(seam).length!==2)return source;
  const bridge=`
  const formatGrowthDuration=(value:number)=>{const total=Math.floor(Math.max(0,Number.isFinite(value)?value:0));return \`\${String(Math.floor(total/60)).padStart(2,'0')}:\${String(total%60).padStart(2,'0')}\`;};
  const growthPageIdRef=useRef<{documentId:string;pageId:string}|null>(null);
  if(!growthPageIdRef.current||growthPageIdRef.current.documentId!==article.identity.documentId)growthPageIdRef.current={documentId:article.identity.documentId,pageId:globalThis.crypto?.randomUUID?.()||String(Date.now())+'-'+String(Math.random())+'-'+String(Math.random())};
  const growthPageId=growthPageIdRef.current.pageId;
  const growthLeaveTimerRef=useRef<number|null>(null);
  const [growthBridgeVersion,setGrowthBridgeVersion] = useState(0);
  const [growthReading,setGrowthReading] = useState({seconds:0,active:false,canResume:false});
  const growthPreviousRef = useRef<{documentId:string;mode:ReaderMode;sentenceIndex:number;lookupKey:string|null;translation:boolean;translationCount:number;fullTranslation:boolean}|null>(null);
  useEffect(() => {
    const receive=(event:MessageEvent)=>{const token=(window as Window & {__vantiloGrowthToken?:string}).__vantiloGrowthToken;if(event.source!==window.parent||(event.origin!=='file://'&&event.origin!=='null'&&event.origin!=='http://127.0.0.1:5173')||event.data?.type!=='vantilo:growth-summary'||event.data.token!==token||!Number.isFinite(event.data.seconds)||event.data.seconds<0||event.data.seconds>86400||typeof event.data.active!=='boolean'||typeof event.data.canResume!=='boolean')return;setGrowthReading({seconds:event.data.seconds,active:event.data.active,canResume:event.data.canResume});};
    window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
  }, []);
  useEffect(() => {
    const update=()=>setGrowthBridgeVersion(value=>value+1);
    window.addEventListener('vantilo:growth-token',update);
    if((window as Window & {__vantiloGrowthToken?:string}).__vantiloGrowthToken)update();
    return()=>window.removeEventListener('vantilo:growth-token',update);
  }, []);
  useEffect(() => {
    const documentId=article.identity.documentId;
    const bookId=(article.identity as any).bookId || documentId;
    const pageId=growthPageId;
    if(growthLeaveTimerRef.current!==null){clearTimeout(growthLeaveTimerRef.current);growthLeaveTimerRef.current=null;}
    return()=>{const token=(window as Window & {__vantiloGrowthToken?:string}).__vantiloGrowthToken;if(!token)return;if(growthLeaveTimerRef.current!==null)clearTimeout(growthLeaveTimerRef.current);growthLeaveTimerRef.current=window.setTimeout(()=>{growthLeaveTimerRef.current=null;window.parent.postMessage({type:'vantilo:growth-leave',token,bookId,documentId,pageId},'*');},0);};
  },[article.identity.documentId,growthPageId]);
  useEffect(() => {
    const token=(window as Window & {__vantiloGrowthToken?:string}).__vantiloGrowthToken;
    if(!token)return;
    const mode=readerMode==='sentence'?'sentence':'article';
    const documentId=article.identity.documentId;
    const bookId=(article.identity as any).bookId || documentId;
    const growthWindow=window as Window & {__vantiloGrowthToken?:string;__vantiloGrowthDocumentId?:string;__vantiloGrowthBookId?:string;__vantiloGrowthPageId?:string};
    growthWindow.__vantiloGrowthDocumentId=documentId;growthWindow.__vantiloGrowthBookId=bookId;growthWindow.__vantiloGrowthPageId=growthPageId;
    const sample=article.paragraphs.join(' ').slice(0,4000);
    const latin=(sample.match(/[A-Za-z]/g)||[]).length,han=(sample.match(/[\\u3400-\\u9fff]/g)||[]).length;
    const english=readerLanguage==='english'&&latin>=12&&latin>=han*2;
    const previous=growthPreviousRef.current;
    const translationCount=Object.keys(translations).length;
    window.parent.postMessage({type:'vantilo:growth-state',token,bookId,documentId,pageId:growthPageId,mode,english},'*');
    if(previous && previous.documentId===article.identity.documentId && previous.mode===mode && previous.sentenceIndex!==sentenceIndex && mode==='sentence') window.parent.postMessage({type:'vantilo:growth-activity',token,bookId,documentId,pageId:growthPageId,action:'sentence'},'*');
    if(previous && previous.lookupKey!== (activeWordLookup?.key??null) && activeWordLookup) window.parent.postMessage({type:'vantilo:growth-activity',token,bookId,documentId,pageId:growthPageId,action:'lookup'},'*');
    if(previous && ((previous.translation!==sentenceTranslationVisible && sentenceTranslationVisible)||(translationCount>previous.translationCount)||(fullArticleTranslationExpanded&&!previous.fullTranslation))) window.parent.postMessage({type:'vantilo:growth-activity',token,bookId,documentId,pageId:growthPageId,action:'translation'},'*');
    growthPreviousRef.current={documentId:article.identity.documentId,mode,sentenceIndex,lookupKey:activeWordLookup?.key??null,translation:sentenceTranslationVisible,translationCount,fullTranslation:fullArticleTranslationExpanded};
  },[article.identity.documentId,article.paragraphs.length,readerMode,readerLanguage,sentenceIndex,activeWordLookup?.key,sentenceTranslationVisible,translations,fullArticleTranslationExpanded,growthBridgeVersion]);
  useEffect(() => {
    if(readerMode!=='article'||readerLanguage!=='english')return;
    let last=0, lastEmit=0;
    const onScroll=(event:Event)=>{const target=event.target instanceof Element?event.target:document.scrollingElement;const current=target?.scrollTop??window.scrollY;const now=Date.now();if(Math.abs(current-last)<80||now-lastEmit<3000)return;last=current;lastEmit=now;const token=(window as Window & {__vantiloGrowthToken?:string}).__vantiloGrowthToken;if(token)window.parent.postMessage({type:'vantilo:growth-activity',token,bookId:(article.identity as any).bookId || article.identity.documentId,documentId:article.identity.documentId,pageId:growthPageId,action:'scroll'},'*');};
    window.addEventListener('scroll',onScroll,{passive:true,capture:true});return()=>window.removeEventListener('scroll',onScroll,true);
  },[readerMode,readerLanguage]);
`;
  source=source.replace(seam,seam+bridge);
  const toolbarSeam='<button className={readerMode === "sentence" ? "is-active" : ""} aria-pressed={readerMode === "sentence"} aria-keyshortcuts="2" title="快捷键 2" onClick={() => switchReaderMode("sentence")}>逐句</button>\n          </div>';
  if(source.split(toolbarSeam).length===2)source=source.replace(toolbarSeam,toolbarSeam+`\n          {readerLanguage === "english" && (growthReading.active || growthReading.canResume) && <button type="button" className="reader-growth-timer" aria-label={growthReading.active?'打开阅读成长记录':'继续阅读计时'} onClick={() => window.parent.postMessage({type:growthReading.active?'vantilo:growth-open-request':'vantilo:growth-resume-request',token:(window as Window & {__vantiloGrowthToken?:string}).__vantiloGrowthToken},'*')}>{formatGrowthDuration(growthReading.seconds)} / 30:00{growthReading.active?'':' · 暂停'}</button>}`);
  const appCardFunction=`function VantiloGrowthHomeCard(){
  const [growthToday,setGrowthToday]=useState({seconds:0,active:false});
  const formatGrowthDuration=(value:number)=>{const total=Math.floor(Math.max(0,Number.isFinite(value)?value:0));return \`\${String(Math.floor(total/60)).padStart(2,'0')}:\${String(total%60).padStart(2,'0')}\`;};
  useEffect(()=>{const receive=(event:MessageEvent)=>{const token=(window as Window & {__vantiloGrowthToken?:string}).__vantiloGrowthToken;if(event.source!==window.parent||(event.origin!=='file://'&&event.origin!=='null'&&event.origin!=='http://127.0.0.1:5173')||event.data?.type!=='vantilo:growth-summary'||event.data.token!==token||!Number.isFinite(event.data.seconds)||event.data.seconds<0||event.data.seconds>86400||typeof event.data.active!=='boolean')return;setGrowthToday({seconds:event.data.seconds,active:event.data.active});};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[]);
  return <section className="vantilo-growth-home-card"><div><strong>今日英文阅读</strong><p>{growthToday.seconds>=1800?'今日目标已达成':\`还差 \${Math.ceil(Math.max(0,1800-growthToday.seconds)/60)} 分钟达到30分钟\`}</p><div className="vantilo-growth-home-progress"><i style={{width:\`\${Math.min(100,growthToday.seconds/1800*100)}%\`}}/></div><small>{formatGrowthDuration(growthToday.seconds)} / 30:00</small></div><button type="button" onClick={()=>window.parent.postMessage({type:'vantilo:growth-open-request',token:(window as Window & {__vantiloGrowthToken?:string}).__vantiloGrowthToken},'*')}>查看阅读成长</button></section>;
}`;
  const appComponentSeam='export default function App() {';
  if(source.split(appComponentSeam).length===2)source=source.replace(appComponentSeam,`${appCardFunction}\n\n${appComponentSeam}`);
  const bookCardSeam='      {continueCard}\n      <section className="section-block library-shelf-section">';
  if(source.split(bookCardSeam).length===2)source=source.replace(bookCardSeam,'      {continueCard}\n      <VantiloGrowthHomeCard />\n      <section className="section-block library-shelf-section">');
  const magazineCardSeam='\n      <section className="section-block library-shelf-section">\n        <div className="section-title-row"><div><div className="eyebrow">Magazine shelf';
  if(source.split(magazineCardSeam).length===2)source=source.replace(magazineCardSeam,'\n      <VantiloGrowthHomeCard />'+magazineCardSeam);
  return source;
}
