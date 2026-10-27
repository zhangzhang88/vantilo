import {EventEmitter} from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createReaderAiFetch } = require('../electron/reader-ai-gateway.cjs');
describe('existing Reader task parsers use the one Agent engine', () => {
  it('forwards only bounded instructions and data and does not use URL/key/model provider configuration', async () => {
    const runAi = vi.fn(async () => '统一翻译结果');
    const local = createReaderAiFetch(runAi);
    const response = await local('https://unused-provider.invalid/responses', {body:JSON.stringify({model:'ignored',apiKey:'ignored',instructions:'Translate only the supplied paragraph',input:'Untrusted paragraph'})});
    expect(runAi).toHaveBeenCalledWith({instructions:'Translate only the supplied paragraph',input:'Untrusted paragraph'});
    expect(await response.json()).toEqual({output_text:'统一翻译结果'});
    await expect(local('ignored',{body:JSON.stringify({instructions:'x',input:'x'.repeat(18001)})})).rejects.toThrow(/过长/);
    expect(runAi).toHaveBeenCalledOnce();
    await local('ignored',{body:JSON.stringify({instructions:'translate',input:'x'.repeat(12000)})});
    expect(runAi).toHaveBeenCalledTimes(2);
  });
  it('fails explicitly instead of falling back to external providers', async () => {
    const missing = createReaderAiFetch();
    await expect(missing('ignored',{body:'{}'})).rejects.toThrow(/登录/);
    const local = createReaderAiFetch(vi.fn(async ()=>'x'.repeat(20001)));
    await expect(local('ignored',{body:JSON.stringify({instructions:'x',input:'y'})})).rejects.toThrow(/格式/);
  });
});

it('cancels a correlated utility request without accepting a late result',async()=>{
  const {createReaderAiClient}=require('../electron/reader-ai-gateway.cjs');
  const parent=new EventEmitter() as any;parent.postMessage=vi.fn();const client=createReaderAiClient(parent);
  const controller=new AbortController();const pending=client.run({instructions:'x',input:'y'},false,controller.signal);
  const id=parent.postMessage.mock.calls[0][0].requestId;
  controller.abort();await expect(pending).rejects.toThrow(/取消/);
  expect(parent.postMessage).toHaveBeenLastCalledWith({type:'ai-cancel',requestId:id});
  parent.emit('message',{data:{type:'ai-result',requestId:id,ok:true,output:'late'}});client.close();
});

it('shows only fixed diagnostic messages and never displays arbitrary process errors',async()=>{
  const {createReaderAiClient}=require('../electron/reader-ai-gateway.cjs');
  const parent=new EventEmitter() as any;parent.postMessage=vi.fn();const client=createReaderAiClient(parent);
  const timeout=client.run({instructions:'x',input:'y'});let id=parent.postMessage.mock.calls.at(-1)[0].requestId;
  parent.emit('message',{data:{type:'ai-result',requestId:id,ok:false,errorCode:'timeout'}});
  await expect(timeout).rejects.toThrow(/超时/);
  const unknown=client.run({instructions:'x',input:'y'});id=parent.postMessage.mock.calls.at(-1)[0].requestId;
  parent.emit('message',{data:{type:'ai-result',requestId:id,ok:false,errorCode:'secret token'}});
  await expect(unknown).rejects.toThrow(/Agent 阅读任务失败/);client.close();
});

it('streams only matching pending request deltas and ignores late, foreign and oversized chunks',async()=>{
  const {createReaderAiClient}=require('../electron/reader-ai-gateway.cjs');
  const parent=new EventEmitter() as any;parent.postMessage=vi.fn();const client=createReaderAiClient(parent);const onDelta=vi.fn();
  const pending=client.run({instructions:'x',input:'y'},false,undefined,onDelta);const id=parent.postMessage.mock.calls[0][0].requestId;
  parent.emit('message',{data:{type:'ai-delta',requestId:'different',delta:'foreign'}});
  parent.emit('message',{data:{type:'ai-delta',requestId:id,delta:'x'.repeat(20001)}});
  parent.emit('message',{data:{type:'ai-delta',requestId:id,delta:'Real chunk'}});
  expect(onDelta).toHaveBeenCalledExactlyOnceWith('Real chunk');
  parent.emit('message',{data:{type:'ai-result',requestId:id,ok:true,output:'Real chunk'}});await expect(pending).resolves.toBe('Real chunk');
  parent.emit('message',{data:{type:'ai-delta',requestId:id,delta:'late'}});expect(onDelta).toHaveBeenCalledOnce();client.close();
});
it('cancels the matching native Reader request on timeout rather than leaving inference running', async()=>{
  const {createReaderAiClient}=require('../electron/reader-ai-gateway.cjs');
  const parent=new EventEmitter() as any;parent.postMessage=vi.fn();
  const client=createReaderAiClient(parent);
  vi.useFakeTimers();
  try{
    const pending=client.run({instructions:'explain',input:'untrusted text'});
    const requestId=parent.postMessage.mock.calls[0][0].requestId;
    const expectation=expect(pending).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(120000);
    await expectation;
    expect(parent.postMessage).toHaveBeenLastCalledWith({type:'ai-cancel',requestId});
    expect(parent.postMessage).toHaveBeenCalledTimes(2);
    parent.emit('message',{data:{type:'ai-result',requestId,ok:true,output:'late result'}});
  }finally{client.close();vi.useRealTimers();}
});
