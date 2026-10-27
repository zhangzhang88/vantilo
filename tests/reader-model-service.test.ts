import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require=createRequire(import.meta.url);
const {createReaderModelService}=require('../electron/reader-model-service.cjs');
const {MODEL_MANIFEST}=require('../electron/reader-model-manifest.cjs');
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture({nativeResult='ok'}:{nativeResult?:string}={}){
  const userData=await mkdtemp(path.join(os.tmpdir(),'vantilo-qwen-service-'));roots.push(userData);
  const assetsDir=path.join(userData,'assets');
  await mkdir(assetsDir,{recursive:true});
  const runHelper=vi.fn(async(_binary:string,args:string[])=>args[0]==='--gloss'? {stdout:JSON.stringify({result:'ok',gloss:'树皮',runtime:'swift-mlx',word:args[2]})} : nativeResult==='ok' ? {
    stdout:JSON.stringify({result:'ok',gloss:'树皮',runtime:'swift-mlx'})
  } : nativeResult==='wrong' ? {
    stdout:JSON.stringify({result:'ok',gloss:'吠叫',runtime:'swift-mlx'})
  } : Promise.reject(Object.assign(new Error('missing binary'),{code:'ENOENT'})));
  const installer={
    inspect:vi.fn(async()=>({hardware:{supported:true,memoryGiB:16},disk:{availableBytes:9e9,freshInstallBytes:5e9},model:{bytes:3061129077},status:'needs-native-runtime-check'})),
    verifyExisting:vi.fn(async(_folder:string)=>({verified:true,modelId:MODEL_MANIFEST.id})),
    adoptExisting:vi.fn(async({folder}:{folder:string})=>{
      const dir=path.join(userData,'local-models');await mkdir(dir);
      await writeFile(path.join(dir,'.adopted-'+MODEL_MANIFEST.id+'.json'),JSON.stringify({
        version:1,id:MODEL_MANIFEST.id,revision:MODEL_MANIFEST.revision,path:folder,
      }));
      return {verified:true,path:folder,adopted:true};
    }),
    install:vi.fn(async()=>({verified:true,path:'/dummy/local/model'})),
  };
  return {userData,assetsDir,installer,runHelper,service:createReaderModelService({userData,assetsDir,installer,runHelper})};
}
describe('B2 main-only model service',()=>{
  it('never claims readiness from a persisted reference alone or an absent binary',async()=>{
    const f=await fixture({nativeResult:'missing'});
    expect((await f.service.inspect()).health.ready).toBe(false);
    const result=await f.service.chooseExisting('/synthetic-model-folder');
    expect(result.health).toMatchObject({ready:false,status:'native-helper-missing'});
    expect((await f.service.inspect()).selected).toBe(true);
    expect((await f.service.inspect()).health.ready).toBe(false);
    expect(f.runHelper).toHaveBeenCalledTimes(1);
  });
  it('returns ready only for exact native Swift expected health response',async()=>{
    const f=await fixture();
    const result=await f.service.chooseExisting('/synthetic-model-folder');
    expect(result.health).toMatchObject({ready:true,status:'verified-native'});
    expect(f.runHelper).toHaveBeenCalledWith(
      path.join(f.assetsDir,'native','vantilo-qwen-health'),
      ['--health','/synthetic-model-folder'],expect.objectContaining({
        timeout:65000,env:expect.objectContaining({HF_HUB_OFFLINE:'1'})
      })
    );
    expect(await f.service.recheck()).toMatchObject({ready:true,status:'verified-native'});
    const broken=await fixture({nativeResult:'wrong'});
    expect((await broken.service.chooseExisting('/synthetic')).health.ready).toBe(false);
  });
  it('rejects requests until native health passes and only accepts bounded word+sentence inputs',async()=>{
    const f=await fixture();
    await expect(f.service.gloss({word:'bark',sentence:"The tree's bark is rough."})).rejects.toThrow('验证');
    await f.service.chooseExisting('/synthetic-model-folder');
    const info=await f.service.inspect();
    expect(info).toMatchObject({selected:true,modelName:'Qwen3.5 4B (MLX 4-bit)',modelPath:'/synthetic-model-folder'});
    await expect(f.service.gloss({word:'../../evil',sentence:'tree'})).rejects.toThrow('输入');
    await expect(f.service.gloss({word:'bark',sentence:'x'.repeat(601)})).rejects.toThrow('输入');
    expect(await f.service.gloss({word:'bark',sentence:"The tree's bark is rough."}))
      .toMatchObject({meaningZh:'树皮',provider:'qwen-mlx'});
    expect(f.runHelper).toHaveBeenCalledWith(
      path.join(f.assetsDir,'native','vantilo-qwen-health'),
      ['--gloss','/synthetic-model-folder','bark',"The tree's bark is rough."],
      expect.objectContaining({timeout:45000,env:expect.objectContaining({HF_HUB_OFFLINE:'1'})})
    );
  });
  it('reuses a single native worker and invalidates its health after idle release',async()=>{
    const f=await fixture();
    let active=false;
    const calls:any[]=[];
    const worker={
      request:vi.fn(async(_folder:string,input:any)=>{
        active=true;calls.push(input);
        return {ok:true,result:'ok',runtime:'swift-mlx',
          gloss:input.type==='health'?'树皮':'段落',word:input.word||'bark'};
      }),
      reset:vi.fn(()=>{active=false;}),
      close:vi.fn(()=>{active=false;}),
      inspect:vi.fn(()=>({active,busy:false})),
    };
    const service=require('../electron/reader-model-service.cjs').createReaderModelService({
      userData:f.userData,assetsDir:f.assetsDir,installer:f.installer,runHelper:f.runHelper,
      persistentGloss:true,workerFactory:()=>worker,
    });
    const adopted=await service.chooseExisting('/synthetic-model-folder');
    expect(adopted.health.ready).toBe(true);
    expect((await service.gloss({word:'paragraph',sentence:'One short paragraph.'})).meaningZh).toBe('段落');
    expect((await service.gloss({word:'bank',sentence:'The river bank.'})).meaningZh).toBe('段落');
    expect(worker.request).toHaveBeenCalledTimes(3);
    expect(calls.map(x=>x.type)).toEqual(['health','gloss','gloss']);
    expect(f.runHelper).not.toHaveBeenCalled();
    active=false; // Synthetic idle timeout: model memory has been released.
    expect((await service.inspect()).health.ready).toBe(false);
    await expect(service.gloss({word:'bank',sentence:'The bank.'})).rejects.toThrow('验证');
    expect((await service.recheck()).ready).toBe(true);
    service.close();
    expect(worker.close).toHaveBeenCalledOnce();
  });
  it('does not start a second concurrent model install and supports cancellation',async()=>{
    const f=await fixture();
    f.installer.install=vi.fn(async({signal}:{signal:AbortSignal})=>
      new Promise((_resolve,reject)=>{
        if(signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
      })
    ) as unknown as typeof f.installer.install;
    const downloading=f.service.startDownload(()=>{});
    expect((await f.service.inspect()).active).toBe(true);
    await expect(f.service.startDownload(()=>{})).rejects.toThrow('已有模型下载任务');
    expect(f.service.cancelDownload()).toEqual({canceled:true});
    await expect(downloading).rejects.toThrow('取消');
    expect((await f.service.inspect()).active).toBe(false);
    expect(f.service.cancelDownload()).toEqual({canceled:false});
  });
});
