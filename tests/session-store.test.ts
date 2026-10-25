import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rename, mkdir, rm, writeFile, truncate, stat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SessionStore, redactSecrets, MAX_SESSION_FILE_BYTES } = require('../electron/session-store.cjs') as { SessionStore: new(options:any)=>any; redactSecrets:(text:string)=>string; MAX_SESSION_FILE_BYTES:number };
const roots:string[]=[];
async function makeStore() { const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-sessions-'));roots.push(dir);const filePath=path.join(dir,'sessions.json');const store=new SessionStore({filePath});await store.load();return {store,filePath,dir}; }
afterEach(async()=>{await Promise.all(roots.splice(0).map(dir=>rm(dir,{recursive:true,force:true})))});

describe('versioned local conversation storage',()=>{
  it('persists multiple sessions, sorts by recency, and reloads full ordered messages',async()=>{
    const {store,filePath}=await makeStore();
    const first=await store.create(); await new Promise(r=>setTimeout(r,3)); const second=await store.create();
    const task='10000000-0000-4000-8000-000000000001';
    await store.addTurn(first.id,task,'first prompt');
    await store.setCodexThread(first.id,'codex-thread-1');
    await store.updateAssistant(first.id,(await store.get(first.id)).messages[1].id,'first answer','completed');
    expect(store.list().map((s:any)=>s.id)).toEqual([first.id,second.id]);
    const reloaded=new SessionStore({filePath});await reloaded.load();
    const restored=reloaded.get(first.id);
    expect(restored.codexThreadId).toBe('codex-thread-1');
    expect(restored.messages.map((m:any)=>[m.role,m.text,m.status])).toEqual([['user','first prompt',undefined],['assistant','first answer','completed']]);
    expect(restored.messages[1].finishedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(reloaded.get(second.id).messages).toEqual([]);
    const document=JSON.parse(await readFile(filePath,'utf8'));expect(document.version).toBe(4);expect(document.sessions[0]).toMatchObject({modelId:null,reasoningEffort:null,workspaceRoot:null,pinned:false});
  });
  it('migrates version-1 history in place while preserving thread IDs and messages',async()=>{
    const {filePath}=await makeStore();
    const legacy={id:'10000000-0000-4000-8000-000000000010',title:'Legacy',createdAt:'2026-10-24T00:00:00.000Z',updatedAt:'2026-10-24T00:00:00.000Z',codexThreadId:'thread-legacy',toolCatalogVersion:1,messages:[{id:'10000000-0000-4000-8000-000000000011',role:'user',text:'kept',createdAt:'2026-10-24T00:00:00.000Z'}]};
    await writeFile(filePath,JSON.stringify({version:1,sessions:[legacy]}));
    const migrated=new SessionStore({filePath});await migrated.load();
    expect(migrated.get(legacy.id)).toMatchObject({codexThreadId:'thread-legacy',toolCatalogVersion:1,modelId:null,reasoningEffort:null,messages:legacy.messages});
    await migrated.setModelConfig(legacy.id,'gpt-6.1-sol','high');
    expect(JSON.parse(await readFile(filePath,'utf8'))).toMatchObject({version:4,sessions:[{id:legacy.id,modelId:'gpt-6.1-sol',reasoningEffort:'high',workspaceRoot:null,codexThreadId:'thread-legacy'}]});
  });
  it('serializes concurrent writes without duplicating turns and redacts common credentials',async()=>{
    const {store,filePath}=await makeStore();const session=await store.create();const task='10000000-0000-4000-8000-000000000002';
    const added=await store.addTurn(session.id,task,'API_KEY=sk-proj-abcdefghijklmnop');
    const assistant=added.assistantMessage.id;
    await Promise.all(['partial answer a','partial answer b','final Bearer abcdef0123456789'].map(text=>store.updateAssistant(session.id,assistant,text)));
    const saved=store.get(session.id);
    expect(saved.messages).toHaveLength(2);expect(saved.messages[0].text).toBe('API_KEY=[REDACTED]');
    expect(saved.messages[1].text).toBe('final [REDACTED]');
    expect(await readFile(filePath,'utf8')).not.toContain('sk-proj-abcdefghijklmnop');
    expect(redactSecrets('token: abcdef123456')).toBe('token: [REDACTED]');
    expect(redactSecrets('Cookie: sid=secret; other=private')).toBe('Cookie: [REDACTED]');
  });
  it('marks incomplete assistant turns as interrupted after a Runtime restart',async()=>{
    const {store,filePath}=await makeStore();const session=await store.create();
    await store.addTurn(session.id,'10000000-0000-4000-8000-000000000003','unfinished');
    const restarted=new SessionStore({filePath});await restarted.load();await restarted.recoverPending();
    expect(restarted.get(session.id).messages[1]).toMatchObject({status:'failed',finishedAt:expect.stringMatching(/^\d{4}-\d\d-\d\dT/),error:expect.stringContaining('Interrupted')});
  });
  it('migrates version-2 history with an unknown project to version 4',async()=>{
    const {filePath}=await makeStore();
    const legacy={version:2,sessions:[{id:'10000000-0000-4000-8000-000000000020',title:'V2',createdAt:'2026-10-24T00:00:00.000Z',updatedAt:'2026-10-24T00:00:00.000Z',codexThreadId:'thread-v2',toolCatalogVersion:1,modelId:'gpt-6.1-sol',reasoningEffort:'high',messages:[]}]};
    await writeFile(filePath,JSON.stringify(legacy));
    const migrated=new SessionStore({filePath});await migrated.load();
    expect(migrated.get(legacy.sessions[0].id)).toMatchObject({codexThreadId:'thread-v2',workspaceRoot:null,modelId:'gpt-6.1-sol'});
    await migrated.setModelConfig(legacy.sessions[0].id,'gpt-6.1-sol','high');
    expect(JSON.parse(await readFile(filePath,'utf8'))).toMatchObject({version:4,sessions:[{id:legacy.sessions[0].id,workspaceRoot:null}]});
  });
  it('backfills a recovered Codex project path only when the local session has none',async()=>{
    const {store,filePath}=await makeStore();const session=await store.create();await store.setCodexThread(session.id,'thread-old');
    await expect(store.recoverWorkspaceRoot(session.id,'/recovered/project')).resolves.toMatchObject({workspaceRoot:'/recovered/project'});
    await expect(store.recoverWorkspaceRoot(session.id,'/different/project')).resolves.toMatchObject({workspaceRoot:'/recovered/project'});
    const reopened=new SessionStore({filePath});await reopened.load();expect(reopened.get(session.id).workspaceRoot).toBe('/recovered/project');
    expect(()=>store.recoverWorkspaceRoot(session.id,'relative/project')).toThrow(/absolute project path/);
  });
  it('persists conversation pinning and safe titles without changing history',async()=>{
    const {store,filePath}=await makeStore();const session=await store.create();await store.addTurn(session.id,'10000000-0000-4000-8000-000000000021','keep this');
    await expect(store.rename(session.id,'  Review notes  ')).resolves.toMatchObject({title:'Review notes'});
    await expect(store.setPinned(session.id,true)).resolves.toMatchObject({pinned:true,title:'Review notes'});
    expect(()=>store.rename(session.id,'   ')).toThrow(/1 to 120/);
    const reopened=new SessionStore({filePath});await reopened.load();expect(reopened.get(session.id)).toMatchObject({title:'Review notes',pinned:true,messages:expect.arrayContaining([expect.objectContaining({text:'keep this'})])});
  });
  it('deletes only the requested local session and persists the removal',async()=>{
    const {store,filePath}=await makeStore();
    const kept=await store.create('/authorized/project');const removed=await store.create('/authorized/project');
    await expect(store.delete(removed.id)).resolves.toMatchObject({id:removed.id,workspaceRoot:'/authorized/project'});
    expect(store.list().map((session:any)=>session.id)).toEqual([kept.id]);
    await expect(store.delete(removed.id)).rejects.toThrow(/not found/);
    const reopened=new SessionStore({filePath});await reopened.load();expect(reopened.list().map((session:any)=>session.id)).toEqual([kept.id]);
  });
  it('preserves corrupt history to a sidecar and starts an empty versioned store',async()=>{
    const {filePath,dir}=await makeStore();await writeFile(filePath,'{not json');
    const recovered=new SessionStore({filePath});const health=await recovered.load();
    expect(health.available).toBe(true);expect(health.warning).toMatch(/damaged/);expect(recovered.list()).toEqual([]);
    const files=await import('node:fs/promises').then(fs=>fs.readdir(dir));expect(files.some((name:string)=>name.startsWith('sessions.json.corrupt-'))).toBe(true);
    expect(JSON.parse(await readFile(filePath,'utf8'))).toEqual({version:4,sessions:[]});
  });
  it('leaves oversized and symlinked history files untouched',async()=>{
    const {filePath,dir}=await makeStore();await writeFile(filePath,'');await truncate(filePath,MAX_SESSION_FILE_BYTES+1);
    const oversized=new SessionStore({filePath});const health=await oversized.load();
    expect(health).toMatchObject({available:false,error:expect.stringContaining('safety limit')});
    expect((await stat(filePath)).size).toBe(MAX_SESSION_FILE_BYTES+1);
    const linkedPath=path.join(dir,'linked.json');await symlink(filePath,linkedPath);
    const linked=new SessionStore({filePath:linkedPath});expect(await linked.load()).toMatchObject({available:false,error:expect.stringContaining('regular file')});
  });
  it('surfaces write failures and does not report an unsaved session as persisted',async()=>{
    const {store,filePath}=await makeStore();await rename(filePath,`${filePath}.saved`);await mkdir(filePath);
    await expect(store.create()).rejects.toThrow(/Cannot save Vantilo session history/);
    expect(store.health()).toMatchObject({available:false,error:expect.stringContaining('Cannot save')});
    expect(store.list()).toEqual([]);
  });
});
