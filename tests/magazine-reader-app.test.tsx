// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const entry = vi.hoisted(() => ({ node: null as React.ReactNode }));
vi.mock('react-dom/client', async importOriginal => {
  const original = await importOriginal<typeof import('react-dom/client')>();
  return { ...original, createRoot: (container: HTMLElement, options: any) => container
    ? original.createRoot(container, options) : { render: (node: React.ReactNode) => { entry.node = node; } } };
});
vi.mock('@react-spectrum/s2', () => ({
  Provider: ({ children }: any) => <>{children}</>,
  ActionButton: ({ children, onPress, isDisabled, 'aria-label': label }: any) =>
    <button onClick={onPress} disabled={isDisabled} aria-label={label}>{children}</button>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  Tooltip: () => null,
}));
vi.mock('@react-spectrum/s2/icons/Add', () => ({ default: () => null }));
vi.mock('@react-spectrum/s2/icons/AddCircle', () => ({ default: () => null }));
vi.mock('@react-spectrum/s2/icons/Folder', () => ({ default: () => null }));
vi.mock('@react-spectrum/s2/icons/Asset', () => ({ default: () => null }));
vi.mock('@react-spectrum/s2/icons/Clock', () => ({ default: () => null }));
vi.mock('@react-spectrum/s2/icons/Home', () => ({ default: () => null }));
vi.mock('@react-spectrum/s2/icons/Lightbulb', () => ({ default: () => null }));
vi.mock('@react-spectrum/s2/icons/Settings', () => ({ default: () => null }));
vi.mock('@react-spectrum/s2/icons/Tools', () => ({ default: () => null }));
vi.mock('@react-spectrum/s2/icons/ChevronDown', () => ({ default: () => null }));
vi.mock('@react-spectrum/s2/icons/ChevronRight', () => ({ default: () => null }));
vi.mock('@react-spectrum/s2/icons/PinOn', () => ({ default: () => null }));
vi.mock('../src/ui/agent-composer', () => ({
  AgentComposer: ({ value, onChange, onSubmit, modelControl }: any) => <><textarea aria-label="Agent 草稿" value={value} onChange={event => onChange(event.target.value)} /><button type="button" aria-label="发送测试消息" onClick={() => onSubmit(value)}>发送</button>{modelControl}</>,
}));
vi.mock('../src/ui/conversation-message', () => ({ ConversationMessage: () => null }));

beforeAll(async () => { await import('../src/main'); });
afterEach(() => { cleanup(); delete window.vantilo; vi.useRealTimers(); });

function mount(initialStatus:any={status:'ready'}) {
  const session = { id: 'session-fixture', title: 'Existing session', createdAt: '2026-10-25',
    updatedAt: '2026-10-25', workspaceRoot: '/fixture', codexThreadId: null, pinned: false, messages: [] };
  const api = {
    onRuntimeStatus: vi.fn((_listener: (status: any) => void) => () => {}), onAgentEvent: vi.fn((_listener: (event: any) => void) => () => {}),
    getRuntimeStatus: vi.fn(async () => initialStatus),
    getWorkspace: vi.fn(async () => ({ root: '/fixture', error: null, revision: 1 })),
    listProjects: vi.fn(async () => []),
    listSessions: vi.fn(async () => ({ sessions: [{ ...session, messageCount: 0, preview: '', threadState: 'new' }], storage: { available: true, error: null, warning: null } })),
    openSession: vi.fn(async () => ({ session, threadState: 'new', connectionError: null })),
    resolveToolApproval: vi.fn(async (..._args:any[]) => ({})), createSession: vi.fn(), submitTask: vi.fn(async (_id:string, _text:string) => ({})), cancelTask: vi.fn(),
    listCodexModels: vi.fn(async () => ({ models: [] })),
    startMagazineReader: vi.fn(async () => ({ ready: true })),
    getMagazineReaderStatus: vi.fn(async () => ({ status: 'ready', error: null as string | null })),
  };
  window.vantilo = api as unknown as NonNullable<Window['vantilo']>;
  render(entry.node);
  return api;
}

