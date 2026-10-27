import {createRequire} from 'node:module';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {it,expect,vi} from 'vitest';
const require=createRequire(import.meta.url);
const {createIntelModelService}=require('../electron/reader-intel-service.cjs');

it('uses a selected verified model, separates Intel provenance and invalidates readiness after failure',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-intel-service-'));
  try {
    await mkdir(path.join(root,'native'));await writeFile(path.join(root,'model.gguf'),'fixture');
    let active=false;const worker={inspect:()=>({active}),reset:()=>{active=false;},close:vi.fn(),translate:vi.fn(async()=>{active=true;return '中文译文';}),gloss:vi.fn(async()=> '宁静')};
    const verify=vi.fn(async()=>({}));
    const service=createIntelModelService({userData:root,assetsDir:root,persistentGloss:true,workerFactory:()=>worker,verify});
    const chosen=await service.chooseExisting(path.join(root,'model.gguf'));
    expect(chosen.health.ready).toBe(true);expect(verify).toHaveBeenCalledTimes(2);
    expect(await service.translate({text:'synthetic'})).toMatchObject({translation:'中文译文',provider:'qwen-gguf'});
    expect(await service.gloss({word:'peaceful',sentence:'The garden is peaceful.'})).toEqual({meaningZh:'宁静',model:'Qwen3.5 4B (GGUF Q4_K_M)',provider:'qwen-gguf'});
    expect(worker.gloss).toHaveBeenCalledWith(path.join(root,'model.gguf'),'peaceful','The garden is peaceful.',{signal:undefined});
    await expect(service.gloss({word:'bad; input',sentence:'example'})).rejects.toThrow(/输入/);
    worker.translate.mockRejectedValueOnce(new Error('failed'));
    await expect(service.translate({text:'synthetic'})).rejects.toThrow('failed');
    await expect(service.translate({text:'synthetic'})).rejects.toThrow(/验证/);
    service.close();expect(worker.close).toHaveBeenCalledOnce();
  } finally {await rm(root,{recursive:true,force:true});}
});
