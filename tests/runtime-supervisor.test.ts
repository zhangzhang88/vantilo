import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { RuntimeSupervisor } = require('../electron/runtime-supervisor.cjs') as { RuntimeSupervisor: new(options:any)=>any };
const { PROTOCOL_VERSION } = require('../electron/runtime-protocol.cjs') as { PROTOCOL_VERSION:number };

class FakeUtilityChild extends EventEmitter {
  messages: any[] = [];
  killed = false;
  postMessage(message: any) { this.messages.push(message); }
  kill() { this.killed = true; queueMicrotask(() => this.emit('exit', 0)); return true; }
  send(message: any) { this.emit('message', message); }
  reply(request: any, result: unknown) { this.send({ version: PROTOCOL_VERSION, type: 'response', requestId: request.requestId, ok: true, result }); }
}
function setup(options: Record<string, unknown> = {}) {
  const child = new FakeUtilityChild();
  const supervisor = new RuntimeSupervisor({ utilityProcess: { fork: vi.fn(() => child) }, entryPath: '/runtime-entry.cjs', startupTimeoutMs: 100, requestTimeoutMs: 100, shutdownTimeoutMs: 30, ...options });
  const starting = supervisor.start();
  child.send({ version: PROTOCOL_VERSION, type: 'ready', status: { status: 'ready' } });
  return { child, supervisor, starting };
}
afterEach(() => vi.useRealTimers());

