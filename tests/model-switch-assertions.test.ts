import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { selectModelSwitchPair, assertCatalogDefaultTask, assertRestoredThreadFollowUp, assertReportedModelSwitch, assertStreamedTaskReply } = require('../scripts/model-switch-assertions.cjs') as {
  selectModelSwitchPair: (models: Array<{ id: string; isDefault: boolean }>) => { defaultModel: { id: string; isDefault: boolean }; selectedModel: { id: string; isDefault: boolean } };
  assertCatalogDefaultTask: (input: Record<string, any>) => boolean;
  assertRestoredThreadFollowUp: (input: Record<string, any>) => boolean;
  assertReportedModelSwitch: (requests: Array<Record<string, unknown>>, expected: { modelAId: string; modelAEffort: string | null; defaultModelId: string; defaultEffort: string | null; threadId: string }) => boolean;
  assertStreamedTaskReply: (input: Record<string, any>) => boolean;
};

const catalog = [
  { id: 'model-a', isDefault: false },
  { id: 'model-default', isDefault: true },
];

describe('real Codex model-switch preconditions and assertions', () => {
  it('chooses a model distinct from the unique catalog default', () => {
    expect(selectModelSwitchPair(catalog)).toEqual({ defaultModel: catalog[1], selectedModel: catalog[0] });
  });

  it('fails clearly when the catalog default is missing or ambiguous', () => {
    expect(() => selectModelSwitchPair([{ id: 'model-a', isDefault: false }])).toThrow(/exactly one catalog default model, received 0/);
    expect(() => selectModelSwitchPair([...catalog, { id: 'other-default', isDefault: true }])).toThrow(/exactly one catalog default model, received 2/);
  });

  it('fails rather than claiming a switch when no unique non-default model exists', () => {
    expect(() => selectModelSwitchPair([{ id: 'only', isDefault: true }])).toThrow(/no uniquely selectable model differs from catalog default/);
    expect(() => selectModelSwitchPair([{ id: 'only', isDefault: true }, { id: 'other', isDefault: false }, { id: 'other', isDefault: false }])).toThrow(/no uniquely selectable model differs from catalog default/);
  });

  it('checks the return task, response/request models, catalog effort, and thread identity separately', () => {
    const input = {
      taskStatus: 'completed',
      turn: { threadId: 'thread-1', requestedModel: 'model-default', effort: 'low' },
      defaultModelId: 'model-default', defaultEffort: 'low', expectedThreadId: 'thread-1', storedThreadId: 'thread-1', threadStarts: 0, redundantResumes: 0,
    };
    expect(assertCatalogDefaultTask(input)).toBe(true);
    let diagnostic = '';
    try {
      assertCatalogDefaultTask({ ...input, taskStatus: 'failed', taskError: 'stale resume model', turn: { ...input.turn, effort: 'high' }, storedThreadId: 'replacement-thread', threadStarts: 1, redundantResumes: 1, modelAId: 'model-a', modelAEffort: 'high', modelAStart: { effectiveModel: 'model-a' }, modelATurn: { effort: 'high' } });
    } catch (error) { diagnostic = (error as Error).message; }
    expect(diagnostic).toContain('default task status: expected "completed", actual "failed" [FAIL]');
    expect(diagnostic).toContain('redundant thread/resume requests for already-loaded thread: expected 0, actual 1 [FAIL]');
    expect(diagnostic).toContain('turn/start effort from model/list defaultReasoningEffort: expected "low", actual "high" [FAIL]');
    expect(diagnostic).toContain('persisted thread ID: expected "thread-1", actual "replacement-thread" [FAIL]');
    expect(diagnostic).toContain('new thread/start requests during default task: expected 0, actual 1 [FAIL]');
    expect(diagnostic).toContain('Task error: stale resume model');
  });

  it('distinguishes the persisted Codex thread model from a newer Vantilo session override', () => {
    const input = {
      taskStatus: 'completed', expectedThreadId: 'thread-1', persistedThreadModel: 'model-a', persistedThreadEffort: 'low',
      sessionModelId: 'model-default', sessionEffort: 'high',
      resume: { threadId: 'thread-1', responseThreadId: 'thread-1', requestedModel: null, effectiveModel: 'model-a', effectiveEffort: 'low' },
      turn: { threadId: 'thread-1', requestedModel: 'model-default', effort: 'high' },
    };
    expect(assertRestoredThreadFollowUp(input)).toBe(true);
    expect(() => assertRestoredThreadFollowUp({ ...input, resume: { ...input.resume, effectiveModel: 'model-default' } })).toThrow(/thread\/resume reported persisted model: expected "model-a", actual "model-default"/);
    expect(() => assertRestoredThreadFollowUp({ ...input, turn: { ...input.turn, effort: 'low' } })).toThrow(/follow-up turn effort from Vantilo session settings: expected "high", actual "low"/);
  });

  it('requires the effective model A report and explicit default turn override on the same thread', () => {
    const requests = [
      { method: 'thread/start', requestedModel: 'model-a', effectiveModel: 'model-a', threadId: 'thread-1', responseThreadId: 'thread-1' },
      { method: 'turn/start', requestedModel: 'model-a', effort: 'high', threadId: 'thread-1' },
      { method: 'turn/start', requestedModel: 'model-default', effort: 'low', threadId: 'thread-1' },
    ];
    expect(assertReportedModelSwitch(requests, { modelAId: 'model-a', modelAEffort: 'high', defaultModelId: 'model-default', defaultEffort: 'low', threadId: 'thread-1' })).toBe(true);
    expect(() => assertReportedModelSwitch(requests.map((request, index) => index === 2 ? { ...request, requestedModel: 'model-a' } : request), { modelAId: 'model-a', modelAEffort: 'high', defaultModelId: 'model-default', defaultEffort: 'low', threadId: 'thread-1' })).toThrow(/Model-switch sequence verification failed/);
    expect(() => assertReportedModelSwitch(requests.map(request => ({ ...request, threadId: 'different-thread' })), { modelAId: 'model-a', modelAEffort: 'high', defaultModelId: 'model-default', defaultEffort: 'low', threadId: 'thread-1' })).toThrow(/Model-switch sequence verification failed/);
  });

  it('requires real matching Agent deltas, a completed final message, and the task-specific response', () => {
    const input = {
      events: [
        { type: 'message-delta', taskId: 'other-task', sessionId: 'session-1', delta: 'irrelevant' },
        { type: 'message-delta', taskId: 'task-1', sessionId: 'session-1', delta: 'VANTILO_DEFAULT_' },
        { type: 'message-delta', taskId: 'task-1', sessionId: 'session-1', delta: 'MODEL_RESTORED' },
      ],
      taskStatus: 'completed', taskId: 'task-1', sessionId: 'session-1',
      messages: [{ role: 'assistant', taskId: 'task-1', status: 'completed', text: 'VANTILO_DEFAULT_MODEL_RESTORED' }],
      expectedText: 'VANTILO_DEFAULT_MODEL_RESTORED',
    };
    expect(assertStreamedTaskReply(input)).toBe(true);
  });

  it('rejects arbitrary final text when no matching non-empty Agent delta was received', () => {
    const input = {
      events: [{ type: 'message-delta', taskId: 'other-task', sessionId: 'session-1', delta: 'VANTILO_DEFAULT_MODEL_RESTORED' }],
      taskStatus: 'completed', taskId: 'task-1', sessionId: 'session-1',
      messages: [{ role: 'assistant', taskId: 'task-1', status: 'completed', text: 'VANTILO_DEFAULT_MODEL_RESTORED' }],
      expectedText: 'VANTILO_DEFAULT_MODEL_RESTORED',
    };
    expect(() => assertStreamedTaskReply(input)).toThrow(/non-empty Agent message delta received/);
  });

  it('rejects a streamed reply unrelated to the exact test operation', () => {
    const input = {
      events: [{ type: 'message-delta', taskId: 'task-1', sessionId: 'session-1', delta: 'Some unrelated reply' }],
      taskStatus: 'completed', taskId: 'task-1', sessionId: 'session-1',
      messages: [{ role: 'assistant', taskId: 'task-1', status: 'completed', text: 'Some unrelated reply' }],
      expectedText: 'VANTILO_DEFAULT_MODEL_RESTORED',
    };
    expect(() => assertStreamedTaskReply(input)).toThrow(/final response matches the task-specific expected text/);
  });
});
