import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const {createSoftwareUpdateService,isNewerRelease,compareVersions,resolveUpdateCurrentVersion}=createRequire(import.meta.url)('../electron/software-update-service.cjs');
const repo='owner/vantilo';const page='https://github.com/'+repo+'/releases';
it('accepts a test version only in an unpackaged app',()=>{
 expect(resolveUpdateCurrentVersion({isPackaged:false,currentVersion:'0.1.12',testVersion:'0.1.11'})).toBe('0.1.11');
 expect(resolveUpdateCurrentVersion({isPackaged:true,currentVersion:'0.1.12',testVersion:'0.1.11'})).toBe('0.1.12');
 expect(resolveUpdateCurrentVersion({isPackaged:true,currentVersion:'0.1.12',testVersion:'invalid'})).toBe('0.1.12');
 expect(()=>resolveUpdateCurrentVersion({isPackaged:false,currentVersion:'0.1.12',testVersion:'invalid'})).toThrow();
});
const release=(tag='v1.10.0',arch='arm64')=>{const name=arch==='arm64'?'Vantilo-Beta-'+tag.slice(1)+'-universal.zip':'Vantilo-'+tag+'-darwin-'+arch+'.zip';return {tag_name:tag,html_url:page+'/tag/'+tag,draft:false,prerelease:false,assets:[{name,size:1234,state:'uploaded',browser_download_url:page+'/download/'+tag+'/'+name}]};};
async function fixture(fn,publicReleases=true){const root=await mkdtemp(path.join(os.tmpdir(),'software-updates-'));const fetch=vi.fn(async()=>new Response(JSON.stringify([release()]))),open=vi.fn(),notify=vi.fn();
 const make=()=>createSoftwareUpdateService({userData:root,currentVersion:'1.2.0',source:{repository:repo,publicReleases},fetchImpl:fetch,openExternal:open,onAvailable:notify,platform:'darwin',arch:'arm64'});
 const service=make();try{await fn({service,fetch,open,notify,make});}finally{await service.stop();await rm(root,{recursive:true,force:true});}}
