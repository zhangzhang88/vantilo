import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {copyCodexRuntime,CODEX_RUNTIME_FILES} from '../scripts/codex-runtime-assets.mjs';

it('copies both same-version executables together, preserving source and executable permissions',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'vantilo-codex-assets-'));
  try {
    const source=path.join(root,'source'), output=path.join(root,'output');
    await fs.mkdir(source);
    for(const name of CODEX_RUNTIME_FILES)await fs.writeFile(path.join(source,name),'fixture '+name,{mode:0o755});
    await fs.writeFile(path.join(source,'private-config'),'never copy');
    await copyCodexRuntime(source,output);
    expect((await fs.readdir(output)).sort()).toEqual([...CODEX_RUNTIME_FILES].sort());
    for(const name of CODEX_RUNTIME_FILES){
      expect(await fs.readFile(path.join(output,name),'utf8')).toBe('fixture '+name);
      expect(await fs.readFile(path.join(source,name),'utf8')).toBe('fixture '+name);
      expect((await fs.stat(path.join(output,name))).mode & 0o777).toBe(0o755);
    }
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
it('rejects incomplete runtime assets before replacing a working executable',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'vantilo-codex-assets-'));
  try {
    const source=path.join(root,'source'), output=path.join(root,'output');
    await fs.mkdir(source);await fs.mkdir(output);
    await fs.writeFile(path.join(source,'codex'),'new cli',{mode:0o755});
    await fs.writeFile(path.join(output,'codex'),'existing cli');
    await expect(copyCodexRuntime(source,output)).rejects.toThrow();
    expect(await fs.readFile(path.join(output,'codex'),'utf8')).toBe('existing cli');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
