import {describe,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {readerSourceRoot} from '../scripts/reader-source-path.mjs';
const require=createRequire(import.meta.url);
const readerRequire=createRequire(path.join(readerSourceRoot,'package.json'));
const Fastify=readerRequire('fastify');
const {registerCatalogPreview}=require('../electron/reader-catalog-preview.cjs');
const {startPortableReader}=require('../electron/portable-reader-service.cjs');
const book={id:'fixture',sourceFingerprint:'v1',parts:[{id:'p1',title:'Part One'}],chapters:[{id:'c1',title:'One idea'}]};
const issue={id:'fixture',sourceFingerprint:'v1',sections:['Ideas'],articles:[{id:'a1',title:'Clear writing'}]};
async function fixture(fn, customApi){
 const dir=await mkdtemp(path.join(os.tmpdir(),'catalog-test-'));const api=Fastify();
 const runAi=vi.fn(async p=>JSON.stringify(JSON.parse(p.input).map(r=>({id:r.id,titleZh:'中文 '+r.title}))));
 const account=vi.fn(async()=>({connected:true}));const docs=vi.fn(async kind=>kind==='book'?book:issue);
 const listModels=async()=>({models:[{id:'model-a',displayName:'A',isDefault:true,defaultEffort:'low'},{id:'model-b',displayName:'B',defaultEffort:'medium'}]});
 const lifetime=new AbortController();
 registerCatalogPreview(api,{dataDir:dir,getDocument:docs,listModels,getAccountStatus:account,runAi,lifetime,customApi});
 const call=async(method,url,payload)=>{const r=await api.inject({method,url,payload});return {code:r.statusCode,body:r.json()};};
 try{await fn({call,runAi,account,docs,lifetime});}finally{await api.close();await rm(dir,{recursive:true,force:true});}
}
const generation=(id='codex:model-a',regenerate=false)=>({engineId:id,regenerate});
describe('explicit independent catalog generation',()=>{
 it('reads settings and directories without running any model',()=>fixture(async c=>{
  expect((await c.call('GET','/api/vantilo-catalog/settings')).body.engineId).toBe('codex:model-a');
  for(const kind of ['book','issue'])expect((await c.call('GET','/api/vantilo-catalog/'+kind+'/fixture')).body.state).toBe('idle');
  expect(c.runAi).not.toHaveBeenCalled();
 }));
 it('lists every saved API and uses the selected configuration for magazine catalog generation',()=>{
  const profiles=[
   {id:'active-profile',name:'Local',model:'fixture-local'},
   {id:'second-profile',name:'Local',model:'fixture-remote'},
   {id:'third-profile',name:'Other',model:'fixture-alt'},
  ];
  const complete=vi.fn(async({input})=>JSON.stringify(JSON.parse(input).map(row=>({id:row.id,titleZh:'中文 '+row.title}))));
  return fixture(async c=>{
   const settings=(await c.call('GET','/api/vantilo-catalog/settings')).body;
   const engines=settings.engines.filter(engine=>engine.custom);
   expect(engines.map(engine=>engine.modelId)).toEqual(profiles.map(profile=>profile.model));
   expect(engines.every(engine=>!('selectedProfileId' in engine))).toBe(true);
   expect(settings.engineId).toBe(engines[0].id);
   expect((await c.call('PUT','/api/vantilo-catalog/settings',{engineId:engines[1].id})).code).toBe(200);
   expect((await c.call('POST','/api/vantilo-catalog/issue/fixture',generation(engines[1].id))).body).toMatchObject({
    model:'fixture-remote',titles:{articles:{a1:'中文 Clear writing'}},
   });
   expect(complete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({selectedProfileId:profiles[1].id}));
   expect(c.runAi).not.toHaveBeenCalled();
  },{get:async()=>({configured:true,...profiles[0],activeId:profiles[0].id,profiles}),complete});
 });
 it('persists an independent model and retains model-specific cached variants',()=>fixture(async c=>{
  expect((await c.call('PUT','/api/vantilo-catalog/settings',{engineId:'codex:model-b'})).code).toBe(200);
  expect((await c.call('GET','/api/vantilo-catalog/settings')).body.engineId).toBe('codex:model-b');
  expect((await c.call('POST','/api/vantilo-catalog/book/fixture',generation())).body.model).toBe('model-a');
  expect(c.runAi.mock.calls[0][0]).toMatchObject({modelId:'model-a',reasoningEffort:'low'});
  await c.call('POST','/api/vantilo-catalog/book/fixture',generation('codex:model-b'));
  expect(c.runAi).toHaveBeenCalledTimes(2);
  await c.call('POST','/api/vantilo-catalog/book/fixture',generation());
  expect(c.runAi).toHaveBeenCalledTimes(2);
  expect((await c.call('GET','/api/vantilo-catalog/book/fixture')).body).toMatchObject({model:'model-a',state:'ready',legacy:false});
 }));
 it('translates only magazine section and article titles',()=>fixture(async c=>{
  const r=await c.call('POST','/api/vantilo-catalog/issue/fixture',generation());
  expect(r.body.titles).toMatchObject({sections:{Ideas:'中文 Ideas'},articles:{a1:'中文 Clear writing'}});
  expect(JSON.parse(c.runAi.mock.calls[0][0].input)).toEqual([{id:'1',title:'Ideas'},{id:'2',title:'Clear writing'}]);
 }));
 it('returns completed magazine titles during generation and resumes after a later batch fails',()=>fixture(async c=>{
  const articles=Array.from({length:14},(_,i)=>({id:'long-epub-identifier-'+i,title:'Idea '+i}));
  c.docs.mockResolvedValue({...issue,articles,sectionTranslations:{Ideas:'历史栏目'}});
  const url='/api/vantilo-catalog/issue/fixture';
  const post=()=>c.call('POST',url,generation());
  c.runAi.mockImplementationOnce(async({input})=>{
   const first=JSON.parse(input)[1];
   return '<think>internal</think>\n```json\n'+JSON.stringify([{id:Number(first.id),titleZh:'已验证译名'}])+'\n```';
  });
  expect((await post()).body).toMatchObject({state:'pending',done:1,titles:{articles:{[articles[0].id]:'已验证译名'}}});
  c.runAi.mockRejectedValueOnce(Error('Temporary failure'));
  expect((await post()).code).toBe(502);
  expect((await c.call('GET',url)).body).toMatchObject({state:'pending',done:1,titles:{articles:{[articles[0].id]:'已验证译名'}}});
  expect((await post()).body).toMatchObject({state:'pending',done:13});
  const final=(await post()).body;
  expect(final.state).toBe('ready');
  expect(Object.keys(final.titles.articles)).toHaveLength(14);
  expect(final.titles.articles[articles[0].id]).toBe('已验证译名');
 }));
 it('keeps the prior directory when regeneration fails and refuses unselected models',()=>fixture(async c=>{
  await c.call('POST','/api/vantilo-catalog/book/fixture',generation());
  c.runAi.mockResolvedValueOnce('[{"id":"wrong","titleZh":"错误"}]');
  expect((await c.call('POST','/api/vantilo-catalog/book/fixture',generation('codex:model-b',true))).code).toBe(502);
  expect((await c.call('GET','/api/vantilo-catalog/book/fixture')).body.model).toBe('model-a');
  expect((await c.call('POST','/api/vantilo-catalog/book/fixture',generation('qwen:unavailable'))).code).toBe(400);
 }));
 it('marks existing magazine translations as historical instead of attributing them to a new model',()=>fixture(async c=>{
  c.docs.mockResolvedValue({...issue,articles:[{...issue.articles[0],readerGuide:{titleZh:'原有中文标题'}}]});
  const r=await c.call('GET','/api/vantilo-catalog/issue/fixture');
  expect(r.body).toMatchObject({state:'ready',legacy:true,titles:{articles:{a1:'原有中文标题'}}});expect(c.runAi).not.toHaveBeenCalled();
 }));
 it('bounds concurrency and cancels active generation on service shutdown',()=>fixture(async c=>{
  let started;const entered=new Promise(r=>started=r);
  c.runAi.mockImplementation(async(_payload,{signal})=>{started();return await new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
  const first=c.call('POST','/api/vantilo-catalog/book/fixture',generation());await entered;
  expect((await c.call('POST','/api/vantilo-catalog/issue/fixture',generation())).code).toBe(409);
  c.lifetime.abort();expect((await first).code).toBe(408);
  expect((await c.call('GET','/api/vantilo-catalog/book/fixture')).body.state).toBe('idle');
 }));
 it('requires login before model inference and rejects malformed inputs',()=>fixture(async c=>{
  c.account.mockResolvedValue({connected:false});
  expect((await c.call('POST','/api/vantilo-catalog/book/fixture',generation())).code).toBe(401);
  expect((await c.call('POST','/api/vantilo-catalog/book/fixture',{engineId:'codex:model-a'})).code).toBe(400);
  expect(c.runAi).not.toHaveBeenCalled();
 }));
});
it('imports synthetic books and magazines and serves directories without automatic AI',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'catalog-import-'));let service;const sessionToken='9'.repeat(64),sessionCookie='__Host-vantilo-reader='+sessionToken;
 const runAi=vi.fn(async p=>JSON.stringify(JSON.parse(p.input).map(r=>({id:r.id,titleZh:'中文 '+r.title}))));
 try{
  service=await startPortableReader({assetsDir:path.resolve('build/reader'),libraryRoot:tmp,apiPort:0,webPort:0,autoSync:false,enableReaderPreviews:true,sessionToken,
   runAi,getAccountStatus:async()=>({connected:true}),listModels:async()=>({models:[{id:'model-a',displayName:'A',defaultEffort:'low'}]}),localQwenService:{inspect:async()=>({selected:false,helperAvailable:false})}});
  const epub=await readFile('tests/fixtures/minimal-magazine.epub');
  const upload=async url=>{const r=await fetch(service.webOrigin+url,{method:'POST',headers:{'content-type':'application/epub+zip',cookie:sessionCookie},body:epub});expect(r.status).toBe(201);return r.json();};
  const importedBook=await upload('/api/books/import?filename=Synthetic.epub&categoryId=uncategorized');
  const importedIssue=await upload('/api/import/epub?filename=TheEconomist.2026.10.24.epub');
  for(const [kind,id]of [['book',importedBook.bookId],['issue',importedIssue.issueId]]){
   const r=await fetch(service.webOrigin+'/api/vantilo-catalog/'+kind+'/'+encodeURIComponent(id),{headers:{cookie:sessionCookie}});expect(r.status).toBe(200);expect((await r.json()).state).toBe('idle');
  }
  await new Promise(r=>setTimeout(r,80));expect(runAi).not.toHaveBeenCalled();
  const blocked=await fetch(service.webOrigin+'/api/issues/'+importedIssue.issueId+'/guide-preparation',{method:'POST',headers:{cookie:sessionCookie}});expect(blocked.status).toBe(409);
  const generated=await fetch(service.webOrigin+'/api/vantilo-catalog/book/'+importedBook.bookId,{method:'POST',headers:{'content-type':'application/json',cookie:sessionCookie},body:JSON.stringify(generation())});
  expect(generated.status).toBe(200);expect((await generated.json()).model).toBe('model-a');expect(runAi).toHaveBeenCalledOnce();
  const badOrigin=await fetch(service.webOrigin+'/api/vantilo-catalog/settings',{headers:{origin:'https://evil.test',cookie:sessionCookie}});expect(badOrigin.status).toBe(403);
 }finally{await service?.close();await rm(tmp,{recursive:true,force:true});}
});

