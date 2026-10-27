import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { AgentRuntime } = require('../electron/runtime.cjs') as { AgentRuntime: new(options:any)=>any };
const { SessionStore } = require('../electron/session-store.cjs') as { SessionStore: new(options:any)=>any };
const { WorkspaceAuthority } = require('../electron/workspace.cjs') as { WorkspaceAuthority:new(options:any)=>any };
const { ProjectStore } = require('../electron/project-store.cjs') as { ProjectStore:new(options:any)=>any };
const { LEGACY_TOOL_CATALOG_FINGERPRINTS } = require('../electron/tool-catalog-fingerprint.cjs') as { LEGACY_TOOL_CATALOG_FINGERPRINTS:Record<number,string> };
const roots:string[]=[];
class FakeDriver extends EventEmitter {
  turnId='turn-1'; closed=false; threadCounter=0; active=false;
  toolCallHandler:((call:any)=>Promise<any>)|null=null;
  threadId:string|null=null;
  effectiveByThread=new Map<string,{model:string;effort:string|null}>();
  executedSettings:Array<{threadId:string;model:string;effort:string|null}>=[];
  threadStartDefinitions:any[]=[];
  listModels=vi.fn(async()=>[{id:'gpt-6.1-sol',catalogId:'catalog-sol',displayName:'GPT 6.1 Sol',description:'Current default model',isDefault:true,defaultEffort:'low',efforts:[{id:'low',description:'Fast'},{id:'high',description:'Deep'}]},{id:'gpt-6-luna',catalogId:'catalog-luna',displayName:'GPT 6 Luna',description:'Alternative model',isDefault:false,defaultEffort:'low',efforts:[{id:'low',description:'Fast'},{id:'high',description:'Deep'}]}]);
  startTurn=vi.fn(async(_text:string,threadId:string|null=null,options:any={})=>{this.active=true;if(!threadId)this.threadStartDefinitions=structuredClone(options.dynamicTools||[]);this.threadId=threadId||`thread-${++this.threadCounter}`;const previous=this.effectiveByThread.get(this.threadId)||{model:'gpt-6.1-sol',effort:'low'};const effective={model:options.model??previous.model,effort:options.effort??previous.effort};this.effectiveByThread.set(this.threadId,effective);this.executedSettings.push({threadId:this.threadId,...effective});return {threadId:this.threadId,turnId:this.turnId}});
  cancelTurn=vi.fn(async()=>{});resumeThread=vi.fn(async(id:string)=>{this.threadId=id;return id});readThreadCwd=vi.fn(async()=>null as string|null);deleteThread=vi.fn(async(id:string)=>({threadId:id}));
  setToolCallHandler(handler:any){this.toolCallHandler=handler;}
  invokeTool(call:any){if(!this.toolCallHandler)throw new Error('No tool handler');return this.toolCallHandler(call);}
  async start(){this.emit('status',{status:'ready'});}
  async close(){this.closed=true;this.active=false;}
}
async function runtimeWith(driver=new FakeDriver()) {const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-runtime-test-'));roots.push(dir);const userDataPath=path.join(dir,'user-data');const store=new SessionStore({filePath:path.join(dir,'sessions.json')});const workspace=new WorkspaceAuthority({userDataPath});const projectStore=new ProjectStore({filePath:path.join(userDataPath,'projects.json')});await workspace.setWorkspace(dir);const runtime=new AgentRuntime({driver:driver as any,store,workspace,projectStore});await runtime.start();return {runtime,store,driver,workspace,projectStore};}
async function waitFor(test:()=>boolean){for(let i=0;i<80;i++){if(test())return;await new Promise(r=>setTimeout(r,5))}throw new Error('Timed out waiting for Runtime state')}
afterEach(async()=>{await Promise.all(roots.splice(0).map(dir=>rm(dir,{recursive:true,force:true})))});

describe('AgentRuntime sessions and tasks',()=>{
  it('reproduces the integration constructor omission and confirms the registry fix without starting Codex',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-runtime-init-test-'));roots.push(dir);
    const store=new SessionStore({filePath:path.join(dir,'sessions.json')});
    const workspace=new WorkspaceAuthority({userDataPath:path.join(dir,'user-data')});
    await workspace.setWorkspace(dir);
    let runtime:any;let initializationError:unknown;
    try{runtime=new AgentRuntime({store,workspace});}catch(error){initializationError=error;}
    expect(runtime).toBeUndefined();
    expect(initializationError).toBeInstanceOf(Error);
    expect((initializationError as Error).message).toBe('AgentRuntime requires explicit session storage, project registry, and workspace authorization.');
    expect((initializationError as Error).stack).toContain('AgentRuntime');
    const projectStore=new ProjectStore({filePath:path.join(dir,'user-data','projects.json')});
    runtime=new AgentRuntime({store,workspace,projectStore});
    expect(runtime).toBeInstanceOf(AgentRuntime);
  });
  it('persists ordered messages, thread IDs, stream deltas, and terminal state',async()=>{
    const {runtime,store,driver}=await runtimeWith();const events:any[]=[];runtime.on('event',(event:any)=>events.push(event));
    const {session}=await runtime.createSession();
    expect(runtime.listSessions()).toMatchObject({sessions:[{id:session.id,messageCount:0,threadState:'new'}],storage:{available:true}});
    const {taskId}=await runtime.submit(session.id,'hello');
    await waitFor(()=>driver.startTurn.mock.results.length>0&&store.get(session.id).codexThreadId==='thread-1');
    const sentDefinitions=driver.threadStartDefinitions;const taskSnapshot=runtime.toolCatalog.snapshot();
    expect(sentDefinitions).toEqual(runtime.toolCatalog.dynamicTools(taskSnapshot));
    expect(sentDefinitions.map((definition:any)=>definition.name)).toEqual(['list_workspace_files','read_workspace_file','read_workspace_passage']);
    expect(sentDefinitions.find((definition:any)=>definition.name==='read_workspace_passage').inputSchema).toEqual(runtime.toolCatalog.dynamicTools(taskSnapshot).find((definition:any)=>definition.name==='read_workspace_passage').inputSchema);
    expect(store.get(session.id).toolCatalogFingerprint).toBe(runtime.toolCatalog.fingerprint(taskSnapshot));
    expect(driver.startTurn).toHaveBeenLastCalledWith('hello',null,expect.objectContaining({dynamicTools:sentDefinitions}));
    driver.emit('delta',{delta:'reply ',turnId:'turn-1'});driver.emit('delta',{delta:'text',turnId:'turn-1'});driver.emit('turn',{status:'completed',turnId:'turn-1'});
    await waitFor(()=>events.some(event=>event.type==='task-status'&&event.status==='completed'));
    const saved=store.get(session.id);
    expect(saved.messages.map((message:any)=>message.role)).toEqual(['user','assistant']);
    expect(saved.messages[1]).toMatchObject({text:'reply text',status:'completed',taskId});
    expect(events.filter(event=>event.type==='message-delta').map(event=>event.delta).join('')).toBe('reply text');
    expect(runtime.getStatus().status).toBe('ready');
  });
  it('executes a selected model, then the live catalog default on the same thread; null effort uses catalog metadata, not Codex config',async()=>{
    const {runtime,store,driver}=await runtimeWith();const first=await runtime.createSession();const second=await runtime.createSession();
    await expect(runtime.setSessionModelConfig(first.session.id,'not-in-catalog',null)).rejects.toThrow(/unavailable or ambiguous/);
    await expect(runtime.setSessionModelConfig(first.session.id,'gpt-6-luna','medium')).rejects.toThrow(/not supported/);
    await expect(runtime.setSessionModelConfig(first.session.id,null,'high')).resolves.toMatchObject({modelId:null,reasoningEffort:'high'});
    expect(store.get(first.session.id)).toMatchObject({modelId:null,reasoningEffort:'high'});
    await runtime.setSessionModelConfig(first.session.id,'gpt-6-luna','high');
    expect(store.get(first.session.id)).toMatchObject({modelId:'gpt-6-luna',reasoningEffort:'high'});
    expect(store.get(second.session.id)).toMatchObject({modelId:null,reasoningEffort:null});
    expect((await driver.listModels()).find(model=>model.isDefault)?.defaultEffort).toBe('low');

    await runtime.submit(first.session.id,'use selected model A');
    await waitFor(()=>driver.startTurn.mock.calls.length===1);
    expect(driver.startTurn).toHaveBeenLastCalledWith('use selected model A',null,expect.objectContaining({model:'gpt-6-luna',effort:'high'}));
    expect(driver.executedSettings.at(-1)).toEqual({threadId:'thread-1',model:'gpt-6-luna',effort:'high'});
    await expect(runtime.setSessionModelConfig(first.session.id,'gpt-6.1-sol',null)).rejects.toThrow(/while a task is running/);
    driver.emit('turn',{status:'completed',turnId:'turn-1'});await waitFor(()=>runtime.activeTask===null);

    await runtime.setSessionModelConfig(first.session.id,null,null);
    expect(store.get(first.session.id)).toMatchObject({modelId:null,reasoningEffort:null});
    await runtime.submit(first.session.id,'restore live model-catalog defaults');await waitFor(()=>driver.startTurn.mock.calls.length===2);
    expect(driver.startTurn).toHaveBeenLastCalledWith('restore live model-catalog defaults','thread-1',expect.objectContaining({model:'gpt-6.1-sol',effort:'low'}));
    expect(driver.executedSettings.at(-1)).toEqual({threadId:'thread-1',model:'gpt-6.1-sol',effort:'low'});
    expect(driver.effectiveByThread.get('thread-1')).toEqual({model:'gpt-6.1-sol',effort:'low'});
    driver.emit('turn',{status:'completed',turnId:'turn-1'});await waitFor(()=>runtime.activeTask===null);

    await runtime.setSessionModelConfig(second.session.id,null,'high');
    expect(store.get(second.session.id)).toMatchObject({modelId:null,reasoningEffort:'high'});
    await runtime.submit(second.session.id,'use live catalog default with explicit effort');await waitFor(()=>driver.startTurn.mock.calls.length===3);
    expect(driver.startTurn).toHaveBeenLastCalledWith('use live catalog default with explicit effort',null,expect.objectContaining({model:'gpt-6.1-sol',effort:'high'}));
    expect(driver.executedSettings.at(-1)).toEqual({threadId:'thread-2',model:'gpt-6.1-sol',effort:'high'});
    driver.emit('turn',{status:'completed',turnId:'turn-1'});await waitFor(()=>runtime.activeTask===null);
    expect(store.get(first.session.id)).toMatchObject({modelId:null,reasoningEffort:null});
  });
  it('reapplies the current session model and effort after restoring a historical thread',async()=>{
    const {runtime,store,driver}=await runtimeWith();const {session}=await runtime.createSession();
    await store.setCodexThread(session.id,'saved-thread',LEGACY_TOOL_CATALOG_FINGERPRINTS[1]);
    await store.setModelConfig(session.id,null,'high');
    const opened=await runtime.openSession(session.id);
    expect(opened.threadState).toBe('connected');expect(opened.toolCatalogCompatibility).toBe('partial');expect(opened.availableToolNames).toEqual(['list_workspace_files','read_workspace_file']);expect(driver.resumeThread).toHaveBeenCalledWith('saved-thread',session.workspaceRoot);
    await runtime.submit(session.id,'continue with current settings');await waitFor(()=>driver.startTurn.mock.calls.length===1);
    expect(driver.startTurn).toHaveBeenCalledWith('continue with current settings','saved-thread',expect.objectContaining({model:'gpt-6.1-sol',effort:'high'}));
    expect(driver.executedSettings.at(-1)).toEqual({threadId:'saved-thread',model:'gpt-6.1-sol',effort:'high'});
    driver.emit('turn',{status:'completed',turnId:'turn-1'});await waitFor(()=>runtime.activeTask===null);
  });
  it('fails closed when the current default or a saved model cannot be resolved',async()=>{
    const missingDefault=new FakeDriver();missingDefault.listModels=vi.fn(async()=>[{id:'gpt-only',catalogId:'catalog-only',displayName:'Only',description:'No default flag',isDefault:false,defaultEffort:'low',efforts:[{id:'low',description:'Fast'}]}]);
    const first=await runtimeWith(missingDefault);const firstSession=await first.runtime.createSession();
    await expect(first.runtime.submit(firstSession.session.id,'must fail without a default')).rejects.toThrow(/exactly one current default/);
    expect(first.driver.startTurn).not.toHaveBeenCalled();expect(first.runtime.activeTask).toBeNull();expect(first.store.get(firstSession.session.id).messages).toHaveLength(0);

    const unavailable=new FakeDriver();const second=await runtimeWith(unavailable);const secondSession=await second.runtime.createSession();
    await second.store.setModelConfig(secondSession.session.id,'retired-model',null);
    await expect(second.runtime.submit(secondSession.session.id,'must fail without saved model')).rejects.toThrow(/unavailable or ambiguous/);
    expect(second.driver.startTurn).not.toHaveBeenCalled();expect(second.runtime.activeTask).toBeNull();expect(second.store.get(secondSession.session.id).messages).toHaveLength(0);

    const broken=new FakeDriver();const third=await runtimeWith(broken);const thirdSession=await third.runtime.createSession();
    broken.listModels=vi.fn(async()=>{throw new Error('model/list unavailable')});
    await expect(third.runtime.submit(thirdSession.session.id,'must fail on catalog error')).rejects.toThrow(/model\/list unavailable/);
    expect(third.driver.startTurn).not.toHaveBeenCalled();expect(third.runtime.activeTask).toBeNull();expect(third.store.get(thirdSession.session.id).messages).toHaveLength(0);
  });
  it('binds sessions to their workspace and refuses to resume or submit them under another folder',async()=>{
    const {runtime,store,driver,workspace}=await runtimeWith();
    const {session}=await runtime.createSession();
    expect(session.workspaceRoot).toBe(workspace.state().root);
    await store.setCodexThread(session.id,'thread-project-a',LEGACY_TOOL_CATALOG_FINGERPRINTS[1]);
    const other=path.join(roots.at(-1)!,'other-project');await mkdir(other);
    await runtime.setWorkspace(other);
    const opened=await runtime.openSession(session.id);
    expect(opened).toMatchObject({threadState:'history',connectionError:expect.stringContaining('所属项目')});
    expect(driver.resumeThread).not.toHaveBeenCalled();
    await expect(runtime.submit(session.id,'must not use another project')).rejects.toThrow(/属于其他项目/);
  });
  it('resolves only known project paths for the Finder context menu',async()=>{
    const {runtime,store,workspace,projectStore}=await runtimeWith();
    const activeRoot=workspace.state().root!;
    expect(await runtime.resolveKnownProjectPath(activeRoot)).toMatchObject({path:activeRoot,active:true,pinned:false,canRemove:true});
    const other=path.join(activeRoot,'other-project');await mkdir(other);await projectStore.register(other);await store.create(other);
    expect(await runtime.resolveKnownProjectPath(other)).toMatchObject({path:other,active:false,pinned:false,canRemove:true});
    await expect(runtime.resolveKnownProjectPath(path.join(activeRoot,'unlisted'))).rejects.toThrow(/not an active Vantilo project/);
  });
  it('pins and removes projects without deleting their files or conversation history',async()=>{
    const {runtime,store,workspace,projectStore}=await runtimeWith();
    const root=workspace.state().root!;const session=await store.create(root);
    await expect(runtime.setProjectPinned(root,true)).resolves.toMatchObject([{root,pinned:true,removed:false}]);
    await expect(runtime.resolveKnownProjectPath(root)).resolves.toMatchObject({pinned:true});
    const removed=await runtime.removeProject(root);
    expect(removed).toMatchObject({projects:[{root,pinned:false,removed:true}],workspace:{root:null}});
    expect(store.get(session.id).workspaceRoot).toBe(root);
    expect(await projectStore.get(root)).toMatchObject({removed:true});
    await expect(runtime.resolveKnownProjectPath(root)).rejects.toThrow(/not an active Vantilo project/);
  });
  it('recovers a legacy session project from Codex cwd metadata before deciding whether it can resume',async()=>{
    const {runtime,store,driver,workspace}=await runtimeWith();
    const session=await store.create(null);await store.setCodexThread(session.id,'thread-legacy',LEGACY_TOOL_CATALOG_FINGERPRINTS[1]);
    driver.readThreadCwd.mockResolvedValue(workspace.state().root);
    const opened=await runtime.openSession(session.id);
    expect(driver.readThreadCwd).toHaveBeenCalledWith('thread-legacy');
    expect(store.get(session.id).workspaceRoot).toBe(workspace.state().root);
    expect(opened).toMatchObject({threadState:'connected',session:{workspaceRoot:workspace.state().root}});
    expect(driver.resumeThread).toHaveBeenCalledWith('thread-legacy',workspace.state().root);
  });
  it('does not guess a legacy project from the currently selected workspace when Codex metadata is unavailable',async()=>{
    const {runtime,store,driver,workspace}=await runtimeWith();
    const session=await store.create(null);await store.setCodexThread(session.id,'thread-metadata-missing',LEGACY_TOOL_CATALOG_FINGERPRINTS[1]);
    driver.readThreadCwd.mockRejectedValue(new Error('metadata unavailable'));
    const opened=await runtime.openSession(session.id);
    expect(opened.session.workspaceRoot).toBeNull();
    expect(store.get(session.id).workspaceRoot).toBeNull();
    expect(driver.resumeThread).not.toHaveBeenCalled();
  });
  it('renames and pins a session through persisted Runtime operations',async()=>{
    const {runtime,store}=await runtimeWith();const {session}=await runtime.createSession();const events:any[]=[];runtime.on('event',(event:any)=>events.push(event));
    await expect(runtime.renameSession(session.id,'Project notes')).resolves.toMatchObject({title:'Project notes'});
    await expect(runtime.setSessionPinned(session.id,true)).resolves.toMatchObject({pinned:true,title:'Project notes'});
    expect(store.get(session.id)).toMatchObject({title:'Project notes',pinned:true});
    expect(events.filter(event=>event.type==='session-updated')).toHaveLength(2);
  });
  it('permanently deletes Codex and local sessions but rejects deletion of the session with an active task',async()=>{
    const {runtime,store,driver}=await runtimeWith();
    const first=await runtime.createSession();const second=await runtime.createSession();
    await expect(runtime.deleteSession(second.session.id)).resolves.toEqual({sessionId:second.session.id});
    expect(store.list().map((session:any)=>session.id)).toEqual([first.session.id]);
    const {taskId}=await runtime.submit(first.session.id,'active');await waitFor(()=>driver.startTurn.mock.results.length>0);
    await expect(runtime.deleteSession(first.session.id)).rejects.toThrow(/正在运行任务/);
    await runtime.cancel(taskId);driver.emit('turn',{status:'cancelled',turnId:'turn-1'});await waitFor(()=>runtime.activeTask===null);
    await expect(runtime.deleteSession(first.session.id)).resolves.toEqual({sessionId:first.session.id});
    expect(driver.deleteThread).toHaveBeenCalledWith('thread-1');
    expect(store.list()).toEqual([]);
  });
  it('returns an empty live catalog as empty and does not manufacture model choices when lookup fails',async()=>{
    const driver=new FakeDriver();driver.listModels=vi.fn(async()=>[]);const {runtime}=await runtimeWith(driver);
    await expect(runtime.listModels()).resolves.toEqual({models:[]});
    driver.listModels=vi.fn(async()=>{throw new Error('model/list unavailable')});
    await expect(runtime.listModels()).rejects.toThrow('model/list unavailable');
  });
  it('limits a migrated v1 thread to its archived tools and rejects the new passage tool before approval',async()=>{
    const {runtime,store,driver,workspace}=await runtimeWith();const {session}=await runtime.createSession();await store.setCodexThread(session.id,'thread-v1',LEGACY_TOOL_CATALOG_FINGERPRINTS[1]);const events:any[]=[];runtime.on('event',(event:any)=>events.push(event));
    const opened=await runtime.openSession(session.id);expect(opened.toolCatalogCompatibility).toBe('partial');expect(opened.availableToolNames).toEqual(['list_workspace_files','read_workspace_file']);
    await runtime.submit(session.id,'Continue on the migrated thread');await waitFor(()=>driver.startTurn.mock.calls.length===1);const definitions=driver.startTurn.mock.calls[0][2].dynamicTools;expect(definitions.map((definition:any)=>definition.name)).toEqual(['list_workspace_files','read_workspace_file']);
    const spy=vi.spyOn(workspace,'readTextRange');const response=await driver.invokeTool({requestId:69,callId:'old-thread-passage',threadId:'thread-v1',turnId:'turn-1',namespace:null,tool:'read_workspace_passage',arguments:{path:'article.md',startLine:1,endLine:2,reason:'Read this passage'}});
    expect(response.success).toBe(false);expect(spy).not.toHaveBeenCalled();expect(events.some(event=>event.type==='tool-approval-requested'&&event.taskId===runtime.activeTask.id)).toBe(false);driver.emit('turn',{status:'cancelled',turnId:'turn-1'});await waitFor(()=>runtime.activeTask===null);
  });
  it('keeps ordinary chat available for threads with unknown catalog metadata but gives them no tools',async()=>{
    const {runtime,store,driver,workspace}=await runtimeWith();const {session}=await runtime.createSession();await store.setCodexThread(session.id,'thread-with-unknown-catalog');
    const opened=await runtime.openSession(session.id);expect(opened.toolCatalogCompatibility).toBe('unknown');expect(opened.availableToolNames).toEqual([]);
    const events:any[]=[];runtime.on('event',(event:any)=>events.push(event));await runtime.submit(session.id,'Continue ordinary conversation');await waitFor(()=>driver.startTurn.mock.calls.length===1);
    expect(driver.startTurn).toHaveBeenLastCalledWith('Continue ordinary conversation','thread-with-unknown-catalog',expect.objectContaining({dynamicTools:[]}));
    const read=vi.spyOn(workspace,'openReadOnly');const response=await driver.invokeTool({requestId:70,callId:'unknown-thread-read',threadId:'thread-with-unknown-catalog',turnId:'turn-1',namespace:null,tool:'read_workspace_file',arguments:{path:'secret.txt',reason:'Try a tool'}});
    expect(response.success).toBe(false);expect(read).not.toHaveBeenCalled();expect(events.some(event=>event.type==='tool-approval-requested')).toBe(false);driver.emit('turn',{status:'cancelled',turnId:'turn-1'});await waitFor(()=>runtime.activeTask===null);
  });
  it('rejects overlapping tasks, validates cancellation IDs, and supports repeated cancellation',async()=>{
    const {runtime,driver}=await runtimeWith();const {session}=await runtime.createSession();const {taskId}=await runtime.submit(session.id,'one');
    await waitFor(()=>driver.startTurn.mock.results.length>0);
    await expect(runtime.submit(session.id,'two')).rejects.toThrow(/已有任务/);
    await expect(runtime.cancel('other')).rejects.toThrow(/不存在/);
    await runtime.cancel(taskId);await runtime.cancel(taskId);expect(driver.cancelTurn).toHaveBeenCalledOnce();
    driver.emit('turn',{status:'cancelled',turnId:'turn-1'});await waitFor(()=>runtime.activeTask===null);
  });
  it('rejects tool requests from a different session thread before approval or execution',async()=>{
    const {runtime,store,driver,workspace}=await runtimeWith();const {session}=await runtime.createSession();const events:any[]=[];runtime.on('event',(event:any)=>events.push(event));await runtime.submit(session.id,'A task');await waitFor(()=>store.get(session.id).codexThreadId==='thread-1'&&runtime.activeTask.turnId==='turn-1');const read=vi.spyOn(workspace,'openReadOnly');
    const response=await driver.invokeTool({requestId:79,callId:'foreign-thread-call',threadId:'thread-from-another-session',turnId:'turn-1',namespace:null,tool:'read_workspace_file',arguments:{path:'actual.txt',reason:'Read the requested file'}});
    expect(response.success).toBe(false);expect(read).not.toHaveBeenCalled();expect(events.some(event=>event.type==='tool-approval-requested')).toBe(false);driver.emit('turn',{status:'cancelled',turnId:'turn-1'});await waitFor(()=>runtime.activeTask===null);
  });
  it('waits for a request-bound approval before reading and returns the real structured file result',async()=>{
    const {runtime,store,driver,workspace}=await runtimeWith();await writeFile(path.join(workspace.state().root,'actual.txt'),'actual authorized contents');
    const {session}=await runtime.createSession();const events:any[]=[];runtime.on('event',(event:any)=>events.push(event));const {taskId}=await runtime.submit(session.id,'Read actual.txt with the workspace tool.');
    await waitFor(()=>store.get(session.id).codexThreadId==='thread-1'&&runtime.activeTask.turnId==='turn-1');
    const read=vi.spyOn(workspace,'openReadOnly');
    const call=driver.invokeTool({requestId:81,callId:'codex-call-read',threadId:'thread-1',turnId:'turn-1',namespace:null,tool:'read_workspace_file',arguments:{path:'actual.txt',reason:'Read the requested project text'}});
    await waitFor(()=>events.some(event=>event.type==='tool-approval-requested'));
    const approval=events.find(event=>event.type==='tool-approval-requested');expect(approval).toMatchObject({taskId,sessionId:session.id,toolName:'read_workspace_file',relativePath:'actual.txt',readOnly:true});
    expect(read).not.toHaveBeenCalled();
    expect(()=>runtime.resolveToolApproval({approvalId:approval.approvalId,sessionId:'20000000-0000-4000-8000-000000000099',taskId,decision:'approved'})).toThrow(/does not belong/);
    runtime.resolveToolApproval({approvalId:approval.approvalId,sessionId:session.id,taskId,decision:'approved'});
    const response=await call;expect(response.success).toBe(true);expect(JSON.parse(response.contentItems[0].text)).toMatchObject({ok:true,data:{path:'actual.txt',content:'actual authorized contents'}});
    expect(read).toHaveBeenCalledOnce();expect(events.some(event=>event.type==='tool-execution'&&event.stage==='completed'&&event.approvalId===approval.approvalId)).toBe(true);
    driver.emit('turn',{status:'completed',turnId:'turn-1'});await waitFor(()=>runtime.activeTask===null);
  });
  it('does not execute a rejected or cancelled tool request',async()=>{
    const {runtime,store,driver,workspace}=await runtimeWith();await writeFile(path.join(workspace.state().root,'actual.txt'),'must not be read');
    const {session}=await runtime.createSession();const events:any[]=[];runtime.on('event',(event:any)=>events.push(event));const {taskId}=await runtime.submit(session.id,'Read actual.txt.');
    await waitFor(()=>store.get(session.id).codexThreadId==='thread-1'&&runtime.activeTask.turnId==='turn-1');const read=vi.spyOn(workspace,'openReadOnly');
    const denied=driver.invokeTool({requestId:82,callId:'codex-call-deny',threadId:'thread-1',turnId:'turn-1',namespace:null,tool:'read_workspace_file',arguments:{path:'actual.txt',reason:'Inspect the requested text'}});
    await waitFor(()=>events.some(event=>event.type==='tool-approval-requested'));const approval=events.find(event=>event.type==='tool-approval-requested');
    runtime.resolveToolApproval({approvalId:approval.approvalId,sessionId:session.id,taskId,decision:'rejected'});
    expect((await denied).success).toBe(false);expect(read).not.toHaveBeenCalled();
    const cancelled=driver.invokeTool({requestId:83,callId:'codex-call-cancel',threadId:'thread-1',turnId:'turn-1',namespace:null,tool:'read_workspace_file',arguments:{path:'actual.txt',reason:'Inspect after cancellation'}});
    await waitFor(()=>events.filter(event=>event.type==='tool-approval-requested').length===2);await runtime.cancel(taskId);
    expect((await cancelled).success).toBe(false);expect(read).not.toHaveBeenCalled();
    driver.emit('turn',{status:'cancelled',turnId:'turn-1'});await waitFor(()=>runtime.activeTask===null);
  });
  it('gates reading passages on approval and emits every user-visible execution outcome',async()=>{
    const {runtime,store,driver,workspace}=await runtimeWith();const articlePath=path.join(workspace.state().root,'article.md');await writeFile(articlePath,'line one\nline two\nline three');
    const {session}=await runtime.createSession();const events:any[]=[];runtime.on('event',(event:any)=>events.push(event));const {taskId}=await runtime.submit(session.id,'Read a selected article passage');await waitFor(()=>store.get(session.id).codexThreadId==='thread-1'&&runtime.activeTask.turnId==='turn-1');
    const read=vi.spyOn(workspace,'readTextRange');const call=(requestId:number)=>driver.invokeTool({requestId,callId:`passage-${requestId}`,threadId:'thread-1',turnId:'turn-1',namespace:null,tool:'read_workspace_passage',arguments:{path:'article.md',startLine:2,endLine:3,reason:'Explain these lines'}});
    const approvedCall=call(101);await waitFor(()=>events.filter(event=>event.type==='tool-approval-requested').length===1);const approved=events.find(event=>event.type==='tool-approval-requested');expect(approved).toMatchObject({toolName:'read_workspace_passage',relativePath:'article.md',operation:'read',lineRange:{startLine:2,endLine:3},taskId,sessionId:session.id});expect(read).not.toHaveBeenCalled();
    runtime.resolveToolApproval({approvalId:approved.approvalId,sessionId:session.id,taskId,decision:'approved'});const successful=await approvedCall;expect(successful.success).toBe(true);expect(JSON.parse(successful.contentItems[0].text)).toMatchObject({ok:true,data:{sourcePath:'article.md',startLine:2,endLine:3,content:'line two\nline three',trust:'untrusted'}});expect(read).toHaveBeenCalledOnce();
    const completedEvents=events.filter(event=>event.type==='tool-execution'&&event.approvalId===approved.approvalId);expect(completedEvents.map(event=>event.stage)).toEqual(['started','completed']);
    read.mockRejectedValueOnce(Object.assign(new Error('bounded read failed'),{code:'tool_error'}));const failedCall=call(102);await waitFor(()=>events.filter(event=>event.type==='tool-approval-requested').length===2);const failedApproval=events.filter(event=>event.type==='tool-approval-requested').at(-1);runtime.resolveToolApproval({approvalId:failedApproval.approvalId,sessionId:session.id,taskId,decision:'approved'});expect((await failedCall).success).toBe(false);expect(events.some(event=>event.type==='tool-execution'&&event.approvalId===failedApproval.approvalId&&event.stage==='failed')).toBe(true);
    const rejectedCall=call(103);await waitFor(()=>events.filter(event=>event.type==='tool-approval-requested').length===3);const rejectedApproval=events.filter(event=>event.type==='tool-approval-requested').at(-1);const readsBeforeReject=read.mock.calls.length;runtime.resolveToolApproval({approvalId:rejectedApproval.approvalId,sessionId:session.id,taskId,decision:'rejected'});expect((await rejectedCall).success).toBe(false);expect(read.mock.calls.length).toBe(readsBeforeReject);expect(events.some(event=>event.type==='tool-execution'&&event.approvalId===rejectedApproval.approvalId&&event.stage==='denied')).toBe(true);
    const cancelledCall=call(104);await waitFor(()=>events.filter(event=>event.type==='tool-approval-requested').length===4);const cancelledApproval=events.filter(event=>event.type==='tool-approval-requested').at(-1);await runtime.cancel(taskId);expect((await cancelledCall).success).toBe(false);expect(events.some(event=>event.type==='tool-execution'&&event.approvalId===cancelledApproval.approvalId&&event.stage==='cancelled')).toBe(true);driver.emit('turn',{status:'cancelled',turnId:'turn-1'});await waitFor(()=>runtime.activeTask===null);
  });
  it('reports persistence failure and interrupts the active Codex turn',async()=>{
    const {runtime,store,driver}=await runtimeWith();const {session}=await runtime.createSession();const events:any[]=[];runtime.on('event',(event:any)=>events.push(event));
    const {taskId}=await runtime.submit(session.id,'save this turn');await waitFor(()=>driver.startTurn.mock.results.length>0);
    store.updateAssistant=vi.fn(async()=>{throw new Error('disk unavailable')});
    driver.emit('delta',{delta:'response',turnId:'turn-1'});
    await waitFor(()=>events.some(event=>event.type==='task-status'&&event.taskId===taskId&&event.status==='failed'));
    expect(events.some(event=>event.type==='storage-error')).toBe(true);expect(driver.cancelTurn).toHaveBeenCalledOnce();
    await runtime.stop();
  });
  it('keeps local history available when Codex fails to start',async()=>{
    const driver=new FakeDriver();driver.start=vi.fn(async()=>{throw new Error('CLI not found')});const {runtime}=await runtimeWith(driver);
    await waitFor(()=>runtime.getStatus().status==='error');
    const {session}=await runtime.createSession();expect((await runtime.openSession(session.id)).threadState).toBe('new');
    await expect(runtime.submit(session.id,'hello')).rejects.toThrow('CLI not found');
  });
  it('keeps tasks attached to their session when the UI switches conversations',async()=>{
    const {runtime,driver,store,workspace}=await runtimeWith();const a=await runtime.createSession();const b=await runtime.createSession();const events:any[]=[];runtime.on('event',(event:any)=>events.push(event));
    const {taskId}=await runtime.submit(a.session.id,'message in A');await waitFor(()=>store.get(a.session.id).codexThreadId==='thread-1');
    const opened=await runtime.openSession(b.session.id);expect(opened.session.id).toBe(b.session.id);expect(opened.threadState).toBe('new');
    expect(driver.cancelTurn).not.toHaveBeenCalled();
    driver.emit('delta',{delta:'A reply',turnId:'turn-1'});driver.emit('turn',{status:'completed',turnId:'turn-1'});
    await waitFor(()=>events.some(event=>event.type==='task-status'&&event.taskId===taskId));
    expect(store.get(b.session.id).messages).toEqual([]);expect(store.get(a.session.id).messages[1].text).toBe('A reply');
    const resumed=await runtime.openSession(a.session.id);expect(resumed.threadState).toBe('connected');expect(driver.resumeThread).toHaveBeenCalledWith('thread-1',workspace.state().root);
  });
  it('persists failure state after a Codex process error and closes cleanly',async()=>{
    const {runtime,store,driver}=await runtimeWith();const {session}=await runtime.createSession();const events:any[]=[];runtime.on('event',(event:any)=>events.push(event));const {taskId}=await runtime.submit(session.id,'active');
    driver.emit('failure',new Error('server exited'));await waitFor(()=>events.some(event=>event.type==='task-status'&&event.taskId===taskId));
    expect(runtime.getStatus()).toMatchObject({status:'error',error:'server exited'});expect(store.get(session.id).messages[1]).toMatchObject({status:'failed',error:'server exited'});
    await runtime.stop();expect(driver.closed).toBe(true);expect(runtime.getStatus().status).toBe('stopped');
  });
});


