function selectModelSwitchPair(models) {
  if (!Array.isArray(models)) throw new Error('Model-switch E2E precondition failed: Codex returned no model list.');
  const defaults = models.filter(model => model?.isDefault === true);
  if (defaults.length !== 1) throw new Error(`Model-switch E2E precondition failed: expected exactly one catalog default model, received ${defaults.length}.`);
  const defaultModel = defaults[0];
  if (typeof defaultModel.id !== 'string' || !defaultModel.id) throw new Error('Model-switch E2E precondition failed: the catalog default model has no ID.');
  const selectedModel = models.find(model => model && typeof model.id === 'string' && model.id && model.id !== defaultModel.id && models.filter(candidate => candidate?.id === model.id).length === 1);
  if (!selectedModel) throw new Error(`Model-switch E2E precondition failed: no uniquely selectable model differs from catalog default ${defaultModel.id}; cannot test a real model switch.`);
  return { defaultModel, selectedModel };
}

function assertCatalogDefaultTask({ taskStatus, taskError = null, turn, defaultModelId, defaultEffort, expectedThreadId, storedThreadId, threadStarts, redundantResumes, modelAId, modelAEffort, modelAStart, modelATurn }) {
  if (typeof expectedThreadId !== 'string' || !expectedThreadId || typeof defaultModelId !== 'string' || !defaultModelId) {
    throw new Error('Catalog-default task verification requires a valid catalog model ID and existing thread ID.');
  }
  const checks = [
    { name: 'default task status', expected: 'completed', actual: taskStatus },
    { name: 'turn/start thread ID', expected: expectedThreadId, actual: turn?.threadId ?? null },
    { name: 'turn/start model', expected: defaultModelId, actual: turn?.requestedModel ?? null },
    { name: 'turn/start effort from model/list defaultReasoningEffort', expected: defaultEffort, actual: turn?.effort ?? null },
    { name: 'persisted thread ID', expected: expectedThreadId, actual: storedThreadId ?? null },
    { name: 'new thread/start requests during default task', expected: 0, actual: threadStarts },
    { name: 'redundant thread/resume requests for already-loaded thread', expected: 0, actual: redundantResumes },
  ];
  const failed = checks.filter(check => !Object.is(check.expected, check.actual));
  if (failed.length > 0) {
    const lines = checks.map(check => `${check.name}: expected ${JSON.stringify(check.expected)}, actual ${JSON.stringify(check.actual)}${failed.includes(check) ? ' [FAIL]' : ''}`);
    throw new Error(`Catalog-default task verification failed (model A ${modelAId} / ${JSON.stringify(modelAEffort)}; catalog model ${defaultModelId} / defaultReasoningEffort ${JSON.stringify(defaultEffort)}).\n${taskError ? `Task error: ${taskError}\n` : ''}Model A thread/start: ${JSON.stringify(modelAStart ?? null)}\nModel A turn/start: ${JSON.stringify(modelATurn ?? null)}\n${lines.join('\n')}`);
  }
  return true;
}

function assertRestoredThreadFollowUp({ taskStatus, resume, turn, expectedThreadId, persistedThreadModel, persistedThreadEffort, sessionModelId, sessionEffort }) {
  const checks = [
    { name: 'restored follow-up task status', expected: 'completed', actual: taskStatus },
    { name: 'thread/resume requested thread ID', expected: expectedThreadId, actual: resume?.threadId ?? null },
    { name: 'thread/resume response thread ID', expected: expectedThreadId, actual: resume?.responseThreadId ?? null },
    { name: 'thread/resume model parameter (open-session reconnect)', expected: null, actual: resume?.requestedModel ?? null },
    { name: 'thread/resume reported persisted model', expected: persistedThreadModel, actual: resume?.effectiveModel ?? null },
    { name: 'thread/resume reported persisted effort', expected: persistedThreadEffort, actual: resume?.effectiveEffort ?? null },
    { name: 'follow-up turn thread ID', expected: expectedThreadId, actual: turn?.threadId ?? null },
    { name: 'follow-up turn model from Vantilo session settings', expected: sessionModelId, actual: turn?.requestedModel ?? null },
    { name: 'follow-up turn effort from Vantilo session settings', expected: sessionEffort, actual: turn?.effort ?? null },
  ];
  const failed = checks.filter(check => !Object.is(check.expected, check.actual));
  if (failed.length > 0) {
    throw new Error(`Restored-thread follow-up verification failed.\n${checks.map(check => `${check.name}: expected ${JSON.stringify(check.expected)}, actual ${JSON.stringify(check.actual)}${failed.includes(check) ? ' [FAIL]' : ''}`).join('\n')}`);
  }
  return true;
}

