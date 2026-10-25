const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { PROTOCOL_VERSION, RuntimeMessage, RuntimeStatus, Payloads, Results } = require('./runtime-protocol.cjs');

class RuntimeSupervisor extends EventEmitter {
  constructor({ utilityProcess, entryPath, args = [], cwd, startupTimeoutMs = 20000, requestTimeoutMs = 30000, shutdownTimeoutMs = 5000 } = {}) {
    super();
    if (!utilityProcess?.fork || !entryPath) throw new Error('RuntimeSupervisor requires Electron utilityProcess and an entry path.');
    Object.assign(this, { utilityProcess, entryPath, args, cwd, startupTimeoutMs, requestTimeoutMs, shutdownTimeoutMs });
    this.status = { status: 'connecting' };
    this.child = null;
    this.pending = new Map();
    this.activeTaskId = null;
    this.activeSessionId = null;
    this.codexPid = null;
    this.started = false;
    this.runtimeReady = false;
    this.stopping = false;
    this.exited = false;
  }

  getStatus() { return { ...this.status }; }

  start() {
    if (this.started) return this.startPromise;
    this.started = true;
    this.status = { status: 'connecting' };
    this.emit('status', this.getStatus());
    try {
      this.child = this.utilityProcess.fork(this.entryPath, this.args, { cwd: this.cwd, serviceName: 'Vantilo Runtime', stdio: 'ignore' });
    } catch (error) {
      this._setStatus({ status: 'error', error: `Unable to start Vantilo Runtime: ${error.message}` });
      this.startPromise = Promise.reject(error);
      return this.startPromise;
    }
    this.child.on('message', message => this._onMessage(message));
    this.child.on('error', (type, location) => this._fail(new Error(`Runtime process error${location ? ` (${location})` : ''}${type ? `: ${type}` : ''}.`)));
    this.child.on('exit', code => this._onExit(code));
    this.startPromise = new Promise((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
      this.startTimer = setTimeout(() => {
        const error = new Error('Vantilo Runtime did not become ready before the startup timeout.');
        this._fail(error);
        reject(error);
      }, this.startupTimeoutMs);
    });
    return this.startPromise;
  }

