import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {describe,it,expect,vi} from 'vitest';
const require=createRequire(import.meta.url);
const {startPortableReader}=require('../electron/portable-reader-service.cjs');
const sessionToken='d'.repeat(64),sessionCookie='__Host-vantilo-reader='+sessionToken;
const good={word:'bark',sentence:"The tree's bark is rough."};
async function runCase(enabled:boolean,fn:(ctx:any)=>Promise<void>){
  const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-qwen-api-'));
  const inspected={selected:true,helperAvailable:true,health:{ready:false,status:'not-checked'}};
  const model={
    inspect:vi.fn(async()=>inspected),
    recheck:vi.fn(async()=>{inspected.health={ready:true,status:'verified-native'};return inspected.health;}),
    gloss:vi.fn(async()=>({meaningZh:'树皮',model:'Qwen3.5 4B',provider:'qwen-mlx'})),
  };
  let service:any;
  try{
    service=await startPortableReader({assetsDir:path.resolve('build/reader'),libraryRoot:root,
      apiPort:0,webPort:0,autoSync:false,enableLocalQwen:enabled,localQwenService:model,sessionToken});
    await fn({service,model});
  } finally {await service?.close();await rm(root,{recursive:true,force:true});}
}
const post=(url:string,body:any,headers:Record<string,string>={})=>
  fetch(url,{method:'POST',headers:{'content-type':'application/json',cookie:sessionCookie,...headers},body:JSON.stringify(body)});
