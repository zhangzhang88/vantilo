import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const {PortableReaderSupervisor} = require('../electron/portable-reader-supervisor.cjs');
function fixture(runAi=vi.fn(async()=>({output:'fixture output'})), supervisorOptions: Record<string,unknown> = {}) {
  const children:any[]=[];
  const utilityProcess={fork:vi.fn(()=>{
    const child=new EventEmitter() as any;
    child.kill=vi.fn(()=>{queueMicrotask(()=>child.emit('exit',1));return true;});
    child.postMessage=vi.fn((message:any)=>{if(message.type==='shutdown')queueMicrotask(()=>child.emit('exit',0));});
    children.push(child);return child;
  })};
  const supervisor=new PortableReaderSupervisor({utilityProcess,assetsDir:'/app/reader',libraryRoot:'/user/library',runAi,timeoutMs:1000,installSessionCookie:async()=>{},clearSessionCookie:async()=>{},...supervisorOptions});
  return {supervisor,utilityProcess,children,runAi};
}
describe('portable Reader process ownership',()=>{
  it('requires authentication callbacks and keeps startup pending until the session cookie is installed',async()=>{
    expect(()=>new PortableReaderSupervisor({utilityProcess:{fork:vi.fn()},assetsDir:'/app',libraryRoot:'/user'})).toThrow(/authentication/);
    let finish!:()=>void;
    const installed=new Promise<void>(resolve=>{finish=resolve;});
    const install=vi.fn(()=>installed),clear=vi.fn(async()=>{});
    const {supervisor,children}=fixture(undefined,{installSessionCookie:install,clearSessionCookie:clear});
    const pending=supervisor.start();
    const token=children[0].postMessage.mock.calls[0][0].token;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    children[0].emit('message',{type:'ready'});
    expect(supervisor.getStatus().status).toBe('authenticating');
    await Promise.resolve();
    expect(install).toHaveBeenCalledWith(token,'http://127.0.0.1:5175');
    finish();await pending;expect(supervisor.getStatus().status).toBe('ready');
    await supervisor.stop();expect(clear).toHaveBeenCalledWith('http://127.0.0.1:5175');
    const second=supervisor.start();
    expect(children[1].postMessage.mock.calls[0][0].token).not.toBe(token);
    children[1].emit('message',{type:'ready'});await second;await supervisor.stop();
  });
  it('fails closed if the cookie cannot be installed',async()=>{
    const {supervisor,children}=fixture(undefined,{installSessionCookie:async()=>{throw new Error('cookie failed');}});
    const pending=supervisor.start();children[0].emit('message',{type:'ready'});
    await expect(pending).rejects.toThrow(/安全会话/);
    expect(supervisor.getStatus().status).toBe('error');expect(children[0].kill).toHaveBeenCalledOnce();
    await supervisor.stop();
  });
  it('fails closed if cookie installation throws synchronously',async()=>{
    const {supervisor,children}=fixture(undefined,{installSessionCookie:()=>{throw new Error('cookie failed');}});
    const pending=supervisor.start();children[0].emit('message',{type:'ready'});
    await expect(pending).rejects.toThrow(/安全会话/);
    expect(supervisor.getStatus().status).toBe('error');await supervisor.stop();
  });
  it('starts only on demand, uses an isolated environment, reuses its own service and stops it',async()=>{
    const {supervisor,utilityProcess,children}=fixture();
    expect(utilityProcess.fork).not.toHaveBeenCalled();
    const pending=supervisor.start();children[0].emit('message',{type:'ready'});await pending;
    expect((utilityProcess.fork.mock.calls as any)[0][2].env).not.toHaveProperty('OPENAI_API_KEY');
    await supervisor.start();expect(utilityProcess.fork).toHaveBeenCalledOnce();
    supervisor.synchronize();expect(children[0].postMessage).toHaveBeenCalledWith({type:'sync'});
    await supervisor.stop();expect(supervisor.getStatus().status).toBe('stopped');
  });
  it('cleans a failed ready service and permits retry without stale events affecting the new child',async()=>{
    const {supervisor,children}=fixture();
    const first=supervisor.start();children[0].emit('message',{type:'ready'});await first;
    children[0].emit('error','crashed');
    expect(supervisor.getStatus().status).toBe('error');expect(children[0].kill).toHaveBeenCalledOnce();
    const retry=supervisor.start();children[1].emit('message',{type:'ready'});await retry;
    children[0].emit('exit',1);expect(supervisor.getStatus().status).toBe('ready');
    await supervisor.stop();
  });
  it('cancels startup and refuses late ready messages',async()=>{
    const {supervisor,children}=fixture();
    const pending=supervisor.start();const rejected=expect(pending).rejects.toThrow(/取消/);
    await supervisor.stop();await rejected;
    children[0].emit('message',{type:'ready'});expect(supervisor.getStatus().status).toBe('stopped');
  });
  it('only forwards bounded Reader prompts into the shared Agent bridge',async()=>{
    const {supervisor,children,runAi}=fixture();
    const pending=supervisor.start();children[0].emit('message',{type:'ready'});await pending;
    const id='20000000-0000-4000-8000-000000000001';
    children[0].emit('message',{type:'ai',requestId:id,instructions:'Translate',input:'source text'});
    await Promise.resolve();
    expect(runAi).toHaveBeenCalledWith({requestId:id,instructions:'Translate',input:'source text'});
    expect(children[0].postMessage).toHaveBeenCalledWith({type:'ai-result',requestId:id,ok:true,output:'fixture output'});
    children[0].emit('message',{type:'ai',requestId:id,instructions:'x',input:'x'.repeat(18001)});
    expect(runAi).toHaveBeenCalledOnce();await supervisor.stop();
  });
  it('forwards a safe error category without exposing backend details',async()=>{
    const {supervisor,children}=fixture(vi.fn(async()=>{throw new Error('request timed out; secret-token');}));
    const pending=supervisor.start();children[0].emit('message',{type:'ready'});await pending;
    const requestId='20000000-0000-4000-8000-000000000099';
    children[0].emit('message',{type:'ai',requestId,instructions:'Translate',input:'source text'});
    await Promise.resolve();
    expect(children[0].postMessage).toHaveBeenLastCalledWith({type:'ai-result',requestId,ok:false,errorCode:'timeout'});
    await supervisor.stop();
  });
});

