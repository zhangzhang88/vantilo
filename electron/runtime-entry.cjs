const path = require('node:path');
const fs = require('node:fs/promises');
const { CodexDriver } = require('./codex-driver.cjs');
const {ReaderEngine}=require('./reader-engine.cjs');
const { AgentRuntime } = require('./runtime.cjs');
const { SessionStore } = require('./session-store.cjs');
const { WorkspaceAuthority } = require('./workspace.cjs');
const { ProjectStore } = require('./project-store.cjs');
const { ApprovalService } = require('./approval-service.cjs');
const { PROTOCOL_VERSION, Request, Payloads } = require('./runtime-protocol.cjs');
const { systemProxyEnvironment } = require('./system-proxy.cjs');

const parentPort = process.parentPort;
if (!parentPort) throw new Error('Runtime process requires Electron utilityProcess parentPort.');

const userDataPath = process.argv[2];
if (!userDataPath || !path.isAbsolute(userDataPath)) throw new Error('Runtime requires Electron’s absolute Vantilo user-data directory.');
let accountChanging=false;
const privateCodexHome = path.join(userDataPath, 'codex-home');
const codexEnvironment = () => ({ PATH: '/usr/bin:/bin', CODEX_HOME: privateCodexHome, LANG: 'en_US.UTF-8', TMPDIR: process.env.TMPDIR || '/tmp', ...systemProxyEnvironment() });
const runtime = new AgentRuntime({
  ...(process.argv[3] ? { driver: new CodexDriver({ command: process.argv[3], cwd: userDataPath, env: codexEnvironment() }) } : {}),
  store: new SessionStore({ filePath: path.join(userDataPath, 'sessions.json') }),
  workspace: new WorkspaceAuthority({ userDataPath }),
  projectStore: new ProjectStore({ filePath: path.join(userDataPath, 'projects.json') }),
  // Workspace writes are suspended until a race-safe directory-relative write primitive is available.
  // Keep the schema for migration, but do not publish the write tool to Codex.
  approvalService: new ApprovalService(), enableWriteTools: false
});
const readerEngine=new ReaderEngine({
  accountStatus:()=>accountChanging ? Promise.resolve({connected:false,email:null}) : runtime.driver.accountStatus(),
  createRuntime:async()=>{
    const readerData=path.join(userDataPath,'reader-engine');
    const root=path.join(readerData,'reader-task-workspace');
    await fs.mkdir(root,{recursive:true,mode:0o700});
    const workspace=new WorkspaceAuthority({userDataPath:readerData});await workspace.setWorkspace(root);
    return new AgentRuntime({
      driver:new CodexDriver({command:process.argv[3],cwd:root,env:codexEnvironment()}),
      store:new SessionStore({filePath:path.join(readerData,'sessions.json')}),workspace,
      projectStore:new ProjectStore({filePath:path.join(readerData,'projects.json')}),approvalService:new ApprovalService(),
    });
  },
});
readerEngine.on('delta',payload=>send({type:'reader-delta',...payload}));
readerEngine.on('process',({pid})=>send({type:'child-process',owner:'reader',pid}));
const handled = new Set();
let stopping = false;
let startupPromise = Promise.resolve();
function send(message) {
  try { parentPort.postMessage({ version: PROTOCOL_VERSION, ...message }); }
  catch { void shutdown(); }
}
function respond(requestId, result) {
  send({ type: 'response', requestId, ok: true, result });
}
function reject(requestId, error) {
  send({ type: 'response', requestId, ok: false, error: { message: error instanceof Error ? error.message : 'Runtime request failed.' } });
}
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try { await startupPromise; await readerEngine.stop(); await runtime.stop(); } finally { process.exit(0); }
}

runtime.on('status', status => send({ type: 'status', status }));
runtime.on('event', event => {
  const id = event.sessionId || event.session?.id;
  if (id) { try { const scoped=runtime.store.get(id); if (scoped.readerScopeKey) { if(event.type==='message-delta' && event.delta) send({type:'reader-delta',requestId:scoped.readerScopeKey.slice('reader-task:'.length),delta:event.delta.slice(0,20000)}); return; } } catch {} }
  send({ type: 'event', event });
});
runtime.driver.on('process-start', ({ pid }) => send({ type: 'child-process', pid }));
runtime.driver.on('process-exit', () => send({ type: 'child-process', pid: null }));

