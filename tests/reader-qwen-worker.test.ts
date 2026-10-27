import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { describe,expect,it,vi } from 'vitest';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {createQwenWorker}=require('../electron/reader-qwen-worker.cjs');

function fakeRuntime({respond=true, wrongId=false}:{respond?:boolean;wrongId?:boolean}={}) {
  const children:any[]=[];
  const spawnImpl=vi.fn((_file:string,args:string[],options:any)=>{
    const child:any=new EventEmitter();
    child.stdout=new PassThrough();
    child.stderr=new PassThrough();
    child.commands=[];
    child.stdin=new Writable({
      write(chunk,_encoding,done) {
        const obj=JSON.parse(Buffer.from(chunk).toString('utf8').trim());
        child.commands.push(obj);
        if(respond)queueMicrotask(()=>child.stdout.write(JSON.stringify({
          id:wrongId?'wrong-id':obj.id,ok:true,result:'ok',runtime:'swift-mlx',
          gloss:obj.type==='health'?'树皮':'段落',word:obj.word||'bark'
        })+'\n'));
        done();
      },
    });
    child.kill=vi.fn(()=>{child.emit('exit',null,'SIGTERM');return true;});
    child.args=args;child.options=options;
    children.push(child);
    return child;
  });
  return {spawnImpl,children};
}
describe('Qwen lazy long-lived worker protocol',()=>{
  it('loads a single offline subprocess for multiple requests and leaves it on idle timer',async()=>{
    const runtime=fakeRuntime();
    const w=createQwenWorker({helper:'/fake/local/helper',spawnImpl:runtime.spawnImpl,idleMs:1000});
    try{
      expect(w.inspect()).toEqual({active:false,busy:false});
      const h=await w.request('/local/model',{type:'health'});
      expect(h).toMatchObject({ok:true,gloss:'树皮'});
      const a=await w.request('/local/model',{type:'gloss',word:'paragraph',sentence:'A paragraph.'});
      const b=await w.request('/local/model',{type:'gloss',word:'bank',sentence:'A river bank.'});
      expect([a.gloss,b.gloss]).toEqual(['段落','段落']);
      expect(runtime.spawnImpl).toHaveBeenCalledTimes(1);
      expect(runtime.children[0].args).toEqual(['--serve','/local/model']);
      expect(runtime.children[0].options).toMatchObject({
        shell:false,env:expect.objectContaining({HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1'}),
      });
      expect(runtime.children[0].commands).toHaveLength(3);
      expect(w.inspect()).toEqual({active:true,busy:false});
    } finally {w.close();}
    expect(runtime.children[0].kill).toHaveBeenCalledOnce();
  });
  it('refuses parallel requests and safely releases an interrupted worker',async()=>{
    const runtime=fakeRuntime({respond:false});
    const w=createQwenWorker({helper:'/fake/helper',spawnImpl:runtime.spawnImpl,timeoutMs:1200});
    const first=w.request('/model',{type:'health'});
    await expect(w.request('/model',{type:'gloss',word:'bark',sentence:'A tree.'})).rejects.toThrow('另一条');
    w.reset();
    await expect(first).rejects.toThrow('切换');
    expect(runtime.children[0].kill).toHaveBeenCalledOnce();
    const again=w.request('/model',{type:'health'});
    expect(runtime.children).toHaveLength(2);
    w.close();
    await expect(again).rejects.toThrow('关闭');
    await expect(w.request('/model',{type:'health'})).rejects.toThrow('停止');
  });
  it('stops an in-flight gloss when its caller cancels',async()=>{
    const runtime=fakeRuntime({respond:false});
    const worker=createQwenWorker({helper:'/fake/helper',spawnImpl:runtime.spawnImpl});
    const controller=new AbortController();
    const request=worker.request('/model',{type:'gloss',word:'bank',sentence:'A river bank.'},{signal:controller.signal});
    controller.abort();
    await expect(request).rejects.toThrow('取消');
    expect(runtime.children[0].kill).toHaveBeenCalledOnce();
    expect(worker.inspect()).toMatchObject({active:false,busy:false});
    worker.close();
  });
  it('fails closed on malformed or mismatched JSONL responses and restarts later',async()=>{
    const runtime=fakeRuntime({wrongId:true});
    const w=createQwenWorker({helper:'/fake/helper',spawnImpl:runtime.spawnImpl});
    await expect(w.request('/model',{type:'health'})).rejects.toThrow('响应失败');
    expect(w.inspect().active).toBe(false);
    expect(runtime.children[0].kill).toHaveBeenCalledOnce();
    w.close();
  });
  it('times out blocked inference, releases the native process, and never returns fake success',async()=>{
    const runtime=fakeRuntime({respond:false});
    const w=createQwenWorker({helper:'/fake/helper',spawnImpl:runtime.spawnImpl,timeoutMs:1000});
    try {
      await expect(w.request('/model',{type:'health'})).rejects.toThrow('超时');
      expect(w.inspect().active).toBe(false);
      expect(runtime.children[0].kill).toHaveBeenCalledOnce();
    } finally {w.close();}
  });
  it('releases the model after inactivity and spawns anew for a later word',async()=>{
    const runtime=fakeRuntime();
    const w=createQwenWorker({helper:'/fake/helper',spawnImpl:runtime.spawnImpl,idleMs:1000});
    try {
      await w.request('/model',{type:'health'});
      await new Promise(resolve=>setTimeout(resolve,1100));
      expect(w.inspect().active).toBe(false);
      await w.request('/model',{type:'health'});
      expect(runtime.children).toHaveLength(2);
    } finally {w.close();}
  });
});
