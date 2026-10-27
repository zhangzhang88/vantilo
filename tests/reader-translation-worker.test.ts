import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {describe,it,expect,vi} from 'vitest';
const require=createRequire(import.meta.url);
const {createQwenWorker}=require('../electron/reader-qwen-worker.cjs');
function setup(){
 const children:any[]=[];
 const spawnImpl=()=>{const p:any=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.commands=[];
  p.stdin=new Writable({write(c,_e,done){p.commands.push(JSON.parse(c.toString()));done();}});
  p.kill=vi.fn(()=>true);children.push(p);return p;};
 const worker=createQwenWorker({helper:'/fake/helper',spawnImpl,timeoutMs:1000});
 const respond=(i:number)=>{const p=children[i];const bytes=Buffer.from(JSON.stringify({id:p.commands[0].id,ok:true,runtime:'swift-mlx',result:'ok',translation:'这是译文。'})+'\n');for(const b of bytes)p.stdout.write(Buffer.from([b]));};
 return {worker,children,respond};
}
describe('bounded native paragraph protocol',()=>{
 it('rejects oversized input before spawning a model and preserves split UTF-8 replies',async()=>{
  const c=setup();try{
   await expect(c.worker.request('/model',{type:'translate',text:'a'.repeat(1801)})).rejects.toThrow('1800');expect(c.children).toHaveLength(0);
   const result=c.worker.request('/model',{type:'translate',text:'Hello.'});c.respond(0);
   expect((await result).translation).toBe('这是译文。');expect(c.children[0].commands[0]).toMatchObject({type:'translate',text:'Hello.'});
  }finally{c.worker.close();}
 });
 it('kills canceled inference and ignores late output from the replaced subprocess',async()=>{
  const c=setup();try{
   const ctl=new AbortController();const first=c.worker.request('/model',{type:'translate',text:'Hi.'},{signal:ctl.signal});ctl.abort();
   await expect(first).rejects.toThrow('取消');expect(c.children[0].kill).toHaveBeenCalledOnce();
   const second=c.worker.request('/model',{type:'translate',text:'Next.'});c.respond(0);c.respond(1);
   expect((await second).translation).toBe('这是译文。');
  }finally{c.worker.close();}
 });
 it('reclaims a model on paragraph timeout or process exit',async()=>{
  const c=setup();try{
   const first=c.worker.request('/model',{type:'translate',text:'Hi.'});c.children[0].emit('exit',1);
   await expect(first).rejects.toThrow('退出');
   await expect(c.worker.request('/model',{type:'translate',text:'Again.'})).rejects.toThrow('超时');expect(c.children[1].kill).toHaveBeenCalledOnce();
  }finally{c.worker.close();}
 });
});
