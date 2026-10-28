import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {describe,it,expect,vi} from 'vitest';
const require=createRequire(import.meta.url);
const {registerContextualGloss}=require('../electron/reader-contextual-gloss.cjs');

function setup({connected=true}={}) {
  const handlers={};
  const api={get:(route,handler)=>{handlers['GET '+route]=handler;},post:(route,handler)=>{handlers['POST '+route]=handler;}};
  const runAi=vi.fn(async()=> '河岸');
  registerContextualGloss(api,{model:null,customApi:{get:async()=>({configured:false})},lifetime:new AbortController(),
    listModels:async()=>({models:[{id:'gpt-6-luna',displayName:'GPT-6-Luna',defaultEffort:'low'}]}),
    runAi,getAccountStatus:async()=>({connected})});
  async function call(method,route,body,query={}) {
    const raw=new EventEmitter();raw.writableEnded=false;
    const replyRaw=new EventEmitter();replyRaw.writableEnded=true;
    const reply={raw:replyRaw,header:vi.fn(),code(n){this.status=n;return this;},send(value){this.value=value;return value;}};
    const request={body,query,raw};
    const result=await handlers[method+' '+route](request,reply);
    return {status:reply.status||200,result};
  }
  return {call,runAi};
}

describe('contextual gloss follows the selected reading model',()=>{
  it('uses the selected Codex model and reports its identity',async()=>{
    const c=setup();
    const state=await c.call('GET','/api/vantilo-context-gloss/status',undefined,{engineId:'codex:gpt-6-luna'});
    expect(state.result).toMatchObject({enabled:true,selected:true,provider:'vantilo-agent',model:'gpt-6-luna',label:'Codex / ChatGPT · GPT-6-Luna'});
    const response=await c.call('POST','/api/vantilo-context-gloss',{engineId:'codex:gpt-6-luna',word:'bank',sentence:'The bank of the river is muddy.'});
    expect(response).toMatchObject({status:200,result:{meaningZh:'河岸',provider:'vantilo-agent',model:'gpt-6-luna'}});
    expect(c.runAi).toHaveBeenCalledWith(expect.objectContaining({modelId:'gpt-6-luna',reasoningEffort:'low'}),expect.objectContaining({signal:expect.any(AbortSignal)}));
  });
  it('requires ChatGPT login for a Codex contextual gloss',async()=>{
    const c=setup({connected:false});
    const response=await c.call('POST','/api/vantilo-context-gloss',{engineId:'codex:gpt-6-luna',word:'bank',sentence:'The bank of the river is muddy.'});
    expect(response).toMatchObject({status:401,result:{error:'请登录 ChatGPT 后重试'}});
    expect(c.runAi).not.toHaveBeenCalled();
  });
  it('rejects an engine id that is not in the current model catalogue',async()=>{
    const c=setup();
    const state=await c.call('GET','/api/vantilo-context-gloss/status',undefined,{engineId:'codex:old-model'});
    expect(state.result).toMatchObject({enabled:false,selected:false});
  });
});
