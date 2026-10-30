'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const fsConstants=require('node:fs').constants;
const {createReadStream}=require('node:fs');
const {setTimeout:delay}=require('node:timers/promises');
function transientNetworkError(error){
 const codes=new Set(['EAI_AGAIN','ENOTFOUND','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET']);
 return error?.name==='TimeoutError'||error?.message==='fetch failed'||error instanceof TypeError||codes.has(error?.code)||codes.has(error?.cause?.code);
}
function parseVersion(value){
 if(typeof value!=='string'||value.length>80)return null;
 const match=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
 if(!match||match[4]?.split('.').some(part=>!part||(/^\d+$/.test(part)&&part.length>1&&part[0]==='0')))return null;const numbers=match.slice(1,4).map(Number);if(numbers.some(n=>!Number.isSafeInteger(n)))return null;
 return {numbers,prerelease:match[4]||null};
}
function compareVersions(left,right){
 const a=parseVersion(left),b=parseVersion(right);if(!a||!b)return null;
 for(let i=0;i<3;i++)if(a.numbers[i]!==b.numbers[i])return a.numbers[i]>b.numbers[i]?1:-1;
 if(!a.prerelease||!b.prerelease)return a.prerelease===b.prerelease?0:a.prerelease?-1:1;
 const x=a.prerelease.split('.'),y=b.prerelease.split('.');
 for(let i=0;i<Math.max(x.length,y.length);i++){
  if(x[i]===undefined)return -1;if(y[i]===undefined)return 1;if(x[i]===y[i])continue;
  const nx=/^\d+$/.test(x[i]),ny=/^\d+$/.test(y[i]);if(nx&&ny)return BigInt(x[i])>BigInt(y[i])?1:-1;if(nx!==ny)return nx?-1:1;return x[i]>y[i]?1:-1;
 }return 0;
}
function isNewerRelease(tag,current){return !parseVersion(tag)?.prerelease&&compareVersions(tag,current)>0;}
function resolveUpdateCurrentVersion({isPackaged,currentVersion,testVersion}){
 if(isPackaged||testVersion===undefined)return currentVersion;
 if(!parseVersion(testVersion))throw Error('开发环境更新测试版本无效');
 return testVersion;
}
function createSoftwareUpdateService({userData,currentVersion,source,fetchImpl=fetch,openExternal=async()=>{},onAvailable=()=>{},platform=process.platform,arch=process.arch,now=Date.now,intervalMs=24*60*60*1000,chooseDownloadDirectory=async()=>null,showItemInFolder=()=>{},retryWait=(ms,signal)=>delay(ms,undefined,{signal}),diskSpace=async dir=>{const stat=await fs.statfs(dir);return Number(stat.bavail)*Number(stat.bsize);}}){
 if(!path.isAbsolute(userData)||!parseVersion(currentVersion)||!source||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository))throw new Error('软件更新配置无效');
 const preference=path.join(userData,'software-update-preferences.json');const repository=source.repository;
 const releasesPage='https://github.com/'+repository+'/releases';
 const channel=source.channel||'stable';if(!['stable','beta'].includes(channel))throw Error('更新通道配置无效');
 let automatic=true,loaded=null,timer=null,pending=null,controller=null,closed=false,notified=null,selected=null,downloadPending=null,downloadController=null,completedPath=null;
 let state={phase:source.publicReleases?'idle':'unconfigured',message:source.publicReleases?'尚未检查软件版本':'发布仓库尚未公开，软件更新源暂未就绪',currentVersion,lastCheckedAt:null,latestVersion:null,releaseURL:null,downloadAvailable:false,installSupported:false};
 async function load(){if(!loaded)loaded=(async()=>{try{const value=JSON.parse(await fs.readFile(preference,'utf8'));if(value.version!==1||typeof value.automatic!=='boolean')throw Error();automatic=value.automatic;}catch(e){if(e.code!=='ENOENT'){automatic=false;state={...state,phase:'error',message:'自动检查设置读取失败，请重新设置'};}}})();await loaded;}
 const snapshot=()=>({...state,automatic,repository,releasesPage,channel});
 async function status(){await load();return snapshot();}
 async function fetchReleases(signal){
  for(let attempt=0;attempt<3;attempt++){
   try{
    const response=await fetchImpl('https://api.github.com/repos/'+repository+'/releases?per_page=100',{method:'GET',redirect:'error',headers:{Accept:'application/vnd.github+json','User-Agent':'Vantilo-update-check','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
    if(response.status>=500&&response.status<=599&&attempt<2){await response.body?.cancel();await retryWait(400*2**attempt,signal);continue;}
    if(!response.ok)return {response};
    if(Number(response.headers.get('content-length'))>2*1024*1024)throw Error('版本信息过大');
    const chunks=[];let size=0;for await(const chunk of response.body||[]){size+=chunk.length;if(size>2*1024*1024)throw Error('版本信息过大');chunks.push(chunk);}
    return {response,body:Buffer.concat(chunks).toString('utf8')};
   }catch(error){
    if(signal.aborted||!transientNetworkError(error)||attempt===2)throw error;
    await retryWait(400*2**attempt,signal);
   }
  }
 }
 async function check(){
  await load();if(closed||downloadPending)return snapshot();if(pending)return pending;
  if(!source.publicReleases){state={...state,phase:'unconfigured',message:'发布仓库尚未公开，软件更新源暂未就绪'};return snapshot();}
  controller=new AbortController();state={...state,phase:'checking',message:'正在检查软件新版本…'};
  pending=(async()=>{
   try{
    const {response,body}=await fetchReleases(controller.signal);
    if(response.status===404){state={...state,phase:'unpublished',lastCheckedAt:new Date(now()).toISOString(),message:'仓库或 Release 无法匿名访问，或尚未发布'};return snapshot();}
    if(!response.ok)throw Error(response.status===403||response.status===429?'GitHub 暂时限制检查，请稍后重试':'软件更新服务暂不可用');
    let releases;try{releases=JSON.parse(body);}catch{throw Error('版本信息格式无效');}
    if(!Array.isArray(releases))throw Error('版本信息格式无效');
    const valid=releases.filter(r=>r&&r.draft===false&&(channel==='beta'?r.prerelease===true:r.prerelease===false)&&parseVersion(r.tag_name)&&(channel==='beta'||!parseVersion(r.tag_name).prerelease));
    valid.sort((a,b)=>compareVersions(b.tag_name,a.tag_name));
    const release=valid[0];
    if(!release){state={...state,phase:'unpublished',message:'没有可用的'+(channel==='beta'?'Beta':'Stable')+'版本',lastCheckedAt:new Date(now()).toISOString()};return snapshot();}
    const releaseURL=releasesPage+'/tag/'+encodeURIComponent(release.tag_name);
    if(release.html_url!==releaseURL)throw Error('发布页不属于已配置的更新仓库');
    const assets=Array.isArray(release.assets)?release.assets:[];
    const asset=assets.find(a=>typeof a.name==='string'&&a.state==='uploaded'&&Number.isSafeInteger(a.size)&&a.size>0&&[ `Vantilo-Beta-${release.tag_name.replace(/^v/,'')}-universal.zip`, `Vantilo-${release.tag_name.replace(/^v/,'')}-universal.zip` ].includes(a.name)&&typeof a.browser_download_url==='string'&&a.browser_download_url===releasesPage+'/download/'+encodeURIComponent(release.tag_name)+'/'+a.name);
    selected=asset?{asset,sidecar:assets.find(a=>a.name===asset.name+'.sha256'&&a.state==='uploaded'&&a.browser_download_url===releasesPage+'/download/'+encodeURIComponent(release.tag_name)+'/'+a.name),tag:release.tag_name}:null;
    const downloadAvailable=platform==='darwin'&&['arm64','x64'].includes(arch)&&Boolean(asset);
    const newer=compareVersions(release.tag_name,currentVersion)>0;
    state={...state,phase:newer?'available':'current',message:newer?(downloadAvailable?'发现新版本':'发现新版本，但没有匹配的 Universal 安装包'):'当前已是最新版本',lastCheckedAt:new Date(now()).toISOString(),latestVersion:release.tag_name,releaseURL,downloadAvailable,releaseNotes:typeof release.body==='string'?release.body.slice(0,100000):'',publishedAt:release.published_at||null,assetSize:asset?.size||null};
    if(newer&&downloadAvailable&&notified!==release.tag_name){notified=release.tag_name;try{Promise.resolve(onAvailable(snapshot())).catch(()=>{});}catch{}}
   }catch(e){state={...state,phase:closed?'stopped':'error',message:closed?'软件版本检查已停止':controller?.signal.aborted?'软件版本检查已取消':e.name==='TimeoutError'?'检查超时，请稍后重试':transientNetworkError(e)?'网络连接或 DNS 查询失败，请检查网络及代理后重试':e.message||'检查失败，请稍后重试'};}
   return snapshot();
  })().finally(()=>{pending=null;controller=null;});
  return pending;
 }
 async function trustedFetch(url,signal){
  for(let redirects=0;redirects<6;redirects++){
   const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com'].includes(parsed.hostname)||parsed.port)throw Error('下载地址不受信任');
   const response=await fetchImpl(url,{redirect:'manual',signal,headers:{'User-Agent':'Vantilo-update-download'}});
   if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location)throw Error('下载重定向无效');url=new URL(location,url).href;continue;}
   if(!response.ok)throw Error('下载失败（HTTP '+response.status+'）');return response;
  }throw Error('下载重定向过多');
 }
 async function download(){
  await load();if(downloadPending)return snapshot();if(!selected||!state.downloadAvailable||state.phase!=='available'&&state.phase!=='download-failed'&&state.phase!=='download-cancelled'&&state.phase!=='verification-failed')throw Error('没有可下载的更新');
  const current=selected;downloadController=new AbortController();const signal=AbortSignal.any([downloadController.signal,AbortSignal.timeout(15*60*1000)]);
  state={...state,phase:'choosing',message:'请选择下载位置',downloadedBytes:0,totalBytes:current.asset.size};
  downloadPending=(async()=>{let temp=null;try{
   const dir=await chooseDownloadDirectory();if(!dir){state={...state,phase:'download-cancelled',message:'下载已取消'};return;}
   if(signal.aborted)throw Object.assign(Error('下载已取消'),{name:'AbortError'});
   state={...state,phase:'downloading',message:'正在下载'};
   const resolved=await fs.realpath(dir),stat=await fs.stat(resolved);if(!stat.isDirectory())throw Error('下载目录不可用');
   if(platform==='darwin'&&resolved.startsWith('/Volumes/')){const volume=path.join('/Volumes',resolved.slice('/Volumes/'.length).split('/')[0]);if((await fs.stat(volume)).dev===(await fs.stat('/Volumes')).dev)throw Error('外置下载卷未挂载，请选择其他位置');}
   await fs.access(resolved,fsConstants.W_OK);
   if(await diskSpace(resolved)<current.asset.size+16*1024*1024)throw Error('磁盘空间不足');
   let expected=/^sha256:([a-f0-9]{64})$/i.exec(current.asset.digest||'')?.[1]?.toLowerCase();
   if(!expected){if(!current.sidecar)throw Error('缺少 SHA-256 校验信息');const side=await trustedFetch(current.sidecar.browser_download_url,signal);const parts=[];let length=0;for await(const part of side.body||[]){length+=part.length;if(length>4096)throw Error('校验文件过大');parts.push(part);}const text=Buffer.concat(parts).toString('utf8');const match=/^([a-f0-9]{64})\s+[* ]?([^\r\n]+)\s*$/i.exec(text.trim());if(!match||match[2]!==current.asset.name)throw Error('校验文件格式不匹配');expected=match[1].toLowerCase();}
   const response=await trustedFetch(current.asset.browser_download_url,signal);temp=path.join(resolved,'.vantilo-update-'+randomUUID()+'.part');const handle=await fs.open(temp,'wx',0o600);let count=0;
   try{for await(const chunk of response.body||[]){if(signal.aborted)throw Object.assign(Error('下载已取消'),{name:'AbortError'});count+=chunk.length;if(count>current.asset.size)throw Error('下载文件大小异常');await handle.writeFile(chunk);state={...state,downloadedBytes:count};}}finally{await handle.close();}
   if(count!==current.asset.size)throw Error('下载文件不完整');state={...state,phase:'verifying',message:'正在验证 SHA-256'};
   const hash=createHash('sha256');for await(const chunk of createReadStream(temp)){if(signal.aborted)throw Object.assign(Error('下载已取消'),{name:'AbortError'});hash.update(chunk);}
   if(hash.digest('hex')!==expected){state={...state,phase:'verification-failed',message:'SHA-256 校验失败，请重新下载'};return;}
   if(signal.aborted)throw Object.assign(Error('下载已取消'),{name:'AbortError'});
   const final=path.join(resolved,current.asset.name);await fs.link(temp,final);await fs.unlink(temp);temp=null;completedPath=final;state={...state,phase:'verified',message:'下载完成，校验通过',downloadedVersion:current.tag,downloadPath:final};
  }catch(error){state={...state,phase:downloadController.signal.aborted?'download-cancelled':'download-failed',message:downloadController.signal.aborted?'下载已取消':error.name==='TimeoutError'?'下载超时，请重试':error.code==='ENOENT'?'下载目录不可用，请选择其他位置':error instanceof TypeError?'网络不可用或连接中断，请重试':error.message||'下载失败，请重试'};}finally{if(temp)await fs.unlink(temp).catch(()=>{});downloadController=null;}})().finally(()=>{downloadPending=null;});
  return snapshot();
 }
 async function cancelDownload(){downloadController?.abort();return snapshot();}
 async function revealDownload(){if(!completedPath)throw Error('尚无已验证的下载文件');await fs.access(completedPath);showItemInFolder(completedPath);return snapshot();}
 function schedule(){if(timer)clearInterval(timer);timer=null;if(automatic&&!closed){timer=setInterval(()=>void check(),intervalMs);timer.unref?.();}}
 async function setAutomatic(value){if(typeof value!=='boolean')throw Error('自动检查设置无效');await load();await fs.mkdir(userData,{recursive:true,mode:0o700});const temp=preference+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify({version:1,automatic:value}),{mode:0o600});await fs.rename(temp,preference);automatic=value;schedule();return snapshot();}
 async function start(){await load();if(closed)return;schedule();if(automatic)void check();}
 async function stop(){closed=true;if(timer)clearInterval(timer);timer=null;controller?.abort();downloadController?.abort();await Promise.allSettled([pending,downloadPending]);}
 async function openRelease(){await load();if(!source.publicReleases||!state.releaseURL||!state.releaseURL.startsWith(releasesPage+'/tag/'))throw Error('当前没有可打开的公开发布版本');await openExternal(state.releaseURL);return {opened:true};}
 return {status,check,start,stop,setAutomatic,openRelease,download,cancelDownload,revealDownload};
}
module.exports={createSoftwareUpdateService,isNewerRelease,parseVersion,compareVersions,resolveUpdateCurrentVersion};
