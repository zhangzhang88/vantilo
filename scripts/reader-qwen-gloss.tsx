// Vantilo-only local contextual meaning. A single serialized queue ensures
// rapid word switching does not collide with the single resident MLX worker.
let vantiloQwenAutoQueue: Promise<void> = Promise.resolve();

function VantiloLocalGloss({
  word, sentence, cachedMeaning, onResolved,
}: {
  word:string;sentence:string;cachedMeaning?:string;
  onResolved:(meaningZh:string)=>void;
}) {
  const [status,setStatus]=useState<'loading'|'ready'|'error'|'unavailable'>(
    cachedMeaning ? 'ready' : 'loading'
  );
  const [meaning,setMeaning]=useState(cachedMeaning?.trim() ?? '');
  useEffect(()=>{
    let live=true;
    const controller=new AbortController();
    if(cachedMeaning?.trim()){
      setMeaning(cachedMeaning.trim());setStatus('ready');
      return ()=>{live=false;controller.abort();};
    }
    setStatus('loading');setMeaning('');
    // The front-end has no model path and no privileged IPC; same-origin API only.
    const task=async()=>{
      if(!live)return;
      try {
        const available=await fetch('/api/vantilo-qwen/status',{cache:'no-store',signal:controller.signal});
        if(!live)return;
        const info=available.ok ? await available.json() : null;
        if(!live)return;
        if(!info?.enabled || !info.selected || !info.helperAvailable){
          setStatus('unavailable');return;
        }
        const response=await fetch('/api/vantilo-qwen/gloss',{
          method:'POST',
          headers:{'content-type':'application/json'},
          signal:controller.signal,
          body:JSON.stringify({word,sentence:sentence.slice(0,600)}),
        });
        if(!live)return;
        if(!response.ok)throw new Error('Qwen gloss unavailable');
        const result=await response.json();
        if(!live)return;
        if(typeof result.meaningZh!=='string' ||
           !/^[\p{Script=Han}、， ]{1,24}$/u.test(result.meaningZh)){
          throw new Error('Invalid Qwen gloss');
        }
        setMeaning(result.meaningZh);setStatus('ready');
        onResolved(result.meaningZh);
      } catch {
        if(live)setStatus('error');
      }
    };
    const next=vantiloQwenAutoQueue.then(task,task);
    vantiloQwenAutoQueue=next.then(()=>{},()=>{});
    return ()=>{live=false;controller.abort();};
  },[word,sentence,cachedMeaning]);
  return <section className="vantilo-context-primary" aria-label="当前语境释义">
    <span className="word-lookup-label">当前语境 · 本地 Qwen</span>
    {status==='ready' ? <strong data-testid="vantilo-qwen-context-meaning">{meaning}</strong> :
      status==='loading' ? <p role="status">正在理解当前句子…</p> :
      status==='unavailable' ? <p>本地 Qwen 尚未配置，请查看下方词典释义。</p> :
      <p>本地语境解释暂不可用，请查看词典释义。</p>}
  </section>;
}