describe('safe GitHub software version checks',()=>{
 it('compares semantic versions numerically and excludes unstable latest tags',()=>{
  expect(isNewerRelease('v1.10.0','1.9.0')).toBe(true);expect(isNewerRelease('v1.2.0','1.2.0')).toBe(false);expect(isNewerRelease('v1.1.9','1.2.0')).toBe(false);expect(isNewerRelease('v1.2.0-beta','1.1.0')).toBe(false);expect(isNewerRelease('v1.2.0','1.2.0-beta')).toBe(true);
 });
 it('shows newer matching releases and only opens the fixed repository page after explicit action',()=>fixture(async c=>{
  const state=await c.service.check();expect(state).toMatchObject({phase:'available',latestVersion:'v1.10.0',downloadAvailable:true,installSupported:false});expect(c.notify).toHaveBeenCalledOnce();expect(c.open).not.toHaveBeenCalled();
  await c.service.check();expect(c.notify).toHaveBeenCalledOnce();await c.service.openRelease();expect(c.open).toHaveBeenCalledWith(page+'/tag/v1.10.0');
  expect(c.fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/'+repo+'/releases?per_page=100');expect(c.fetch.mock.calls[0][1]).toMatchObject({redirect:'error'});expect(c.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
 }));
 it('does not pretend that a private or unpublished repository is up to date',async()=>{
  await fixture(async c=>{await c.service.start();expect((await c.service.status()).phase).toBe('unconfigured');expect(c.fetch).not.toHaveBeenCalled();},false);
  await fixture(async c=>{c.fetch.mockResolvedValue(new Response('{}',{status:404}));expect((await c.service.check()).phase).toBe('unpublished');expect(c.notify).not.toHaveBeenCalled();});
 });
 it('persists software preference independently and still supports manual checking',()=>fixture(async c=>{
  await c.service.setAutomatic(false);const restarted=c.make();try{await restarted.start();expect((await restarted.status()).automatic).toBe(false);expect(c.fetch).not.toHaveBeenCalled();expect((await restarted.check()).phase).toBe('available');}finally{await restarted.stop();}
 }));
 it('rejects hostile release URLs and never offers a wrong-architecture install',async()=>{
  await fixture(async c=>{c.fetch.mockResolvedValue(new Response(JSON.stringify([{...release(),html_url:'https://evil.test/setup'}])));expect((await c.service.check()).phase).toBe('error');await expect(c.service.openRelease()).rejects.toThrow();expect(c.open).not.toHaveBeenCalled();});
  await fixture(async c=>{c.fetch.mockResolvedValue(new Response(JSON.stringify([release('v2.0.0','x64')])));expect((await c.service.check()).downloadAvailable).toBe(false);expect(c.notify).not.toHaveBeenCalled();});
 });
 it('reports offline failures as errors and coalesces overlapping checks',()=>fixture(async c=>{
  let entered,finish;const started=new Promise(r=>entered=r);c.fetch.mockImplementation(async()=>{entered();return await new Promise(r=>finish=r);});
  const first=c.service.check();await started;const second=c.service.check();finish(new Response(JSON.stringify([release()])));await Promise.all([first,second]);expect(c.fetch).toHaveBeenCalledOnce();
  c.fetch.mockRejectedValue(new Error('Network unavailable'));expect((await c.service.check()).phase).toBe('error');
 }));
 it('does not mistake a GitHub source-only release for an installable package',()=>fixture(async c=>{
  c.fetch.mockResolvedValue(new Response(JSON.stringify([{...release(),assets:[]}])));expect((await c.service.check()).downloadAvailable).toBe(false);expect(c.notify).not.toHaveBeenCalled();
 }));
});

it('compares SemVer prereleases and rejects invalid numeric identifiers',()=>{expect(compareVersions('1.0.0-beta.11','1.0.0-beta.2')).toBe(1);expect(compareVersions('1.0.0-beta','1.0.0')).toBe(-1);expect(compareVersions('1.0.0-beta.01','1.0.0')).toBeNull();});
it('selects the newest Beta independently from Stable releases and prevents downgrade',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'software-channel-'));
 const beta={...release('v1.3.0'),prerelease:true,body:'Beta notes',published_at:'2026-01-01T00:00:00Z'};
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify([release('v2.0.0'),beta,{...release('v3.0.0'),draft:true,prerelease:true}])));
 const make=(channel,currentVersion='1.2.0')=>createSoftwareUpdateService({userData:root,currentVersion,source:{repository:repo,publicReleases:true,channel},fetchImpl,platform:'darwin',arch:'arm64'});
 const b=make('beta'),s=make('stable'),newer=make('beta','1.4.0');try{expect(await b.check()).toMatchObject({phase:'available',latestVersion:'v1.3.0',channel:'beta',releaseNotes:'Beta notes',assetSize:1234});expect((await s.check()).latestVersion).toBe('v2.0.0');expect((await newer.check()).phase).toBe('current');}finally{await Promise.all([b.stop(),s.stop(),newer.stop()]);await rm(root,{recursive:true,force:true});}
});

