'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
function parseVersion(value){
 if(typeof value!=='string'||value.length>80)return null;
 const match=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
 if(!match)return null;const numbers=match.slice(1,4).map(Number);if(numbers.some(n=>!Number.isSafeInteger(n)))return null;
 return {numbers,prerelease:match[4]||null};
}
function isNewerRelease(tag,current){const a=parseVersion(tag),b=parseVersion(current);if(!a||!b||a.prerelease)return false;for(let i=0;i<3;i++){if(a.numbers[i]!==b.numbers[i])return a.numbers[i]>b.numbers[i];}return !!b.prerelease;}
function createSoftwareUpdateService({userData,currentVersion,source,fetchImpl=fetch,openExternal=async()=>{},onAvailable=()=>{},platform=process.platform,arch=process.arch,now=Date.now,intervalMs=24*60*60*1000}){
 if(!path.isAbsolute(userData)||!parseVersion(currentVersion)||!source||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository))throw new Error('软件更新配置无效');
 const preference=path.join(userData,'software-update-preferences.json');const repository=source.repository;
 const releasesPage='https://github.com/'+repository+'/releases';
 let automatic=true,loaded=null,timer=null,pending=null,controller=null,closed=false,notified=null;
 let state={phase:source.publicReleases?'idle':'unconfigured',message:source.publicReleases?'尚未检查软件版本':'发布仓库尚未公开，软件更新源暂未就绪',currentVersion,lastCheckedAt:null,latestVersion:null,releaseURL:null,downloadAvailable:false,installSupported:false};
 async function load(){if(!loaded)loaded=(async()=>{try{const value=JSON.parse(await fs.readFile(preference,'utf8'));if(value.version!==1||typeof value.automatic!=='boolean')throw Error();automatic=value.automatic;}catch(e){if(e.code!=='ENOENT'){automatic=false;state={...state,phase:'error',message:'自动检查设置读取失败，请重新设置'};}}})();await loaded;}
 const snapshot=()=>({...state,automatic,repository,releasesPage});
 async function status(){await load();return snapshot();}
 async function check(){
  await load();if(closed)return snapshot();if(pending)return pending;
  if(!source.publicReleases){state={...state,phase:'unconfigured',message:'发布仓库尚未公开，软件更新源暂未就绪'};return snapshot();}
  controller=new AbortController();state={...state,phase:'checking',message:'正在检查软件新版本…'};
  pending=(async()=>{
   try{
    const response=await fetchImpl('https://api.github.com/repos/'+repository+'/releases/latest',{method:'GET',redirect:'error',headers:{Accept:'application/vnd.github+json','User-Agent':'Vantilo-update-check','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
    if(response.status===404){state={...state,phase:'unpublished',lastCheckedAt:new Date(now()).toISOString(),message:'尚无可公开访问的正式版本，请先公开发布仓库并创建 Release'};return snapshot();}
    if(!response.ok)throw Error(response.status===403||response.status===429?'GitHub 暂时限制检查，请稍后重试':'软件更新服务暂不可用');
    if(Number(response.headers.get('content-length'))>2*1024*1024)throw Error('版本信息过大');
    const chunks=[];let size=0;for await(const chunk of response.body||[]){size+=chunk.length;if(size>2*1024*1024)throw Error('版本信息过大');chunks.push(chunk);}
    let release;try{release=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('版本信息格式无效');}
    if(release.draft||release.prerelease||!parseVersion(release.tag_name)||parseVersion(release.tag_name).prerelease)throw Error('没有可用的稳定版信息');
    const releaseURL=releasesPage+'/tag/'+encodeURIComponent(release.tag_name);
    if(release.html_url!==releaseURL)throw Error('发布页不属于已配置的更新仓库');
    const assets=Array.isArray(release.assets)?release.assets:[];
    const downloadAvailable=assets.some(a=>typeof a.name==='string'&&a.state==='uploaded'&&a.size>0&&/\.(?:zip|dmg|exe|msix)$/i.test(a.name)&&a.name.toLowerCase().includes(arch)&&
      (platform==='darwin'?/(?:mac|darwin|osx)/i.test(a.name):platform==='win32'?/(?:win|windows)/i.test(a.name):false)&&
      typeof a.browser_download_url==='string'&&a.browser_download_url.startsWith(releasesPage+'/download/'+encodeURIComponent(release.tag_name)+'/'));
    const newer=isNewerRelease(release.tag_name,currentVersion);
    state={...state,phase:newer?'available':'current',message:newer?(downloadAvailable?'发现新版本，可前往发布页下载安装':'发现新版本，但尚未上传适配本机的安装包'):'当前已是最新稳定版',lastCheckedAt:new Date(now()).toISOString(),latestVersion:release.tag_name,releaseURL,downloadAvailable};
    if(newer&&downloadAvailable&&notified!==release.tag_name){notified=release.tag_name;try{Promise.resolve(onAvailable(snapshot())).catch(()=>{});}catch{}}
   }catch(e){state={...state,phase:closed?'stopped':'error',message:closed?'软件版本检查已停止':controller?.signal.aborted?'软件版本检查已取消':e.name==='TimeoutError'?'检查超时，请稍后重试':e.message||'检查失败，请稍后重试'};}
   return snapshot();
  })().finally(()=>{pending=null;controller=null;});
  return pending;
 }
 function schedule(){if(timer)clearInterval(timer);timer=null;if(automatic&&!closed){timer=setInterval(()=>void check(),intervalMs);timer.unref?.();}}
 async function setAutomatic(value){if(typeof value!=='boolean')throw Error('自动检查设置无效');await load();await fs.mkdir(userData,{recursive:true,mode:0o700});const temp=preference+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify({version:1,automatic:value}),{mode:0o600});await fs.rename(temp,preference);automatic=value;schedule();return snapshot();}
 async function start(){await load();if(closed)return;schedule();if(automatic)void check();}
 async function stop(){closed=true;if(timer)clearInterval(timer);timer=null;controller?.abort();await pending;}
 async function openRelease(){await load();if(!source.publicReleases||!state.releaseURL||!state.releaseURL.startsWith(releasesPage+'/tag/'))throw Error('当前没有可打开的公开发布版本');await openExternal(state.releaseURL);return {opened:true};}
 return {status,check,start,stop,setAutomatic,openRelease};
}
module.exports={createSoftwareUpdateService,isNewerRelease,parseVersion};
