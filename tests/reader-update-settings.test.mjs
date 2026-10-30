import {it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
const require=createRequire(import.meta.url);const {startPortableReader}=require('../electron/portable-reader-service.cjs');const {PortableReaderSupervisor}=require('../electron/portable-reader-supervisor.cjs');
it('separates persistent magazine settings from software settings and validates request scope',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'reader-update-settings-'));let server;
 const sessionToken='e'.repeat(64),sessionCookie='__Host-vantilo-reader='+sessionToken;
 const software={status:vi.fn(async()=>({currentVersion:'0.1.0',phase:'unpublished',automatic:true})),check:vi.fn(async()=>({currentVersion:'0.1.0',phase:'current',automatic:true})),setAutomatic:vi.fn(async automatic=>({automatic,currentVersion:'0.1.0',phase:'idle'})),openRelease:vi.fn(async()=>({opened:true})),download:vi.fn(async()=>({phase:'downloading'})),cancelDownload:vi.fn(async()=>({phase:'download-cancelled'})),revealDownload:vi.fn(async()=>({phase:'verified'}))};
 const fetchImpl=vi.fn(async()=>{throw Error('Offline fixture');});
 const setup=autoSync=>startPortableReader({assetsDir:path.resolve('build/reader'),libraryRoot:root,apiPort:0,webPort:0,autoSync,enableReaderPreviews:true,softwareUpdates:software,localQwenService:{inspect:async()=>({selected:false,helperAvailable:false})},fetchImpl,sessionToken});
 const call=async(method,url,body)=>{const response=await fetch(server.webOrigin+'/api/vantilo-updates/'+url,{method,headers:{'Content-Type':'application/json',cookie:sessionCookie},...(body?{body:JSON.stringify(body)}:{})});return {code:response.status,value:await response.json()};};
 try{server=await setup(false);expect((await call('PUT','magazines',{automatic:false})).value.enabled).toBe(false);expect(software.setAutomatic).not.toHaveBeenCalled();await server.close();server=null;
  server=await setup(true);expect((await call('GET','magazines')).value.enabled).toBe(false);expect(fetchImpl).not.toHaveBeenCalled();
  expect((await call('PUT','software',{automatic:false})).value.automatic).toBe(false);expect((await call('GET','magazines')).value.enabled).toBe(false);
  expect((await call('POST','magazines/check',{})).code).toBe(202);await server.sync.pending;expect(fetchImpl).toHaveBeenCalled();
  expect((await call('PUT','software',{automatic:'yes'})).code).toBe(400);
  expect((await call('POST','software/open-release',{url:'https://evil.test'})).code).toBe(400);expect(software.openRelease).not.toHaveBeenCalled();
  expect((await call('POST','software/download',{})).value.phase).toBe('downloading');expect((await call('POST','software/cancel-download',{})).value.phase).toBe('download-cancelled');expect((await call('POST','software/reveal-download',{})).value.phase).toBe('verified');expect((await call('POST','software/download',{path:'/tmp/evil'})).code).toBe(400);
  const blocked=await fetch(server.webOrigin+'/api/vantilo-updates/software',{headers:{origin:'https://evil.test',cookie:sessionCookie}});expect(blocked.status).toBe(403);
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});
it('brokers update metadata separately from model inference, including automatic-off status',async()=>{
 const child=new EventEmitter();child.postMessage=vi.fn();child.kill=vi.fn();
 const status=vi.fn(async()=>({phase:'unpublished',currentVersion:'0.1.0'})),runAi=vi.fn();
 const supervisor=new PortableReaderSupervisor({utilityProcess:{fork:()=>child},assetsDir:'/test/assets',libraryRoot:'/test/library',softwareUpdates:{status},runAi,timeoutMs:1000,installSessionCookie:async()=>{},clearSessionCookie:async()=>{}});
 const started=supervisor.start();child.emit('message',{type:'ready',sync:{enabled:false,status:'idle',message:'paused',importedCount:0,failedCount:0}});await started;
 expect(supervisor.getStatus().sync.enabled).toBe(false);
 const requestId='11111111-1111-4111-8111-111111111111';child.emit('message',{type:'ai',requestId,operation:'software-status'});await new Promise(r=>setTimeout(r,0));
 expect(status).toHaveBeenCalledOnce();expect(runAi).not.toHaveBeenCalled();expect(child.postMessage).toHaveBeenCalledWith({type:'ai-result',requestId,ok:true,metadata:{phase:'unpublished',currentVersion:'0.1.0'}});
 const stopped=supervisor.stop();child.emit('exit',0);await stopped;
});