describe('Reader jobs reuse AgentRuntime', () => {
  it('reuses the engine but isolates Reader tasks, history, model settings and workspace from Agent projects', async () => {
    const {runtime,driver,store} = await runtimeWith();
    (driver as any).accountStatus = vi.fn(async()=>({connected:true,email:'fixture@example.com'}));
    const source = await runtime.createSession();
    await runtime.setSessionModelConfig(source.session.id,'gpt-6-luna','high');
    const output = runtime.runReaderAi({instructions:'Return a translation only',input:'Untrusted source text',modelId:null,reasoningEffort:null});
    await waitFor(()=>driver.startTurn.mock.calls.length===1);
    expect(driver.threadStartDefinitions).toEqual([]);
    expect(driver.executedSettings[0]).toMatchObject({model:'gpt-6.1-sol',effort:'low'});
    expect(driver.startTurn.mock.calls[0]?.[2].workspaceRoot).not.toBe(source.session.workspaceRoot);
    driver.emit('delta',{delta:'中文结果'});
    driver.emit('turn',{status:'completed',turnId:driver.turnId});
    await expect(output).resolves.toBe('中文结果');
    const session = store.list().find((item:any)=>item.title==='Reader · 阅读任务');
    expect(store.get(session!.id).messages.at(-1)?.text).toBe('中文结果');
    expect(store.get(source.session.id).messages).toEqual([]);
    expect(runtime.listSessions().sessions.map((s:any)=>s.id)).toEqual([source.session.id]);
    await expect(runtime.submit(session!.id,'cross-domain')).rejects.toThrow(/交叉/);
    const second=runtime.runReaderAi({instructions:'Translate another paragraph',input:'Second source paragraph',modelId:'gpt-6-luna',reasoningEffort:'high'});
    await waitFor(()=>driver.startTurn.mock.calls.length===2);
    driver.emit('delta',{delta:'第二段译文'});driver.emit('turn',{status:'completed',turnId:driver.turnId});
    await expect(second).resolves.toBe('第二段译文');
    expect(store.list().filter((item:any)=>item.title==='Reader · 阅读任务')).toHaveLength(2);
    expect(driver.startTurn.mock.calls[1]?.[1]).toBeNull();
    expect(driver.executedSettings[1]).toMatchObject({model:'gpt-6-luna',effort:'high'});
    await runtime.stop();
  });
  it('requires the same ChatGPT account and never invokes the driver when logged out', async () => {
    const {runtime,driver} = await runtimeWith();
    (driver as any).accountStatus = vi.fn(async()=>({connected:false,email:null}));
    await expect(runtime.runReaderAi({instructions:'x',input:'y',modelSourceSessionId:null})).rejects.toThrow(/登录/);
    expect(driver.startTurn).not.toHaveBeenCalled();
    await runtime.stop();
  });
});

