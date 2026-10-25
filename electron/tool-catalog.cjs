const { z } = require('zod');
const { redactSecrets } = require('./session-store.cjs');
const { WorkspaceError, MAX_READ_BYTES } = require('./workspace.cjs');

const TOOL_CATALOG_VERSION = 1;
const TOOL_TIMEOUT_MS = 10000;
const FileEntry = z.object({ path: z.string(), size: z.number().int().nonnegative(), modifiedAt: z.string().datetime() }).strict();
const ListOutput = z.object({ directory: z.string(), files: z.array(FileEntry).max(200), truncated: z.boolean() }).strict();
const ReadOutput = z.object({ path: z.string(), content: z.string().max(MAX_READ_BYTES * 3), bytes: z.number().int().nonnegative(), modifiedAt: z.string().datetime() }).strict();
const Reason = z.string().trim().min(3).max(500);
const ListInput = z.object({ reason: Reason, path: z.string().max(1024).optional(), limit: z.number().int().min(1).max(200).optional() }).strict();
const ReadInput = z.object({ reason: Reason, path: z.string().min(1).max(1024) }).strict();

const descriptions = {
  list_workspace_files: 'List regular files under the user-authorized Vantilo workspace. Every call requires the user\'s one-time approval. Only workspace-relative directory paths are accepted; credential-like files, excluded build/dependency directories, and all symlinks are omitted. This tool never executes commands.',
  read_workspace_file: 'Read a small UTF-8 text file under the user-authorized Vantilo workspace. Every call requires the user\'s one-time approval. Only workspace-relative paths are accepted; sensitive files, hard-linked files, binary files, files over 1 MiB, excluded directories, and symlinks are always denied. This tool never executes commands.'
};

function jsonSchemaFor(name) {
  if (name === 'list_workspace_files') return {
    type: 'object', additionalProperties: false,
    properties: {
      reason: { type: 'string', minLength: 3, maxLength: 500, description: 'Briefly explain why this directory listing is needed; it is shown in the user approval prompt.' },
      path: { type: 'string', maxLength: 1024, description: 'Optional workspace-relative directory path; omit it or use "." for the workspace root.' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum number of file entries to return (default 100).' }
    }, required: ['reason']
  };
  return {
    type: 'object', additionalProperties: false,
    properties: {
      reason: { type: 'string', minLength: 3, maxLength: 500, description: 'Briefly explain why this file is needed; it is shown in the user approval prompt.' },
      path: { type: 'string', minLength: 1, maxLength: 1024, description: 'Workspace-relative path to a small, non-sensitive UTF-8 text file.' }
    }, required: ['reason', 'path']
  };
}

function ensureNotAborted(signal) {
  if (signal?.aborted) throw new WorkspaceError('cancelled', 'The workspace request was cancelled.');
}

class ToolCatalog {
  constructor({ workspace, timeoutMs = TOOL_TIMEOUT_MS }) {
    if (!workspace) throw new Error('ToolCatalog requires a WorkspaceAuthority.');
    this.workspace = workspace;
    this.timeoutMs = timeoutMs;
    this.tools = new Map([
      ['list_workspace_files', {
        name: 'list_workspace_files', effect: 'read-only', requiredScope: 'workspace:read', approval: 'every-call', timeoutMs: this.timeoutMs,
        description: descriptions.list_workspace_files, inputSchema: ListInput, outputSchema: ListOutput,
        normalize: input => {
          const directory = this.workspace.normalize(input.path ?? '.', { allowRoot: true });
          if (this.workspace.isSensitive(directory)) throw new WorkspaceError('sensitive_path', 'This path may contain credentials and is excluded.');
          return { ...input, path: directory, limit: input.limit ?? 100 };
        },
        execute: async (input, { signal }) => this.workspace.listFiles(input.path, input.limit, { signal })
      }],
      ['read_workspace_file', {
        name: 'read_workspace_file', effect: 'read-only', requiredScope: 'workspace:read', approval: 'every-call', timeoutMs: this.timeoutMs,
        description: descriptions.read_workspace_file, inputSchema: ReadInput, outputSchema: ReadOutput,
        normalize: input => {
          const relative = this.workspace.normalize(input.path);
          if (this.workspace.isSensitive(relative)) throw new WorkspaceError('sensitive_path', 'This path may contain credentials or private keys and is excluded.');
          return { ...input, path: relative }
        },
        execute: async (input, { signal }) => {
          ensureNotAborted(signal);
          const result = await this.workspace.openReadOnly(input.path);
          ensureNotAborted(signal);
          return { ...result, content: redactSecrets(result.content) };
        }
      }]
    ]);
  }

  get(name) { return this.tools.get(name) || null; }
  list() { return [...this.tools.values()].map(({ name, description, effect, requiredScope, approval, timeoutMs }) => ({ name, description, effect, requiredScope, approval, timeoutMs })); }

  dynamicTools() {
    return [...this.tools.values()].map(tool => ({ type: 'function', name: tool.name, description: tool.description, inputSchema: jsonSchemaFor(tool.name) }));
  }

  validateCall(name, rawInput) {
    const tool = this.get(name);
    if (!tool) throw new WorkspaceError('unknown_tool', 'The requested tool is not available in Vantilo.');
    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) throw new WorkspaceError('invalid_input', 'The tool arguments do not match the published input schema.');
    return { tool, input: tool.normalize(parsed.data) };
  }

  async execute(name, rawInput, { signal } = {}) {
    const { tool, input } = this.validateCall(name, rawInput);
    ensureNotAborted(signal);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    let timer;
    let timedOut = false;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new WorkspaceError('timeout', `The ${tool.name} operation exceeded its ${tool.timeoutMs} ms timeout.`)); }, tool.timeoutMs);
    });
    try {
      const output = await Promise.race([Promise.resolve().then(() => tool.execute(input, { signal: controller.signal })), timeout]);
      ensureNotAborted(signal);
      const parsed = tool.outputSchema.safeParse(output);
      if (!parsed.success) throw new WorkspaceError('invalid_output', 'The tool produced an invalid structured result.');
      return { ok: true, data: parsed.data };
    } catch (error) {
      if (timedOut) throw error;
      if (signal?.aborted) throw new WorkspaceError('cancelled', 'The workspace request was cancelled.');
      if (error instanceof WorkspaceError) throw error;
      throw new WorkspaceError('tool_error', 'The workspace tool could not complete the requested operation.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

module.exports = { ToolCatalog, TOOL_CATALOG_VERSION, TOOL_TIMEOUT_MS, descriptions, ListInput, ReadInput, ListOutput, ReadOutput, jsonSchemaFor };
