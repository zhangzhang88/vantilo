function vantiloReleaseSummary(markdown: unknown): string[] {
  if(typeof markdown!=='string')return [];
  const lines=markdown.replace(/\r\n?/g,'\n').split('\n');
  const heading=/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
  const matches=(title:string)=>/^(?:[一二三四五六七八九十]+[、.．]\s*)?(?:what['’]?s new|what is new|user(?:-facing)? (?:updates|summary)|release highlights|本次更新|更新内容|用户更新摘要|更新亮点|新增与改进)\s*[:：]?$/i.test(title.trim());
  let fenced=false;
  for(let i=0;i<lines.length;i++){
    if(/^\s*(```|~~~)/.test(lines[i])){fenced=!fenced;continue;}
    if(fenced)continue;
    const start=heading.exec(lines[i]);if(!start||!matches(start[2]))continue;
    const items:string[]=[];let inCode=false;
    for(i++;i<lines.length;i++){
      if(/^\s*(```|~~~)/.test(lines[i])){inCode=!inCode;continue;}
      if(inCode)continue;
      if(heading.test(lines[i]))break;
      const item=/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)(.+?)\s*$/.exec(lines[i]);
      if(item&&/[\u3400-\u9fff]/.test(item[1]))items.push(item[1].trim());
      if(items.length===5)break;
    }
    return items;
  }
  return [];
}

function vantiloHasChineseReleaseNotes(markdown: unknown): boolean {
  if(typeof markdown!=='string'||!/[\u3400-\u9fff]/.test(markdown))return false;
  let inCode=false;
  for(const line of markdown.split(/\r?\n/)){
    if(/^\s*(```|~~~)/.test(line)){inCode=!inCode;continue;}
    if(inCode||/[\u3400-\u9fff]/.test(line)||/^\s*https?:\/\//.test(line))continue;
    if((line.match(/\b[A-Za-z]{2,}\b/g)||[]).length>=4)return false;
  }
  return true;
}

function VantiloUpdateSettings() {
  const [magazines,setMagazines]=useState<any>(null);
  const [software,setSoftware]=useState<any>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState('');
  const [releaseExpanded,setReleaseExpanded]=useState(false);
  const busyRef=useRef(false),sequence=useRef(0);
  const date=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN'):'尚未检查';
  const chineseNotes=vantiloHasChineseReleaseNotes(software?.releaseNotes);
  const notes=chineseNotes?vantiloReleaseSummary(software?.releaseNotes):[];
  const showRelease=['available','download-failed','download-cancelled','verification-failed'].includes(software?.phase);
  const showProgress=software?.totalBytes>0&&['downloading','verifying','verified'].includes(software.phase);
  const percent=showProgress?Math.max(0,Math.min(100,software.downloadedBytes/software.totalBytes*100)):0;
  useEffect(()=>setReleaseExpanded(false),[software?.latestVersion,showRelease]);
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
      <p>检查系统词典，了解如何配置云端或局域网 API。</p>
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
      <p>当前版本：{software?.currentVersion||'读取中…'}<br/>更新通道：{software?.channel==='beta'?'Beta':software?.channel==='stable'?'Stable':'读取中…'}</p>
      <label className="vantilo-update-toggle"><input type="checkbox" aria-label="自动检查软件版本" checked={Boolean(software?.automatic)} disabled={!software||Boolean(busy)} onChange={e=>void action('software','PUT',{automatic:e.target.checked})}/>启动时自动检查软件新版本</label>
      <p role="status">{software?.phase==='current'?'你正在使用最新版本。':software?.phase==='downloading'?`正在下载 Vantilo ${software.latestVersion||''}`:software?.message||'正在读取软件更新状态…'}</p>
      {showRelease&&software?.latestVersion&&<p>最新版本：{software.latestVersion}<br/>发布日期：{date(software.publishedAt)}{software.assetSize?<><br/>Universal ZIP：{(software.assetSize/1024/1024).toFixed(1)} MB</>:null}</p>}
      {showRelease&&notes.length>0&&<div><p>本次更新：</p><ul>{notes.map((note,index)=><li key={index}><VantiloReleaseMarkdown unwrapDisallowed>{note}</VantiloReleaseMarkdown></li>)}</ul></div>}
      {showRelease&&chineseNotes&&software?.releaseNotes&&<details key={software.latestVersion} className="vantilo-release-details" onToggle={event=>setReleaseExpanded(event.currentTarget.open)}><summary>查看完整更新说明</summary>{releaseExpanded&&<><div className="vantilo-release-markdown"><VantiloReleaseMarkdown>{software.releaseNotes}</VantiloReleaseMarkdown></div>{software.releaseURL&&<button type="button" className="text-button" disabled={Boolean(busy)} onClick={()=>void action('software/open-release')}>在 GitHub 查看完整发布说明</button>}</>}</details>}
      {showProgress&&<div><progress className="vantilo-update-progress" aria-label="下载进度" max={100} value={percent}/><p>下载：{percent.toFixed(1)}% · {(software.downloadedBytes/1024/1024).toFixed(1)} / {(software.totalBytes/1024/1024).toFixed(1)} MB</p></div>}
      <p>上次检查：{date(software?.lastCheckedAt)}</p>
      <button type="button" className="primary-button" disabled={!software||Boolean(busy)||software.phase==='checking'} onClick={()=>void action('software/check')}>{busy==='software/check'?'正在检查软件…':'检查软件新版本'}</button>
      {showRelease&&software?.releaseURL&&!chineseNotes&&<><p>当前版本尚无简体中文更新说明。</p><button type="button" className="text-button" disabled={Boolean(busy)} onClick={()=>void action('software/open-release')}>在 GitHub 查看完整发布说明</button></>}
      {software?.downloadAvailable&&['available','download-failed','download-cancelled','verification-failed'].includes(software.phase)&&<button type="button" onClick={()=>void action('software/download')}>下载并更新</button>}
      {['choosing','downloading'].includes(software?.phase)&&<button type="button" onClick={()=>void action('software/cancel-download')}>取消下载</button>}
      {software?.phase==='verified'&&<><button type="button" onClick={()=>void action('software/reveal-download')}>在 Finder 中显示</button><p>退出 Vantilo，解压 ZIP，将新版应用拖入原来的 Applications 目录并选择替换，然后重新启动。无需先卸载旧版，用户数据会保留。</p></>}
      {['verifying','verified','verification-failed'].includes(software?.phase)&&<small>SHA-256 用于检查下载完整性，不是独立的数字签名。</small>}
    </section>
    {error&&<p role="alert" className="vantilo-update-error">{error}</p>}
  </div>;
}