parentPort.on('message', async event => {
  const parsed = Request.safeParse(event.data);
  if (!parsed.success) return;
  const { requestId, method, payload } = parsed.data;
  if (handled.has(requestId)) { reject(requestId, new Error('Duplicate Runtime request ID.')); return; }
  const input = Payloads[method].safeParse(payload);
  if (!input.success) { reject(requestId, new Error('Invalid Runtime request payload.')); return; }
  handled.add(requestId);
  try {
    let result;
    switch (method) {
      case 'reader:cancel': result=readerEngine.cancel(input.data.requestId); break;
      case 'reader:ai': result = { output: await readerEngine.run(input.data) }; break;
      case 'account:status': result = await runtime.driver.accountStatus(); break;
      case 'account:login': if (runtime.activeTask || readerEngine.busy) throw new Error('请先结束当前任务'); accountChanging=true;try{await readerEngine.reset(); result = await runtime.driver.startAccountLogin();}finally{accountChanging=false;} break;
      case 'account:logout': if (runtime.activeTask || readerEngine.busy) throw new Error('请先结束当前任务'); accountChanging=true;try{await readerEngine.reset(); result = await runtime.driver.logoutAccount();}finally{accountChanging=false;} break;
      case 'status': result = runtime.getStatus(); break;
      case 'sessions:list': result = runtime.listSessions(); break;
      case 'sessions:create': result = await runtime.createSession(); break;
      case 'sessions:open': result = await runtime.openSession(input.data.sessionId); break;
      case 'sessions:delete': result = await runtime.deleteSession(input.data.sessionId); break;
      case 'sessions:menu-state': result = runtime.getSessionMenuState(input.data.sessionId); break;
      case 'sessions:rename': result = await runtime.renameSession(input.data.sessionId, input.data.title); break;
      case 'sessions:pin': result = await runtime.setSessionPinned(input.data.sessionId, input.data.pinned); break;
      case 'models:list': result = await runtime.listModels(); break;
      case 'session:model-config': result = await runtime.setSessionModelConfig(input.data.sessionId, input.data.modelId, input.data.reasoningEffort); break;
      case 'session:permission-mode': result = await runtime.setSessionPermissionMode(input.data.sessionId, input.data.permissionMode); break;
      case 'workspace:get': result = runtime.getWorkspace(); break;
      case 'workspace:set': result = await runtime.setWorkspace(input.data.path); break;
      case 'workspace:clear': result = await runtime.clearWorkspace(); break;
      case 'workspace:references:validate': result = { references: await runtime.validateWorkspaceReferences(input.data.paths) }; break;
      case 'workspace:project-path:resolve': result = await runtime.resolveKnownProjectPath(input.data.path); break;
      case 'projects:list': result = runtime.listProjects(); break;
      case 'project:pin': result = await runtime.setProjectPinned(input.data.path, input.data.pinned); break;
      case 'project:remove': result = await runtime.removeProject(input.data.path); break;
      case 'approval:resolve': result = runtime.resolveToolApproval(input.data); break;
      case 'submit': result = await runtime.submit(input.data.sessionId, input.data.text, {permissionMode:input.data.permissionMode ?? 'supervised'}); break;
      case 'cancel': result = await runtime.cancel(input.data.taskId); break;
      case 'shutdown':
        stopping = true;
        await startupPromise;
        await readerEngine.stop();
        await runtime.stop();
        respond(requestId, { status: 'stopped' });
        process.exit(0);
        return;
    }
    respond(requestId, result);
  } catch (error) { reject(requestId, error); }
  finally { handled.delete(requestId); }
});

startupPromise = (async () => {
  if (process.argv[3]) {
    await fs.mkdir(privateCodexHome, { recursive: true, mode: 0o700 });
    await runtime.workspace.load();
    if (!runtime.workspace.state().root) {
      const defaultWorkspace = path.join(userDataPath, 'agent-workspace');
      await fs.mkdir(defaultWorkspace, { recursive: true, mode: 0o700 });
      await runtime.workspace.setWorkspace(defaultWorkspace);
    }
  }
  return runtime.start();
})();
startupPromise.then(status => send({ type: 'ready', status })).catch(error => {
  send({ type: 'ready', status: { status: 'error', error: error instanceof Error ? error.message : 'Runtime startup failed.' } });
});
