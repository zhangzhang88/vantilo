import {describe,it,expect,vi,afterEach} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {MagazineSyncController,DEFAULT_INTERVAL_MS}=require('../electron/magazine-sync-controller.cjs');
const {createMagazineFetch}=require('../electron/magazine-github-fetch.cjs');
const {startPortableReader}=require('../electron/portable-reader-service.cjs');
afterEach(()=>vi.restoreAllMocks());
async function schedulerCase(fn){const root=await mkdtemp(path.join(os.tmpdir(),'auto-magazine-clock-'));const ticks=[];
 vi.spyOn(globalThis,'setInterval').mockImplementation(callback=>{ticks.push(callback);return {unref(){}};});
 try{await fn({stateFile:path.join(root,'sync.json'),ticks});}finally{await rm(root,{recursive:true,force:true});}}
describe('automatic publication schedule',()=>{
 it('checks at startup and the real three-hour boundary, and catches up after days closed',()=>schedulerCase(async c=>{
  expect(DEFAULT_INTERVAL_MS).toBe(3*60*60*1000);let now=Date.parse('2026-10-26T00:00:00Z');const run=vi.fn(async()=>({importedCount:0,failedCount:0}));
  const first=new MagazineSyncController({stateFile:c.stateFile,syncImpl:run,now:()=>now,checkOnStart:true});await first.initialize();first.start();await first.pending;expect(run).toHaveBeenCalledOnce();
  now+=DEFAULT_INTERVAL_MS-1;c.ticks[0]();expect(run).toHaveBeenCalledOnce();
  now++;c.ticks[0]();await first.pending;expect(run).toHaveBeenCalledTimes(2);await first.stop();
  now+=2*24*60*60*1000;const next=new MagazineSyncController({stateFile:c.stateFile,syncImpl:run,now:()=>now,checkOnStart:true});await next.initialize();next.start();await next.pending;expect(run).toHaveBeenCalledTimes(3);await next.stop();
  now+=DEFAULT_INTERVAL_MS;c.ticks.forEach(tick=>tick());expect(run).toHaveBeenCalledTimes(3);
 }));
 it('checks once on every reopening and retries offline failures after five minutes',()=>schedulerCase(async c=>{
  let now=Date.parse('2026-10-26T00:00:00Z');const run=vi.fn(async()=>({importedCount:0,failedCount:4}));
  const first=new MagazineSyncController({stateFile:c.stateFile,syncImpl:run,now:()=>now,checkOnStart:true});await first.initialize();first.start();await first.pending;
  now+=5*60*1000-1;c.ticks[0]();expect(run).toHaveBeenCalledOnce();now++;c.ticks[0]();await first.pending;expect(run).toHaveBeenCalledTimes(2);await first.stop();
  run.mockResolvedValue({importedCount:0,failedCount:0});const next=new MagazineSyncController({stateFile:c.stateFile,syncImpl:run,now:()=>now,checkOnStart:true});await next.initialize();next.start();await next.pending;await next.stop();
  now+=1000;const again=new MagazineSyncController({stateFile:c.stateFile,syncImpl:run,now:()=>now,checkOnStart:true});await again.initialize();again.start();await again.pending;expect(run).toHaveBeenCalledTimes(4);await again.stop();
 }));
});
describe('same-repository download recovery',()=>{
 it('uses bounded GitHub raw Contents on a raw-host timeout without credentials or redirects',async()=>{
  const progress=vi.fn();const fetch=vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(new Response('epub bytes', {headers:{'content-length':String(6*1024*1024)}}));
  const request=createMagazineFetch({fetchImpl:fetch,onProgress:progress});const response=await request('https://raw.githubusercontent.com/hehonghui/awesome-english-ebooks/master/05_wired/2026.10.02/wired.epub',{headers:{Authorization:'never-forward'}});
  expect(await response.text()).toBe('epub bytes');expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).toBe('https://api.github.com/repos/hehonghui/awesome-english-ebooks/contents/05_wired/2026.10.02/wired.epub?ref=master');
  expect(fetch.mock.calls[1][1]).toMatchObject({redirect:'error',headers:{Accept:'application/vnd.github.raw+json'}});expect(fetch.mock.calls[1][1].headers.Authorization).toBeUndefined();expect(progress.mock.calls.flat().join('')).not.toContain('wired.epub');
 });
 it('never starts a fallback after shutdown or an oversized response',async()=>{
  const ctl=new AbortController();const fetch=vi.fn(async()=>{ctl.abort();throw new Error('aborted');});
  await expect(createMagazineFetch({fetchImpl:fetch,signal:ctl.signal})('https://raw.githubusercontent.com/hehonghui/awesome-english-ebooks/master/a.epub')).rejects.toThrow();expect(fetch).toHaveBeenCalledOnce();
  const big=vi.fn(async()=>new Response('x',{headers:{'content-length':String(101*1024*1024)}}));await expect(createMagazineFetch({fetchImpl:big})('https://raw.githubusercontent.com/hehonghui/awesome-english-ebooks/master/a.epub')).rejects.toThrow('too large');expect(big).toHaveBeenCalledOnce();
 });
});
it('starts fetching four magazines with no clicks or model calls',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'auto-magazines-start-'));let service;const states=[],sessionToken='f'.repeat(64),sessionCookie='__Host-vantilo-reader='+sessionToken;
 const epub=await readFile('tests/fixtures/minimal-magazine.epub'),dirs=['01_economist','02_new_yorker','04_atlantic','05_wired'],names=['TheEconomist','NewYorker','TheAtlantic','Wired'];
 const runAi=vi.fn(async()=>{throw Error('No model allowed');});const fetchImpl=vi.fn(async input=>{
  const url=new URL(input);if(url.hostname==='raw.githubusercontent.com')return new Response(epub);
  const relative=decodeURIComponent(url.pathname.split('/contents/')[1]);const i=dirs.indexOf(relative.split('/')[0]);if(i<0)throw Error('Unexpected source');
  const prefix=dirs[i]+'/2026.10.31',name=names[i]+'.2026.10.31.epub';return new Response(JSON.stringify(relative.includes('/')?[{type:'file',name,path:prefix+'/'+name,download_url:'https://raw.githubusercontent.com/hehonghui/awesome-english-ebooks/master/'+prefix+'/'+name}]:[{type:'dir',name:'2026.10.31',path:prefix}]));
 });
 try{service=await startPortableReader({assetsDir:path.resolve('build/reader-qwen-translation-stage'),libraryRoot:root,apiPort:0,webPort:0,autoSync:true,enableLocalQwen:true,runAi,fetchImpl,onSync:state=>states.push(state),localQwenService:{inspect:async()=>({selected:false,helperAvailable:false})},sessionToken});
  await service.sync.pending;expect((await fetch(service.webOrigin+'/api/issues',{headers:{cookie:sessionCookie}}).then(r=>r.json()))).toHaveLength(4);expect(states.at(-1)).toMatchObject({status:'idle',importedCount:4,enabled:true});expect(runAi).not.toHaveBeenCalled();
  const calls=fetchImpl.mock.calls.length;await service.close();service=null;await new Promise(r=>setTimeout(r,20));expect(fetchImpl).toHaveBeenCalledTimes(calls);
 }finally{await service?.close();await rm(root,{recursive:true,force:true});}
});
