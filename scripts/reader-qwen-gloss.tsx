// Vantilo-only local contextual meaning. A single serialized queue ensures
// rapid word switching does not collide with the single resident MLX worker.
let vantiloQwenAutoQueue: Promise<void> = Promise.resolve();

function VantiloLocalGloss({
  word, sentence, cachedMeaning, cachedProvider, cachedModel, preserveCached, onResolved,
}: {
  word:string;sentence:string;cachedMeaning?:string;cachedProvider?:string;cachedModel?:string;
  preserveCached?:boolean;
  onResolved:(meaningZh:string,provider?:string,model?:string)=>void;
}) {
  const [status,setStatus]=useState<'loading'|'ready'|'error'|'unavailable'>(
    preserveCached&&cachedMeaning ? 'ready' : 'loading'
  );
  const [meaning,setMeaning]=useState(preserveCached ? cachedMeaning?.trim() ?? '' : '');
  const [engineId,setEngineId]=useState(()=>{try{return localStorage.getItem('vantilo-translation-engine-v1')||'';}catch{return '';}});
  const [providerLabel,setProviderLabel]=useState('正在读取所选模型');
  useEffect(()=>{
    const refresh=()=>{try{setEngineId(localStorage.getItem('vantilo-translation-engine-v1')||'');}catch{setEngineId('');}};
    window.addEventListener('vantilo-translation-engine-change',refresh);
    return ()=>window.removeEventListener('vantilo-translation-engine-change',refresh);
  },[]);
  useEffect(()=>{
    let live=true;
    const controller=new AbortController();
    if(preserveCached&&cachedMeaning?.trim()){
      setMeaning(cachedMeaning.trim());setStatus('ready');
      return ()=>{live=false;controller.abort();};
    }
    setProviderLabel('正在读取所选模型');
    setStatus('loading');setMeaning('');
    // The front-end has no model path and no privileged IPC; same-origin API only.
    const task=async()=>{
      if(!live)return;
      try {
        const suffix=engineId?`?engineId=${encodeURIComponent(engineId)}`:'';
        const available=await fetch('/api/vantilo-context-gloss/status'+suffix,{cache:'no-store',signal:controller.signal});
        if(!live)return;
        const info=available.ok ? await available.json() : null;
        if(!live)return;
        if(typeof info?.label==='string'&&info.label)setProviderLabel(info.label);
        if(!info?.enabled || !info.selected || !info.helperAvailable){
          setStatus('unavailable');return;
        }
        const response=await fetch('/api/vantilo-context-gloss',{
          method:'POST',
          headers:{'content-type':'application/json'},
          signal:controller.signal,
          body:JSON.stringify({word,sentence:sentence.slice(0,600),...(engineId?{engineId}:{})}),
        });
        if(!live)return;
        if(!response.ok)throw new Error('Context gloss unavailable');
        const result=await response.json();
        if(!live)return;
        if(typeof result.meaningZh!=='string' ||
           !/^[\p{Script=Han}、， ]{1,24}$/u.test(result.meaningZh)){
          throw new Error('Invalid context gloss');
        }
        setMeaning(result.meaningZh);setStatus('ready');
        if(result.provider==='custom-api')setProviderLabel(`自定义 API${typeof result.model==='string'&&result.model?' · '+result.model:''}`);
        onResolved(result.meaningZh,typeof result.provider==='string'?result.provider:undefined,typeof result.model==='string'?result.model:undefined);
      } catch {
        if(live)setStatus('error');
      }
    };
    const next=vantiloQwenAutoQueue.then(task,task);
    vantiloQwenAutoQueue=next.then(()=>{},()=>{});
    return ()=>{live=false;controller.abort();};
  },[word,sentence,cachedMeaning,preserveCached,engineId]);
  return <section className="vantilo-context-primary" aria-label="当前语境释义">
    <span className="word-lookup-label">当前语境 · {providerLabel}</span>
    {status==='ready' ? <strong data-testid="vantilo-qwen-context-meaning">{meaning}</strong> :
      status==='loading' ? <p role="status">正在理解当前句子…</p> :
      status==='unavailable' ? <p>{engineId.startsWith('codex:')?'请登录 ChatGPT 后重试。':'尚未配置所选模型，请在阅读设置中检查 API 或本地模型。'}</p> :
      <p>{providerLabel}暂不可用，请检查模型连接后重试。</p>}
  </section>;
}
