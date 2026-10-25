const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { CodexDriver } = require('./codex-driver.cjs');
const { ApprovalService } = require('./approval-service.cjs');
const { ToolCatalog, TOOL_CATALOG_VERSION } = require('./tool-catalog.cjs');

const MAX_PROMPT_LENGTH = 20000;

class AgentRuntime extends EventEmitter {
  constructor({ driver = new CodexDriver({ cwd: process.cwd() }), store, workspace, projectStore, approvalService = new ApprovalService() } = {}) {
    super();
    if (!store || !workspace || !projectStore) throw new Error('AgentRuntime requires explicit session storage, project registry, and workspace authorization.');
    this.driver = driver; this.store = store; this.workspace = workspace; this.projectStore = projectStore; this.approvals = approvalService; this.toolCatalog = new ToolCatalog({ workspace });
    this.status = { status: 'connecting' }; this.activeTask = null; this.stopped = false;
    this.connectedThreads = new Set(); this.activationQueue = Promise.resolve(); this.modelCatalog = null;
    driver.setToolCallHandler(call => this._handleToolCall(call));
    this.approvals.on('requested', request => this.emit('event', { type: 'tool-approval-requested', ...request }));
    this.approvals.on('resolved', request => this.emit('event', { type: 'tool-approval-resolved', approvalId: request.approvalId, sessionId: request.sessionId, taskId: request.taskId, status: request.status }));
    driver.on('status', state => {
      this.status = state; this.emit('status', state);
      if (state.status === 'ready') void this.#recoverMissingWorkspaceRoots();
    });
    driver.on('failure', error => {
      this.status = { status: 'error', error: error.message }; this.emit('status', this.status);
      if (this.activeTask) this._finish(this.activeTask.id, 'failed', error.message);
    });
    driver.on('delta', delta => this._onDelta(delta));
    driver.on('turn-id', ({ turnId }) => { if (this.activeTask) this.activeTask.turnId = turnId; });
    driver.on('turn', turn => {
      if (!this.activeTask || (turn.turnId && this.activeTask.turnId && turn.turnId !== this.activeTask.turnId)) return;
      if (turn.status === 'running') { this.activeTask.turnId = turn.turnId || this.activeTask.turnId; this.emit('event', { type: 'activity', taskId: this.activeTask.id, sessionId: this.activeTask.sessionId, message: 'Codex 正在处理任务…' }); }
      else this._finish(this.activeTask.id, turn.status, turn.error);
    });
    driver.on('activity', activity => { if (this.activeTask) this.emit('event', { type: 'activity', taskId: this.activeTask.id, sessionId: this.activeTask.sessionId, message: activity.message }); });
  }

  async start() {
    if (this.stopped) throw new Error('Runtime has stopped.');
    this.status = { status: 'connecting' }; this.emit('status', this.status);
    const storage = await this.store.load();
    const workspace = await this.workspace.load();
    await this.projectStore.load();
    if (workspace.root) await this.projectStore.ensure(workspace.root);
    if (!storage.error) for (const session of this.store.list()) if (session.workspaceRoot) await this.projectStore.ensure(session.workspaceRoot);
    this.emit('event', { type: 'workspace-updated', workspace });
    if (!storage.error) {
      try { await this.store.recoverPending(); }
      catch (error) { this._reportStorageError(error); }
    }
    if (storage.warning) this.emit('event', { type: 'storage-warning', message: storage.warning });
    if (storage.error) this.emit('event', { type: 'storage-error', message: storage.error });
    void this.driver.start().catch(error => {
      this.status = { status: 'error', error: error.message }; this.emit('status', this.status);
      if (this.activeTask) this._finish(this.activeTask.id, 'failed', error.message);
    });
    return this.getStatus();
  }

  getStatus() { return { ...this.status }; }

