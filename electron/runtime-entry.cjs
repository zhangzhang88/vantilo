const path = require('node:path');
const { AgentRuntime } = require('./runtime.cjs');
const { SessionStore } = require('./session-store.cjs');
const { WorkspaceAuthority } = require('./workspace.cjs');
const { ProjectStore } = require('./project-store.cjs');
const { ApprovalService } = require('./approval-service.cjs');
const { PROTOCOL_VERSION, Request, Payloads } = require('./runtime-protocol.cjs');

const parentPort = process.parentPort;
if (!parentPort) throw new Error('Runtime process requires Electron utilityProcess parentPort.');

const userDataPath = process.argv[2];
if (!userDataPath || !path.isAbsolute(userDataPath)) throw new Error('Runtime requires Electron’s absolute Vantilo user-data directory.');
const runtime = new AgentRuntime({
  store: new SessionStore({ filePath: path.join(userDataPath, 'sessions.json') }),
  workspace: new WorkspaceAuthority({ userDataPath }),
  projectStore: new ProjectStore({ filePath: path.join(userDataPath, 'projects.json') }),
  approvalService: new ApprovalService()
});
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
  try { await startupPromise; await runtime.stop(); } finally { process.exit(0); }
}

runtime.on('status', status => send({ type: 'status', status }));
runtime.on('event', event => send({ type: 'event', event }));
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
      case 'workspace:get': result = runtime.getWorkspace(); break;
      case 'workspace:set': result = await runtime.setWorkspace(input.data.path); break;
      case 'workspace:clear': result = await runtime.clearWorkspace(); break;
      case 'workspace:references:validate': result = { references: await runtime.validateWorkspaceReferences(input.data.paths) }; break;
      case 'workspace:project-path:resolve': result = await runtime.resolveKnownProjectPath(input.data.path); break;
      case 'projects:list': result = runtime.listProjects(); break;
      case 'project:pin': result = await runtime.setProjectPinned(input.data.path, input.data.pinned); break;
      case 'project:remove': result = await runtime.removeProject(input.data.path); break;
      case 'approval:resolve': result = runtime.resolveToolApproval(input.data); break;
      case 'submit': result = await runtime.submit(input.data.sessionId, input.data.text); break;
      case 'cancel': result = await runtime.cancel(input.data.taskId); break;
      case 'shutdown':
        stopping = true;
        await startupPromise;
        await runtime.stop();
        respond(requestId, { status: 'stopped' });
        process.exit(0);
        return;
    }
    respond(requestId, result);
  } catch (error) { reject(requestId, error); }
  finally { handled.delete(requestId); }
});

startupPromise = runtime.start();
startupPromise.then(status => send({ type: 'ready', status })).catch(error => {
  send({ type: 'ready', status: { status: 'error', error: error instanceof Error ? error.message : 'Runtime startup failed.' } });
});
