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
const roots:string[]=[];
class FakeDriver extends EventEmitter {
  turnId='turn-1'; closed=false; threadCounter=0; active=false;
  toolCallHandler:((call:any)=>Promise<any>)|null=null;
  threadId:string|null=null;
  effectiveByThread=new Map<string,{model:string;effort:string|null}>();
  executedSettings:Array<{threadId:string;model:string;effort:string|null}>=[];
  listModels=vi.fn(async()=>[{id:'gpt-6.1-sol',catalogId:'catalog-sol',displayName:'GPT 6.1 Sol',description:'Current default model',isDefault:true,defaultEffort:'low',efforts:[{id:'low',description:'Fast'},{id:'high',description:'Deep'}]},{id:'gpt-6-luna',catalogId:'catalog-luna',displayName:'GPT 6 Luna',description:'Alternative model',isDefault:false,defaultEffort:'low',efforts:[{id:'low',description:'Fast'},{id:'high',description:'Deep'}]}]);
  startTurn=vi.fn(async(_text:string,threadId:string|null=null,options:any={})=>{this.active=true;this.threadId=threadId||`thread-${++this.threadCounter}`;const previous=this.effectiveByThread.get(this.threadId)||{model:'gpt-6.1-sol',effort:'low'};const effective={model:options.model??previous.model,effort:options.effort??previous.effort};this.effectiveByThread.set(this.threadId,effective);this.executedSettings.push({threadId:this.threadId,...effective});return {threadId:this.threadId,turnId:this.turnId}});
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
    await store.setCodexThread(session.id,'saved-thread',1);
    await store.setModelConfig(session.id,null,'high');
    const opened=await runtime.openSession(session.id);
    expect(opened.threadState).toBe('connected');expect(driver.resumeThread).toHaveBeenCalledWith('saved-thread',session.workspaceRoot);
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
    await store.setCodexThread(session.id,'thread-project-a',1);
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
    const session=await store.create(null);await store.setCodexThread(session.id,'thread-legacy',1);
    driver.readThreadCwd.mockResolvedValue(workspace.state().root);
    const opened=await runtime.openSession(session.id);
    expect(driver.readThreadCwd).toHaveBeenCalledWith('thread-legacy');
    expect(store.get(session.id).workspaceRoot).toBe(workspace.state().root);
    expect(opened).toMatchObject({threadState:'connected',session:{workspaceRoot:workspace.state().root}});
    expect(driver.resumeThread).toHaveBeenCalledWith('thread-legacy',workspace.state().root);
  });
  it('does not guess a legacy project from the currently selected workspace when Codex metadata is unavailable',async()=>{
    const {runtime,store,driver,workspace}=await runtimeWith();
    const session=await store.create(null);await store.setCodexThread(session.id,'thread-metadata-missing',1);
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
  it('rejects overlapping tasks, validates cancellation IDs, and supports repeated cancellation',async()=>{
    const {runtime,driver}=await runtimeWith();const {session}=await runtime.createSession();const {taskId}=await runtime.submit(session.id,'one');
    await waitFor(()=>driver.startTurn.mock.results.length>0);
    await expect(runtime.submit(session.id,'two')).rejects.toThrow(/已有任务/);
    await expect(runtime.cancel('other')).rejects.toThrow(/不存在/);
    await runtime.cancel(taskId);await runtime.cancel(taskId);expect(driver.cancelTurn).toHaveBeenCalledOnce();
    driver.emit('turn',{status:'cancelled',turnId:'turn-1'});await waitFor(()=>runtime.activeTask===null);
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