describe('Preview-only local Qwen Reader route',()=>{
  it('exposes translation and catalogue engines in the development feature mode without enabling local inference routes or sync',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-translation-api-'));
    const model={
      inspect:vi.fn(async()=>({selected:false,helperAvailable:false,health:{ready:false},hardware:{appleSilicon:true}})),
      recheck:vi.fn(),
      translate:vi.fn(),
    };
    const fetchImpl=vi.fn(async()=>new Response('unexpected sync'));
    const runAi=vi.fn(async()=> '这是一段测试译文。');
    let service:any;
    try{
      service=await startPortableReader({assetsDir:path.resolve('build/reader'),libraryRoot:root,
        apiPort:0,webPort:0,autoSync:false,enableTranslation:true,enableReaderPreviews:true,localQwenService:model,
        runAi,getAccountStatus:async()=>({connected:true,email:null}),
        listModels:async()=>({models:[{id:'gpt-test',displayName:'GPT 测试',defaultEffort:'low'}]}),
        fetchImpl,sessionToken});
      const headers={cookie:sessionCookie};
      const engines=await fetch(service.webOrigin+'/api/vantilo-translation/engines',{headers});
      expect(engines.status).toBe(200);
      expect(await engines.json()).toMatchObject({engines:[
        {id:expect.stringMatching(/^qwen:/),engine:'qwen'},
        {id:'codex:gpt-test',engine:'codex'},
      ]});
      const catalogSettings=await fetch(service.webOrigin+'/api/vantilo-catalog/settings',{headers});
      expect(catalogSettings.status).toBe(200);
      expect(await catalogSettings.json()).toMatchObject({engines:[
        {id:expect.stringMatching(/^qwen:/),local:true},
        {id:'codex:gpt-test'},
      ]});
      expect((await fetch(service.webOrigin+'/api/vantilo-qwen/status',{headers})).status).toBe(404);
      const translated=await fetch(service.webOrigin+'/api/vantilo-translation/translate',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({engineId:'codex:gpt-test',text:'A synthetic paragraph.'})});
      expect(translated.status).toBe(200);
      expect(await translated.json()).toMatchObject({translation:'这是一段测试译文。',engineId:'codex:gpt-test'});
      expect(runAi).toHaveBeenCalledOnce();
      expect(fetchImpl).not.toHaveBeenCalled();
    }finally{await service?.close();await rm(root,{recursive:true,force:true});}
  });
  it('uses a configured custom API for translation and catalogue without a local Qwen model or ChatGPT login',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-custom-api-route-'));
    const customApi={get:vi.fn(async()=>({configured:true,name:'DeepSeek',baseUrl:'https://api.deepseek.com/v1',model:'deepseek-chat',hasApiKey:true})),
      complete:vi.fn(async()=> '这是 API 返回的译文。'),save:vi.fn(),test:vi.fn()};
    const runAi=vi.fn(async()=>{throw new Error('ChatGPT should not be required');});let service:any;
    try{
      service=await startPortableReader({assetsDir:path.resolve('build/reader'),libraryRoot:root,apiPort:0,webPort:0,autoSync:false,
        enableTranslation:true,enableReaderPreviews:true,localQwenService:false,customApi,runAi,getAccountStatus:async()=>({connected:false}),sessionToken});
      const headers={cookie:sessionCookie};
      const engines=await fetch(service.webOrigin+'/api/vantilo-translation/engines',{headers});
      const result=await engines.json();expect(result.defaultId).toMatch(/^custom-api:/);expect(result.engines).toHaveLength(1);
      const translated=await fetch(service.webOrigin+'/api/vantilo-translation/translate',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({engineId:result.defaultId,text:'An untrusted source passage.'})});
      expect(translated.status).toBe(200);expect(await translated.json()).toMatchObject({translation:'这是 API 返回的译文。',provider:'custom-api'});
      expect(customApi.complete).toHaveBeenCalledWith(expect.objectContaining({instruction:expect.any(String),input:'An untrusted source passage.',signal:expect.any(AbortSignal)}));
      expect(runAi).not.toHaveBeenCalled();
      const settings=await fetch(service.webOrigin+'/api/vantilo-catalog/settings',{headers});expect((await settings.json()).engines[0]).toMatchObject({id:result.defaultId,custom:true});
      expect((await fetch(service.webOrigin+'/api/vantilo-custom-api/settings',{headers})).status).toBe(200);
    }finally{await service?.close();await rm(root,{recursive:true,force:true});}
  });
  it('does not register local inference in ordinary Reader',()=>runCase(false,async({service,model})=>{
    const r=await post(service.webOrigin+'/api/vantilo-qwen/gloss',good);
    expect(r.status).toBe(404);
    expect(model.gloss).not.toHaveBeenCalled();
  }));
  it('checks native readiness then invokes only bounded contextual gloss in preview',()=>runCase(true,async({service,model})=>{
    const status=await fetch(service.webOrigin+'/api/vantilo-qwen/status',{headers:{cookie:sessionCookie}});
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({enabled:true,selected:true,helperAvailable:true});
    const r=await post(service.webOrigin+'/api/vantilo-qwen/gloss',good);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({meaningZh:'树皮',provider:'qwen-mlx'});
    expect(model.recheck).toHaveBeenCalledOnce();
    expect(model.gloss).toHaveBeenCalledWith({...good,signal:expect.any(AbortSignal)});
  }));
  it('cancels an obsolete gloss before starting the latest word',()=>runCase(true,async({service,model})=>{
    let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
    let firstSignal:AbortSignal|undefined;
    model.gloss.mockImplementationOnce(({signal}:{signal:AbortSignal})=>new Promise((_resolve,reject)=>{
      firstSignal=signal;started();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    }));
    const first=post(service.webOrigin+'/api/vantilo-qwen/gloss',good);await ready;
    const second=post(service.webOrigin+'/api/vantilo-qwen/gloss',{word:'tree',sentence:'The tree is tall.'});
    expect((await first).status).toBe(408);expect((await second).status).toBe(200);
    expect(firstSignal?.aborted).toBe(true);expect(model.gloss).toHaveBeenCalledTimes(2);
  }));
  it('rejects extra fields, long input and cross-origin requests before model work',()=>runCase(true,async({service,model})=>{
    for(const body of [{...good,url:'https://evil.test'},{...good,word:'a'.repeat(100)},{...good,sentence:'x'.repeat(601)}, {...good,sentence:'one\ntwo'}]){
      const r=await post(service.webOrigin+'/api/vantilo-qwen/gloss',body);
      expect(r.status).toBe(400);
    }
    for(const headers of ([{origin:'https://evil.test'},{'sec-fetch-site':'cross-site'}] as Record<string,string>[])){
      const r=await post(service.webOrigin+'/api/vantilo-qwen/gloss',good,headers);
      expect(r.status).toBe(403);
    }
    expect(model.gloss).not.toHaveBeenCalled();
  }));
});