  async request(method, payload) {
    const schema = Payloads[method];
    if (!schema) throw new Error('Unsupported Runtime operation.');
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new Error('Invalid Runtime request payload.');
    if (!this.runtimeReady && method !== 'shutdown' && this.startPromise) await this.startPromise;
    if (!this.child || this.exited || (this.stopping && method !== 'shutdown')) throw new Error(this.status.error || 'Runtime is not available.');
    const requiresCodex = method === 'submit' || method === 'cancel';
    if (requiresCodex && this.status.status !== 'ready') throw new Error(this.status.error || 'Runtime is not ready.');
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Runtime request timed out: ${method}.`));
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { method, resolve, reject, timer });
      try { this.child.postMessage({ version: PROTOCOL_VERSION, type: 'request', requestId, method, payload: parsed.data }); }
      catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
    });
  }

  getRuntimeStatus() { return this.request('status', {}); }
  listSessions() { return this.request('sessions:list', {}); }
  createSession() { return this.request('sessions:create', {}); }
  openSession(sessionId) { return this.request('sessions:open', { sessionId }); }
  deleteSession(sessionId) { return this.request('sessions:delete', { sessionId }); }
  getSessionMenuState(sessionId) { return this.request('sessions:menu-state', { sessionId }); }
  renameSession(sessionId, title) { return this.request('sessions:rename', { sessionId, title }); }
  setSessionPinned(sessionId, pinned) { return this.request('sessions:pin', { sessionId, pinned }); }
  listModels() { return this.request('models:list', {}); }
  setSessionModelConfig(sessionId, modelId, reasoningEffort) { return this.request('session:model-config', { sessionId, modelId, reasoningEffort }); }
  getWorkspace() { return this.request('workspace:get', {}); }
  setWorkspace(workspacePath) { return this.request('workspace:set', { path: workspacePath }); }
  clearWorkspace() { return this.request('workspace:clear', {}); }
  validateWorkspaceReferences(paths) { return this.request('workspace:references:validate', { paths }).then(result => result.references); }
  resolveKnownProjectPath(path) { return this.request('workspace:project-path:resolve', { path }); }
  listProjects() { return this.request('projects:list', {}); }
  setProjectPinned(path, pinned) { return this.request('project:pin', { path, pinned }); }
  removeProject(path) { return this.request('project:remove', { path }); }
  resolveToolApproval(approvalId, sessionId, taskId, decision) { return this.request('approval:resolve', { approvalId, sessionId, taskId, decision }); }
  submit(sessionId, text) { return this.request('submit', { sessionId, text }); }
  cancel(taskId) { return this.request('cancel', { taskId }); }

  _onMessage(raw) {
    const parsed = RuntimeMessage.safeParse(raw);
    if (!parsed.success) { this._fail(new Error('Runtime sent an invalid or unsupported protocol message.')); return; }
    const message = parsed.data;
    if (message.type === 'ready') {
      clearTimeout(this.startTimer);
      this.runtimeReady = true;
      this._setStatus(message.status);
      this.startResolve?.(this.getStatus());
      return;
    }
    if (message.type === 'status') { this._setStatus(message.status); return; }
    if (message.type === 'child-process') { this.codexPid = message.pid; return; }
    if (message.type === 'event') {
      const event = message.event;
      if (event.type === 'task-started') { this.activeTaskId = event.taskId; this.activeSessionId = event.sessionId; }
      if (event.type === 'task-status' && event.status !== 'cancelling' && event.taskId === this.activeTaskId) { this.activeTaskId = null; this.activeSessionId = null; }
      this.emit('event', event);
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    if (message.ok) {
      const result = Results[pending.method].safeParse(message.result);
      if (!result.success) {
        this.pending.delete(message.requestId);
        const error = new Error(`Runtime returned an invalid result for ${pending.method}.`);
        pending.reject(error); this._fail(error); return;
      }
      this.pending.delete(message.requestId);
      pending.resolve(result.data);
    } else {
      this.pending.delete(message.requestId);
      pending.reject(new Error(message.error.message));
    }
  }

  _setStatus(status) {
    const parsed = RuntimeStatus.safeParse(status);
    if (!parsed.success) { this._fail(new Error('Runtime reported an invalid health status.')); return; }
    this.status = parsed.data;
    this.emit('status', this.getStatus());
  }

  _fail(error) {
    if (this.exited || this.stopping) return;
    clearTimeout(this.startTimer);
    this._setStatus({ status: 'error', error: error.message });
    this.startReject?.(error);
    for (const [id, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(error); this.pending.delete(id); }
    if (this.activeTaskId) {
      this.emit('event', { type: 'task-status', taskId: this.activeTaskId, sessionId: this.activeSessionId, status: 'failed', error: `Runtime connection lost: ${error.message}` });
      this.activeTaskId = null; this.activeSessionId = null;
    }
    if (this.child && !this.exited) this.child.kill();
  }

  _onExit(code) {
    if (this.exited) return;
    this.exited = true;
    clearTimeout(this.startTimer);
    const error = new Error(this.stopping ? 'Runtime stopped.' : `Runtime exited unexpectedly${typeof code === 'number' ? ` (code ${code})` : ''}.`);
    if (!this.stopping) {
      this._terminateCodex();
      this._setStatus({ status: 'error', error: error.message });
      this.startReject?.(error);
      if (this.activeTaskId) {
        this.emit('event', { type: 'task-status', taskId: this.activeTaskId, sessionId: this.activeSessionId, status: 'failed', error: `Runtime connection lost: ${error.message}` });
        this.activeTaskId = null; this.activeSessionId = null;
      }
    } else this._setStatus({ status: 'stopped' });
    for (const [id, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(error); this.pending.delete(id); }
    this.emit('exit', { code, expected: this.stopping });
  }

  _terminateCodex() {
    const pid = this.codexPid;
    this.codexPid = null;
    if (!Number.isInteger(pid) || pid <= 0) return;
    try { process.kill(pid, 'SIGTERM'); } catch { return; }
    const escalation = setTimeout(() => {
      try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch { /* the owned child has already exited */ }
    }, 1500);
    escalation.unref();
  }

  _waitForExit(timeoutMs) {
    if (this.exited) return Promise.resolve(true);
    return new Promise(resolve => {
      const finish = exited => { clearTimeout(timer); this.child?.removeListener('exit', onExit); resolve(exited); };
      const onExit = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.child.once('exit', onExit);
    });
  }

  async stop() {
    if (!this.child || this.exited) { this._terminateCodex(); return; }
    this.stopping = true;
    const child = this.child;
    try {
      void this.request('shutdown', {}).catch(() => {});
      if (!await this._waitForExit(this.shutdownTimeoutMs)) {
        this._terminateCodex();
        child.kill();
        await this._waitForExit(this.shutdownTimeoutMs);
      }
    } finally {
      if (!this.exited) this._onExit(null);
    }
  }
}

module.exports = { RuntimeSupervisor };