describe('isolated update downloads',()=>{
 async function setup(options={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'software-download-'));const data=Buffer.from('synthetic update');const {createHash}=await import('node:crypto');const digest=createHash('sha256').update(data).digest('hex');
  const item=release('v1.3.0');item.prerelease=true;item.assets[0].size=data.length;item.assets[0].digest='sha256:'+(options.badHash?'0'.repeat(64):digest);
  const fetchImpl=vi.fn(async url=>url.includes('api.github.com')?new Response(JSON.stringify([item])):options.response?options.response():new Response(data));
  const show=vi.fn(),service=createSoftwareUpdateService({userData:root,currentVersion:'1.2.0',source:{repository:repo,publicReleases:true,channel:'beta'},fetchImpl,platform:'darwin',arch:'arm64',chooseDownloadDirectory:async()=>options.directory??root,diskSpace:async()=>options.space??100000000,showItemInFolder:show});
  await service.check();return {root,service,show,fetchImpl,item,data};
 }
 async function finish(service){for(let i=0;i<100;i++){const s=await service.status();if(!['downloading','verifying'].includes(s.phase))return s;await new Promise(r=>setTimeout(r,5));}throw Error('download did not finish');}
 it('downloads, verifies and reveals the file without overwriting another file',async()=>{const f=await setup();try{await f.service.download();const state=await finish(f.service);expect(state.phase).toBe('verified');await f.service.revealDownload();expect(f.show).toHaveBeenCalledWith(state.downloadPath);}finally{await f.service.stop();await rm(f.root,{recursive:true,force:true});}});
 it('rejects a wrong hash, removes the partial file and permits retry',async()=>{const f=await setup({badHash:true});try{await f.service.download();expect((await finish(f.service)).phase).toBe('verification-failed');await expect((await import('node:fs/promises')).readdir(f.root)).resolves.toEqual([]);await f.service.download();expect((await finish(f.service)).phase).toBe('verification-failed');}finally{await f.service.stop();await rm(f.root,{recursive:true,force:true});}});
 it('reports insufficient space and missing directories',async()=>{for(const opts of [{space:0},{directory:'/no-such-vantilo-download-directory'}]){const f=await setup(opts);try{await f.service.download();expect((await finish(f.service)).phase).toBe('download-failed');}finally{await f.service.stop();await rm(f.root,{recursive:true,force:true});}}});
 it('reports interrupted and incomplete streams and allows retry',async()=>{let count=0;const f=await setup({response:()=>{count++;return new Response(count===1?Buffer.from('short'):Buffer.from('synthetic update'));}});try{await f.service.download();expect((await finish(f.service)).phase).toBe('download-failed');await vi.waitFor(async()=>expect(await (await import('node:fs/promises')).readdir(f.root)).toEqual([]));await f.service.download();expect((await finish(f.service)).phase).toBe('verified');}finally{await f.service.stop();await rm(f.root,{recursive:true,force:true});}});
 it('cancels and coalesces repeated download requests',async()=>{let choose;const f=await setup();try{const original=f.fetchImpl;original.mockImplementation(async url=>url.includes('api.github.com')?new Response(JSON.stringify([f.item])):new Response(new ReadableStream({start(controller){choose=()=>controller.close();}})));await Promise.all([f.service.download(),f.service.download()]);await new Promise(r=>setTimeout(r,10));await f.service.cancelDownload();choose();expect((await finish(f.service)).phase).toBe('download-cancelled');expect(original.mock.calls.filter(c=>!c[0].includes('api.github.com'))).toHaveLength(1);}finally{await f.service.stop();await rm(f.root,{recursive:true,force:true});}});
});
it('reports GitHub rate limits without calling the current version up to date',()=>fixture(async c=>{c.fetch.mockResolvedValue(new Response('{}',{status:429}));const state=await c.service.check();expect(state.phase).toBe('error');expect(state.message).toContain('限制');}));
it('uses the matching SHA-256 sidecar when the API has no digest',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'software-sidecar-'));const data=Buffer.from('synthetic sidecar');const {createHash}=await import('node:crypto');const digest=createHash('sha256').update(data).digest('hex');const item=release('v1.3.0');item.prerelease=true;item.assets[0].size=data.length;const zip=item.assets[0];item.assets.push({name:zip.name+'.sha256',state:'uploaded',browser_download_url:zip.browser_download_url+'.sha256'});
 const fetchImpl=vi.fn(async url=>url.includes('api.github.com')?new Response(JSON.stringify([item])):url.endsWith('.sha256')?new Response(digest+'  '+zip.name+'\n'):new Response(data));
 const service=createSoftwareUpdateService({userData:root,currentVersion:'1.2.0',source:{repository:repo,publicReleases:true,channel:'beta'},fetchImpl,platform:'darwin',arch:'arm64',chooseDownloadDirectory:async()=>root,diskSpace:async()=>100000000});
 try{await service.check();await service.download();let state;for(let i=0;i<100;i++){state=await service.status();if(state.phase!=='downloading'&&state.phase!=='verifying')break;await new Promise(r=>setTimeout(r,5));}expect(state.phase).toBe('verified');}finally{await service.stop();await rm(root,{recursive:true,force:true});}
});
it('fails closed when both digest and sidecar are missing',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'software-no-hash-'));const item=release('v1.3.0');item.prerelease=true;
 const service=createSoftwareUpdateService({userData:root,currentVersion:'1.2.0',source:{repository:repo,publicReleases:true,channel:'beta'},fetchImpl:async()=>new Response(JSON.stringify([item])),platform:'darwin',arch:'arm64',chooseDownloadDirectory:async()=>root,diskSpace:async()=>1e9});
 try{await service.check();await service.download();let state;for(let i=0;i<100;i++){state=await service.status();if(state.phase!=='downloading')break;await new Promise(r=>setTimeout(r,5));}expect(state.phase).toBe('download-failed');expect(state.message).toContain('SHA-256');}finally{await service.stop();await rm(root,{recursive:true,force:true});}
});
it('cleans the partial file after an interrupted network stream',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'software-network-'));const item=release('v1.3.0');item.prerelease=true;item.assets[0].size=100;item.assets[0].digest='sha256:'+'0'.repeat(64);
 const service=createSoftwareUpdateService({userData:root,currentVersion:'1.2.0',source:{repository:repo,publicReleases:true,channel:'beta'},fetchImpl:async url=>url.includes('api.github.com')?new Response(JSON.stringify([item])):new Response(new ReadableStream({pull(controller){controller.error(new TypeError('network interrupted'));}})),platform:'darwin',arch:'arm64',chooseDownloadDirectory:async()=>root,diskSpace:async()=>1e9});
 try{await service.check();await service.download();let state;for(let i=0;i<100;i++){state=await service.status();if(state.phase!=='downloading')break;await new Promise(r=>setTimeout(r,5));}expect(state.phase).toBe('download-failed');expect(state.message).toContain('网络');await expect((await import('node:fs/promises')).readdir(root)).resolves.toEqual([]);}finally{await service.stop();await rm(root,{recursive:true,force:true});}
});