it('delivers bounded native deltas only to the owned Reader child',async()=>{
  const {supervisor,children}=fixture();const pending=supervisor.start();children[0].emit('message',{type:'ready'});await pending;
  const requestId='20000000-0000-4000-8000-000000000082';
  supervisor.deliverDelta({requestId,delta:'source chunk'});
  expect(children[0].postMessage).toHaveBeenCalledWith({type:'ai-delta',requestId,delta:'source chunk'});
  supervisor.deliverDelta({requestId,delta:'x'.repeat(20001)});expect(children[0].postMessage).toHaveBeenCalledTimes(2);
  await supervisor.stop();const count=children[0].postMessage.mock.calls.length;
  supervisor.deliverDelta({requestId,delta:'late'});expect(children[0].postMessage).toHaveBeenCalledTimes(count);
});
it('probes both Reader HTTP services, tolerates one transient failure and kills the owned child after repeated failures',async()=>{
  let healthy=false;
  const fetchImpl=vi.fn(async (url:string)=>{
    if(!healthy)throw new Error('connection refused');
    if(url.endsWith('/api/health'))return {ok:true,json:async()=>({ok:true,reader:'epub'})};
    return {ok:true,text:async()=>('<title>Magazine Reader</title><div id="root"></div>')};
  });
  const {supervisor,children}=fixture(undefined,{fetchImpl});
  expect((await supervisor.checkHealth()).status).toBe('idle');
  expect(fetchImpl).not.toHaveBeenCalled();
  const pending=supervisor.start();children[0].emit('message',{type:'ready'});await pending;
  expect((await supervisor.checkHealth()).status).toBe('ready');
  expect((await supervisor.checkHealth()).status).toBe('error');
  expect(children[0].kill).toHaveBeenCalledOnce();
  healthy=true;
  const retry=supervisor.start();children[1].emit('message',{type:'ready'});await retry;
  expect((await supervisor.checkHealth()).status).toBe('ready');
  expect(fetchImpl).toHaveBeenCalled();
  await supervisor.stop();
});
