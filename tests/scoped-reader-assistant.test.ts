import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
const {startPortableReader}=createRequire(import.meta.url)('../electron/portable-reader-service.cjs');
const options={method:'POST',headers:{'content-type':'application/json'}};
const scoped=(kind:string)=>'?scope='+encodeURIComponent(JSON.stringify({kind}));
const sessionToken='c'.repeat(64),sessionCookie='__Host-vantilo-reader='+sessionToken;
function sessionFetch(origin:string,url:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set('cookie',sessionCookie);return fetch(origin+url,{...init,headers});}

it('restores independent Reader histories, native account/catalog, model choices and clear without a project session',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-scoped-reader-'));
  const runAi=vi.fn(async({input}:{input:string})=>input.startsWith('ASSISTANT_RESEARCH_PLAN_V1') ? JSON.stringify({queries:[],reads:[]}) : input.includes('Book-only question')?'Book shelf reply':'Magazine shelf reply');
  let service:any;
  const config={assetsDir:path.resolve('build/reader'),libraryRoot:root,apiPort:0,webPort:0,autoSync:false,runAi,getAccountStatus:async()=>({connected:true,email:'fixture@example.com'}),listModels:async()=>({models:[{id:'fixture-model',catalogId:'fixture',displayName:'Fixture',description:'Fixture only',isDefault:true,defaultEffort:'low',efforts:[{id:'low',description:'Low'}]}]}),sessionToken};
  try{
    service=await startPortableReader(config);
    const request=(url:string,init?:RequestInit)=>sessionFetch(service.apiOrigin,url,init);
    expect(await request('/api/prep/auth').then(r=>r.json())).toMatchObject({connected:true,sharing:true,email:'fixture@example.com'});
    expect(await request('/api/prep/models').then(r=>r.json())).toMatchObject({models:[{model:'fixture-model'}]});
    expect((await request('/api/prep/auth/start',{...options,body:'{}'})).status).toBe(404);
    expect((await request('/api/prep/tts',{...options,body:'{}'})).status).toBe(404);
    expect((await request('/api/prep/model-preferences',{...options,method:'PUT',body:JSON.stringify({modelMode:'manual',model:'fixture-model',reasoningMode:'manual',reasoningEffort:'low'})})).status).toBe(200);
    for(const [kind,message] of [['books','Book-only question'],['magazines','Magazine-only question']]){
      const r=await request('/api/prep/assistant/chat'+scoped(kind!),{...options,body:JSON.stringify({message})});
      expect(r.status,await r.clone().text()).toBe(200);
    }
    const translation=await request('/api/translate',{...options,body:JSON.stringify({text:'Synthetic translation request'})});expect(translation.status).toBe(200);
    expect(runAi.mock.calls.every(([p])=>(p as any).modelId==='fixture-model')).toBe(true);
    const books=await request('/api/prep/assistant/history'+scoped('books')).then(r=>r.json());
    const magazines=await request('/api/prep/assistant/history'+scoped('magazines')).then(r=>r.json());
    expect(books.map((m:any)=>m.text)).toEqual(['Book-only question','Book shelf reply']);
    expect(magazines.map((m:any)=>m.text)).toEqual(['Magazine-only question','Magazine shelf reply']);
    await service.close();service=await startPortableReader(config);
    expect(await request('/api/prep/assistant/history'+scoped('books')).then(r=>r.json())).toEqual(books);
    expect((await request('/api/prep/assistant/history'+scoped('books'),{method:'DELETE'})).status).toBe(200);
    expect(await request('/api/prep/assistant/history'+scoped('books')).then(r=>r.json())).toEqual([]);
    expect(await request('/api/prep/assistant/history'+scoped('magazines')).then(r=>r.json())).toEqual(magazines);
    expect(await request('/api/prep/assistant/history'+scoped('all')).then(r=>r.json())).toEqual([]);
  }finally{await service?.close();await rm(root,{recursive:true,force:true});}
});