it('cancels only the matching Reader request and never an unrelated project task', async () => {
  const {runtime,driver,store}=await runtimeWith();
  (driver as any).accountStatus=vi.fn(async()=>({connected:true,email:null}));
  const requestId='20000000-0000-4000-8000-000000000041';
  const pending=runtime.runReaderAi({requestId,instructions:'Translate',input:'Synthetic paragraph'});
  const rejected=expect(pending).rejects.toThrow(/未完成/);
  await waitFor(()=>driver.startTurn.mock.calls.length===1);
  expect(runtime.cancelReaderRequest('20000000-0000-4000-8000-000000000099')).toEqual({cancelled:false});
  expect(driver.cancelTurn).not.toHaveBeenCalled();
  expect(runtime.cancelReaderRequest(requestId)).toEqual({cancelled:true});
  await waitFor(()=>driver.cancelTurn.mock.calls.length===1);
  driver.emit('turn',{status:'cancelled',turnId:driver.turnId});await rejected;
  const project=await runtime.createSession();await runtime.submit(project.session.id,'Project task');
  expect(runtime.cancelReaderRequest(requestId)).toEqual({cancelled:false});
  expect(driver.cancelTurn).toHaveBeenCalledOnce();
  driver.emit('turn',{status:'completed',turnId:driver.turnId});
  await waitFor(()=>!runtime.activeTask);
  expect(store.get(project.session.id).messages[0].text).toBe('Project task');
  await runtime.stop();
});

