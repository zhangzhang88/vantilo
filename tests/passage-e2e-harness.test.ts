import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { AgentRuntime } = require('../electron/runtime.cjs') as { AgentRuntime:new(options:any)=>any };
const { SessionStore } = require('../electron/session-store.cjs') as { SessionStore:new(options:any)=>any };
const { WorkspaceAuthority } = require('../electron/workspace.cjs') as { WorkspaceAuthority:new(options:any)=>any };
const { ProjectStore } = require('../electron/project-store.cjs') as { ProjectStore:new(options:any)=>any };
const { CodexDriver } = require('../electron/codex-driver.cjs') as { CodexDriver:new(options?:any)=>any };
const { installRpcBudget, installRawToolCallBudget, approvalMatchesRawRequest, assertThreadStartCatalog, assertPassageResult, decodeToolResponse } = require('../scripts/passage-e2e-assertions.cjs') as {
  installRpcBudget:(driver:any,limits:any)=>any; installRawToolCallBudget:(driver:any,options:any)=>any; approvalMatchesRawRequest:(event:any,raw:any,expected:any)=>boolean;
  assertThreadStartCatalog:(options:any)=>void; assertPassageResult:(response:any,expected:any)=>void; decodeToolResponse:(response:any)=>any;
};
class FakePassageDriver extends EventEmitter {
  threadId:string|null=null; turnId='fake-turn'; threadStartParams:any=null; handler:any; starts:any[]=[];
  setToolCallHandler(handler:any){this.handler=handler;}
  async start(){this.emit('status',{status:'ready'});}
  async listModels(){return [{id:'model',catalogId:'model',displayName:'Model',description:'test',isDefault:true,defaultEffort:'low',efforts:[{id:'low',description:'low'}]}];}
  async startTurn(_text:string,threadId:string|null,options:any){this.starts.push({threadId,options:structuredClone(options)});if(!threadId){this.threadId='fake-thread';this.threadStartParams={dynamicTools:structuredClone(options.dynamicTools)};}else this.threadId=threadId;return {threadId:this.threadId,turnId:this.turnId};}
  async cancelTurn(){return {};}
  async close(){}
  invokeTool(call:any){return this.handler(call);}
}
async function waitFor(test:()=>boolean){for(let n=0;n<100;n++){if(test())return;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Timed out waiting for fake app-server interaction.');}
describe('passage real-Codex E2E harness assertions (fake app-server only)',()=>{
  it('enforces RPC limits before sending, counts raw malformed tool requests, and fails closed over budget',async()=>{
    const sent:any[]=[];const runtimeCalls:any[]=[];const rawHandler=vi.fn((message:any)=>{if(!message.params||message.params.tool!=='read_workspace_passage')return;runtimeCalls.push(message);});const driver:any={request:vi.fn(async(method:string)=>{sent.push(method);return method;}),_handleDynamicToolCall:rawHandler};const violations:string[]=[];
    const limits={initialize:1,'model/list':2,'thread/start':1,'turn/start':2};const rpc=installRpcBudget(driver,limits);
    for(const [method,limit] of Object.entries(limits)){for(let i=0;i<limit;i++)await driver.request(method,{});await expect(driver.request(method,{})).rejects.toThrow(/budget/);}
    await expect(driver.request('unlisted',{})).rejects.toThrow(/budget/);expect(sent).toEqual(Object.entries(limits).flatMap(([method,limit])=>Array(limit).fill(method)));expect(rpc.counts.get('initialize')).toBe(1);
    const raw=installRawToolCallBudget(driver,{limit:2,violations});const first={jsonrpc:'2.0',id:1,method:'item/tool/call',params:{tool:'read_workspace_passage'}};const malformed={jsonrpc:'2.0',id:2,method:'item/tool/call',params:{tool:7}};const extra={jsonrpc:'2.0',id:3,method:'item/tool/call',params:{tool:'unexpected'}};
    driver._handleDynamicToolCall(first);driver._handleDynamicToolCall(malformed);driver._handleDynamicToolCall(extra);
    expect(raw.requests).toEqual([first,malformed,extra]);expect(rawHandler).toHaveBeenCalledTimes(3);expect(rawHandler.mock.calls[2][0].params).toBeNull();expect(runtimeCalls).toEqual([first]);expect(violations).toHaveLength(1);
    rpc.restore();raw.restore();
  });
  it('blocks an over-budget raw request before the actual CodexDriver invokes its tool handler',async()=>{
    const driver:any=new CodexDriver();
    const writes:any[]=[];
    driver._write=(message:any)=>writes.push(structuredClone(message));
    const runtime:any=new AgentRuntime({driver,store:{flush:async()=>{}},workspace:{},projectStore:{}});
    const runtimeToolHandler=vi.spyOn(runtime,'_handleToolCall').mockImplementation(async()=>({success:true,contentItems:[{type:'inputText',text:'{"ok":true}'}]}));
    const violations:string[]=[];
    const budget=installRawToolCallBudget(driver,{limit:2,violations});
    const send=(id:number)=>driver._handleDynamicToolCall({jsonrpc:'2.0',id,method:'item/tool/call',params:{threadId:'thread-a',turnId:'turn-a',callId:`call-${id}`,namespace:null,tool:'read_workspace_passage',arguments:{path:'e2e.md',startLine:2,endLine:3}}});
    try{
      send(1);send(2);send(3);
      await vi.waitFor(()=>{expect(runtimeToolHandler).toHaveBeenCalledTimes(2);expect(writes).toHaveLength(3);});
      expect(budget.requests).toHaveLength(3);
      expect(violations).toEqual(['Raw item/tool/call request budget exceeded (2).']);
      expect(writes.map(message=>message.id)).toEqual([3,1,2]);
      expect(writes[0].result.success).toBe(false);
      expect(JSON.parse(writes[0].result.contentItems[0].text).error.code).toBe('tool_unavailable');
      expect(writes[1].result.success).toBe(true);
      expect(writes[2].result.success).toBe(true);
      expect(runtimeToolHandler).toHaveBeenCalledTimes(2);
    }finally{budget.restore();await runtime.stop();}
  });
  it('binds every approval field to its raw Codex request',()=>{
    const raw={id:42,params:{threadId:'thread-a',turnId:'turn-b',callId:'call-c',tool:'read_workspace_passage',arguments:{path:'e2e.md',startLine:2,endLine:3}}};
    const expected={sessionId:'session-a',taskId:'task-b',workspaceRoot:'/tmp/isolated',workspaceRevision:9,relativePath:'e2e.md',startLine:2,endLine:3};
    const event={...expected,threadId:'thread-a',turnId:'turn-b',serverRequestId:42,callId:'call-c',toolName:'read_workspace_passage',lineRange:{startLine:2,endLine:3}};
    expect(approvalMatchesRawRequest(event,raw,expected)).toBe(true);
    for(const key of ['sessionId','taskId','threadId','turnId','serverRequestId','callId','workspaceRoot','workspaceRevision','toolName','relativePath'])expect(approvalMatchesRawRequest({...event,[key]:key==='workspaceRevision'?10:'mismatch'},raw,expected)).toBe(false);
    expect(approvalMatchesRawRequest({...event,lineRange:{startLine:1,endLine:3}},raw,expected)).toBe(false);
  });
  it('binds the exact published thread definition to persisted fingerprint and approved/rejected Runtime calls',async()=>{
    let base:string|undefined;let runtime:any;let primaryError:unknown=null;
    try {
    base=await mkdtemp(path.join(os.tmpdir(),'vantilo-passage-e2e-fake-'));const userData=path.join(base,'user-data');const root=path.join(base,'workspace');await mkdir(root,{recursive:true});
    const passage='FAKE-PASSAGE-MARKER';await writeFile(path.join(root,'e2e.md'),`first\n${passage}\nthird\nfourth\n`);
    const workspace=new WorkspaceAuthority({userDataPath:userData});await workspace.setWorkspace(root);const store=new SessionStore({filePath:path.join(userData,'sessions.json')});const driver=new FakePassageDriver();runtime=new AgentRuntime({driver,store,workspace,projectStore:new ProjectStore({filePath:path.join(userData,'projects.json')})});await runtime.start();
    const events:any[]=[];runtime.on('event',(event:any)=>events.push(event));const created=await runtime.createSession();const sessionId=created.session.id;const snapshot=runtime.toolCatalog.snapshot();
    const first=await runtime.submit(sessionId,'Read lines two and three.');await waitFor(()=>store.get(sessionId).codexThreadId==='fake-thread'&&runtime.activeTask?.turnId==='fake-turn');
    const actualRead=vi.spyOn(workspace,'readTextRange');const firstCall=driver.invokeTool({requestId:1,callId:'fake-approved',threadId:'fake-thread',turnId:'fake-turn',namespace:null,tool:'read_workspace_passage',arguments:{path:'e2e.md',startLine:2,endLine:3,reason:'Read selected passage'}});
    await waitFor(()=>events.some(event=>event.type==='tool-approval-requested'&&event.taskId===first.taskId));const approval=events.find(event=>event.type==='tool-approval-requested'&&event.taskId===first.taskId);
    expect(actualRead).not.toHaveBeenCalled();expect(approvalMatchesRawRequest(approval,{id:1,params:{threadId:'fake-thread',turnId:'fake-turn',callId:'fake-approved',tool:'read_workspace_passage',arguments:{path:'e2e.md',startLine:2,endLine:3}}},{sessionId,taskId:first.taskId,workspaceRoot:workspace.state().root,workspaceRevision:workspace.state().revision,relativePath:'e2e.md',startLine:2,endLine:3})).toBe(true);
    runtime.resolveToolApproval({approvalId:approval.approvalId,sessionId,taskId:first.taskId,decision:'approved'});const firstResponse=await firstCall;
    assertPassageResult(firstResponse,{path:'e2e.md',startLine:2,endLine:3,content:`${passage}\nthird`});expect(actualRead).toHaveBeenCalledOnce();
    const definitions=driver.threadStartParams;assertThreadStartCatalog({params:definitions,catalog:runtime.toolCatalog,snapshot,persistedFingerprint:store.get(sessionId).toolCatalogFingerprint});
    expect(driver.starts[0].options.dynamicTools).toEqual(definitions.dynamicTools);
    driver.emit('delta',{delta:`${passage} e2e.md lines 2-3 untrusted`,turnId:'fake-turn'});driver.emit('turn',{status:'completed',turnId:'fake-turn'});await waitFor(()=>runtime.activeTask===null);

    const second=await runtime.submit(sessionId,'Read the same passage again.');await waitFor(()=>runtime.activeTask?.turnId==='fake-turn');const secondCall=driver.invokeTool({requestId:2,callId:'fake-rejected',threadId:'fake-thread',turnId:'fake-turn',namespace:null,tool:'read_workspace_passage',arguments:{path:'e2e.md',startLine:2,endLine:3,reason:'Retry selected passage'}});
    await waitFor(()=>events.filter(event=>event.type==='tool-approval-requested'&&event.taskId===second.taskId).length===1);const rejected=events.find(event=>event.type==='tool-approval-requested'&&event.taskId===second.taskId);const readsBeforeReject=actualRead.mock.calls.length;
    runtime.resolveToolApproval({approvalId:rejected.approvalId,sessionId,taskId:second.taskId,decision:'rejected'});const deniedResponse=await secondCall;
    expect(decodeToolResponse(deniedResponse)).toMatchObject({ok:false});expect(actualRead).toHaveBeenCalledTimes(readsBeforeReject);
    expect(events.some(event=>event.type==='tool-approval-resolved'&&event.approvalId===rejected.approvalId&&event.status==='rejected')).toBe(true);
    expect(events.some(event=>event.type==='tool-execution'&&event.approvalId===rejected.approvalId&&event.stage==='denied')).toBe(true);
    driver.emit('delta',{delta:'The read was denied.',turnId:'fake-turn'});driver.emit('turn',{status:'completed',turnId:'fake-turn'});await waitFor(()=>runtime.activeTask===null);
    expect(store.get(sessionId).messages.at(-1).text).toBe('The read was denied.');
    expect(driver.starts).toHaveLength(2);expect(driver.starts.filter(item=>item.threadId===null)).toHaveLength(1);expect(driver.starts[1].threadId).toBe('fake-thread');
    }catch(error){primaryError=error;throw error;}finally{
      const { cleanupRealCodexE2E }=require('../scripts/real-codex-cleanup.cjs');const cleanupErrors=await cleanupRealCodexE2E(runtime,base);
      if(cleanupErrors.length){if(primaryError)throw new AggregateError([primaryError,...cleanupErrors],'Fake Runtime test failed and cleanup reported an error.');throw cleanupErrors[0];}
    }
  });
});
