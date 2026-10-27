import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createReaderOnboarding, MODEL_INFO_URL } = require('../electron/reader-onboarding.cjs');
const dirs:string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, {recursive:true,force:true}); });
async function isolated(lookup:any, arch='arm64') {
  const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-fresh-setup-'));dirs.push(dir);
  return {dir,service:createReaderOnboarding({userData:dir,assetsDir:path.join(dir,'new-install-without-models'),platform:'darwin',arch,totalMemory:16*1024**3,lookup})};
}
describe('first-run Reader setup on a clean Mac',()=>{
  it('shows onboarding on fresh userData, without a model or Python installed, and persists an explicit skip',async()=>{
    const {dir,service}=await isolated(vi.fn(async()=>({definitionsEn:[{definition:'apple fruit'}],definitionsZh:[]})));
    expect(await service.getState()).toEqual({show:true});
    expect(await service.check()).toEqual({dictionary:'english-only',hardware:{appleSilicon:true,memoryGiB:16},localAi:'not-integrated'});
    expect(await service.finish('skipped')).toEqual({show:false});
    const saved=JSON.parse(await readFile(path.join(dir,'reader-onboarding.json'),'utf8'));
    expect(saved).toEqual({version:1,decision:'skipped'});
    expect(await service.getState()).toEqual({show:false});
  });
  it('distinguishes Chinese dictionary from unavailable and does not claim Intel MLX readiness',async()=>{
    const bilingual=await isolated(vi.fn(async()=>({definitionsZh:[{definition:'苹果'}]})));
    expect((await bilingual.service.check()).dictionary).toBe('bilingual');
    const unavailable=await isolated(vi.fn(async()=>{throw new Error('not configured');}),'x64');
    expect(await unavailable.service.check()).toEqual({dictionary:'unavailable',hardware:{appleSilicon:false,memoryGiB:16},localAi:'not-integrated'});
  });
  it('rejects invalid actions, treats broken state as unresolved and only documents one verified model source',async()=>{
    const {dir,service}=await isolated(vi.fn(async()=>({})));
    await expect(service.finish('install-model')).rejects.toThrow('Invalid');
    expect(await service.getState()).toEqual({show:true});
    expect(MODEL_INFO_URL).toBe('https://huggingface.co/mlx-community/Qwen3.5-4B-MLX-4bit');
    expect(await service.finish('finished')).toEqual({show:false});
  });
});
