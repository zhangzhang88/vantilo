import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const {createSoftwareUpdateService,isNewerRelease}=createRequire(import.meta.url)('../electron/software-update-service.cjs');
const repo='owner/vantilo';const page='https://github.com/'+repo+'/releases';
const release=(tag='v1.10.0',arch='arm64')=>({tag_name:tag,html_url:page+'/tag/'+tag,draft:false,prerelease:false,assets:[{name:'Vantilo-'+tag+'-darwin-'+arch+'.zip',size:1234,state:'uploaded',browser_download_url:page+'/download/'+tag+'/Vantilo.zip'}]});
async function fixture(fn,publicReleases=true){const root=await mkdtemp(path.join(os.tmpdir(),'software-updates-'));const fetch=vi.fn(async()=>new Response(JSON.stringify(release()))),open=vi.fn(),notify=vi.fn();
 const make=()=>createSoftwareUpdateService({userData:root,currentVersion:'1.2.0',source:{repository:repo,publicReleases},fetchImpl:fetch,openExternal:open,onAvailable:notify,platform:'darwin',arch:'arm64'});
 const service=make();try{await fn({service,fetch,open,notify,make});}finally{await service.stop();await rm(root,{recursive:true,force:true});}}
describe('safe GitHub software version checks',()=>{
 it('compares semantic versions numerically and excludes unstable latest tags',()=>{
  expect(isNewerRelease('v1.10.0','1.9.0')).toBe(true);expect(isNewerRelease('v1.2.0','1.2.0')).toBe(false);expect(isNewerRelease('v1.1.9','1.2.0')).toBe(false);expect(isNewerRelease('v1.2.0-beta','1.1.0')).toBe(false);expect(isNewerRelease('v1.2.0','1.2.0-beta')).toBe(true);
 });
 it('shows newer matching releases and only opens the fixed repository page after explicit action',()=>fixture(async c=>{
  const state=await c.service.check();expect(state).toMatchObject({phase:'available',latestVersion:'v1.10.0',downloadAvailable:true,installSupported:false});expect(c.notify).toHaveBeenCalledOnce();expect(c.open).not.toHaveBeenCalled();
  await c.service.check();expect(c.notify).toHaveBeenCalledOnce();await c.service.openRelease();expect(c.open).toHaveBeenCalledWith(page+'/tag/v1.10.0');
  expect(c.fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/'+repo+'/releases/latest');expect(c.fetch.mock.calls[0][1]).toMatchObject({redirect:'error'});expect(c.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
 }));
 it('does not pretend that a private or unpublished repository is up to date',async()=>{
  await fixture(async c=>{await c.service.start();expect((await c.service.status()).phase).toBe('unconfigured');expect(c.fetch).not.toHaveBeenCalled();},false);
  await fixture(async c=>{c.fetch.mockResolvedValue(new Response('{}',{status:404}));expect((await c.service.check()).phase).toBe('unpublished');expect(c.notify).not.toHaveBeenCalled();});
 });
 it('persists software preference independently and still supports manual checking',()=>fixture(async c=>{
  await c.service.setAutomatic(false);const restarted=c.make();try{await restarted.start();expect((await restarted.status()).automatic).toBe(false);expect(c.fetch).not.toHaveBeenCalled();expect((await restarted.check()).phase).toBe('available');}finally{await restarted.stop();}
 }));
 it('rejects hostile release URLs and never offers a wrong-architecture install',async()=>{
  await fixture(async c=>{c.fetch.mockResolvedValue(new Response(JSON.stringify({...release(),html_url:'https://evil.test/setup'})));expect((await c.service.check()).phase).toBe('error');await expect(c.service.openRelease()).rejects.toThrow();expect(c.open).not.toHaveBeenCalled();});
  await fixture(async c=>{c.fetch.mockResolvedValue(new Response(JSON.stringify(release('v2.0.0','x64'))));expect((await c.service.check()).downloadAvailable).toBe(false);expect(c.notify).not.toHaveBeenCalled();});
 });
 it('reports offline failures as errors and coalesces overlapping checks',()=>fixture(async c=>{
  let entered,finish;const started=new Promise(r=>entered=r);c.fetch.mockImplementation(async()=>{entered();return await new Promise(r=>finish=r);});
  const first=c.service.check();await started;const second=c.service.check();finish(new Response(JSON.stringify(release())));await Promise.all([first,second]);expect(c.fetch).toHaveBeenCalledOnce();
  c.fetch.mockRejectedValue(new Error('Network unavailable'));expect((await c.service.check()).phase).toBe('error');
 }));
 it('does not mistake a GitHub source-only release for an installable package',()=>fixture(async c=>{
  c.fetch.mockResolvedValue(new Response(JSON.stringify({...release(),assets:[]})));expect((await c.service.check()).downloadAvailable).toBe(false);expect(c.notify).not.toHaveBeenCalled();
 }));
});
