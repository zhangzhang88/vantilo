const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { z } = require('zod');

const VERSION = 4;
const MAX_SESSION_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_TITLE = 'New conversation';
const MessageSchema = z.object({
  id: z.string().uuid(), role: z.enum(['user', 'assistant']), text: z.string(), createdAt: z.string().datetime(),
  taskId: z.string().uuid().optional(), status: z.enum(['pending', 'completed', 'failed', 'cancelled']).optional(), finishedAt: z.string().datetime().optional(), error: z.string().nullable().optional()
}).strict();
const LegacySessionSchema = z.object({
  id: z.string().uuid(), title: z.string().min(1).max(120), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  codexThreadId: z.string().nullable(), toolCatalogVersion: z.number().int().positive().nullable().optional(), messages: z.array(MessageSchema)
}).strict();
const Version2SessionSchema = LegacySessionSchema.extend({ modelId: z.string().min(1).max(256).nullable(), reasoningEffort: z.string().min(1).max(64).nullable() }).strict();
const Version3SessionSchema = Version2SessionSchema.extend({ workspaceRoot: z.string().min(1).max(4096).nullable() }).strict();
const SessionSchema = Version3SessionSchema.extend({ pinned: z.boolean() }).strict();
const DocumentSchema = z.object({ version: z.literal(VERSION), sessions: z.array(SessionSchema) }).strict();
const Version3DocumentSchema = z.object({ version: z.literal(3), sessions: z.array(Version3SessionSchema) }).strict();
const Version2DocumentSchema = z.object({ version: z.literal(2), sessions: z.array(Version2SessionSchema) }).strict();
const LegacyDocumentSchema = z.object({ version: z.literal(1), sessions: z.array(LegacySessionSchema) }).strict();
const SECRET_PATTERNS = [
  /(\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth(?:entication)?[_ -]?token|token|client[_ -]?secret|password|passwd|authorization|cookie)\b\s*[:=]\s*)([^\s,;]+)/gi,
  /(^|\n)(\s*(?:set-cookie|cookie)\s*:\s*)[^\r\n]*/gim,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:sk-(?:proj-)?|sk_live_|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{0,240}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /(https?:\/\/)[^\s/:@]+:[^\s/@]+@/gi
];