  async #recoverWorkspaceRoot(sessionId) {
    if (this.status.status !== 'ready' || typeof this.driver.readThreadCwd !== 'function') return false;
    let session;
    try { session = this.store.get(sessionId); } catch { return false; }
    if (session.workspaceRoot || !session.codexThreadId) return false;
    try {
      const recordedCwd = await this.driver.readThreadCwd(session.codexThreadId);
      const canonicalRoot = await this.workspace.canonicalizeDirectory(recordedCwd);
      const recovered = await this.store.recoverWorkspaceRoot(sessionId, canonicalRoot);
      if (!recovered.workspaceRoot) return false;
      await this.projectStore.ensure(recovered.workspaceRoot);
      this.emit('event', { type: 'projects-updated', projects: this.projectStore.list() });
      this.emit('event', { type: 'session-updated', session: this.#summary(recovered, this.connectedThreads.has(recovered.codexThreadId)) });
      return true;
    } catch {
      // Codex metadata may be unavailable or the original directory may have moved.
      // Keep the association unknown; never guess from the currently selected workspace.
      return false;
    }
  }

  async #recoverMissingWorkspaceRoots() {
    if (this.workspaceRecoveryPromise) return this.workspaceRecoveryPromise;
    this.workspaceRecoveryPromise = (async () => {
      let sessions = [];
      try { sessions = this.store.list().filter(session => !session.workspaceRoot && session.codexThreadId); } catch { return; }
      for (let index = 0; index < sessions.length; index += 4) {
        await Promise.all(sessions.slice(index, index + 4).map(session => this.#recoverWorkspaceRoot(session.id)));
      }
    })().catch(() => {}).finally(() => { this.workspaceRecoveryPromise = null; });
    return this.workspaceRecoveryPromise;
  }

  async listModels() {
    const models = await this.driver.listModels();
    const parsed = require('./runtime-protocol.cjs').ModelCatalog.safeParse({ models });
    if (!parsed.success) throw new Error('Codex returned model metadata that Vantilo cannot safely use.');
    this.modelCatalog = parsed.data.models;
    return parsed.data;
  }

  async #resolveEffectiveModelConfig(modelId, reasoningEffort) {
    const catalog = await this.listModels();
    let model;
    if (modelId === null) {
      const defaults = catalog.models.filter(item => item.isDefault);
      if (defaults.length !== 1) throw new Error('Codex did not identify exactly one current default model; the task was not started.');
      [model] = defaults;
    } else {
      const matches = catalog.models.filter(item => item.id === modelId);
      if (matches.length !== 1) throw new Error('The selected Codex model is unavailable or ambiguous in the current catalog; the task was not started.');
      [model] = matches;
    }
    if (reasoningEffort !== null && !model.efforts.some(item => item.id === reasoningEffort)) throw new Error('The selected reasoning effort is not supported by the effective Codex model.');
    // A null override means the live model/list defaultReasoningEffort, not a user-config lookup.
    let effectiveEffort = reasoningEffort;
    if (effectiveEffort === null && model.efforts.length > 0) {
      if (!model.defaultEffort || !model.efforts.some(item => item.id === model.defaultEffort)) throw new Error('Codex did not provide a compatible default reasoning effort for the effective model; the task was not started.');
      effectiveEffort = model.defaultEffort;
    }
    return { modelId: model.id, reasoningEffort: effectiveEffort };
  }

  async setSessionModelConfig(sessionId, modelId, reasoningEffort) {
    if (this.activeTask) throw new Error('Model settings cannot be changed while a task is running. Wait for the turn to finish first.');
    await this.#resolveEffectiveModelConfig(modelId, reasoningEffort);
    const session = await this.store.setModelConfig(sessionId, modelId, reasoningEffort);
    const config = { modelId: session.modelId ?? null, reasoningEffort: session.reasoningEffort ?? null };
    this.emit('event', { type: 'session-updated', session: this.#summary(session, this.connectedThreads.has(session.codexThreadId)) });
    return config;
  }

  listSessions() {
    const health = this.store.health();
    let sessions = [];
    try { sessions = this.store.list().map(item => this.#summary(item)); }
    catch (error) { if (!health.error) throw error; }
    return { sessions, storage: health };
  }

  async createSession() {
    try {
      const session = await this.store.create(this.workspace.state().root);
      if (session.workspaceRoot) await this.projectStore.ensure(session.workspaceRoot);
      const summary = this.#summary(session);
      this.emit('event', { type: 'session-updated', session: summary });
      return { session, threadState: 'new', connectionError: null };
    } catch (error) { this._reportStorageError(error); throw error; }
  }

  async openSession(sessionId) {
    let session;
    try { session = this.store.get(sessionId); session.toolCatalogVersion ??= null; session.workspaceRoot ??= null; }
    catch (error) { throw error; }
    if (!session.workspaceRoot && session.codexThreadId && await this.#recoverWorkspaceRoot(sessionId)) session = this.store.get(sessionId);
    let threadState = session.codexThreadId ? (this.connectedThreads.has(session.codexThreadId) ? 'connected' : 'history') : 'new';
    let connectionError = null;
    const activeWorkspaceRoot = this.workspace.state().root;
    if (session.codexThreadId && (!session.workspaceRoot || session.workspaceRoot !== activeWorkspaceRoot)) {
      connectionError = '此会话所属项目与当前工作区不同，仅显示本地历史记录。请切换到对应项目后继续。';
      threadState = 'history';
    } else if (session.codexThreadId && !this.activeTask && this.status.status === 'ready') {
      const operation = this.activationQueue.then(async () => {
        if (this.activeTask) return false;
        await this.driver.resumeThread(session.codexThreadId, session.workspaceRoot);
        this.connectedThreads.add(session.codexThreadId);
        return true;
      });
      this.activationQueue = operation.catch(() => false);
      try { if (await operation) threadState = 'connected'; }
      catch (error) { connectionError = error instanceof Error ? error.message : String(error); threadState = 'history'; }
    } else if (session.codexThreadId && this.status.status !== 'ready') {
      connectionError = this.status.error || 'Codex is not connected; showing local history only.';
    }
    return { session, threadState, connectionError };
  }

  async submit(sessionId, text) {
    if (typeof sessionId !== 'string') throw new Error('Choose a conversation before sending a message.');
    if (typeof text !== 'string' || !text.trim()) throw new Error('请输入任务内容。');
    if (text.length > MAX_PROMPT_LENGTH) throw new Error(`任务内容不能超过 ${MAX_PROMPT_LENGTH} 个字符。`);
    const workspaceState = this.workspace.state();
    if (!workspaceState.root) throw new Error('Choose an authorized workspace before starting an Agent task.');
    await this.activationQueue;
    if (this.status.status !== 'ready') throw new Error(this.status.error || 'Codex 尚未连接，请稍后重试。');
    if (this.activeTask) throw new Error('当前已有任务运行，请等待完成或先取消。');
    const session = this.store.get(sessionId);
    if (session.workspaceRoot !== workspaceState.root) throw new Error('此会话属于其他项目或尚未关联项目。请切换到对应工作区，或新建会话后继续。');
    if (session.codexThreadId && session.toolCatalogVersion !== TOOL_CATALOG_VERSION) throw new Error('This saved Codex thread predates Vantilo workspace tools. Create a new conversation to enable them.');
    const task = { id: randomUUID(), sessionId, turnId: null, status: 'running', assistantText: '', assistantMessageId: null, eventChain: Promise.resolve(), terminalQueued: false, abortController: new AbortController(), workspaceRevision: workspaceState.revision };
    this.activeTask = task;
    let modelConfig;
    try { modelConfig = await this.#resolveEffectiveModelConfig(session.modelId ?? null, session.reasoningEffort ?? null); }
    catch (error) { if (this.activeTask?.id === task.id) this.activeTask = null; throw error; }
    let turn;
    try { turn = await this.store.addTurn(sessionId, task.id, text.trim()); }
    catch (error) { this.activeTask = null; this._reportStorageError(error); throw error; }
    task.assistantMessageId = turn.assistantMessage.id;
    const summary = this.#summary(turn.session, session.codexThreadId === this.driver.threadId);
    this.emit('event', { type: 'session-updated', session: summary });
    this.emit('event', {
      type: 'task-started', taskId: task.id, sessionId, text: turn.userMessage.text, status: 'running',
      userMessage: turn.userMessage, assistantMessage: turn.assistantMessage
    });
    this.driver.startTurn(text.trim(), session.codexThreadId, { dynamicTools: this.toolCatalog.dynamicTools(), workspaceRoot: workspaceState.root, model: modelConfig.modelId, effort: modelConfig.reasoningEffort }).then(async ({ threadId, turnId }) => {
      if (threadId) {
        try { await this.store.setCodexThread(sessionId, threadId, TOOL_CATALOG_VERSION); }
        catch (error) { this._storageFailure(task, error); return; }
        this.connectedThreads.add(threadId);
        this.emit('event', { type: 'session-updated', session: this.#summary(this.store.get(sessionId), true) });
      }
      if (this.activeTask?.id === task.id) task.turnId = turnId || task.turnId;
    }).catch(error => this._finish(task.id, 'failed', error.message));
    return { taskId: task.id, sessionId };
  }

  _onDelta(delta) {
    const task = this.activeTask;
    if (!task || task.terminalQueued || (delta.turnId && task.turnId && delta.turnId !== task.turnId)) return;
    task.assistantText += delta.delta;
    task.eventChain = task.eventChain.then(async () => {
      const updated = await this.store.updateAssistant(task.sessionId, task.assistantMessageId, task.assistantText);
      this.emit('event', { type: 'message-delta', taskId: task.id, sessionId: task.sessionId, messageId: updated.message.id, delta: delta.delta });
      this.emit('event', { type: 'session-updated', session: this.#summary(updated.session, true) });
    }).catch(error => this._storageFailure(task, error));
  }

  _finish(taskId, status, error = null) {
    const task = this.activeTask;
    if (!task || task.id !== taskId || task.terminalQueued) return;
    task.terminalQueued = true;
    task.abortController.abort();
    this.approvals.rejectTask(taskId, 'cancelled');
    task.eventChain = task.eventChain.then(async () => {
      const messageStatus = status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed';
      const updated = await this.store.updateAssistant(task.sessionId, task.assistantMessageId, task.assistantText, messageStatus, error);
      this.emit('event', { type: 'message-status', taskId, sessionId: task.sessionId, record: updated.message });
      this.emit('event', { type: 'session-updated', session: this.#summary(updated.session, true) });
      this.emit('event', { type: 'task-status', taskId, sessionId: task.sessionId, status, error: error || null });
      if (this.activeTask?.id === taskId) this.activeTask = null;
    }).catch(storageError => {
      this._reportStorageError(storageError);
      this.emit('event', { type: 'task-status', taskId, sessionId: task.sessionId, status: 'failed', error: `Conversation could not be saved: ${storageError.message}` });
      if (this.activeTask?.id === taskId) this.activeTask = null;
    });
  }

  _storageFailure(task, error) {
    if (this.activeTask?.id !== task.id) return;
    this._reportStorageError(error);
    void this.driver.cancelTurn().catch(() => {});
    this._finish(task.id, 'failed', `Conversation could not be saved: ${error.message}`);
  }

  _reportStorageError(error) {
    const message = error instanceof Error ? error.message : String(error);
    this.emit('event', { type: 'storage-error', message });
  }

  #summary(session, connected = false) {
    return {
      id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt,
      codexThreadId: session.codexThreadId, toolCatalogVersion: session.toolCatalogVersion ?? null, modelId: session.modelId ?? null, reasoningEffort: session.reasoningEffort ?? null, workspaceRoot: session.workspaceRoot ?? null, pinned: session.pinned ?? false, messageCount: session.messageCount ?? session.messages.length,
      preview: session.preview ?? session.messages.at(-1)?.text.replace(/\s+/g, ' ').slice(0, 120) ?? '',
      threadState: session.codexThreadId ? (connected || this.connectedThreads.has(session.codexThreadId) ? 'connected' : 'history') : 'new'
    };
  }

  getSessionMenuState(sessionId) {
    const session = this.store.get(sessionId);
    return { sessionId, title: session.title, pinned: session.pinned ?? false, hasCodexThread: Boolean(session.codexThreadId), canDelete: this.activeTask?.sessionId !== sessionId };
  }

  async renameSession(sessionId, title) {
    const session = await this.store.rename(sessionId, title);
    this.emit('event', { type: 'session-updated', session: this.#summary(session, this.connectedThreads.has(session.codexThreadId)) });
    return this.#summary(session, this.connectedThreads.has(session.codexThreadId));
  }

  async setSessionPinned(sessionId, pinned) {
    const session = await this.store.setPinned(sessionId, pinned);
    this.emit('event', { type: 'session-updated', session: this.#summary(session, this.connectedThreads.has(session.codexThreadId)) });
    return this.#summary(session, this.connectedThreads.has(session.codexThreadId));
  }

  async deleteSession(sessionId) {
    if (this.activeTask?.sessionId === sessionId) throw new Error('当前会话正在运行任务，请先取消或等待任务完成后再删除。');
    const session = this.store.get(sessionId);
    if (session.codexThreadId) {
      if (typeof this.driver.deleteThread !== 'function') throw new Error('当前 Codex Runtime 不支持永久删除线程；会话记录未删除。');
      await this.driver.deleteThread(session.codexThreadId);
      this.connectedThreads.delete(session.codexThreadId);
    }
    await this.store.delete(sessionId);
    return { sessionId };
  }

  getWorkspace() { return this.workspace.state(); }
  validateWorkspaceReferences(selectedPaths) { return this.workspace.validateReferences(selectedPaths); }

  listProjects() { return this.projectStore.list(); }

  async resolveKnownProjectPath(requestedPath) {
    if (typeof requestedPath !== 'string' || !path.isAbsolute(requestedPath)) throw new Error('Choose a known project folder.');
    const project = this.projectStore.get(requestedPath);
    if (!project || project.removed) throw new Error('This folder is not an active Vantilo project.');
    return {
      path: await this.workspace.canonicalizeDirectory(requestedPath), pinned: project.pinned,
      active: this.workspace.state().root === requestedPath, canRemove: !(this.activeTask && this.workspace.state().root === requestedPath)
    };
  }

  async setProjectPinned(projectPath, pinned) {
    await this.projectStore.setPinned(projectPath, pinned);
    const projects = this.projectStore.list();
    this.emit('event', { type: 'projects-updated', projects });
    return projects;
  }

  async removeProject(projectPath) {
    const currentRoot = this.workspace.state().root;
    if (this.activeTask && currentRoot === projectPath) throw new Error('当前项目有任务正在运行，暂不能移除。');
    const project = this.projectStore.get(projectPath);
    if (!project || project.removed) throw new Error('This folder is not an active Vantilo project.');
    let workspace = this.workspace.state();
    if (currentRoot === projectPath) workspace = await this.workspace.clearWorkspace();
    try { await this.projectStore.remove(projectPath); }
    catch (error) {
      if (currentRoot === projectPath) await this.workspace.setWorkspace(projectPath).catch(() => {});
      throw error;
    }
    const projects = this.projectStore.list();
    this.emit('event', { type: 'projects-updated', projects });
    if (currentRoot === projectPath) this.emit('event', { type: 'workspace-updated', workspace });
    return { projects, workspace };
  }

  async setWorkspace(workspacePath) {
    if (this.activeTask) throw new Error('Cancel or finish the current task before changing workspace authorization.');
    const state = await this.workspace.setWorkspace(workspacePath);
    await this.projectStore.register(state.root);
    this.emit('event', { type: 'projects-updated', projects: this.projectStore.list() });
    this.emit('event', { type: 'workspace-updated', workspace: state });
    return state;
  }

  async clearWorkspace() {
    if (this.activeTask) throw new Error('Cancel or finish the current task before clearing workspace authorization.');
    const state = await this.workspace.clearWorkspace();
    this.emit('event', { type: 'workspace-updated', workspace: state });
    return state;
  }

  resolveToolApproval(input) {
    const task = this.activeTask;
    if (!task || task.id !== input.taskId || task.sessionId !== input.sessionId) throw new Error('Approval request does not belong to the active task and session.');
    const request = this.approvals.listPending().find(item => item.approvalId === input.approvalId);
    if (!request || request.workspaceRevision !== this.workspace.state().revision || request.workspaceRoot !== this.workspace.state().root) {
      if (request) this.approvals.rejectTask(request.taskId);
      throw new Error('Approval request expired or its workspace authorization changed.');
    }
    return this.approvals.decide(input);
  }

  async cancel(taskId) {
    const task = this.activeTask;
    if (!task || task.id !== taskId) throw new Error('该任务不存在或已经结束。');
    if (task.status === 'cancelling') return { taskId, status: 'cancelling' };
    task.status = 'cancelling';
    task.abortController.abort();
    this.approvals.rejectTask(taskId);
    this.emit('event', { type: 'task-status', taskId, sessionId: task.sessionId, status: 'cancelling', message: '正在取消任务…' });
    try { await this.driver.cancelTurn(); return { taskId, status: 'cancelling' }; }
    catch (error) { if (this.activeTask?.id === taskId) task.status = 'running'; throw error; }
  }

  async _handleToolCall(call) {
    const task = this.activeTask;
    const deny = (code, message) => ({ success: false, contentItems: [{ type: 'inputText', text: JSON.stringify({ ok: false, error: { code, message } }) }] });
    if (!task || task.terminalQueued || task.abortController.signal.aborted) return deny('task_ended', 'The task is no longer active.');
    if (call.threadId !== this.driver.threadId || (task.turnId && call.turnId !== task.turnId)) return deny('request_mismatch', 'The tool request does not match the active Codex turn.');
    if (call.namespace !== null) return deny('tool_not_allowed', 'Only the published Vantilo workspace tools are available.');
    let prepared;
    try { prepared = this.toolCatalog.validateCall(call.tool, call.arguments); }
    catch (error) { return deny(error.code || 'invalid_input', error.message); }
    const workspace = this.workspace.state();
    if (!workspace.root || workspace.revision !== task.workspaceRevision) return deny('workspace_unavailable', 'The authorized workspace changed or is unavailable.');
    const operation = call.tool === 'read_workspace_file' ? 'read' : 'list';
    const relativePath = prepared.input.path || '.';
    let approval;
    try {
      approval = this.approvals.request({
        serverRequestId: call.requestId, callId: call.callId, sessionId: task.sessionId, taskId: task.id,
        threadId: call.threadId, turnId: call.turnId, toolName: call.tool, reason: prepared.input.reason,
        relativePath, operation, workspaceRoot: workspace.root, workspaceRevision: workspace.revision
      });
    } catch (error) { return deny('approval_unavailable', error.message); }
    const decision = await approval;
    if (decision.status !== 'approved') {
      this.emit('event', { type: 'tool-execution', approvalId: decision.approvalId, sessionId: task.sessionId, taskId: task.id, toolName: call.tool, stage: 'denied', summary: `${call.tool} was not executed.`, error: decision.status === 'expired' ? 'Approval expired.' : decision.status === 'rejected' ? 'User rejected the request.' : 'The task ended before approval.' });
      return deny(decision.status, decision.status === 'rejected' ? 'The user rejected this read-only workspace request.' : 'This approval request expired or was cancelled.');
    }
    if (this.activeTask?.id !== task.id || task.abortController.signal.aborted || this.workspace.state().revision !== workspace.revision) return deny('cancelled', 'The task or workspace authorization changed before execution.');
    const approvalId = decision.approvalId;
    this.emit('event', { type: 'tool-execution', approvalId, sessionId: task.sessionId, taskId: task.id, toolName: call.tool, stage: 'started', summary: `${call.tool}: ${relativePath}`, error: null });
    try {
      const result = await this.toolCatalog.execute(call.tool, prepared.input, { signal: task.abortController.signal });
      if (this.activeTask?.id !== task.id || task.abortController.signal.aborted) return deny('cancelled', 'The task was cancelled during tool execution.');
      const summary = call.tool === 'list_workspace_files' ? `Listed ${result.data.files.length} file(s) under ${result.data.directory}.` : `Read ${result.data.bytes} byte(s) from ${result.data.path}.`;
      this.emit('event', { type: 'tool-execution', approvalId, sessionId: task.sessionId, taskId: task.id, toolName: call.tool, stage: 'completed', summary, error: null });
      return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(result) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workspace tool failed.';
      this.emit('event', { type: 'tool-execution', approvalId, sessionId: task.sessionId, taskId: task.id, toolName: call.tool, stage: 'failed', summary: `${call.tool} failed.`, error: message });
      return deny(error.code || 'tool_error', message);
    }
  }


  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.approvals.rejectAll('cancelled');
    const task = this.activeTask;
    if (task) this._finish(task.id, 'cancelled', 'Vantilo 正在退出。');
    await task?.eventChain;
    await this.driver.close();
    await this.store.flush();
    this.status = { status: 'stopped' }; this.emit('status', this.status);
  }
}

module.exports = { AgentRuntime, MAX_PROMPT_LENGTH };
