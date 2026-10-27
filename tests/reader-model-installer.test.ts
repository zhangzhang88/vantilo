import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createReaderModelInstaller, verifyModelFiles, validateModelManifest,
  checkModelHardware, LOCAL_HEALTH_PENDING } = require('../electron/reader-model-installer.cjs');
const { MODEL_MANIFEST } = require('../electron/reader-model-manifest.cjs');
const dirs:string[]=[];
const revision='32f3e8ecf65426fc3306969496342d504bfa13f3';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function fixture(){
  const tmp=await mkdtemp(path.join(os.tmpdir(),'vantilo-qwen-b2-')); dirs.push(tmp);
  const payloads:Record<string,Buffer>={
    'config.json':Buffer.from(JSON.stringify({model_type:'qwen3_5',quantization:{bits:4}})),
    'model.safetensors':Buffer.from('synthetic-only-not-a-real-model-weight-'.repeat(4)),
    'tokenizer.json':Buffer.from('{"toy":"synthetic token fixture"}'),
  };
  const manifest={version:1,id:'test-qwen3.5',repository:'mlx-community/Qwen3.5-4B-MLX-4bit',
    revision,license:'Apache-2.0',
    files:Object.entries(payloads).map(([name,data])=>({name,bytes:data.length,sha256:sha(data)}))};
  const root=path.join(tmp,'installed');
  const callbacks:any[]=[];
  let failType='';
  const fetchImpl=vi.fn(async (url:string,options:any)=>{
    callbacks.push({url,range:options.headers.range||null,redirect:options.redirect});
    if(failType==='redirect')return new Response(null,{status:302,headers:{location:'https://evil.example/anything'}});
    const name=decodeURIComponent(new URL(url).pathname.split('/').at(-1)!);
    const data=payloads[name];
    if(!data)throw new Error('unexpected file request');
    const offset=Number(options.headers.range?.match(/^bytes=(\d+)-$/)?.[1]||0);
    if(failType==='range')return new Response(new Uint8Array(data.subarray(offset)),{
      status:206,headers:{'content-range':'bytes 1-'+(data.length-1)+'/'+data.length}
    });
    if(failType==='corrupt')return new Response(new Uint8Array(Buffer.alloc(data.length,88)),{status:200});
    if(failType==='ignoreRange' && offset>0)return new Response(new Uint8Array(data),{status:200,headers:{'content-length':String(data.length)}});
    const bytes=data.subarray(offset);
    const headers:Record<string,string>=offset?{'content-range':'bytes '+offset+'-'+(data.length-1)+'/'+data.length,'content-length':String(bytes.length)}
      :{'content-length':String(bytes.length)};
    if(failType==='chunked' && name==='model.safetensors' && offset===0){
      let i=0;
      const stream=new ReadableStream({
        pull(controller){
          if(i>=data.length){controller.close();return;}
          controller.enqueue(data.subarray(i,Math.min(i+10,data.length)));i+=10;
        }
      });
      return new Response(stream,{status:200,headers});
    }
    return new Response(new Uint8Array(bytes),{status:offset?206:200,headers});
  });
  const opts={root,manifest,fetchImpl,platform:'darwin',arch:'arm64',memoryBytes:16*1024**3,
    reserveBytes:0,statfsImpl:async()=>({bavail:100_000_000,bsize:1})};
  return {tmp,root,manifest,payloads,fetchImpl,callbacks,opts,setFailure:(t:string)=>{failType=t;}};
}
afterEach(async()=>{await Promise.all(dirs.splice(0).map(x=>rm(x,{recursive:true,force:true})));});
describe('B2 local model installer foundation',()=>{
  it('pins the real official 4-bit artifact and never starts installation by inspection',async()=>{
    expect(MODEL_MANIFEST.revision).toBe(revision);
    expect(MODEL_MANIFEST.files.find((x:any)=>x.name==='model.safetensors')).toMatchObject({
      bytes:3034300695,sha256:'5fb9acd0246866381cf8c5c354c6db1019f6498eec4ccb4f5edcc71ffeacb2db',
    });
    expect(validateModelManifest(MODEL_MANIFEST)).toBe(MODEL_MANIFEST);
    const f=await fixture();const installer=createReaderModelInstaller(f.opts);
    const info=await installer.inspect();
    expect(info.hardware).toMatchObject({supported:true,appleSilicon:true,memoryGiB:16});
    expect(info.status).toBe(LOCAL_HEALTH_PENDING);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    await expect(installer.install()).rejects.toThrow('明确确认');
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects invalid or remote-injected manifest entries, Intel and memory below 8GB',async()=>{
    const f=await fixture();
    for(const file of ['../oops','x/y','.hidden.safetensors','bad'] ){
      const m={...f.manifest,files:[{name:file,bytes:3,sha256:'0'.repeat(64)}]};
      if(file==='bad')m.files[0].sha256='invalid';
      await expect(Promise.resolve().then(()=>validateModelManifest(m))).rejects.toThrow('清单');
    }
    expect(checkModelHardware({platform:'darwin',arch:'x64',memoryBytes:16*1024**3}).supported).toBe(false);
    expect(checkModelHardware({platform:'darwin',arch:'arm64',memoryBytes:4*1024**3}).supported).toBe(false);
    const x=createReaderModelInstaller({...f.opts,arch:'x64'});
    await expect(x.install({consent:true})).rejects.toThrow('Apple Silicon');
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('downloads only pinned filenames, verifies all SHA256, publishes atomically but NOT inference-ready',async()=>{
    const f=await fixture();
    const progress:any[]=[];
    const installer=createReaderModelInstaller(f.opts);
    const result=await installer.install({consent:true,onProgress:(x:{file:string;completedBytes:number;totalBytes:number})=>progress.push(x)});
    expect(result).toMatchObject({verified:true,alreadyInstalled:false,status:LOCAL_HEALTH_PENDING});
    expect(f.callbacks).toHaveLength(3);
    expect(f.callbacks.every(x=>x.url.includes('/resolve/'+revision+'/'))).toBe(true);
    expect(progress.at(-1)).toMatchObject({totalBytes:f.manifest.files.reduce((a,x)=>a+x.bytes,0)});
    const installedNames=await readdir(result.path);
    expect(installedNames).toContain('.vantilo-install.json');
    expect(installedNames).toContain('model.safetensors');
    expect((await readFile(path.join(result.path,'model.safetensors'))).equals(f.payloads['model.safetensors'])).toBe(true);
    expect(await verifyModelFiles(result.path,f.manifest)).toMatchObject({verified:true,status:LOCAL_HEALTH_PENDING});
    const second=await installer.install({consent:true});
    expect(second.alreadyInstalled).toBe(true);
    expect(f.fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('refuses low disk with no outbound network',async()=>{
    const f=await fixture();
    const installer=createReaderModelInstaller({...f.opts,statfsImpl:async()=>({bavail:2,bsize:1})});
    await expect(installer.install({consent:true})).rejects.toThrow('磁盘');
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('preserves a partial download on cancellation then resumes using exact HTTP Range',async()=>{
    const f=await fixture();f.setFailure('chunked');
    const installer=createReaderModelInstaller(f.opts);
    const ctl=new AbortController();
    await expect(installer.install({consent:true,signal:ctl.signal,onProgress:(x:{file:string;completedBytes:number;totalBytes:number})=>{
      if(x.file==='model.safetensors' && x.completedBytes>=f.payloads['config.json'].length+10)ctl.abort();
    }})).rejects.toThrow();
    const staging=path.join(f.root,'.staging','test-qwen3.5-'+revision.slice(0,12));
    const part=path.join(staging,'model.safetensors.partial');
    const incomplete=await stat(part);
    expect(incomplete.size).toBeGreaterThan(0);
    expect(incomplete.size).toBeLessThan(f.payloads['model.safetensors'].length);
    f.setFailure('');
    const result=await installer.install({consent:true});
    expect(result.verified).toBe(true);
    expect(f.callbacks.some(x=>x.range==='bytes='+incomplete.size+'-')).toBe(true);
  });
  it('fails closed on corrupt data, unsafe redirect and mismatched content range',async()=>{
    for(const scenario of ['corrupt','redirect','range']){
      const f=await fixture();f.setFailure(scenario);
      const installer=createReaderModelInstaller(f.opts);
      await expect(installer.install({consent:true})).rejects.toThrow();
      await expect(stat(installer.destination)).rejects.toMatchObject({code:'ENOENT'});
    }
  });
  it('rejects symlinked model files on verification',async()=>{
    const f=await fixture();
    const folder=path.join(f.tmp,'external');await mkdir(folder);
    for(const [name,data] of Object.entries(f.payloads))await writeFile(path.join(folder,name),data);
    expect(await verifyModelFiles(folder,f.manifest)).toMatchObject({verified:true});
    await rm(path.join(folder,'tokenizer.json'));
    await symlink(path.join(f.tmp,'not-allowed-file'),path.join(folder,'tokenizer.json'));
    await expect(verifyModelFiles(folder,f.manifest)).rejects.toThrow();
  });
  it('adopts a fully verified external model without copying weights or asserting ready',async()=>{
    const f=await fixture();
    const folder=path.join(f.tmp,'external');await mkdir(folder);
    for(const [name,data] of Object.entries(f.payloads))await writeFile(path.join(folder,name),data);
    const manager=createReaderModelInstaller(f.opts);
    await expect(manager.adoptExisting({folder})).rejects.toThrow('明确确认');
    const adopted=await manager.adoptExisting({consent:true,folder});
    expect(adopted).toMatchObject({adopted:true,verified:true,status:LOCAL_HEALTH_PENDING,path:folder});
    expect(f.fetchImpl).not.toHaveBeenCalled();
    const record=JSON.parse(await readFile(path.join(f.root,'.adopted-test-qwen3.5.json'),'utf8'));
    expect(record).toMatchObject({path:folder,status:LOCAL_HEALTH_PENDING});
    expect(await readdir(folder)).toHaveLength(3);
  });
  it('restarts from zero safely when server ignores a saved Range request',async()=>{
    const f=await fixture();f.setFailure('chunked');
    const installer=createReaderModelInstaller(f.opts);
    const ctl=new AbortController();
    await expect(installer.install({consent:true,signal:ctl.signal,onProgress:(x:{file:string;completedBytes:number;totalBytes:number})=>{
      if(x.file==='model.safetensors' && x.completedBytes>f.payloads['config.json'].length)ctl.abort();
    }})).rejects.toThrow();
    f.setFailure('ignoreRange');
    const result=await installer.install({consent:true});
    expect(result.verified).toBe(true);
    expect(f.callbacks.some(x=>x.range?.startsWith('bytes=') && x.range!=='bytes=0-')).toBe(true);
    expect(await verifyModelFiles(result.path,f.manifest)).toMatchObject({verified:true});
  });
  it('refuses unexpected files in the staging directory rather than publishing them',async()=>{
    const f=await fixture();
    const staged=path.join(f.root,'.staging','test-qwen3.5-'+revision.slice(0,12));
    await mkdir(staged,{recursive:true});
    await writeFile(path.join(staged,'user-notes.txt'),'do not touch');
    const installer=createReaderModelInstaller(f.opts);
    await expect(installer.install({consent:true})).rejects.toThrow('意外文件');
    expect(await readFile(path.join(staged,'user-notes.txt'),'utf8')).toBe('do not touch');
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('recovers an interrupted owner PID lock while retaining the staged source files',async()=>{
    const f=await fixture();
    await mkdir(f.root);
    await writeFile(path.join(f.root,'.test-qwen3.5.install-lock'),JSON.stringify({pid:999999999,createdAt:0}));
    const installer=createReaderModelInstaller(f.opts);
    const result=await installer.install({consent:true});
    expect(result).toMatchObject({verified:true,alreadyInstalled:false});
    await expect(stat(path.join(f.root,'.test-qwen3.5.install-lock'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('rejects a symlinked managed root without writing into its target',async()=>{
    const f=await fixture();
    const outside=path.join(f.tmp,'real');await mkdir(outside);
    await symlink(outside,f.root);
    const installer=createReaderModelInstaller(f.opts);
    await expect(installer.install({consent:true})).rejects.toThrow('普通文件夹');
    expect(await readdir(outside)).toHaveLength(0);
  });
});
