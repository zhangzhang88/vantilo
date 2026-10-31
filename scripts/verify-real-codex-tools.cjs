#!/usr/bin/env node
require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();
// Opt-in integration check. Uses the locally installed Codex app-server and existing authentication without editing Codex configuration.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AgentRuntime } = require('../electron/runtime.cjs');
const { selectModelSwitchPair, assertCatalogDefaultTask, assertRestoredThreadFollowUp, assertReportedModelSwitch, assertStreamedTaskReply } = require('./model-switch-assertions.cjs');
const { cleanupRealCodexE2E } = require('./real-codex-cleanup.cjs');
const { ProjectStore } = require('../electron/project-store.cjs');
const { SessionStore } = require('../electron/session-store.cjs');
const { WorkspaceAuthority } = require('../electron/workspace.cjs');

const TIMEOUT_MS = Number(process.env.VANTILO_E2E_TIMEOUT_MS || 180000);
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};
const waitForTask = async (events, taskId) => {
  await waitFor(() => events.some(event => event.type === 'task-status' && event.taskId === taskId && ['completed', 'failed', 'cancelled'].includes(event.status)), `task ${taskId}`);
  return events.findLast(event => event.type === 'task-status' && event.taskId === taskId);
};
const captureModelRequests = (driver, records) => {
  const original = driver.request.bind(driver);
  driver.request = async (method, params, ...rest) => {
    try {
      const result = await original(method, params, ...rest);
      if (['thread/start', 'thread/resume', 'turn/start'].includes(method)) records.push({
        method, requestedModel: params?.model ?? null, effort: params?.effort ?? null,
        effectiveModel: result?.model ?? null, effectiveEffort: result?.reasoningEffort ?? null,
        threadId: params?.threadId ?? result?.thread?.id ?? null, responseThreadId: result?.thread?.id ?? null, error: null
      });
      return result;
    } catch (error) {
      if (['thread/start', 'thread/resume', 'turn/start'].includes(method)) records.push({
        method, requestedModel: params?.model ?? null, effort: params?.effort ?? null,
        effectiveModel: null, effectiveEffort: null, threadId: params?.threadId ?? null, responseThreadId: null,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  };
};
const captureModelCatalogs = (driver, records) => {
  const original = driver.listModels.bind(driver);
  driver.listModels = async (...args) => {
    try {
      const models = await original(...args);
      records.push(models.map(model => ({ id: model.id, isDefault: model.isDefault, defaultEffort: model.defaultEffort, efforts: model.efforts.map(item => item.id) })));
      return models;
    } catch (error) {
      records.push({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
};

(async () => {
  let base;
  let root;
  let workspace;
  let store;
  let projectStore;
  let runtime;
  let primaryError = null;
  const events = [];
  let actualReads = 0;
  let rejectNextApproval = false;
  const initializeRuntime = async (selectWorkspace = false) => {
    workspace = new WorkspaceAuthority({ userDataPath: path.join(base, 'user-data') });
    if (selectWorkspace) await workspace.setWorkspace(root);
    store = new SessionStore({ filePath: path.join(base, 'user-data', 'sessions.json') });
    projectStore = new ProjectStore({ filePath: path.join(base, 'user-data', 'projects.json') });
    runtime = new AgentRuntime({ store, workspace, projectStore });
    runtime.on('event', event => {
    events.push(event);
    if (event.type !== 'tool-approval-requested') return;
    const reject = rejectNextApproval;
    if (reject) rejectNextApproval = false;
    const approve = !reject && ((event.toolName === 'list_workspace_files' && event.relativePath === '.') ||
      (event.toolName === 'read_workspace_file' && event.relativePath === 'approved.txt'));
    try {
      runtime.resolveToolApproval({ approvalId: event.approvalId, sessionId: event.sessionId, taskId: event.taskId, decision: approve ? 'approved' : 'rejected' });
    } catch { /* stale approvals are expected to fail closed */ }
    });
    const originalRead = workspace.openReadOnly.bind(workspace);
    workspace.openReadOnly = (...args) => { actualReads++; return originalRead(...args); };
  };
  const outcomes = [];

  try {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'vantilo-real-codex-tools-'));
    root = path.join(base, 'authorized-workspace');
    await fs.mkdir(root);
    const knownText = 'violet-orbit-47';
    await fs.writeFile(path.join(root, 'approved.txt'), `Integration fixture: ${knownText}\n`, { mode: 0o600 });
    await initializeRuntime(true);
    await runtime.start();
    await waitFor(() => runtime.getStatus().status === 'ready' || runtime.getStatus().status === 'error', 'Codex app-server startup');
    if (runtime.getStatus().status !== 'ready') throw new Error(`Codex app-server could not start: ${runtime.getStatus().error}`);

    const catalog = await runtime.listModels();
    const { selectedModel } = selectModelSwitchPair(catalog.models);
    const selectedEffort = selectedModel.defaultEffort && selectedModel.efforts.some(item => item.id === selectedModel.defaultEffort)
      ? selectedModel.defaultEffort
      : selectedModel.efforts[0]?.id ?? null;
    const listing = await runtime.createSession();
    await runtime.setSessionModelConfig(listing.session.id, selectedModel.id, selectedEffort);
    const protocolRequests = [];
    captureModelRequests(runtime.driver, protocolRequests);
    const listStart = events.length;
    const listed = await runtime.submit(listing.session.id, 'Use list_workspace_files on the workspace root to find the available project files. Do not claim to inspect anything you did not receive from the tool.');
    const listStatus = await waitForTask(events, listed.taskId);
    const listEvents = events.slice(listStart);
    const listApproval = listEvents.find(event => event.type === 'tool-approval-requested' && event.toolName === 'list_workspace_files');
    if (!listApproval || !listEvents.some(event => event.type === 'tool-execution' && event.toolName === 'list_workspace_files' && event.stage === 'completed')) throw new Error('Codex did not complete the approved real list_workspace_files call.');
    if (listStatus.status !== 'completed') throw new Error('Codex listing task did not complete successfully.');
    if (!protocolRequests.some(request => request.method === 'thread/start' && request.requestedModel === selectedModel.id && request.effectiveModel === selectedModel.id) || !protocolRequests.some(request => request.method === 'turn/start' && request.requestedModel === selectedModel.id && request.effort === selectedEffort)) throw new Error('Codex did not report the requested effective model for the new thread and receive the selected model/effort on turn/start.');
    outcomes.push(`real model settings: thread/start reported ${selectedModel.id}; turn/start received ${selectedModel.id} / ${selectedEffort || 'model default'}`);
    const originalThreadId = store.get(listing.session.id).codexThreadId;
    const defaultCatalogCalls = [];
    captureModelCatalogs(runtime.driver, defaultCatalogCalls);
    const resetRequestOffset = protocolRequests.length;
    await runtime.setSessionModelConfig(listing.session.id, null, null);
    if (store.get(listing.session.id).modelId !== null || store.get(listing.session.id).reasoningEffort !== null) throw new Error('Restoring model-catalog defaults changed the session’s persisted null settings.');
    const catalogCountBeforeTask = defaultCatalogCalls.length;
    const defaultTaskEventStart = events.length;
    const defaultTask = await runtime.submit(listing.session.id, 'Reply with exactly VANTILO_DEFAULT_MODEL_RESTORED and do not call tools.');
    const catalogsDuringTask = defaultCatalogCalls.slice(catalogCountBeforeTask);
    const taskCatalog = catalogsDuringTask.at(-1);
    if (!Array.isArray(taskCatalog)) throw new Error(`Could not identify the model/list result used to resolve the return task: ${JSON.stringify(catalogsDuringTask)}.`);
    const { defaultModel } = selectModelSwitchPair(taskCatalog);
    if (defaultModel.id === selectedModel.id) throw new Error(`Model-switch E2E precondition failed: model A ${selectedModel.id} was the task's live catalog default; no model switch could be verified.`);
    if (taskCatalog.filter(model => model.id === selectedModel.id).length !== 1) throw new Error(`Model-switch E2E precondition failed: model A ${selectedModel.id} was not uniquely available in the task's live catalog.`);
    if (defaultModel.efforts.length > 0 && (!defaultModel.defaultEffort || !defaultModel.efforts.includes(defaultModel.defaultEffort))) throw new Error(`Task catalog provided no compatible defaultReasoningEffort for ${defaultModel.id}: ${JSON.stringify(defaultModel)}.`);
    const defaultEffort = defaultModel.defaultEffort;
    const defaultStatus = await waitForTask(events, defaultTask.taskId);
    assertStreamedTaskReply({
      events: events.slice(defaultTaskEventStart), taskStatus: defaultStatus.status,
      taskId: defaultTask.taskId, sessionId: listing.session.id,
      messages: store.get(listing.session.id).messages, expectedText: 'VANTILO_DEFAULT_MODEL_RESTORED'
    });
    const defaultRequests = protocolRequests.slice(resetRequestOffset);
    const defaultTurn = defaultRequests.find(request => request.method === 'turn/start');
    assertCatalogDefaultTask({
      taskStatus: defaultStatus.status, taskError: defaultStatus.error, turn: defaultTurn,
      defaultModelId: defaultModel.id, defaultEffort, expectedThreadId: originalThreadId,
      storedThreadId: store.get(listing.session.id).codexThreadId,
      threadStarts: defaultRequests.filter(request => request.method === 'thread/start').length,
      redundantResumes: defaultRequests.filter(request => request.method === 'thread/resume').length,
      modelAId: selectedModel.id, modelAEffort: selectedEffort,
      modelAStart: protocolRequests.find(request => request.method === 'thread/start'),
      modelATurn: protocolRequests.find(request => request.method === 'turn/start')
    });
    assertReportedModelSwitch(protocolRequests, { modelAId: selectedModel.id, modelAEffort: selectedEffort, defaultModelId: defaultModel.id, defaultEffort, threadId: originalThreadId });
    outcomes.push(`catalog default: persisted model/effort stayed null; thread/start reported model A ${selectedModel.id}; the task completed on the same thread with turn/start model ${defaultModel.id} and catalog defaultReasoningEffort ${defaultEffort || 'no effort override'}`);
    outcomes.push('approved list_workspace_files: real Codex request, user approval, and workspace listing verified');

    const reading = await runtime.createSession();
    const readsBefore = actualReads;
    const readStart = events.length;
    const readTask = await runtime.submit(reading.session.id, 'Call read_workspace_file for the workspace-relative path approved.txt, then report the exact unique phrase in the file. Do not guess or answer without using the tool.');
    const readStatus = await waitForTask(events, readTask.taskId);
    const readEvents = events.slice(readStart);
    if (!readEvents.some(event => event.type === 'tool-approval-requested' && event.taskId === readTask.taskId && event.toolName === 'read_workspace_file' && event.relativePath === 'approved.txt')) throw new Error('Codex did not request the real approved.txt read.');
    if (!readEvents.some(event => event.type === 'tool-approval-resolved' && event.taskId === readTask.taskId && event.status === 'approved')) throw new Error('The initial real read approval was not resolved as approved.');
    if (!readEvents.some(event => event.type === 'tool-execution' && event.taskId === readTask.taskId && event.toolName === 'read_workspace_file' && event.stage === 'completed')) throw new Error('The approved real read_workspace_file call did not complete.');
    if (actualReads !== readsBefore + 1) throw new Error('The approved read did not perform exactly one workspace file read.');
    if (readStatus.status !== 'completed') throw new Error('Codex read task did not complete successfully.');
    const readingThreadId = store.get(reading.session.id).codexThreadId;
    const lastReadingTurn = protocolRequests.filter(request => request.method === 'turn/start' && request.threadId === readingThreadId).at(-1);
    if (!readingThreadId || !lastReadingTurn) throw new Error('Could not identify the reading session thread and its last Codex turn before Runtime restart.');
    await runtime.setSessionModelConfig(reading.session.id, selectedModel.id, selectedEffort);
    const readTranscript = store.get(reading.session.id).messages.map(message => message.text).join('\n');
    if (!readTranscript.includes(knownText)) throw new Error('Codex did not return the actual text read from the approved workspace file.');
    outcomes.push('approved read_workspace_file: real Codex request, one-time approval, bounded file read, and tool completion verified');

    await runtime.stop();
    events.length = 0;
    await initializeRuntime();
    await runtime.start();
    await waitFor(() => runtime.getStatus().status === 'ready' || runtime.getStatus().status === 'error', 'Codex app-server restart');
    if (runtime.getStatus().status !== 'ready') throw new Error(`Codex app-server did not restart: ${runtime.getStatus().error}`);
    const resumedProtocolRequests = [];
    captureModelRequests(runtime.driver, resumedProtocolRequests);
    const restored = await runtime.openSession(reading.session.id);
    if (restored.threadState !== 'connected') throw new Error(`Saved Codex thread did not reconnect: ${restored.connectionError || restored.threadState}`);
    if (restored.session.modelId !== selectedModel.id || restored.session.reasoningEffort !== selectedEffort) throw new Error('The saved session model configuration did not survive Runtime/Codex restart.');
    const resumedReadStart = events.length;
    const resumedTask = await runtime.submit(reading.session.id, 'Use read_workspace_file on approved.txt and report the exact phrase from the file.');
    const resumedStatus = await waitForTask(events, resumedTask.taskId);
    const resumedEvents = events.slice(resumedReadStart);
    if (!resumedEvents.some(event => event.type === 'tool-approval-resolved' && event.taskId === resumedTask.taskId && event.status === 'approved')) throw new Error('The restored-thread read approval was not resolved as approved.');
    if (!resumedEvents.some(event => event.type === 'tool-execution' && event.taskId === resumedTask.taskId && event.toolName === 'read_workspace_file' && event.stage === 'completed')) throw new Error('The restored Codex thread did not complete a workspace tool call.');
    if (resumedStatus.status !== 'completed' || actualReads !== readsBefore + 2) throw new Error('Workspace tool execution did not remain authorized after Codex thread recovery.');
    const restoredResume = resumedProtocolRequests.find(request => request.method === 'thread/resume');
    const restoredTurn = resumedProtocolRequests.find(request => request.method === 'turn/start');
    assertRestoredThreadFollowUp({
      taskStatus: resumedStatus.status, resume: restoredResume, turn: restoredTurn,
      expectedThreadId: readingThreadId, persistedThreadModel: lastReadingTurn.requestedModel,
      persistedThreadEffort: lastReadingTurn.effort, sessionModelId: selectedModel.id, sessionEffort: selectedEffort
    });
    outcomes.push('restored thread settings: Codex reported the persisted model on thread/resume and received model/effort on the real turn/start after Runtime/Codex restart');
    outcomes.push('restored thread: after Runtime/Codex restart, the saved thread reconnected and completed a newly approved real file read');

    const rejectedStart = events.length;
    rejectNextApproval = true;
    const rejectedTask = await runtime.submit(reading.session.id, 'Call read_workspace_file for the workspace-relative path approved.txt and report its contents.');
    const rejectedStatus = await waitForTask(events, rejectedTask.taskId);
    const rejectedEvents = events.slice(rejectedStart);
    const rejectedRequest = rejectedEvents.find(event => event.type === 'tool-approval-requested' && event.taskId === rejectedTask.taskId);
    if (!rejectedRequest || rejectedRequest.toolName !== 'read_workspace_file' || rejectedRequest.relativePath !== 'approved.txt') throw new Error('Codex did not make the real approved.txt request used by the rejection check.');
    if (!rejectedEvents.some(event => event.type === 'tool-approval-resolved' && event.taskId === rejectedTask.taskId && event.status === 'rejected')) throw new Error('The final real read approval was not resolved as rejected.');
    if (!rejectedEvents.some(event => event.type === 'tool-execution' && event.taskId === rejectedTask.taskId && event.toolName === 'read_workspace_file' && event.stage === 'denied')) throw new Error('The rejected tool request was not recorded as denied.');
    if (actualReads !== readsBefore + 2) throw new Error('A rejected request reached the workspace file reader.');
    if (!['completed', 'failed'].includes(rejectedStatus.status)) throw new Error('Rejected Codex task ended in an unexpected state.');

    const allProtocolRequests = [...protocolRequests, ...resumedProtocolRequests];
    const threadStarts = allProtocolRequests.filter(request => request.method === 'thread/start');
    const threadIds = threadStarts.map(request => request.responseThreadId ?? request.threadId);
    const turnStarts = allProtocolRequests.filter(request => request.method === 'turn/start');
    if (threadStarts.length !== 2 || new Set(threadIds).size !== 2 || !threadIds.includes(originalThreadId) || !threadIds.includes(readingThreadId)) {
      throw new Error(`Expected exactly two unique Codex threads (model-switch and read/recovery/rejection), observed ${threadStarts.length} starts.`);
    }
    if (turnStarts.length !== 5) throw new Error(`Expected five Codex turn/start requests across the two threads, observed ${turnStarts.length}.`);
    outcomes.push('rejected read_workspace_file: actual Codex request denied, no workspace read performed');
    outcomes.push('remote side-effect budget: exactly two Codex threads and five turn/start requests');

    for (const outcome of outcomes) console.log(`PASS ${outcome}`);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors = await cleanupRealCodexE2E(runtime, base);
    for (const error of cleanupErrors) console.error('CLEANUP', error);
    if (!primaryError && cleanupErrors.length > 0) throw cleanupErrors[0];
  }
})().catch(error => {
  console.error('FAIL', error);
  process.exitCode = 1;
});
