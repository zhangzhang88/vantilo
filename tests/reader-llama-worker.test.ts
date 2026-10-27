import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {describe,it,expect,vi} from 'vitest';
const require=createRequire(import.meta.url);
const {createLlamaWorker}=require('../electron/reader-llama-worker.cjs');
function fake() {
  const children:any[]=[];
  const spawn=vi.fn((_cmd:string,_args:string[],options:any)=>{const p=new EventEmitter() as any;p.stderr=new EventEmitter();p.kill=vi.fn();children.push({p,options});return p;});
  const fetch=vi.fn(async (url:string,_options?:any):Promise<any>=>url.endsWith('/v1/models')?{ok:true}:{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'雨后小花园很安静。'}}]})});
  return {children,spawn,fetch};
}
describe('Intel local model worker',()=>{
  it('reuses its authenticated loopback child and rejects truncated output',async()=>{
    const f=fake(),worker=createLlamaWorker({helper:'/app/llama-server',spawnImpl:f.spawn,fetchImpl:f.fetch});
    try {
      expect(await worker.translate('/models/test.gguf','The garden is quiet.')).toContain('花园');
      await worker.translate('/models/test.gguf','The garden is quiet again.');
      expect(f.spawn).toHaveBeenCalledTimes(1);
      expect(f.children[0].options.env.LLAMA_API_KEY).toMatch(/^[a-f0-9]{64}$/);
      expect(f.spawn.mock.calls[0][1]).toContain('127.0.0.1');
      f.fetch.mockImplementation(async (url:string)=>url.endsWith('/v1/models')?{ok:true}:{ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'截断'}}]})});
      await expect(worker.translate('/models/test.gguf','long text')).rejects.toThrow(/不完整/);
      expect(f.children[0].p.kill).toHaveBeenCalled();
    } finally {worker.close();}
  });
  it('cancels only its child and does not return a late response',async()=>{
    const f=fake(),worker=createLlamaWorker({helper:'/app/llama-server',spawnImpl:f.spawn,fetchImpl:f.fetch});
    f.fetch.mockImplementation(async (url:string,options:any)=>{
      if(url.endsWith('/v1/models'))return {ok:true};
      return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
    });
    const ctl=new AbortController();const pending=worker.translate('/models/test.gguf','text',{signal:ctl.signal});
    const rejected=expect(pending).rejects.toThrow(/取消/);
    await vi.waitFor(()=>expect(f.fetch).toHaveBeenCalledTimes(2));ctl.abort();await rejected;
    expect(f.children[0].p.kill).toHaveBeenCalled();worker.close();
  });
  it('asks for a bounded contextual meaning and rejects malformed results',async()=>{
    const f=fake(),worker=createLlamaWorker({helper:'/app/llama-server',spawnImpl:f.spawn,fetchImpl:f.fetch});
    try {
      f.fetch.mockImplementation(async (url:string)=>url.endsWith('/v1/models')?{ok:true}:{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'宁静'}}]})});
      expect(await worker.gloss('/models/test.gguf','peaceful','The garden is peaceful.')).toBe('宁静');
      const request=JSON.parse(f.fetch.mock.calls[1][1].body);
      expect(request.max_tokens).toBe(64);
      expect(JSON.parse(request.messages[1].content)).toEqual({word:'peaceful',sentence:'The garden is peaceful.'});
      f.fetch.mockImplementation(async (url:string)=>url.endsWith('/v1/models')?{ok:true}:{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'peaceful: 宁静'}}]})});
      await expect(worker.gloss('/models/test.gguf','peaceful','The garden is peaceful.')).rejects.toThrow(/格式/);
      await expect(worker.gloss('/models/test.gguf','invalid;','sentence')).rejects.toThrow(/输入/);
    } finally {worker.close();}
  });
});