describe('supervised Runtime IPC', () => {
  it('starts separately and reports validated Ready health', async () => {
    const { supervisor, starting } = setup();
    await expect(starting).resolves.toEqual({ status: 'ready' });
    expect(supervisor.getStatus()).toEqual({ status: 'ready' });
    await supervisor.stop();
  });
  it('correlates concurrent requests independently and validates payloads', async () => {
    const { child, supervisor, starting } = setup(); await starting;
    const sessionId = '20000000-0000-4000-8000-000000000001';
    const first = supervisor.submit(sessionId, 'one'); const second = supervisor.submit(sessionId, 'two');
    const [a, b] = child.messages.slice(-2);
    expect(a.requestId).not.toBe(b.requestId);
    child.reply(b, { taskId: '00000000-0000-4000-8000-000000000002', sessionId }); child.reply(a, { taskId: '00000000-0000-4000-8000-000000000001', sessionId });
    await expect(first).resolves.toEqual({ taskId: '00000000-0000-4000-8000-000000000001', sessionId });
    await expect(second).resolves.toEqual({ taskId: '00000000-0000-4000-8000-000000000002', sessionId });
    await expect(supervisor.submit(sessionId, '')).rejects.toThrow(/Invalid Runtime/);
    await supervisor.stop();
  });
  it('exposes validated history operations and propagates structured storage errors', async () => {
    const { child, supervisor, starting } = setup(); await starting;
    const listing = supervisor.listSessions(); const listRequest = child.messages.at(-1);
    expect(listRequest.method).toBe('sessions:list');
    const now = new Date().toISOString();
    child.reply(listRequest, { sessions: [{ id: '20000000-0000-4000-8000-000000000001', title: 'History', createdAt: now, updatedAt: now, codexThreadId: null, modelId: null, reasoningEffort: null, workspaceRoot: '/authorized/workspace', pinned:false, messageCount: 0, preview: '', threadState: 'new' }], storage: { available: true, error: null, warning: null } });
    await expect(listing).resolves.toMatchObject({ sessions: [{ title: 'History' }], storage: { available: true } });
    const created = supervisor.createSession(); const createRequest = child.messages.at(-1);
    child.reply(createRequest, { session: { id: '20000000-0000-4000-8000-000000000002', title: 'New conversation', createdAt: now, updatedAt: now, codexThreadId: null, modelId: null, reasoningEffort: null, workspaceRoot: '/authorized/workspace', pinned:false, messages: [] }, threadState: 'new', connectionError: null });
    await expect(created).resolves.toMatchObject({ threadState: 'new' });
    const deleted = supervisor.deleteSession('20000000-0000-4000-8000-000000000002'); const deleteRequest = child.messages.at(-1);
    expect(deleteRequest).toMatchObject({ method: 'sessions:delete', payload: { sessionId: '20000000-0000-4000-8000-000000000002' } });
    child.reply(deleteRequest, { sessionId: '20000000-0000-4000-8000-000000000002' });
    await expect(deleted).resolves.toMatchObject({ sessionId: '20000000-0000-4000-8000-000000000002' });
    const failed = supervisor.listSessions(); const failedRequest = child.messages.at(-1);
    child.send({ version: PROTOCOL_VERSION, type: 'response', requestId: failedRequest.requestId, ok: false, error: { message: 'Cannot read session file.' } });
    await expect(failed).rejects.toThrow('Cannot read session file.');
    await supervisor.stop();
  });
  it('validates workspace reference selections in Runtime and returns only workspace-relative paths', async () => {
    const { child, supervisor, starting } = setup(); await starting;
    const pending = supervisor.validateWorkspaceReferences(['/authorized/project/src/app.ts']);
    const request = child.messages.at(-1);
    expect(request).toMatchObject({method:'workspace:references:validate',payload:{paths:['/authorized/project/src/app.ts']}});
    child.reply(request,{references:[{path:'src/app.ts',kind:'file'}]});
    await expect(pending).resolves.toEqual([{path:'src/app.ts',kind:'file'}]);
    await supervisor.stop();
  });
  it('validates and forwards one-time tool approvals without accepting file paths from Renderer IPC', async () => {
    const { child, supervisor, starting } = setup(); await starting;
    const events: any[] = []; supervisor.on('event', (event: any) => events.push(event));
    const now = new Date(); const sessionId = '20000000-0000-4000-8000-000000000001'; const taskId = '8a2b9de2-1cf0-47a8-a75a-d2397b112345'; const approvalId = '30000000-0000-4000-8000-000000000001';
    child.send({ version: PROTOCOL_VERSION, type: 'event', event: { type: 'tool-approval-requested', approvalId, serverRequestId: 81, callId: 'codex-call-81', sessionId, taskId, threadId: 'thread-one', turnId: 'turn-one', toolName: 'read_workspace_passage', reason: 'Inspect the requested source', relativePath: 'README.md', operation: 'read', lineRange:{startLine:3,endLine:6}, readOnly: true, workspaceRoot: '/authorized/workspace', workspaceRevision: 1, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 120000).toISOString() } });
    expect(events[0]).toMatchObject({ type: 'tool-approval-requested', approvalId, relativePath: 'README.md', toolName:'read_workspace_passage', lineRange:{startLine:3,endLine:6}, readOnly: true });
    for(const stage of ['started','completed','failed','denied','cancelled'])child.send({version:PROTOCOL_VERSION,type:'event',event:{type:'tool-execution',approvalId,sessionId,taskId,toolName:'read_workspace_passage',stage,summary:'passage result',error:null}});
    expect(events.slice(1).map(event=>event.stage)).toEqual(['started','completed','failed','denied','cancelled']);
    const resolved = supervisor.resolveToolApproval(approvalId, sessionId, taskId, 'approved'); const request = child.messages.at(-1);
    expect(request).toMatchObject({ method: 'approval:resolve', payload: { approvalId, sessionId, taskId, decision: 'approved' } });
    expect(request.payload).not.toHaveProperty('path');
    child.reply(request, { approvalId, sessionId, taskId, status: 'approved' });
    await expect(resolved).resolves.toMatchObject({ status: 'approved' });
    await expect(supervisor.resolveToolApproval(approvalId, sessionId, taskId, 'always')).rejects.toThrow(/Invalid Runtime request payload/);
    await supervisor.stop();
  });
  it('forwards streamed events and fails active tasks if Runtime exits unexpectedly', async () => {
    const { child, supervisor, starting } = setup(); await starting;
    const events: any[] = []; supervisor.on('event', (event: any) => events.push(event));
    child.send({ version: PROTOCOL_VERSION, type: 'event', event: {
      type: 'task-started', taskId: '8a2b9de2-1cf0-47a8-a75a-d2397b112345', sessionId: '20000000-0000-4000-8000-000000000001', text: 'hello', status: 'running',
      userMessage: { id: '30000000-0000-4000-8000-000000000001', role: 'user', text: 'hello', createdAt: new Date().toISOString() },
      assistantMessage: { id: '30000000-0000-4000-8000-000000000002', role: 'assistant', text: '', createdAt: new Date().toISOString(), taskId: '8a2b9de2-1cf0-47a8-a75a-d2397b112345', status: 'pending', error: null }
    } });
    const finishedAt = new Date().toISOString();
    child.send({ version: PROTOCOL_VERSION, type: 'event', event: { type: 'message-status', taskId: '8a2b9de2-1cf0-47a8-a75a-d2397b112345', sessionId: '20000000-0000-4000-8000-000000000001', record: { id: '30000000-0000-4000-8000-000000000002', role: 'assistant', text: 'hello', createdAt: new Date(Date.parse(finishedAt) - 1000).toISOString(), finishedAt, taskId: '8a2b9de2-1cf0-47a8-a75a-d2397b112345', status: 'completed', error: null } } });
    expect(events.at(-1)).toMatchObject({ type: 'message-status', record: { status: 'completed', finishedAt } });
    expect(supervisor.getStatus().status).toBe('ready');
    child.send({ version: PROTOCOL_VERSION, type: 'child-process', pid: 456789 });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    child.emit('exit', 9);
    expect(kill).toHaveBeenCalledWith(456789, 'SIGTERM');
    kill.mockRestore();
    expect(supervisor.getStatus()).toMatchObject({ status: 'error', error: expect.stringContaining('code 9') });
    expect(events.at(-1)).toMatchObject({ type: 'task-status', status: 'failed', cause: 'runtime-disconnected', sessionId: '20000000-0000-4000-8000-000000000001', taskId: '8a2b9de2-1cf0-47a8-a75a-d2397b112345', error: expect.stringContaining('Runtime connection lost') });
  });
  it('rejects malformed RPC results and fails closed', async () => {
    const { child, supervisor, starting } = setup(); await starting;
    const request = supervisor.submit('20000000-0000-4000-8000-000000000001', 'hello');
    child.reply(child.messages.at(-1), { taskId: 'not-a-uuid', sessionId: '20000000-0000-4000-8000-000000000001' });
    await expect(request).rejects.toThrow(/invalid result/);
    expect(supervisor.getStatus()).toMatchObject({ status: 'error' });
  });
  it('fails closed on malformed messages and startup timeout', async () => {
    const malformedChild = new FakeUtilityChild();
    const supervisor = new RuntimeSupervisor({ utilityProcess: { fork: () => malformedChild }, entryPath: '/runtime-entry.cjs', startupTimeoutMs: 100 });
    const starting = supervisor.start();
    const rejected = expect(starting).rejects.toThrow(/invalid or unsupported protocol/);
    malformedChild.send({ version: 6, type: 'ready', status: { status: 'ready' } });
    await rejected;
    expect(supervisor.getStatus().status).toBe('error');

    vi.useFakeTimers();
    const timeoutChild = new FakeUtilityChild();
    const timeout = new RuntimeSupervisor({ utilityProcess: { fork: () => timeoutChild }, entryPath: '/runtime-entry.cjs', startupTimeoutMs: 20 });
    const promise = timeout.start(); const timeoutRejected = expect(promise).rejects.toThrow(/startup timeout/);
    await vi.advanceTimersByTimeAsync(25); await timeoutRejected;
    expect(timeoutChild.killed).toBe(true);
  });
  it('shuts down only its own utility process', async () => {
    const { child, supervisor, starting } = setup(); await starting;
    const stopping = supervisor.stop();
    const shutdown = child.messages.at(-1);
    expect(shutdown).toMatchObject({ method: 'shutdown', type: 'request' });
    child.reply(shutdown, { status: 'stopped' }); child.emit('exit', 0);
    await stopping;
    expect(child.killed).toBe(false);
    expect(supervisor.getStatus().status).toBe('stopped');
  });
});

it('routes Reader deltas separately from project events',async()=>{
  const {child,supervisor,starting}=setup();await starting;const reader=vi.fn(),project=vi.fn();
  supervisor.on('reader-delta',reader);supervisor.on('event',project);
  const requestId='20000000-0000-4000-8000-000000000081';
  child.send({version:PROTOCOL_VERSION,type:'reader-delta',requestId,delta:'Reader-only text'});
  expect(reader).toHaveBeenCalledWith({requestId,delta:'Reader-only text'});
  expect(project).not.toHaveBeenCalled();await supervisor.stop();
});

it('tracks and terminates both owned engine processes after a Runtime crash',async()=>{
  const {child,supervisor,starting}=setup();await starting;const kill=vi.spyOn(process,'kill').mockImplementation(()=>true);
  child.send({version:PROTOCOL_VERSION,type:'child-process',pid:456781});
  child.send({version:PROTOCOL_VERSION,type:'child-process',owner:'reader',pid:456782});
  child.emit('exit',1);expect(kill).toHaveBeenCalledWith(456781,'SIGTERM');expect(kill).toHaveBeenCalledWith(456782,'SIGTERM');kill.mockRestore();
});
