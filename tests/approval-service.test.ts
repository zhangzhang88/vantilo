import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { ApprovalService }=require('../electron/approval-service.cjs') as {ApprovalService:new(options?:any)=>any};
const details=(overrides:any={})=>({serverRequestId:7,callId:'codex-call-1',sessionId:'20000000-0000-4000-8000-000000000001',taskId:'30000000-0000-4000-8000-000000000001',threadId:'thread-one',turnId:'turn-one',toolName:'read_workspace_file',reason:'Inspect the requested source',relativePath:'README.md',operation:'read',workspaceRoot:'/workspace',workspaceRevision:1,...overrides});
afterEach(()=>vi.useRealTimers());

describe('one-shot request-bound tool approvals',()=>{
  it('binds an approval to its JSON-RPC request, session, task and workspace; repeated decisions fail',async()=>{
    const service=new ApprovalService();const events:any[]=[];service.on('requested',(event:any)=>events.push(event));
    const waiting=service.request(details());const request=events[0];expect(request).toMatchObject({sessionId:details().sessionId,taskId:details().taskId,serverRequestId:7,workspaceRoot:'/workspace',readOnly:true});
    expect(()=>service.decide({approvalId:request.approvalId,sessionId:'20000000-0000-4000-8000-000000000099',taskId:details().taskId,decision:'approved'})).toThrow(/does not match/);
    service.decide({approvalId:request.approvalId,sessionId:details().sessionId,taskId:details().taskId,decision:'approved'});
    await expect(waiting).resolves.toMatchObject({approvalId:request.approvalId,status:'approved'});
    expect(()=>service.decide({approvalId:request.approvalId,sessionId:details().sessionId,taskId:details().taskId,decision:'approved'})).toThrow(/no longer pending/);
    expect(()=>service.request(details())).toThrow(/Duplicate or replayed/);
  });
  it('does not authorize another task or session and denies explicit rejection',async()=>{
    const service=new ApprovalService();const requested:any[]=[];service.on('requested',(request:any)=>requested.push(request));
    const waiting=service.request(details());const request=requested[0];
    expect(()=>service.decide({approvalId:request.approvalId,sessionId:details().sessionId,taskId:'30000000-0000-4000-8000-000000000002',decision:'approved'})).toThrow();
    service.decide({approvalId:request.approvalId,sessionId:details().sessionId,taskId:details().taskId,decision:'rejected'});
    await expect(waiting).resolves.toMatchObject({status:'rejected'});
  });
  it('retains a validated article line range in the one-time approval receipt',async()=>{
    const service=new ApprovalService();const events:any[]=[];service.on('requested',(event:any)=>events.push(event));const waiting=service.request(details({lineRange:{startLine:4,endLine:10}}));expect(events[0].lineRange).toEqual({startLine:4,endLine:10});service.decide({approvalId:events[0].approvalId,sessionId:details().sessionId,taskId:details().taskId,decision:'rejected'});await expect(waiting).resolves.toMatchObject({status:'rejected'});
    expect(()=>service.request(details({serverRequestId:8,lineRange:{startLine:1,endLine:41}}))).toThrow(/line range/);
  });
  it('expires approvals closed and rejects pending calls on cancellation or Runtime shutdown',async()=>{
    vi.useFakeTimers();const service=new ApprovalService({timeoutMs:50});const requests:any[]=[];const resolved:any[]=[];service.on('requested',(request:any)=>requests.push(request));service.on('resolved',(request:any)=>resolved.push(request));
    const expiring=service.request(details());await vi.advanceTimersByTimeAsync(51);await expect(expiring).resolves.toMatchObject({status:'expired'});expect(resolved.at(-1).status).toBe('expired');
    const cancelled=service.request(details({serverRequestId:8,callId:'codex-call-2',taskId:'30000000-0000-4000-8000-000000000002'}));service.rejectTask('30000000-0000-4000-8000-000000000002');await expect(cancelled).resolves.toMatchObject({status:'cancelled'});
    const stopped=service.request(details({serverRequestId:9,callId:'codex-call-3',taskId:'30000000-0000-4000-8000-000000000003'}));service.rejectAll();await expect(stopped).resolves.toMatchObject({status:'cancelled'});expect(service.listPending()).toEqual([]);
  });
});

it('reuses an explicit read-only grant only in the same session, root and revision, with replay checks',async()=>{
  const service=new ApprovalService();const requested:any[]=[];service.on('requested',(r:any)=>requested.push(r));
  const first=service.request(details());service.decide({...requested[0],decision:'approved-for-session'});
  await expect(first).resolves.toMatchObject({status:'approved'});
  await expect(service.request(details({serverRequestId:8,taskId:'later-task',toolName:'list_workspace_files',operation:'list'}))).resolves.toMatchObject({status:'approved'});
  expect(requested).toHaveLength(1);
  expect(()=>service.request(details({serverRequestId:8}))).toThrow(/replayed/);
  for(const overrides of [{sessionId:'other-session'},{workspaceRoot:'/other'},{workspaceRevision:2},{toolName:'write_file'}]){
    const pending=service.request(details({serverRequestId:20+requested.length,...overrides}));
    const request=requested.at(-1);service.decide({...request,decision:'rejected'});await expect(pending).resolves.toMatchObject({status:'rejected'});
  }
  expect(requested).toHaveLength(5);service.rejectAll();
});
it('clears session grants on workspace reset or shutdown and never persists them across instances',async()=>{
  for(const clear of ['clearSessionReadGrants','rejectAll']){
    const service=new ApprovalService();const events:any[]=[];service.on('requested',(r:any)=>events.push(r));
    const first=service.request(details());service.decide({...events[0],decision:'approved-for-session'});await first;
    service[clear]();const next=service.request(details({serverRequestId:9}));expect(events).toHaveLength(2);
    service.rejectAll();await expect(next).resolves.toMatchObject({status:'cancelled'});
  }
  const service=new ApprovalService();const pending=service.request(details());expect(service.listPending()).toHaveLength(1);service.rejectAll();await pending;
});
it('cannot create a session grant from an expired or mismatched request',async()=>{
  let now=1000;const service=new ApprovalService({now:()=>now,timeoutMs:20});const events:any[]=[];service.on('requested',(r:any)=>events.push(r));
  const first=service.request(details());expect(()=>service.decide({...events[0],sessionId:'foreign',decision:'approved-for-session'})).toThrow();
  now+=21;expect(()=>service.decide({...events[0],decision:'approved-for-session'})).toThrow(/expired/);await first;
  const next=service.request(details({serverRequestId:8}));expect(events).toHaveLength(2);service.rejectAll();await next;
});

it('supports task-scoped automatic approval for the selected permission mode', async()=>{
  const service=new ApprovalService(); const requested:any[]=[]; service.on('requested',(request:any)=>requested.push(request));
  const write=service.request(details({serverRequestId:31,operation:'write',toolName:'write_workspace_file',readOnly:false,autoApprove:true}));
  await expect(write).resolves.toMatchObject({status:'approved'}); expect(requested).toHaveLength(0);
  const read=service.request(details({serverRequestId:32,autoApprove:false})); expect(requested).toHaveLength(1);
  service.decide({approvalId:requested[0].approvalId,sessionId:details().sessionId,taskId:details().taskId,decision:'rejected'}); await read;
  const automaticRead=service.request(details({serverRequestId:33,autoApprove:true}));
  await expect(automaticRead).resolves.toMatchObject({status:'approved'});
});
