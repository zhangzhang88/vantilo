async function vantiloCatalogRequest(url: string, options: RequestInit = {}) {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '目录操作失败');
  return value;
}
function VantiloCatalogPicker({value,onChange,disabled=false,onBusy}: {
  value:string;onChange:(value:string)=>void;disabled?:boolean;onBusy?:(busy:boolean)=>void;
}) {
  const [models,setModels]=useState<Array<{id:string;label:string}>>([]);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const [reload,setReload]=useState(0);
  const available=models.some(model=>model.id===value);
  useEffect(()=>{onBusy?.(saving||!available);},[saving,available,onBusy]);
  useEffect(()=>{
    let ctl:AbortController|undefined;
    const load=()=>{
      ctl?.abort();const request=new AbortController();ctl=request;setError('');
      vantiloCatalogRequest('/api/vantilo-catalog/settings',{signal:request.signal}).then(data=>{
        if(request.signal.aborted)return;setModels(data.engines);onChange(data.engineId);
      }).catch(e=>{if(!request.signal.aborted)setError(e.message);});
    };
    load();window.addEventListener('vantilo-custom-api-updated',load);
    return ()=>{ctl?.abort();window.removeEventListener('vantilo-custom-api-updated',load);};
  },[reload]);
  async function select(id:string) {
    setSaving(true);setError('');
    try{await vantiloCatalogRequest('/api/vantilo-catalog/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({engineId:id})});onChange(id);}
    catch(e){setError(e instanceof Error?e.message:'目录模型保存失败');}
    finally{setSaving(false);}
  }
  return <div className="vantilo-catalog-picker">
    <label>目录翻译模型 <select aria-label="目录翻译模型" value={value} disabled={disabled||saving||!models.length} onChange={e=>void select(e.target.value)}>
      {!available&&<option value={value} disabled>{value?'原选模型不可用，请重新选择':'暂无可用模型'}</option>}
      {models.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}
    </select></label>
    {error&&<span role="alert">{error} <button type="button" onClick={()=>setReload(n=>n+1)}>重试模型列表</button></span>}
  </div>;
}
function VantiloCatalogControl({kind,id,onResolved,hasBatchTitles=false}: {hasBatchTitles?:boolean;kind:'book'|'issue';id:string;onResolved:(record:any)=>void}) {
  const [engine,setEngine]=useState('');
  const [record,setRecord]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [modelBusy,setModelBusy]=useState(false);
  const [progress,setProgress]=useState<any>(null);
  const [error,setError]=useState('');
  const request=useRef<AbortController|null>(null);
  const statusRequest=useRef<AbortController|null>(null);
  const url='/api/vantilo-catalog/'+kind+'/'+encodeURIComponent(id);
  useEffect(()=>{
    const ctl=new AbortController();statusRequest.current=ctl;setRecord(null);setError('');
    vantiloCatalogRequest(url,{signal:ctl.signal}).then(value=>{if(!ctl.signal.aborted){setRecord(value);onResolved(value);}}).catch(e=>{if(!ctl.signal.aborted)setError(e.message);});
    return ()=>{ctl.abort();request.current?.abort();};
  },[url]);
  async function generate() {
    if(request.current||modelBusy||!engine)return;
    statusRequest.current?.abort();
    const ctl=new AbortController();request.current=ctl;setBusy(true);setError('');
    const regenerate=record?.state==='ready';
    try{
      let value;
      do {
      value=await vantiloCatalogRequest(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({engineId:engine,regenerate}),signal:ctl.signal});
      if(ctl.signal.aborted)return;
      if(value.state==='pending'){
        setProgress(value);
        if(value.titles){setRecord(value);onResolved(value);}
      }
      }while(value.state==='pending'&&!ctl.signal.aborted);
      if(ctl.signal.aborted)return;
      setProgress(null);setRecord(value);onResolved(value);window.dispatchEvent(new CustomEvent('vantilo-catalog-updated',{detail:{kind,id}}));
    }catch(e){setError(ctl.signal.aborted?'已停止，原有目录和已完成进度保留，再次点击可继续':e instanceof Error?e.message:'目录生成失败');}
    finally{if(request.current===ctl){request.current=null;setBusy(false);}}
  }
  const hasArticleTitles=Object.keys(record?.titles?.articles??{}).length>0;
  const noCatalogStatus=hasBatchTitles?'已显示整期翻译的文章标题':'尚未用目录模型生成标题';
  const legacyStatus=kind==='issue'&&!hasArticleTitles?'已有历史栏目译名 · '+noCatalogStatus:'已有历史中文目录 · 原模型记录可能不完整';
  return <section className="vantilo-catalog-control" aria-label="中文目录生成设置">
    <VantiloCatalogPicker value={engine} onChange={setEngine} disabled={busy} onBusy={setModelBusy}/>
    <p>目录模型独立于助手和正文翻译。{kind==='issue'?'自动抓取仅导入杂志，不会自动翻译。':'仅在你确认生成时翻译目录。'}</p>
    <p role="status">{record?.state==='ready'?(record.legacy?legacyStatus:'已有中文目录 · '+record.model):record?.state==='pending'?`中文目录已生成 ${record.done}/${record.total} 项 · 可继续生成`:noCatalogStatus}{record?.state==='ready'&&record.engineId&&record.engineId!==engine?'；更换所选模型不会自动重译':''}</p>
    <button type="button" className="primary-button" disabled={busy||modelBusy||!engine} onClick={()=>void generate()}>{busy?(progress?'正在生成 '+progress.done+' / '+progress.total:'正在生成中文目录…'):record?.state==='ready'&&(!record.legacy||kind==='book'||hasArticleTitles)?'用所选模型重新生成':record?.state==='pending'?'继续生成中文目录':'生成中文目录'}</button>
    {busy&&<button type="button" className="text-button" onClick={()=>request.current?.abort()}>停止生成</button>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