it('keeps local project history intact when the old Codex rollout is missing',async()=>{
  const {runtime,driver,store}=await runtimeWith();const created=await runtime.createSession();
  await store.addTurn(created.session.id,'20000000-0000-4000-8000-000000000042','Previous local project question');
  await store.setCodexThread(created.session.id,'missing-thread');
  driver.resumeThread.mockRejectedValueOnce(new Error('no rollout found for thread id missing-thread'));
  const opened=await runtime.openSession(created.session.id);
  expect(opened.threadState).toBe('history');expect(opened.connectionError).toContain('本地历史已保留');
  expect(store.get(created.session.id).messages[0].text).toBe('Previous local project question');
  expect(store.get(created.session.id).codexThreadId).toBe('missing-thread');
  expect(driver.startTurn).not.toHaveBeenCalled();await runtime.stop();
});

it('completes confirmed local deletion when the exact Codex rollout is already absent',async()=>{
  const {runtime,driver,store}=await runtimeWith();
  const removed=await runtime.createSession(),retained=await runtime.createSession();
  await store.setCodexThread(removed.session.id,'missing-delete-thread');
  await store.addTurn(removed.session.id,'20000000-0000-4000-8000-000000000092','Delete this local history');
  runtime.connectedThreads.add('missing-delete-thread');
  driver.deleteThread.mockRejectedValueOnce(new Error('no rollout found for thread id missing-delete-thread'));
  await expect(runtime.deleteSession(removed.session.id)).resolves.toEqual({sessionId:removed.session.id});
  expect(()=>store.get(removed.session.id)).toThrow(/not found/);
  expect(store.get(retained.session.id)).toMatchObject({id:retained.session.id});
  expect(runtime.connectedThreads.has('missing-delete-thread')).toBe(false);
  const reloaded=new SessionStore({filePath:store.filePath});await reloaded.load();
  expect(reloaded.list().map((s:any)=>s.id)).toEqual([retained.session.id]);await runtime.stop();
});

