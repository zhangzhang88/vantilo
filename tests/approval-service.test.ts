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