describe('bounded update check retries',()=>{
 async function context(fetchImpl){const root=await mkdtemp(path.join(os.tmpdir(),'update-retry-'));const waits=[];const service=createSoftwareUpdateService({userData:root,currentVersion:'1.2.0',source:{repository:repo,publicReleases:true},fetchImpl,retryWait:async ms=>{waits.push(ms);},platform:'darwin',arch:'arm64'});return {root,service,waits};}
 it('recovers from a transient startup DNS failure with bounded backoff',async()=>{const fetchImpl=vi.fn().mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'),{cause:{code:'EAI_AGAIN'}})).mockResolvedValue(new Response(JSON.stringify([release()])));const c=await context(fetchImpl);try{await c.service.start();for(let i=0;i<100&&(await c.service.status()).phase!=='available';i++)await new Promise(r=>setTimeout(r,1));expect((await c.service.status()).phase).toBe('available');expect(fetchImpl).toHaveBeenCalledTimes(2);expect(c.waits).toEqual([400]);}finally{await c.service.stop();await rm(c.root,{recursive:true,force:true});}});
 it('retries the generic fetch failed error observed in Electron',async()=>{const fetchImpl=vi.fn().mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValue(new Response(JSON.stringify([release()])));const c=await context(fetchImpl);try{expect((await c.service.check()).phase).toBe('available');expect(c.waits).toEqual([400]);}finally{await c.service.stop();await rm(c.root,{recursive:true,force:true});}});
 it('reports continuous network failure and retains last successful release metadata',async()=>{const fetchImpl=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([release()]))).mockRejectedValue(new TypeError('fetch failed'));const c=await context(fetchImpl);try{const previous=await c.service.check();const failed=await c.service.check();expect(failed).toMatchObject({phase:'error',latestVersion:previous.latestVersion,releaseURL:previous.releaseURL,lastCheckedAt:previous.lastCheckedAt});expect(failed.message).toContain('网络');expect(fetchImpl).toHaveBeenCalledTimes(4);expect(c.waits).toEqual([400,800]);}finally{await c.service.stop();await rm(c.root,{recursive:true,force:true});}});
 it('does not retry a rate limit and retains manual checking',async()=>{const fetchImpl=vi.fn().mockResolvedValueOnce(new Response('',{status:429})).mockResolvedValueOnce(new Response(JSON.stringify([release()])));const c=await context(fetchImpl);try{expect((await c.service.check()).phase).toBe('error');expect(c.waits).toEqual([]);expect((await c.service.check()).phase).toBe('available');}finally{await c.service.stop();await rm(c.root,{recursive:true,force:true});}});
});