it.each(['Connection timed out','Permission denied','no rollout found for thread id a-different-thread','thread not found while checking permission'])(
  'keeps local history for any other Codex deletion failure: %s',async(message)=>{
    const {runtime,driver,store}=await runtimeWith();const {session}=await runtime.createSession();
    await store.setCodexThread(session.id,'target-thread');
    await store.addTurn(session.id,'20000000-0000-4000-8000-000000000093','Keep this local history');
    driver.deleteThread.mockRejectedValueOnce(new Error(message));
    await expect(runtime.deleteSession(session.id)).rejects.toThrow(message);
    expect(store.get(session.id).messages[0].text).toBe('Keep this local history');await runtime.stop();
  }
);

it('publishes a content-free busy snapshot before acceptance, restores it on query, and releases it on all preparation failures',async()=>{
  const {runtime,driver}=await runtimeWith();const {session}=await runtime.createSession();
  let finish!:(value:any)=>void;driver.listModels.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=runtime.submit(session.id,'Synthetic pending question');
  await waitFor(()=>Boolean(finish));
  expect(runtime.getStatus().activeTask).toMatchObject({sessionId:session.id,owner:'agent',phase:'starting'});
  expect(JSON.stringify(runtime.getStatus())).not.toContain('Synthetic pending question');
  const taskId=runtime.getStatus().activeTask.taskId;await runtime.cancel(taskId);
  expect(driver.cancelTurn).not.toHaveBeenCalled();
  finish(await new FakeDriver().listModels());await expect(pending).rejects.toThrow(/取消/);
  expect(runtime.getStatus().activeTask).toBeNull();expect(driver.startTurn).not.toHaveBeenCalled();await runtime.stop();
});

