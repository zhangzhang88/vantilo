import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {expect,it,vi} from 'vitest';
const {ReaderEngine}=createRequire(import.meta.url)('../electron/reader-engine.cjs');
function runtimeFixture(){
  const driver=new EventEmitter() as any;driver.start=vi.fn(async()=>{});
  const runtime=new EventEmitter() as any;runtime.driver=driver;runtime.activeTask=null;
  runtime.getStatus=()=>({status:'ready'});runtime.start=vi.fn(async()=>{});runtime.stop=vi.fn(async()=>{});
  runtime.runReaderAi=vi.fn(async()=> 'result');runtime.cancelReaderRequest=vi.fn(()=>({cancelled:true}));
  return runtime;
}
it('starts Reader lazily, reuses its instance, and recreates it after an idle account reset',async()=>{
  const runtimes:any[]=[];const createRuntime=vi.fn(async()=>{const r=runtimeFixture();runtimes.push(r);return r;});
  const engine=new ReaderEngine({createRuntime,accountStatus:async()=>({connected:true})});
  expect(createRuntime).not.toHaveBeenCalled();
  const payload={requestId:'20000000-0000-4000-8000-000000000121',instructions:'x',input:'y'};
  await expect(engine.run(payload)).resolves.toBe('result');await engine.run(payload);expect(createRuntime).toHaveBeenCalledOnce();
  await engine.reset();expect(runtimes[0].stop).toHaveBeenCalledOnce();
  await engine.run(payload);expect(createRuntime).toHaveBeenCalledTimes(2);await engine.stop();
  await expect(engine.run(payload)).rejects.toThrow(/停止/);
});
it('never starts an independent login/process when the shared account is logged out',async()=>{
  const createRuntime=vi.fn();const engine=new ReaderEngine({createRuntime,accountStatus:async()=>({connected:false})});
  await expect(engine.run({requestId:'logged-out'})).rejects.toThrow(/登录/);expect(createRuntime).not.toHaveBeenCalled();await engine.stop();
});
it('cancels a request during cold startup without allowing a late background generation',async()=>{
  const r=runtimeFixture();let finish!:(value:any)=>void;
  const engine=new ReaderEngine({createRuntime:()=>new Promise(resolve=>{finish=resolve;}),accountStatus:async()=>({connected:true})});
  const id='20000000-0000-4000-8000-000000000122';const pending=engine.run({requestId:id});
  await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));expect(engine.cancel(id)).toEqual({cancelled:true});
  const rejected=expect(pending).rejects.toThrow(/取消/);finish(r);await rejected;
  expect(r.runReaderAi).not.toHaveBeenCalled();await engine.stop();
});
it('refuses account reset while Reader work is pending',async()=>{
  const r=runtimeFixture();let finish!:(value:string)=>void;r.runReaderAi.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const engine=new ReaderEngine({createRuntime:async()=>r,accountStatus:async()=>({connected:true})});
  const pending=engine.run({requestId:'20000000-0000-4000-8000-000000000123'});
  await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));await expect(engine.reset()).rejects.toThrow(/结束阅读任务/);
  finish('done');await pending;await engine.reset();await engine.stop();
});