it('restores book preparation, verified source windows, candidate confirmation and saving via the shared engine',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-prep-reader-'));let chapterId='';
  const runAi=vi.fn(async({input}:{input:string})=>{
    if(input.startsWith('RESEARCH_PLAN_V1'))return JSON.stringify({queries:[],reads:[{chapterId,start:0,count:1}]});
    return JSON.stringify({titleZh:'测试阅读候选',teaserZh:'测试导语',english:Array(80).fill('word').join(' '),explanationZh:'只依据合成 EPUB 的原文进行测试',keywords:['test'],evidence:[{chapterId,paragraphIndex:0}]});
  });let service:any;
  try{
    service=await startPortableReader({assetsDir:path.resolve('build/reader'),libraryRoot:root,apiPort:0,webPort:0,autoSync:false,runAi,getAccountStatus:async()=>({connected:true,email:null}),sessionToken});
    const request=(url:string,init?:RequestInit)=>sessionFetch(service.apiOrigin,url,init);
    const epub=await readFile('tests/fixtures/minimal-magazine.epub');
    const imported=await request('/api/books/import?filename=ScopedBook.epub',{...options,headers:{'content-type':'application/epub+zip'},body:epub}).then(r=>r.json());
    const book=await request('/api/books/'+imported.bookId).then(r=>r.json());
    chapterId=book.chapters.find((c:any)=>c.paragraphs.length)?.id;
    expect(chapterId).toBeTruthy();
    const rootUrl='/api/books/'+imported.bookId;
    const draftReply=await request(rootUrl+'/prep/chat',{...options,body:JSON.stringify({message:'Prepare a synthetic candidate',chapterId,draft:true})});
    expect(draftReply.status,await draftReply.clone().text()).toBe(200);
    const draft=await draftReply.json();expect(draft.draft.titleZh).toBe('测试阅读候选');expect(draft.draftId).toBeTruthy();
    expect(await request(rootUrl+'/lessons').then(r=>r.json())).toEqual([]);
    const confirmed=await request(rootUrl+'/prep/approve',{...options,body:JSON.stringify({draftId:draft.draftId})});
    expect(confirmed.status,await confirmed.clone().text()).toBe(201);
    const lessons=await request(rootUrl+'/lessons').then(r=>r.json());
    expect(lessons).toHaveLength(1);expect(lessons[0].titleZh).toBe('测试阅读候选');
    expect(runAi).toHaveBeenCalledTimes(2);
  }finally{await service?.close();await rm(root,{recursive:true,force:true});}
});

it('feeds real bridge chunks into the original scoped NDJSON reply without appending the final answer twice',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-reader-stream-'));let service:any;
  const runAi=vi.fn(async({input}:{input:string},callbacks?:{onDelta?:(text:string)=>void})=>{
    if(input.startsWith('ASSISTANT_RESEARCH_PLAN_V1'))return JSON.stringify({queries:[],reads:[]});
    callbacks?.onDelta?.('Scoped ');callbacks?.onDelta?.('answer');return 'Scoped answer';
  });
  try{
    service=await startPortableReader({assetsDir:path.resolve('build/reader'),libraryRoot:root,apiPort:0,webPort:0,autoSync:false,runAi,getAccountStatus:async()=>({connected:true,email:null}),sessionToken});
    const reply=await sessionFetch(service.apiOrigin,'/api/prep/assistant/chat'+scoped('books'),{...options,headers:{...options.headers,accept:'application/x-ndjson',cookie:sessionCookie},body:JSON.stringify({message:'A synthetic stream question'})});
    const events=(await reply.text()).trim().split('\n').map(line=>JSON.parse(line));
    expect(events.filter(e=>e.type==='delta').map(e=>e.text).join('')).toBe('Scoped answer');
    expect(events.find(e=>e.type==='done').answer).toBe('Scoped answer');
    const history=await sessionFetch(service.apiOrigin,'/api/prep/assistant/history'+scoped('books')).then(r=>r.json());
    expect(history.map((m:any)=>m.text)).toEqual(['A synthetic stream question','Scoped answer']);
  }finally{await service?.close();await rm(root,{recursive:true,force:true});}
});