it('runs project work and Reader work simultaneously with separate drivers and cancels only Reader',async()=>{
  const {ReaderEngine}=require('../electron/reader-engine.cjs');
  const project=await runtimeWith(),reader=await runtimeWith();
  (project.driver as any).accountStatus=vi.fn(async()=>({connected:true,email:null}));
  (reader.driver as any).accountStatus=vi.fn(async()=>({connected:true,email:null}));
  const engine=new ReaderEngine({accountStatus:()=> (project.driver as any).accountStatus(),createRuntime:async()=>reader.runtime});
  const session=await project.runtime.createSession();await project.runtime.submit(session.session.id,'Project task');
  const requestId='20000000-0000-4000-8000-000000000101';const reading=engine.run({requestId,instructions:'Translate',input:'Reader source'});
  const rejected=expect(reading).rejects.toThrow(/未完成/);
  await waitFor(()=>reader.driver.startTurn.mock.calls.length===1);
  expect(project.runtime.getStatus().activeTask).toMatchObject({owner:'agent',sessionId:session.session.id});
  expect(reader.runtime.getStatus().activeTask).toMatchObject({owner:'reader'});
  expect(reader.driver.threadStartDefinitions).toEqual([]);expect(project.driver.threadStartDefinitions).toHaveLength(3);
  const deltas=vi.fn();engine.on('delta',deltas);
  reader.driver.emit('delta',{delta:'Reader chunk'});project.driver.emit('delta',{delta:'Project chunk'});
  await waitFor(()=>deltas.mock.calls.length===1);
  expect(deltas).toHaveBeenCalledWith({requestId,delta:'Reader chunk'});
  expect(project.store.get(session.session.id).messages.at(-1).text).toBe('Project chunk');
  engine.cancel(requestId);await waitFor(()=>reader.driver.cancelTurn.mock.calls.length===1);
  expect(project.driver.cancelTurn).not.toHaveBeenCalled();
  reader.driver.emit('turn',{status:'cancelled',turnId:reader.driver.turnId});await rejected;
  expect(project.runtime.activeTask).toBeTruthy();project.driver.emit('turn',{status:'completed',turnId:project.driver.turnId});
  await waitFor(()=>!project.runtime.activeTask);await engine.stop();await project.runtime.stop();
});