it('downloads automatic-sync fixture magazines without running translation',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'catalog-sync-'));let service;const sessionToken='8'.repeat(64),sessionCookie='__Host-vantilo-reader='+sessionToken;
 const epub=await readFile('tests/fixtures/minimal-magazine.epub');const runAi=vi.fn(async()=>{throw Error('Unexpected AI');});
 const dirs=['01_economist','02_new_yorker','04_atlantic','05_wired'],prefix=['TheEconomist','NewYorker','TheAtlantic','Wired'];
 const fetchImpl=async input=>{const url=new URL(input);if(url.hostname==='raw.githubusercontent.com')return new Response(epub);
  const rel=decodeURIComponent(url.pathname.split('/contents/')[1]);const index=dirs.indexOf(rel.split('/')[0]);if(index<0)throw Error('Unexpected source');
  const issuePath=dirs[index]+'/2026.10.24',name=prefix[index]+'.2026.10.24.epub';
  return new Response(JSON.stringify(rel.includes('/')?[{type:'file',name,path:issuePath+'/'+name,download_url:'https://raw.githubusercontent.com/hehonghui/awesome-english-ebooks/master/'+issuePath+'/'+name}]:[{type:'dir',name:'2026.10.24',path:issuePath}]));};
 try{service=await startPortableReader({assetsDir:path.resolve('build/reader'),libraryRoot:tmp,apiPort:0,webPort:0,autoSync:false,enableReaderPreviews:true,runAi,fetchImpl,sessionToken,
  localQwenService:{inspect:async()=>({selected:false,helperAvailable:false})}});
  await service.sync.check();const issues=await fetch(service.webOrigin+'/api/issues',{headers:{cookie:sessionCookie}}).then(r=>r.json());expect(issues).toHaveLength(4);expect(runAi).not.toHaveBeenCalled();
 }finally{await service?.close();await rm(tmp,{recursive:true,force:true});}
});

