import {createRequire} from 'node:module';
import {describe,it,expect,vi} from 'vitest';
const require=createRequire(import.meta.url);
const {registerTranslationPreview}=require('../electron/reader-translation-preview.cjs');
const {MODEL_MANIFEST}=require('../electron/reader-model-manifest.cjs');
const localId='qwen:'+MODEL_MANIFEST.id+'@'+MODEL_MANIFEST.revision;
const {EventEmitter}=require('node:events');
function setup({customApi}:any={}) {
 const handlers:any={};
 const api={get:(p:string,h:any)=>handlers[p]=h,post:(p:string,h:any)=>handlers[p]=h};
 const model={inspect:vi.fn(async()=>({selected:true,helperAvailable:true,health:{ready:true}})),recheck:vi.fn(async()=>({ready:true})),translate:vi.fn(async(_input:any)=>({translation:'树皮粗糙。',model:'Qwen3.5 4B',provider:'qwen-mlx'}))};
 const runAi=vi.fn(async()=> '树皮粗糙。');
 const listModels=vi.fn(async()=>({models:[{id:'gpt-test',displayName:'Test',defaultEffort:'low'}]}));
 const getAccountStatus=vi.fn(async()=>({connected:true}));
 registerTranslationPreview(api,{model,runAi,listModels,getAccountStatus,customApi,lifetime:new AbortController()});
 async function post(body:any,raw=new EventEmitter()) {
  const reply:any={raw,header:vi.fn(),code(n:number){this.status=n;return this;},send(value:any){this.value=value;return value;},status:200};
  const req:any={body,raw:new EventEmitter()};
  const result=await handlers['/api/vantilo-translation/translate'](req,reply);
  return {result,status:reply.status};
 }
 async function postSentence(body:any) {
  const reply:any={raw:new EventEmitter(),header:vi.fn(),code(n:number){this.status=n;return this;},send(value:any){this.value=value;return value;},status:200};
  const req:any={body,raw:new EventEmitter()};
  const result=await handlers['/api/vantilo-translation/sentence'](req,reply);
  return {result,status:reply.status};
 }
 return {handlers,model,runAi,listModels,post,postSentence,getAccountStatus};
}
describe('explicit preview translation engines',()=>{
 it('keeps offline Qwen translation local while loading choices for the model selector',async()=>{
  const c=setup();const r=await c.post({engineId:localId,text:'The bark is rough.'});
  expect(r.status).toBe(200);expect(r.result).toMatchObject({engineId:localId,provider:'qwen-mlx'});
  expect(c.listModels).toHaveBeenCalledOnce();expect(c.runAi).not.toHaveBeenCalled();
 });
 it('clearly reports unsupported Intel Qwen without silently using GPT',async()=>{
  const c=setup();c.model.inspect.mockResolvedValue({selected:false,helperAvailable:false,health:{ready:false},hardware:{appleSilicon:false}} as any);
  const engines=await c.handlers['/api/vantilo-translation/engines']({}, {header:vi.fn()});
  expect(engines.engines[0].label).toContain('当前设备不支持');
  const r=await c.post({engineId:localId,text:'A short sentence.'});
  expect(r.status).toBe(503);expect(r.result.error).toContain('手动切换引擎');
  expect(c.model.translate).not.toHaveBeenCalled();expect(c.runAi).not.toHaveBeenCalled();
 });
 it('fails closed on missing or unhealthy Qwen and rejects oversized requests or extra inputs',async()=>{
  const c=setup();c.model.inspect.mockResolvedValue({selected:false,helperAvailable:true,health:{ready:false}});
  expect((await c.post({engineId:localId,text:'hello'})).status).toBe(503);
  c.model.inspect.mockResolvedValue({selected:true,helperAvailable:true,health:{ready:false}});c.model.recheck.mockResolvedValue({ready:false});
  expect((await c.post({engineId:localId,text:'hello'})).status).toBe(503);
  for(const b of [{engineId:localId,text:'x'.repeat(60001)},{engineId:'codex:gpt-test',text:'x'.repeat(12001)},{engineId:localId,text:'hello',url:'evil'},{text:'hello'},{engineId:'unknown',text:'hello'}])expect((await c.post(b)).status).toBe(400);
  expect(c.runAi).not.toHaveBeenCalled();expect(c.model.translate).not.toHaveBeenCalled();
 });
 it('splits long Qwen passages at sentence boundaries, translates sequentially, merges and records progress',async()=>{
  const c=setup(),calls:string[]=[];
  c.model.translate.mockImplementation(async({text}:any)=>{calls.push(text);return {translation:`译${calls.length}。`+'中'.repeat(Math.ceil(text.length/15)),model:'Qwen3.5 4B',provider:'qwen-mlx'};});
  const text=Array.from({length:180},(_,i)=>`Sentence ${i+1} has a useful idea.`).join(' ');
  const r=await c.post({engineId:localId,text});
  expect(r.status).toBe(200);expect(calls.length).toBeGreaterThan(1);expect(calls.every(item=>item.length<=1800)).toBe(true);
  expect(calls.slice(0,-1).every(item=>/[.!?]$/.test(item.trim()))).toBe(true);
  expect(r.result.translation).toBe(calls.map((text,i)=>`译${i+1}。`+'中'.repeat(Math.ceil(text.length/15))).join(''));
  const reply:any={header:vi.fn()};const status=await c.handlers['/api/vantilo-translation/progress']({},reply);
  expect(status).toMatchObject({status:'complete',completedChunks:calls.length,totalChunks:calls.length});
  expect(c.runAi).not.toHaveBeenCalled();
 });
 it('resumes only completed Qwen chunks after a failure on a paragraph over 12000 characters',async()=>{
  const c=setup(),calls:string[]=[];let fail=true;
  c.model.translate.mockImplementation(async({text}:any)=>{
    calls.push(text);
    if(fail&&calls.length===2){fail=false;throw new Error('synthetic failure');}
    return {translation:'译文。'+'中'.repeat(Math.ceil(text.length/15)),model:'Qwen3.5 4B',provider:'qwen-mlx'};
  });
  const text=Array.from({length:450},(_,i)=>`Sentence ${i+1} has a useful idea.`).join(' ');
  expect(text.length).toBeGreaterThan(12000);
  const first=await c.post({engineId:localId,text});expect(first.status).toBe(502);
  const firstChunk=calls[0];const second=await c.post({engineId:localId,text});
  expect(second.status).toBe(200);expect(second.result.chunkProgress.resumedChunks).toBe(1);
  expect(calls.filter(value=>value===firstChunk)).toHaveLength(1);
  expect(calls.every(value=>value.length<=1800)).toBe(true);expect(c.runAi).not.toHaveBeenCalled();
 });
 it('rejects a drastically shortened long-chunk translation instead of caching it',async()=>{
  const c=setup();c.model.translate.mockResolvedValue({translation:'一条摘要。',model:'Qwen3.5 4B',provider:'qwen-mlx'});
  const text='The museum keeps careful records of every object in its collection. '.repeat(20);
  const r=await c.post({engineId:localId,text});
  expect(r.status).toBe(502);expect(r.result.error).toContain('可能遗漏内容');
  expect(c.runAi).not.toHaveBeenCalled();
 });
 it('explains independent preview login before attempting GPT inference',async()=>{
  const c=setup();c.getAccountStatus.mockResolvedValue({connected:false});
  const r=await c.post({engineId:'codex:gpt-test',text:'Hello.'});
  expect(r.status).toBe(401);expect(r.result.error).toContain('窗口顶部');
  expect(c.runAi).not.toHaveBeenCalled();expect(c.model.translate).not.toHaveBeenCalled();
 });
 it('unwraps GPT title JSON and sends plain source text',async()=>{
  const c=setup();c.runAi.mockResolvedValue('{"source":"示例文章"}');
  const r=await c.post({engineId:'codex:gpt-test',text:'Fixture article'});
  expect(r.status).toBe(200);expect(r.result.translation).toBe('示例文章');
  expect(c.runAi).toHaveBeenCalledWith(expect.objectContaining({input:'Fixture article'}),expect.anything());
 });
 it('rejects unexpected structured output rather than caching it',async()=>{
  const c=setup();c.runAi.mockResolvedValue('{"unrelated":"内容"}');
  expect((await c.post({engineId:'codex:gpt-test',text:'Title'})).status).toBe(502);
 });
 it('runs only the explicitly selected catalog model',async()=>{
  const c=setup();const r=await c.post({engineId:'codex:gpt-test',text:'Hello.'});
  expect(r.result).toMatchObject({provider:'vantilo-agent',model:'gpt-test',engineId:'codex:gpt-test'});
  expect(c.runAi).toHaveBeenCalledWith(expect.objectContaining({modelId:'gpt-test',reasoningEffort:'low'}),expect.objectContaining({signal:expect.any(AbortSignal)}));
  expect(c.model.translate).not.toHaveBeenCalled();
 });
 it('accepts plain Chinese from a translation focused custom model when optional expressions are omitted',async()=>{
  const customApi={get:vi.fn(async()=>({configured:true,id:'local-index',name:'Local-Index',model:'index-translate-2b'})),complete:vi.fn(async()=> '埃迪·拉马表示，他不会辞去总理职务，并警告称，抗议者正在危及阿尔巴尼亚加入欧盟的进程。')};
  const c=setup({customApi});const text='Edi Rama said he would not resign as prime minister.';
  const r=await c.postSentence({engineId:'custom-api:'+require('node:crypto').createHash('sha256').update('local-index').digest('hex').slice(0,12),task:'both',text,paragraphContext:text});
  expect(r.status).toBe(200);expect(r.result.translation).toContain('不会辞去总理职务');expect(r.result.expressions).toEqual([]);expect(r.result.provider).toBe('custom-api');
 });
 it('extracts JSON sentence results wrapped in a short model preface',async()=>{
  const customApi={get:vi.fn(async()=>({configured:true,id:'local-index',name:'Local-Index',model:'index-translate-2b'})),complete:vi.fn(async()=> 'Here is the result:\n```json\n{"translation":"他不会辞去总理职务。","expressions":[]}\n```')};
  const c=setup({customApi});const text='He would not resign.';
  const r=await c.postSentence({engineId:'custom-api:'+require('node:crypto').createHash('sha256').update('local-index').digest('hex').slice(0,12),task:'both',text,paragraphContext:text});
  expect(r.status).toBe(200);expect(r.result.translation).toBe('他不会辞去总理职务。');
 });
 it('rejects concurrent translations and cancels disconnected work',async()=>{
  const c=setup();let began:()=>void;const started=new Promise<void>(r=>began=r);
  c.model.translate.mockImplementation(async({signal}:any)=>{began();return await new Promise<never>((_r,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
  const raw=new EventEmitter();const first=c.post({engineId:localId,text:'Hello.'},raw);await started;
  expect((await c.post({engineId:localId,text:'Again.'})).status).toBe(409);
  raw.emit('close');expect((await first).status).toBe(408);expect(c.runAi).not.toHaveBeenCalled();
 });
 it('returns native failure and allows a later retry',async()=>{
  const c=setup();c.model.translate.mockRejectedValueOnce(new Error('native failed'));
  expect((await c.post({engineId:localId,text:'Hi.'})).status).toBe(502);
  expect((await c.post({engineId:localId,text:'Hi.'})).status).toBe(200);expect(c.runAi).not.toHaveBeenCalled();
 });
});