it('reads subsequent files with session approval while still rejecting sensitive and outside paths',async()=>{
  const {runtime,store,driver,workspace}=await runtimeWith();
  await writeFile(path.join(workspace.state().root,'actual.txt'),'authorized text');
  const {session}=await runtime.createSession();const events:any[]=[];runtime.on('event',(event:any)=>events.push(event));
  const {taskId}=await runtime.submit(session.id,'Read project files');
  await waitFor(()=>store.get(session.id).codexThreadId==='thread-1'&&runtime.activeTask.turnId==='turn-1');
  let id=900;const invoke=(file:string)=>driver.invokeTool({requestId:++id,callId:`call-${id}`,threadId:'thread-1',turnId:'turn-1',namespace:null,tool:'read_workspace_file',arguments:{path:file,reason:'Read requested project text'}});
  const first=invoke('actual.txt');await waitFor(()=>events.some(event=>event.type==='tool-approval-requested'));
  const request=events.find(event=>event.type==='tool-approval-requested');
  runtime.resolveToolApproval({approvalId:request.approvalId,sessionId:session.id,taskId,decision:'approved-for-session'});
  expect((await first).success).toBe(true);expect((await invoke('actual.txt')).success).toBe(true);
  expect(events.filter(event=>event.type==='tool-approval-requested')).toHaveLength(1);
  expect((await invoke('../outside.txt')).success).toBe(false);expect((await invoke('.env')).success).toBe(false);
  driver.emit('turn',{status:'completed',turnId:'turn-1'});await waitFor(()=>runtime.activeTask===null);
  await runtime.setWorkspace(workspace.state().root);
  expect(runtime.approvals.sessionReadGrants.size).toBe(0);await runtime.stop();
});