describe('bounded resumable catalog slices and local Qwen',()=>{
 it('resumes cloud batches after a failure without publishing partial titles',()=>fixture(async c=>{
  c.docs.mockResolvedValue({...book,parts:[],chapters:Array.from({length:25},(_,i)=>({id:'c'+i,title:'Idea '+i}))});
  const url='/api/vantilo-catalog/book/fixture';
  expect((await c.call('POST',url,generation())).body).toMatchObject({state:'pending',done:12,total:25});
  expect((await c.call('GET',url)).body.state).toBe('idle');
  c.runAi.mockRejectedValueOnce(Error('Temporary failure'));
  expect((await c.call('POST',url,generation())).code).toBe(502);
  expect((await c.call('POST',url,generation())).body).toMatchObject({state:'pending',done:24});
  const result=await c.call('POST',url,generation());expect(result.body.state).toBe('ready');
  expect(Object.keys(result.body.titles.chapters)).toHaveLength(25);
  expect(JSON.parse(c.runAi.mock.calls[2][0].input)[0].id).toBe('chapter:c12');
 }));
 it('offers Qwen by default, works without GPT login and never falls back',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'catalog-qwen-')),api=Fastify(),lifetime=new AbortController();
  const localModel={inspect:vi.fn(async()=>({health:{ready:true}})),recheck:vi.fn(),translate:vi.fn(async()=>({translation:'本地中文标题'}))};
  const runAi=vi.fn();let doc=book;
  registerCatalogPreview(api,{dataDir:dir,localModel,getDocument:async()=>doc,listModels:async()=>{throw Error('Offline');},getAccountStatus:async()=>({connected:false}),runAi,lifetime});
  try{
   const settings=(await api.inject('/api/vantilo-catalog/settings')).json();expect(settings.engineId).toMatch(/^qwen:/);expect(settings.engines).toHaveLength(1);
   const post=async()=>api.inject({method:'POST',url:'/api/vantilo-catalog/book/fixture',payload:generation(settings.engineId)});
   expect((await post()).json()).toMatchObject({state:'pending',done:1,total:2});
   expect((await post()).json()).toMatchObject({state:'ready',engineId:settings.engineId,titles:{chapters:{c1:'本地中文标题'}}});
   doc={...book,sourceFingerprint:'v2'};localModel.inspect.mockResolvedValue({health:{ready:false}});localModel.recheck.mockResolvedValue({ready:false});
   const failed=await post();expect(failed.statusCode).toBe(502);expect(failed.json().error).toContain('不会切换');expect(runAi).not.toHaveBeenCalled();
  }finally{await api.close();await rm(dir,{recursive:true,force:true});}
 });
});
