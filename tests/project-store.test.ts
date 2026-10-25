import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ProjectStore } = require('../electron/project-store.cjs') as { ProjectStore: new(options:any)=>any };
const roots:string[]=[];
async function makeStore(){const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-projects-'));roots.push(dir);const filePath=path.join(dir,'projects.json');const store=new ProjectStore({filePath});await store.load();return {store,filePath,dir};}
afterEach(async()=>{await Promise.all(roots.splice(0).map(dir=>rm(dir,{recursive:true,force:true})))});

describe('Vantilo project registry',()=>{
  it('persists pin state and removes a project without losing its registration history',async()=>{
    const {store,filePath}=await makeStore();
    await store.ensure('/projects/alpha');
    await store.setPinned('/projects/alpha',true);
    expect(store.list()).toEqual([{root:'/projects/alpha',pinned:true,removed:false}]);
    await store.remove('/projects/alpha');
    expect(store.list()).toEqual([{root:'/projects/alpha',pinned:false,removed:true}]);
    const reopened=new ProjectStore({filePath});await reopened.load();
    expect(reopened.list()).toEqual([{root:'/projects/alpha',pinned:false,removed:true}]);
  });
  it('restores a removed project only after explicit registration and never duplicates roots',async()=>{
    const {store}=await makeStore();
    await store.ensure('/projects/alpha');await store.remove('/projects/alpha');
    await store.ensure('/projects/alpha');
    expect(store.list()).toEqual([{root:'/projects/alpha',pinned:false,removed:true}]);
    await store.register('/projects/alpha');await store.ensure('/projects/alpha');
    expect(store.list()).toEqual([{root:'/projects/alpha',pinned:false,removed:false}]);
    expect(JSON.parse(await readFile(path.join(path.dirname(store.filePath),'projects.json'),'utf8')).projects).toHaveLength(1);
  });
  it('rejects pinning or removing unknown roots',async()=>{
    const {store}=await makeStore();
    await expect(store.setPinned('/projects/missing',true)).rejects.toThrow(/not registered/);
    await expect(store.remove('/projects/missing')).rejects.toThrow(/not registered/);
  });
});