function assertStreamedTaskReply({ events, taskStatus, taskId, sessionId, messages, expectedText }) {
  const deltaEvents = Array.isArray(events) ? events.filter(event => event?.type === 'message-delta' && event.taskId === taskId && event.sessionId === sessionId && typeof event.delta === 'string') : [];
  const streamedText = deltaEvents.map(event => event.delta).join('');
  const finalMessage = Array.isArray(messages) ? messages.find(message => message?.role === 'assistant' && message.taskId === taskId) : null;
  const checks = [
    { name: 'task completed', passed: taskStatus === 'completed' },
    { name: 'non-empty Agent message delta received', passed: deltaEvents.some(event => event.delta.trim().length > 0) },
    { name: 'final assistant message completed', passed: finalMessage?.status === 'completed' },
    { name: 'final assistant message is non-empty', passed: typeof finalMessage?.text === 'string' && finalMessage.text.trim().length > 0 },
    { name: 'streamed deltas match persisted final message', passed: typeof finalMessage?.text === 'string' && streamedText === finalMessage.text },
    { name: 'final response matches the task-specific expected text', passed: typeof expectedText === 'string' && expectedText.length > 0 && finalMessage?.text?.trim() === expectedText && streamedText.trim() === expectedText },
  ];
  const failed = checks.filter(check => !check.passed);
  if (failed.length > 0) {
    throw new Error(`Real Codex streamed-reply verification failed: ${failed.map(check => check.name).join('; ')}. Observed ${deltaEvents.length} matching delta(s), ${streamedText.length} streamed character(s), final status ${JSON.stringify(finalMessage?.status ?? null)}, and ${typeof finalMessage?.text === 'string' ? finalMessage.text.length : 0} final character(s).`);
  }
  return true;
}

function assertReportedModelSwitch(requests, { modelAId, modelAEffort, defaultModelId, defaultEffort, threadId }) {
  if (!Array.isArray(requests) || !modelAId || !defaultModelId || modelAId === defaultModelId || !threadId) {
    throw new Error('Model-switch verification requires distinct model IDs and one valid thread ID.');
  }
  const start = requests.find(request => request.method === 'thread/start' && request.requestedModel === modelAId);
  const firstTurn = requests.find(request => request.method === 'turn/start' && request.requestedModel === modelAId);
  const firstTurnIndex = requests.indexOf(firstTurn);
  const defaultTurn = requests.find((request, index) => request.method === 'turn/start' && request.requestedModel === defaultModelId && index > firstTurnIndex);
  const checks = [
    { name: 'model A thread/start request', expected: modelAId, actual: start?.requestedModel ?? null },
    { name: 'model A thread/start reported model', expected: modelAId, actual: start?.effectiveModel ?? null },
    { name: 'model A thread ID', expected: threadId, actual: start?.threadId ?? null },
    { name: 'model A turn thread ID', expected: threadId, actual: firstTurn?.threadId ?? null },
    { name: 'model A turn model', expected: modelAId, actual: firstTurn?.requestedModel ?? null },
    { name: 'model A turn effort', expected: modelAEffort, actual: firstTurn?.effort ?? null },
    { name: 'no redundant thread/resume on loaded thread', expected: 0, actual: requests.filter(request => request.method === 'thread/resume').length },
    { name: 'default turn thread ID', expected: threadId, actual: defaultTurn?.threadId ?? null },
    { name: 'default turn model', expected: defaultModelId, actual: defaultTurn?.requestedModel ?? null },
    { name: 'default turn catalog effort', expected: defaultEffort, actual: defaultTurn?.effort ?? null },
  ];
  const failed = checks.filter(check => !Object.is(check.expected, check.actual));
  if (failed.length > 0) {
    const lines = checks.map(check => `${check.name}: expected ${JSON.stringify(check.expected)}, actual ${JSON.stringify(check.actual)}${failed.includes(check) ? ' [FAIL]' : ''}`);
    throw new Error(`Model-switch sequence verification failed.\n${lines.join('\n')}`);
  }
  return true;
}

module.exports = { selectModelSwitchPair, assertCatalogDefaultTask, assertRestoredThreadFollowUp, assertReportedModelSwitch, assertStreamedTaskReply };
