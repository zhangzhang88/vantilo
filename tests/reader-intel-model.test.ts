import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdtemp, writeFile, symlink, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url);
const {INTEL_MODEL,verifyIntelModel}=require('../electron/reader-intel-model.cjs');

describe('Intel model file verification',()=>{
  it('keeps GGUF provenance separate from the MLX model',()=>{
    expect(INTEL_MODEL.id).toContain('gguf');
    expect(INTEL_MODEL.bytes).toBe(2783446880);
    expect(INTEL_MODEL.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('verifies a selected plain file, rejects altered files and does not follow a symlink',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-gguf-test-'));
    try {
      const file=path.join(dir,'model.gguf');const data=Buffer.from('synthetic fixture');await writeFile(file,data);
      const manifest={id:'test',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
      expect(await verifyIntelModel(file,{manifest})).toMatchObject({id:'test',size:data.length});
      await writeFile(file,Buffer.alloc(data.length));await expect(verifyIntelModel(file,{manifest})).rejects.toThrow(/完整性/);
      const link=path.join(dir,'link');await symlink(file,link);await expect(verifyIntelModel(link,{manifest})).rejects.toThrow();
      await expect(verifyIntelModel('relative.gguf',{manifest})).rejects.toThrow(/选择/);
    } finally {await rm(dir,{recursive:true,force:true});}
  });
});
