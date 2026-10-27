const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');

const DEFAULT_APPROVAL_TIMEOUT_MS = 120000;
const MAX_PENDING_APPROVALS = 8;
const MAX_SEEN_REQUESTS = 2048;

function requestKey(requestId) { return `${typeof requestId}:${String(requestId)}`; }

class ApprovalService extends EventEmitter {
  constructor({ timeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS, maxPending = MAX_PENDING_APPROVALS, now = Date.now } = {}) {
    super();
    Object.assign(this, { timeoutMs, maxPending, now });
    this.pending = new Map();
    this.seenRequests = new Map();
    this.sessionReadGrants = new Map();
  }

  listPending() { return [...this.pending.values()].map(({ resolve, timer, ...request }) => ({ ...request })); }

  request(details) {
    if (this.pending.size >= this.maxPending) throw new Error('Too many workspace tool approvals are already pending.');
    if (details.lineRange !== undefined && (!details.lineRange || !Number.isInteger(details.lineRange.startLine) || !Number.isInteger(details.lineRange.endLine) || details.lineRange.startLine < 1 || details.lineRange.endLine < details.lineRange.startLine || details.lineRange.endLine - details.lineRange.startLine + 1 > 40)) throw new Error('Invalid approved line range.');
    const key = requestKey(details.serverRequestId);
    this.#pruneSeen();
    if (this.seenRequests.has(key)) throw new Error('Duplicate or replayed Codex tool request.');
    this.seenRequests.set(key, this.now() + this.timeoutMs * 2);
    while (this.seenRequests.size > MAX_SEEN_REQUESTS) this.seenRequests.delete(this.seenRequests.keys().next().value);
    const approvalId = randomUUID();
    const createdAt = this.now();
    const request = {
      approvalId, serverRequestId: details.serverRequestId, callId: details.callId,
      sessionId: details.sessionId, taskId: details.taskId, threadId: details.threadId, turnId: details.turnId,
      toolName: details.toolName, reason: details.reason, relativePath: details.relativePath,
      operation: details.operation, ...(details.lineRange ? {lineRange:{startLine:details.lineRange.startLine,endLine:details.lineRange.endLine}} : {}), readOnly: details.readOnly !== false && details.operation !== 'write', workspaceRoot: details.workspaceRoot,
      workspaceRevision: details.workspaceRevision, createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + this.timeoutMs).toISOString()
    };
    let resolve;
    const result = new Promise(done => { resolve = done; });
    request.resolve = resolve;
    request.timer = setTimeout(() => this.#settle(request, 'expired'), this.timeoutMs);
    this.pending.set(approvalId, request);
    if (details.autoApprove || this.#hasSessionReadGrant(request)) this.#settle(request, 'approved');
    else this.emit('requested', this.#public(request));
    return result;
  }

  decide({ approvalId, sessionId, taskId, decision }) {
    const request = this.pending.get(approvalId);
    if (!request || request.sessionId !== sessionId || request.taskId !== taskId) throw new Error('Approval request is no longer pending or does not match this task.');
    if (!['approved', 'rejected', 'approved-for-session'].includes(decision)) throw new Error('Invalid approval decision.');
    if (this.now() >= Date.parse(request.expiresAt)) { this.#settle(request, 'expired'); throw new Error('Approval request has expired.'); }
    if (decision === 'approved-for-session') {
      if (!this.#isSessionRead(request)) throw new Error('Only scoped read-only workspace tools support session approval.');
      this.sessionReadGrants.set(sessionId, {root:request.workspaceRoot, revision:request.workspaceRevision});
    }
    const status = decision === 'approved-for-session' ? 'approved' : decision;
    this.#settle(request, status);
    return { approvalId, sessionId, taskId, status };
  }

  rejectTask(taskId, status = 'cancelled') {
    let count = 0;
    for (const request of this.pending.values()) if (request.taskId === taskId) { this.#settle(request, status); count++; }
    return count;
  }

  clearSessionReadGrants() { this.sessionReadGrants.clear(); }

  #isSessionRead(request) {
    return request.readOnly === true && ['list_workspace_files','read_workspace_file','read_workspace_passage'].includes(request.toolName);
  }

  #hasSessionReadGrant(request) {
    const grant = this.sessionReadGrants.get(request.sessionId);
    return this.#isSessionRead(request) && grant?.root === request.workspaceRoot && grant?.revision === request.workspaceRevision;
  }

  rejectAll(status = 'cancelled') {
    this.clearSessionReadGrants();
    for (const request of [...this.pending.values()]) this.#settle(request, status);
  }

  #settle(request, status) {
    if (!this.pending.has(request.approvalId)) return false;
    clearTimeout(request.timer);
    this.pending.delete(request.approvalId);
    const settled = { ...this.#public(request), status };
    this.emit('resolved', settled);
    request.resolve({ approvalId: request.approvalId, status });
    return true;
  }

  #public(request) {
    const { resolve, timer, ...publicRequest } = request;
    return { ...publicRequest };
  }

  #pruneSeen() {
    const now = this.now();
    for (const [key, expiresAt] of this.seenRequests) if (expiresAt <= now) this.seenRequests.delete(key);
  }
}

module.exports = { ApprovalService, DEFAULT_APPROVAL_TIMEOUT_MS, MAX_PENDING_APPROVALS, MAX_SEEN_REQUESTS, requestKey };
