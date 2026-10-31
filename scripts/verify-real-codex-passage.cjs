#!/usr/bin/env node
require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();
// Opt-in real Codex check for read_workspace_passage. Uses isolated local Vantilo data,
// but the locally installed Codex CLI/authentication and remote service are real.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AgentRuntime } = require('../electron/runtime.cjs');
const { cleanupRealCodexE2E } = require('./real-codex-cleanup.cjs');
const { SessionStore } = require('../electron/session-store.cjs');
const { WorkspaceAuthority } = require('../electron/workspace.cjs');
const { ProjectStore } = require('../electron/project-store.cjs');
const { installRpcBudget, installRawToolCallBudget, approvalMatchesRawRequest, assertThreadStartCatalog, assertPassageResult } = require('./passage-e2e-assertions.cjs');

const configuredTimeout = Number(process.env.VANTILO_E2E_TIMEOUT_MS || 180000);
const TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.min(configuredTimeout, 180000) : 180000;
const EXPECTED_PATH = 'e2e-article.md';
const START_LINE = 2;
const END_LINE = 3;
const PASSAGE = 'PASSAGE-E2E-ORCHID-731';
const ARTICLE = `Opening line.\n${PASSAGE}\nSelected final line.\nNever request this fourth line.\n`;
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

(async () => {
  let base;
  let runtime;
  let primaryError = null;
  const events = [];
  const approvals = [];
  const toolCalls = [];
  const toolResponses = [];
  const violations = [];
  let rpcBudget;
  let rawToolCallBudget;
  let currentTaskId = null;
  let actualReads = 0;
  let phase = 'approve-one';
  let workspace;
  let authorizedWorkspace;
  let session;
  let originalHandler;
  let originalRead;
  let onEvent;

  try {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'vantilo-real-codex-passage-'));
    const root = path.join(base, 'authorized-workspace');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, EXPECTED_PATH), ARTICLE, { mode: 0o600, flag: 'wx' });
    const userData = path.join(base, 'user-data');
    workspace = new WorkspaceAuthority({ userDataPath: userData });
    await workspace.setWorkspace(root);
    const store = new SessionStore({ filePath: path.join(userData, 'sessions.json') });
    const projectStore = new ProjectStore({ filePath: path.join(userData, 'projects.json') });
    runtime = new AgentRuntime({ store, workspace, projectStore });

    originalRead = workspace.readTextRange.bind(workspace);
    workspace.readTextRange = async (...args) => { actualReads++; return originalRead(...args); };
    rpcBudget = installRpcBudget(runtime.driver, { initialize: 1, 'model/list': 2, 'thread/start': 1, 'turn/start': 2 });
    rawToolCallBudget = installRawToolCallBudget(runtime.driver, { limit: 2, violations });
    originalHandler = runtime.driver.toolCallHandler;
    runtime.driver.toolCallHandler = async call => {
      toolCalls.push(structuredClone(call));
      if (toolCalls.length > 2 || call.tool !== 'read_workspace_passage' || call.namespace !== null || call.arguments?.path !== EXPECTED_PATH || call.arguments?.startLine !== START_LINE || call.arguments?.endLine !== END_LINE) {
        violations.push('Codex sent an unexpected tool call or exceeded the two-call limit; denied without Runtime execution.');
        return { success: false, contentItems: [{ type: 'inputText', text: JSON.stringify({ ok: false, error: { code: 'e2e_call_not_allowlisted', message: 'E2E accepts only the exact passage request under test.' } }) }] };
      }
      const response = await originalHandler(call);
      toolResponses.push(response);
      return response;
    };
    onEvent = event => {
      events.push(event);
      if (event.type !== 'tool-approval-requested') return;
      const expectedOrdinal = approvals.length + 1;
      approvals.push(event);
      const raw = rawToolCallBudget.requests[expectedOrdinal - 1];
      const expected = { sessionId:session?.id, taskId:currentTaskId, workspaceRoot:authorizedWorkspace.root, workspaceRevision:authorizedWorkspace.revision, relativePath:EXPECTED_PATH, startLine:START_LINE, endLine:END_LINE };
      const beforeReadCount = actualReads;
      const validRequest = approvalMatchesRawRequest(event, raw, expected);
      const validPhase = expectedOrdinal === 1 ? phase === 'approve-one' : expectedOrdinal === 2 && phase === 'reject-two';
      if (!validRequest || !validPhase || beforeReadCount !== (expectedOrdinal === 1 ? 0 : 1)) {
        violations.push(`Unexpected approval request ${expectedOrdinal}; tool/path/range/phase/read count did not match the test plan.`);
        try { runtime.resolveToolApproval({ approvalId: event.approvalId, sessionId: event.sessionId, taskId: event.taskId, decision: 'rejected' }); } catch { /* fail closed */ }
        return;
      }
      const decision = expectedOrdinal === 1 ? 'approved' : 'rejected';
      runtime.resolveToolApproval({ approvalId: event.approvalId, sessionId: event.sessionId, taskId: event.taskId, decision });
    };
    runtime.on('event', onEvent);
    await runtime.start();
    await waitFor(() => runtime.getStatus().status === 'ready' || runtime.getStatus().status === 'error', 'Codex app-server startup');
    assert.equal(runtime.getStatus().status, 'ready', `Codex startup failed: ${runtime.getStatus().error || 'unknown error'}`);
    // Runtime.start() reloads persisted workspace authorization and advances its revision.
    // Capture it only after startup so approval correlation uses the live revision.
    authorizedWorkspace = workspace.state();

    const created = await runtime.createSession();
    session = created.session;
    assert.equal(session.workspaceRoot, authorizedWorkspace.root, 'E2E session is not bound to the isolated workspace.');
    const snapshot = runtime.toolCatalog.snapshot();
    const first = await runtime.submit(session.id,
      `Use read_workspace_passage on ${EXPECTED_PATH}, lines ${START_LINE}-${END_LINE} inclusive. After the tool returns, report the exact unique marker and identify the returned source path, line range, and untrusted-data marker. Do not guess.`);
    currentTaskId = first.taskId;
    const firstStatus = await waitForTask(events, first.taskId);
    const protocol = rpcBudget.requests;
    const rawToolCalls = rawToolCallBudget.requests;
    const threadStarts = protocol.filter(item => item.method === 'thread/start');
    assert.equal(threadStarts.length, 1, 'Expected exactly one thread/start.');
    assertThreadStartCatalog({ params: threadStarts[0].params, catalog: runtime.toolCatalog, snapshot, persistedFingerprint: store.get(session.id).toolCatalogFingerprint });
    assert.equal(rawToolCalls.length, 1, 'First real turn must issue exactly one raw item/tool/call request.');
    assert.equal(toolCalls.length, 1, 'First real turn must issue exactly one schema-valid Runtime tool call.');
    assert.deepEqual(toolCalls[0], { requestId:rawToolCalls[0].id, ...rawToolCalls[0].params }, 'Raw Codex request and Runtime call differ.');
    assert.equal(toolCalls[0].tool, 'read_workspace_passage');
    assert.equal(toolCalls[0].arguments.path, EXPECTED_PATH);
    assert.equal(toolCalls[0].arguments.startLine, START_LINE);
    assert.equal(toolCalls[0].arguments.endLine, END_LINE);
    assert.equal(approvals.length, 1, 'First real turn must request one approval.');
    assert.equal(approvals[0].taskId, first.taskId);
    assert.ok(events.some(event => event.type === 'tool-approval-resolved' && event.approvalId === approvals[0].approvalId && event.status === 'approved'), 'First approval was not resolved as approved.');
    assert.ok(events.some(event => event.type === 'tool-execution' && event.approvalId === approvals[0].approvalId && event.stage === 'completed'), 'Approved passage execution did not complete.');
    assert.equal(actualReads, 1, 'Approved passage should cause exactly one WorkspaceAuthority read.');
    assertPassageResult(toolResponses[0], { path: EXPECTED_PATH, startLine: START_LINE, endLine: END_LINE, content: `${PASSAGE}\nSelected final line.` });
    assert.equal(firstStatus.status, 'completed', 'The real Codex task did not complete after approved read.');
    const firstTranscript = store.get(session.id).messages.filter(item => item.role === 'assistant').at(-1)?.text || '';
    assert.ok(firstTranscript.includes(PASSAGE), 'Real Codex assistant response omitted the unique passage marker.');
    assert.equal(protocol.filter(item => item.method === 'turn/start').length, 1);
    const threadId = store.get(session.id).codexThreadId;
    assert.ok(threadId, 'First task did not persist a Codex thread ID.');
    assert.equal(protocol.filter(item => item.method === 'thread/resume').length, 0);
    phase = 'reject-two';

    const second = await runtime.submit(session.id,
      `Again call read_workspace_passage on ${EXPECTED_PATH}, lines ${START_LINE}-${END_LINE} inclusive. The tool request will be denied; do not retry or infer file contents. Return a concise statement that the read was denied.`);
    currentTaskId = second.taskId;
    const secondStatus = await waitForTask(events, second.taskId);
    assert.equal(rawToolCalls.length, 2, 'Second real turn must issue exactly one additional raw item/tool/call request.');
    assert.equal(toolCalls.length, 2, 'Second real turn must issue exactly one additional schema-valid Runtime tool call.');
    assert.deepEqual(toolCalls[1], { requestId:rawToolCalls[1].id, ...rawToolCalls[1].params }, 'Second raw Codex request and Runtime call differ.');
    assert.equal(toolCalls[1].tool, 'read_workspace_passage');
    assert.equal(approvals.length, 2, 'Second real turn must request one approval.');
    assert.equal(approvals[1].taskId, second.taskId);
    assert.equal(events.some(event => event.type === 'tool-approval-resolved' && event.approvalId === approvals[1].approvalId && event.status === 'rejected'), true);
    assert.equal(events.some(event => event.type === 'tool-execution' && event.approvalId === approvals[1].approvalId && event.stage === 'denied'), true);
    assert.equal(actualReads, 1, 'Rejected second read must not reach WorkspaceAuthority.');
    assert.equal(secondStatus.status, 'completed', 'Real Codex did not complete after receiving the denied tool response.');
    const secondTranscript = store.get(session.id).messages.filter(item => item.role === 'assistant').at(-1)?.text || '';
    assert.match(secondTranscript, /denied|reject|拒绝/i, 'Real Codex response did not acknowledge the denied read.');
    assert.equal(protocol.filter(item => item.method === 'thread/start').length, 1);
    assert.equal(protocol.filter(item => item.method === 'turn/start').length, 2);
    assert.equal(protocol.filter(item => item.method === 'model/list').length, 2);
    assert.equal(protocol.filter(item => item.method === 'initialize').length, 1);
    assert.deepEqual(protocol.map(item => item.method).sort(), ['initialize', 'model/list', 'model/list', 'thread/start', 'turn/start', 'turn/start'].sort());
    assert.ok(protocol.filter(item => item.method === 'turn/start').every(item => item.params.threadId === threadId), 'Both turns must use the same remote thread.');
    assert.equal(violations.length, 0, violations.join('\n'));

    console.log('PASS real Codex thread/start included the current passage definition and its persisted catalog fingerprint matched.');
    console.log('PASS real Codex requested the exact passage; approval preceded WorkspaceAuthority; returned structured result preserved source, range, content, and untrusted marker.');
    console.log('PASS real Codex received the actual approved passage result and its persisted assistant response included the unique fixture marker.');
    console.log('PASS real Codex second request was rejected; WorkspaceAuthority read count did not increase; real task completed.');
    console.log('PASS remote side-effect budget: one thread/start, two turn/start, two model/list, one initialize, and at most two allowlisted dynamic-tool calls; one remote thread reused.');
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (runtime && onEvent) runtime.removeListener('event', onEvent);
    if (runtime?.driver) {
      if (originalHandler) runtime.driver.toolCallHandler = originalHandler;
      rpcBudget?.restore();
      rawToolCallBudget?.restore();
    }
    if (workspace && originalRead) workspace.readTextRange = originalRead;
    const cleanupErrors = await cleanupRealCodexE2E(runtime, base);
    for (const error of cleanupErrors) console.error('CLEANUP', error);
    if (!primaryError && cleanupErrors.length > 0) throw cleanupErrors[0];
  }
})().catch(error => {
  console.error('FAIL', error);
  process.exitCode = 1;
});