function redactSecrets(text) {
  let result = String(text);
  for (const pattern of SECRET_PATTERNS) result = result.replace(pattern, (...args) => {
    const match = args[0];
    if (/^https?:\/\//i.test(match)) return `${args[1]}[REDACTED]@`;
    if (/^(?:\n)?\s*(?:set-cookie|cookie)\s*:/i.test(match)) return `${args[1]}${args[2]}[REDACTED]`;
    if (/^Bearer\s/i.test(match) || /^(?:sk-|sk_live_|gh|github_pat_|xox|AKIA|eyJ|-----BEGIN)/.test(match)) return '[REDACTED]';
    if (/-----BEGIN/.test(match)) return '[REDACTED PRIVATE KEY]';
    return `${args[1]}[REDACTED]`;
  });
  return result;
}

function preview(session) {
  const last = session.messages.at(-1);
  return last ? redactSecrets(last.text).replace(/\s+/g, ' ').slice(0, 120) : '';
}
function clone(value) { return structuredClone(value); }

class SessionStore {
  constructor({ filePath }) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('SessionStore requires an absolute storage path.');
    this.filePath = filePath;
    this.data = { version: VERSION, sessions: [] };
    this.error = null;
    this.warning = null;
    this.loaded = false;
    this.writeQueue = Promise.resolve();
  }

  health() {
    return { available: this.loaded && !this.error, error: this.error, warning: this.warning };
  }

  async load() {
    if (this.loaded) return this.health();
    try { await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 }); await fs.chmod(path.dirname(this.filePath), 0o700); }
    catch (error) { this.error = `Cannot create the Vantilo session-data directory: ${error.message}`; this.loaded = true; return this.health(); }
    let raw;
    try {
      const fileStat = await fs.lstat(this.filePath);
      if (!fileStat.isFile()) {
        this.error = 'Vantilo session history is not a regular file and was left untouched.';
        this.loaded = true;
        return this.health();
      }
      if (fileStat.size > MAX_SESSION_FILE_BYTES) {
        this.error = `Vantilo session history exceeds the ${MAX_SESSION_FILE_BYTES / (1024 * 1024)} MB safety limit and was left untouched.`;
        this.loaded = true;
        return this.health();
      }
      raw = await fs.readFile(this.filePath, 'utf8');
    }
    catch (error) {
      if (error.code !== 'ENOENT') { this.error = `Cannot read Vantilo session history: ${error.message}`; this.loaded = true; return this.health(); }
      this.loaded = true;
      try { await this.#writeDocument(this.data); }
      catch (writeError) { this.error = `Cannot initialize Vantilo session history: ${writeError.message}`; }
      return this.health();
    }
    let parsed;
    try {
      const candidate = JSON.parse(raw);
      const current = DocumentSchema.safeParse(candidate);
      if (current.success) parsed = current.data;
      else {
        const version3 = Version3DocumentSchema.safeParse(candidate);
        if (version3.success) parsed = { version: VERSION, sessions: version3.data.sessions.map(session => ({ ...session, pinned: false })) };
        else {
          const version2 = Version2DocumentSchema.safeParse(candidate);
          if (version2.success) {
            parsed = { version: VERSION, sessions: version2.data.sessions.map(session => ({ ...session, toolCatalogVersion: session.toolCatalogVersion ?? null, workspaceRoot: null, pinned: false })) };
          } else {
            const legacy = LegacyDocumentSchema.safeParse(candidate);
            if (!legacy.success) throw current.error;
            parsed = { version: VERSION, sessions: legacy.data.sessions.map(session => ({ ...session, toolCatalogVersion: session.toolCatalogVersion ?? null, modelId: null, reasoningEffort: null, workspaceRoot: null, pinned: false })) };
          }
        }
      }
    }
    catch (error) {
      const backup = `${this.filePath}.corrupt-${Date.now()}-${randomUUID()}`;
      try {
        await fs.rename(this.filePath, backup);
        this.warning = `Session history was damaged and has been preserved as ${path.basename(backup)}. A new empty history was created.`;
        this.loaded = true;
        try { await this.#writeDocument(this.data); }
        catch (writeError) { this.error = `Damaged history was preserved, but new session storage could not be created: ${writeError.message}`; }
      } catch (backupError) {
        this.error = `Session history is damaged (${error.message}); it could not be preserved safely (${backupError.message}).`;
        this.loaded = true;
      }
      return this.health();
    }
    this.data = parsed;
    this.loaded = true;
    try { await fs.chmod(this.filePath, 0o600); } catch { /* platform may not support POSIX mode bits */ }
    return this.health();
  }

  list() {
    this.#assertLoaded();
    return clone(this.data.sessions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(session => ({
      id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt,
      codexThreadId: session.codexThreadId, toolCatalogVersion: session.toolCatalogVersion ?? null, modelId: session.modelId ?? null, reasoningEffort: session.reasoningEffort ?? null, workspaceRoot: session.workspaceRoot ?? null, pinned: session.pinned ?? false, messageCount: session.messages.length, preview: preview(session)
    }));
  }

  get(sessionId) {
    this.#assertLoaded();
    const session = this.data.sessions.find(item => item.id === sessionId);
    if (!session) throw new Error('Conversation not found.');
    return clone(session);
  }

  create(workspaceRoot = null) {
    if (workspaceRoot !== null && (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot) || workspaceRoot.length > 4096)) throw new Error('A canonical absolute workspace path is required.');
    return this.#mutate(data => {
      const now = new Date().toISOString();
      const session = { id: randomUUID(), title: DEFAULT_TITLE, createdAt: now, updatedAt: now, codexThreadId: null, toolCatalogVersion: null, modelId: null, reasoningEffort: null, workspaceRoot, pinned: false, messages: [] };
      data.sessions.push(session);
      return session;
    });
  }

  recoverWorkspaceRoot(sessionId, workspaceRoot) {
    if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot) || workspaceRoot.length > 4096) throw new Error('A valid absolute project path is required.');
    return this.#mutate(data => {
      const session = this.#find(data, sessionId);
      if (session.workspaceRoot === null) session.workspaceRoot = workspaceRoot;
      return session;
    });
  }

  rename(sessionId, title) {
    if (typeof title !== 'string') throw new Error('A conversation title is required.');
    const normalized = title.trim();
    if (!normalized || normalized.length > 120) throw new Error('Conversation titles must contain 1 to 120 characters.');
    return this.#mutate(data => { const session = this.#find(data, sessionId); session.title = normalized; return session; });
  }

  setPinned(sessionId, pinned) {
    if (typeof pinned !== 'boolean') throw new Error('Pinned state must be a boolean.');
    return this.#mutate(data => { const session = this.#find(data, sessionId); session.pinned = pinned; return session; });
  }

  delete(sessionId) {
    return this.#mutate(data => {
      const index = data.sessions.findIndex(item => item.id === sessionId);
      if (index < 0) throw new Error('Conversation not found.');
      return data.sessions.splice(index, 1)[0];
    });
  }

  addTurn(sessionId, taskId, userText) {
    return this.#mutate(data => {
      const session = this.#find(data, sessionId);
      const now = new Date().toISOString();
      const userMessage = { id: randomUUID(), role: 'user', text: redactSecrets(userText), createdAt: now };
      const assistantMessage = { id: randomUUID(), role: 'assistant', text: '', createdAt: now, taskId, status: 'pending', error: null };
      session.messages.push(userMessage, assistantMessage);
      if (session.messages.filter(message => message.role === 'user').length === 1 && session.title === DEFAULT_TITLE) {
        session.title = userMessage.text.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Sensitive conversation';
      }
      session.updatedAt = now;
      return { session: clone(session), userMessage, assistantMessage };
    });
  }

  recoverPending() {
    const pending = this.data.sessions.some(session => session.messages.some(message => message.role === 'assistant' && message.status === 'pending'));
    if (!pending) return Promise.resolve(false);
    return this.#mutate(data => {
      let recovered = 0;
      const finishedAt = new Date().toISOString();
      for (const session of data.sessions) for (const message of session.messages) {
        if (message.role === 'assistant' && message.status === 'pending') {
          message.status = 'failed'; message.finishedAt = finishedAt; message.error = 'Interrupted when Vantilo stopped before this response completed.'; recovered++;
        }
      }
      return recovered;
    });
  }

  setModelConfig(sessionId, modelId, reasoningEffort) {
    return this.#mutate(data => {
      const session = this.#find(data, sessionId);
      session.modelId = modelId;
      session.reasoningEffort = reasoningEffort;
      session.updatedAt = new Date().toISOString();
      return session;
    });
  }

  setCodexThread(sessionId, threadId, toolCatalogVersion = null) {
    return this.#mutate(data => {
      const session = this.#find(data, sessionId);
      session.codexThreadId = threadId;
      session.toolCatalogVersion = toolCatalogVersion;
      session.updatedAt = new Date().toISOString();
      return session;
    });
  }

  updateAssistant(sessionId, messageId, rawText, status, error = null) {
    return this.#mutate(data => {
      const session = this.#find(data, sessionId);
      const message = session.messages.find(item => item.id === messageId && item.role === 'assistant');
      if (!message) throw new Error('Assistant message not found.');
      message.text = redactSecrets(rawText);
      if (status) {
        message.status = status;
        if (status !== 'pending') message.finishedAt = new Date().toISOString();
      }
      if (error !== null) message.error = redactSecrets(error);
      session.updatedAt = new Date().toISOString();
      return { session: clone(session), message: clone(message) };
    });
  }

  async flush() { await this.writeQueue; }

  #assertLoaded() {
    if (!this.loaded) throw new Error('Session history has not finished loading.');
  }

  #find(data, id) {
    const session = data.sessions.find(item => item.id === id);
    if (!session) throw new Error('Conversation not found.');
    return session;
  }

  #mutate(change) {
    this.#assertLoaded();
    const operation = this.writeQueue.then(async () => {
      if (this.error) throw new Error(this.error);
      const next = clone(this.data);
      const result = change(next);
      try { await this.#writeDocument(next); }
      catch (error) { this.error ||= `Cannot save Vantilo session history: ${error.message}`; throw new Error(this.error); }
      this.data = next;
      return clone(result);
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async #writeDocument(document) {
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      const contents = JSON.stringify(document);
      if (Buffer.byteLength(contents, 'utf8') > MAX_SESSION_FILE_BYTES) throw new Error(`Vantilo session history would exceed the ${MAX_SESSION_FILE_BYTES / (1024 * 1024)} MB safety limit.`);
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
      await handle.close(); handle = null;
      await fs.rename(temporary, this.filePath);
      try {
        const directory = await fs.open(path.dirname(this.filePath), 'r');
        await directory.sync(); await directory.close();
      } catch { /* directory fsync is not available on every platform */ }
    } catch (error) {
      try { await handle?.close(); } catch { /* best effort */ }
      try { await fs.unlink(temporary); } catch { /* best effort */ }
      throw error;
    }
  }
}

module.exports = { SessionStore, redactSecrets, DEFAULT_TITLE, VERSION, MAX_SESSION_FILE_BYTES, DocumentSchema, LegacyDocumentSchema };