describe('Reader inside the Agent application', () => {
  it('opens from home on demand and returns to the existing session and draft', async () => {
    const api = mount();
    await waitFor(() => expect(api.openSession).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole('textbox', { name: 'Agent 草稿' }), { target: { value: 'Keep this draft' } });
    expect(api.startMagazineReader).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Magazine Reader/ }));
    await screen.findByTitle('Magazine Reader');
    fireEvent.click(screen.getByRole('button', { name: '对话' }));
    expect((screen.getByRole('textbox', { name: 'Agent 草稿' }) as HTMLTextAreaElement).value).toBe('Keep this draft');
    expect(screen.getByTitle('Existing session')).toBeTruthy();
    expect(api.openSession).toHaveBeenCalledOnce();
    expect(api.createSession).not.toHaveBeenCalled();
    expect(api.submitTask).not.toHaveBeenCalled();
    expect(api.cancelTask).not.toHaveBeenCalled();
  });

  it('retains the exact Reader iframe when returning during startup and later switching to Agent', async () => {
    const api = mount();
    await waitFor(() => expect(api.openSession).toHaveBeenCalledOnce());
    let finish!: () => void;
    api.startMagazineReader.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ ready: true }); }));
    fireEvent.click(screen.getByRole('button', { name: '阅读' }));
    expect(screen.getByRole('status').textContent).toContain('正在启动');
    fireEvent.click(screen.getByRole('button', { name: '对话' }));
    await act(async () => { finish(); });
    const frame = screen.getByTitle('Magazine Reader');
    expect(frame.closest('.magazine-reader-module')?.hasAttribute('hidden')).toBe(true);
    const initialStarts = api.startMagazineReader.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '阅读' }));
    expect(screen.getByTitle('Magazine Reader')).toBe(frame);
    expect(frame.closest('.magazine-reader-module')?.hasAttribute('hidden')).toBe(false);
    expect(api.startMagazineReader).toHaveBeenCalledTimes(initialStarts);
    fireEvent.click(screen.getByRole('button', { name: '对话' }));
    expect(screen.getByTitle('Magazine Reader')).toBe(frame);
    expect(frame.closest('.magazine-reader-module')?.hasAttribute('hidden')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '阅读' }));
    expect(screen.getByTitle('Magazine Reader')).toBe(frame);
    expect(api.startMagazineReader).toHaveBeenCalledTimes(initialStarts);
  });

  it('allows retrying a genuine startup error from the reading entry', async () => {
    const api = mount();
    await waitFor(() => expect(api.openSession).toHaveBeenCalledOnce());
    api.startMagazineReader.mockRejectedValueOnce(new Error('端口冲突'));
    fireEvent.click(screen.getByRole('button', { name: '阅读' }));
    await screen.findByText('端口冲突');
    fireEvent.click(screen.getAllByRole('button', { name: '对话' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: '阅读' }));
    await screen.findByTitle('Magazine Reader');
    expect(api.startMagazineReader).toHaveBeenCalledTimes(2);
  });

  it('shows a running-service failure, retries, and stops polling when leaving Reader', async () => {
    const api = mount();
    await waitFor(() => expect(api.openSession).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: '阅读' }));
    await screen.findByTitle('Magazine Reader');
    vi.useFakeTimers();
    // The already-created interval is real; remount its effect using an Agent round trip.
    fireEvent.click(screen.getByRole('button', { name: '对话' }));
    fireEvent.click(screen.getByRole('button', { name: '阅读' }));
    await act(async () => {});
    api.getMagazineReaderStatus.mockResolvedValue({ status: 'error', error: '服务中断' });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole('alert').textContent).toContain('服务中断');
    api.getMagazineReaderStatus.mockResolvedValue({ status: 'ready', error: null });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await act(async () => {});
    expect(screen.getByTitle('Magazine Reader')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '对话' }));
    const probes = api.getMagazineReaderStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(api.getMagazineReaderStatus).toHaveBeenCalledTimes(probes);
  });
  it('keeps the project composer hidden and unchanged when Reader assistant messages arrive', async () => {
    const api = mount();
    await waitFor(() => expect(api.openSession).toHaveBeenCalledOnce());
    const originalComposer = screen.getByRole('textbox', {name:'Agent 草稿'});
    fireEvent.change(originalComposer,{target:{value:'Private project draft'}});
    fireEvent.click(screen.getByRole('button', {name:'阅读'}));
    const frame = await screen.findByTitle('Magazine Reader') as HTMLIFrameElement;
    act(() => window.dispatchEvent(new MessageEvent('message', { origin:'http://127.0.0.1:5175', source:frame.contentWindow,
      data:{type:'vantilo:open-agent',title:'Fixture book',documentId:'book:fixture',text:'Selected original paragraph'} })));
    expect(screen.queryByRole('textbox', {name:'Agent 草稿'})).toBeNull();
    expect(screen.queryByText('Selected original paragraph')).toBeNull();
    expect(api.submitTask).not.toHaveBeenCalled(); expect(api.createSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'对话'}));
    expect(screen.getByRole('textbox',{name:'Agent 草稿'})).toBe(originalComposer);
    expect((originalComposer as HTMLTextAreaElement).value).toBe('Private project draft');
    expect(api.openSession).toHaveBeenCalledOnce();
  });

  it('uses one ChatGPT login state for Agent and Reader and supports logout', async () => {
    vi.useFakeTimers();
    let connected = false;
    const api = mount() as any;
    api.getAccountStatus = vi.fn(async()=>({connected,email:connected?'fixture@example.com':null}));
    api.loginWithChatGPT = vi.fn(async()=>{connected=true;return {pending:true};});
    api.logoutAccount = vi.fn(async()=>{connected=false;return {connected:false,email:null};});
    await act(async()=>{});
    fireEvent.click(screen.getByRole('button',{name:'登录 ChatGPT'}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
    expect(screen.getByRole('button',{name:'退出账号'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'阅读'}));
    await act(async()=>{});
    expect(screen.getByRole('button',{name:'退出账号'})).toBeTruthy();
    expect(api.loginWithChatGPT).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button',{name:'退出账号'}));
    await act(async()=>{});
    expect(screen.getByRole('button',{name:'登录 ChatGPT'})).toBeTruthy();
    expect(api.logoutAccount).toHaveBeenCalledOnce();
  });

});

