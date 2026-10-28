import {describe,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
const {registerWordContext}=createRequire(import.meta.url)('../electron/reader-word-context.cjs');

function fixture(){
 const api={post:vi.fn((_path,handler)=>{api.handler=handler;})};
 const customApi={get:vi.fn(async()=>({configured:true,id:'test-id',model:'deepseek-flash'})),complete:vi.fn(async()=>JSON.stringify({meaningZh:'河岸',partOfSpeech:'noun',explanationZh:'这里指河边的岸。'}))};
 const runAi=vi.fn(async()=>JSON.stringify({meaningZh:'银行',partOfSpeech:'noun',explanationZh:'这里指金融机构。'}));
 registerWordContext(api,{customApi,runAi,listModels:async()=>({models:[{id:'gpt-test',defaultEffort:'low'}]}),getAccountStatus:async()=>({connected:true}),lifetime:new AbortController()});
 const id='custom-api:'+createHash('sha256').update('test-id').digest('hex').slice(0,12);
 const call=async(body)=>{const raw=new EventEmitter(),replyRaw=new EventEmitter();replyRaw.writableEnded=true;const reply={raw:replyRaw,header(){},code(n){this.status=n;return this;},send(x){return x;}};return {result:await api.handler({body,raw},reply),status:reply.status||200};};
 return {id,call,customApi,runAi};
}
const base={stage:'primary',text:'bank',sentence:'The river bank is wet.',paragraph:'The river bank is wet.',meaningZh:'',explanationZh:''};
describe('selected model contextual meaning',()=>{
 it('routes primary and supplement to selected custom API and validates results',async()=>{
  const f=fixture();const first=await f.call({...base,engineId:f.id});
  expect(first.result).toMatchObject({meaningZh:'河岸',explanationZh:'这里指河边的岸。',provider:'custom-api',engineId:f.id});
  expect(f.customApi.complete).toHaveBeenCalledWith(expect.objectContaining({task:'word-context'}));
  f.customApi.complete.mockResolvedValueOnce(JSON.stringify({meaningEn:'land beside a river',explanationEn:'The sentence mentions a river.',examplesEn:['The bank was muddy.','We sat on the bank.']}));
  const second=await f.call({...base,engineId:f.id,stage:'supplement',meaningZh:'河岸',explanationZh:'这里指河边的岸。'});
  expect(second.result.examplesEn).toHaveLength(2);
  f.customApi.complete.mockResolvedValueOnce('{}');expect((await f.call({...base,engineId:f.id})).status).toBe(502);
 });
 it('uses selected Codex model and refuses unknown engines',async()=>{
  const f=fixture();expect((await f.call({...base,engineId:'codex:gpt-test'})).result).toMatchObject({provider:'vantilo-agent',model:'gpt-test'});
  expect(f.runAi).toHaveBeenCalledWith(expect.objectContaining({modelId:'gpt-test'}),expect.anything());
  expect((await f.call({...base,engineId:'codex:unknown'})).status).toBe(503);
 });
});
