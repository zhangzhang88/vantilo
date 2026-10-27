function VantiloUpdateSettings() {
  const [magazines,setMagazines]=useState<any>(null);
  const [software,setSoftware]=useState<any>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState('');
  const busyRef=useRef(false),sequence=useRef(0);
  const date=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN'):'尚未检查';
  async function call(path:string,options:RequestInit={}){
    const response=await fetch('/api/vantilo-updates/'+path,options);const value=await response.json();
    if(!response.ok)throw new Error(value.error||'更新操作失败');return value;
  }
  useEffect(()=>{
    const ctl=new AbortController();let pending=false;
    const refresh=async()=>{
      if(pending||busyRef.current)return;pending=true;const token=sequence.current;
      try{const results=await Promise.allSettled([call('magazines',{signal:ctl.signal}),call('software',{signal:ctl.signal})]);
        if(ctl.signal.aborted||token!==sequence.current)return;
        if(results[0].status==='fulfilled')setMagazines(results[0].value);
        if(results[1].status==='fulfilled')setSoftware(results[1].value);
        if(results.some(result=>result.status==='rejected'))setError('部分更新状态读取失败，请稍后重试');
      }finally{pending=false;}
    };
    void refresh();const timer=window.setInterval(()=>void refresh(),3000);
    return ()=>{ctl.abort();window.clearInterval(timer);};
  },[]);
  async function action(path:string,method='POST',body:any={}){
    if(busyRef.current)return;sequence.current++;busyRef.current=true;setBusy(path);setError('');
    try{const value=await call(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(path.startsWith('magazines'))setMagazines(value);else if(!path.endsWith('open-release'))setSoftware(value);
    }catch(e){setError(e instanceof Error?e.message:'更新操作失败');}
    finally{busyRef.current=false;setBusy('');}
  }
  return <div className="settings-grid vantilo-update-settings" aria-label="更新设置">
    <section className="settings-card">
      <div className="settings-card-heading"><div><span>Reading environment</span><h2>阅读环境设置</h2></div></div>
      <p>查看本地千问模型和阅读服务的准备状态。</p>
      <button type="button" className="primary-button" onClick={()=>window.parent.postMessage({type:'vantilo:open-environment-settings'},'*')}>阅读环境设置</button>
    </section>
    <section className="settings-card" data-testid="magazine-update-settings">
      <div className="settings-card-heading"><div><span>Magazine updates</span><h2>杂志更新</h2></div></div>
      <p>启动时检查新刊，运行期间每 3 小时检查；退出应用后停止检查，下次启动自动补查。只下载杂志，不自动翻译。</p>
      <label className="vantilo-update-toggle"><input type="checkbox" aria-label="自动抓取杂志" checked={Boolean(magazines?.enabled)} disabled={!magazines||Boolean(busy)} onChange={e=>void action('magazines','PUT',{automatic:e.target.checked})}/>自动抓取最新杂志</label>
      <p role="status">{magazines?.message||'正在读取杂志更新状态…'}</p>
      <p>上次检查：{date(magazines?.lastAttemptAt)}<br/>上次成功：{date(magazines?.lastSuccessAt)}</p>
      <button type="button" className="primary-button" disabled={!magazines||Boolean(busy)||magazines.status==='checking'} onClick={()=>void action('magazines/check')}>{magazines?.status==='checking'?'正在检查杂志…':'立即检查杂志'}</button>
      <small>关闭自动抓取后仍可手动检查；已在进行的下载会完成。</small>
    </section>
    <section className="settings-card" data-testid="software-update-settings">
      <div className="settings-card-heading"><div><span>Software updates</span><h2>软件更新</h2></div></div>
      <p>当前版本：{software?.currentVersion||'读取中…'}</p>
      <label className="vantilo-update-toggle"><input type="checkbox" aria-label="自动检查软件版本" checked={Boolean(software?.automatic)} disabled={!software||Boolean(busy)} onChange={e=>void action('software','PUT',{automatic:e.target.checked})}/>启动时自动检查软件新版本</label>
      <p>启用后，应用运行期间每 24 小时再检查；发现适配本机的新版本时提示，不会强制安装或重启。</p>
      <p role="status">{software?.message||'正在读取软件更新状态…'}{software?.phase==='available'&&software.latestVersion?' · '+software.latestVersion:''}</p>
      <p>上次检查：{date(software?.lastCheckedAt)}<br/>发布仓库：{software?.repository||'尚未配置'}</p>
      <button type="button" className="primary-button" disabled={!software||Boolean(busy)||software.phase==='checking'} onClick={()=>void action('software/check')}>{busy==='software/check'?'正在检查软件…':'检查软件新版本'}</button>
      {software?.releaseURL&&<button type="button" className="text-button" disabled={Boolean(busy)} onClick={()=>void action('software/open-release')}>{software.downloadAvailable?'前往发布页下载':'查看发布说明'}</button>}
      <small>可前往 GitHub 发布页下载新版，更新时需要手动安装。</small>
    </section>
    {error&&<p role="alert" className="vantilo-update-error">{error}</p>}
  </div>;
}