it('dismisses an open project model portal on module navigation and does not reopen it on return',async()=>{
  const api=mount();await waitFor(()=>expect(api.openSession).toHaveBeenCalledOnce());
  const draft=screen.getByRole('textbox',{name:'Agent 草稿'});fireEvent.change(draft,{target:{value:'Retain project draft'}});
  fireEvent.click(screen.getByRole('button',{name:/Codex 模型设置/}));
  expect(screen.getByRole('menu',{name:'Codex 模型与推理强度'})).toBeTruthy();
  // click alone reproduces programmatic/keyboard navigation without an outside pointerdown.
  fireEvent.click(screen.getByRole('button',{name:'阅读'}));
  await screen.findByTitle('Magazine Reader');
  expect(screen.queryByRole('menu',{name:'Codex 模型与推理强度'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'对话'}));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getByRole('button',{name:/Codex 模型设置/}).getAttribute('aria-expanded')).toBe('false');
  expect((screen.getByRole('textbox',{name:'Agent 草稿'}) as HTMLTextAreaElement).value).toBe('Retain project draft');
  expect(api.openSession).toHaveBeenCalledOnce();
});

it('restores an active project task from status after page reload without a task-started event',async()=>{
  const taskId='20000000-0000-4000-8000-000000000111';
  const api=mount({status:'ready',activeTask:{taskId,sessionId:'session-fixture',owner:'agent',phase:'running'}});
  await waitFor(()=>expect(api.openSession).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByRole('textbox',{name:'Agent 草稿'}),{target:{value:'Next draft'}});
  fireEvent.click(screen.getByRole('button',{name:'发送测试消息'}));expect(api.submitTask).not.toHaveBeenCalled();
  act(()=>api.onRuntimeStatus.mock.calls[0]![0]({status:'ready',activeTask:null}));
  fireEvent.click(screen.getByRole('button',{name:'发送测试消息'}));await waitFor(()=>expect(api.submitTask).toHaveBeenCalledOnce());
});

it('accepts only one send while the first submission is still awaiting acknowledgement',async()=>{
  const api=mount();await waitFor(()=>expect(api.openSession).toHaveBeenCalledOnce());
  let finish!:(value:any)=>void;api.submitTask.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  fireEvent.change(screen.getByRole('textbox',{name:'Agent 草稿'}),{target:{value:'One user submission'}});
  act(()=>{fireEvent.click(screen.getByRole('button',{name:'发送测试消息'}));fireEvent.click(screen.getByRole('button',{name:'发送测试消息'}));});
  expect(api.submitTask).toHaveBeenCalledOnce();await act(async()=>finish({taskId:'fixture'}));
});

it('offers session read-only permission and forwards only the selected approval identity',async()=>{
  const api=mount();await waitFor(()=>expect(api.openSession).toHaveBeenCalledOnce());
  const request={type:'tool-approval-requested',approvalId:'approval-fixture',sessionId:'session-fixture',taskId:'task-fixture',toolName:'read_workspace_file',reason:'Read requested file',relativePath:'AGENTS.md',operation:'read',workspaceRoot:'/fixture',workspaceRevision:1,expiresAt:'2026-10-26T12:00:00Z'};
  act(()=>api.onAgentEvent.mock.calls[0]![0](request));
  fireEvent.click(await screen.findByRole('button',{name:'本会话允许只读'}));
  expect(api.resolveToolApproval).toHaveBeenCalledWith('approval-fixture','session-fixture','task-fixture','approved-for-session');
});
it('opens settings from the lower-left navigation without replacing the Reader frame',async()=>{
 const api=mount();await waitFor(()=>expect(api.openSession).toHaveBeenCalledOnce());
 fireEvent.click(screen.getByRole('button',{name:'设置'}));
 const frame=await screen.findByTitle('Magazine Reader') as HTMLIFrameElement;
 const post=vi.spyOn(frame.contentWindow!,'postMessage');fireEvent.load(frame);
 expect(post).toHaveBeenCalledWith({type:'vantilo:navigate',target:'settings'},'http://127.0.0.1:5175');
 expect(screen.queryByRole('button',{name:'返回 Agent'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'阅读'}));
 expect(screen.getByTitle('Magazine Reader')).toBe(frame);
 expect(post).toHaveBeenLastCalledWith({type:'vantilo:navigate',target:'library'},'http://127.0.0.1:5175');
 expect(api.submitTask).not.toHaveBeenCalled();
});
