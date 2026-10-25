const { z } = require('zod');
const path = require('node:path');

const PROTOCOL_VERSION = 7;
const MAX_PROMPT_LENGTH = 20000;
const Uuid = z.string().uuid();
const RuntimeStatus = z.object({ status: z.enum(['connecting', 'ready', 'error', 'stopped']), error: z.string().optional() }).strict();
const StorageHealth = z.object({ available: z.boolean(), error: z.string().nullable(), warning: z.string().nullable() }).strict();
const WorkspaceState = z.object({ root: z.string().nullable(), error: z.string().nullable(), revision: z.number().int().nonnegative() }).strict();
const ProjectEntry = z.object({ root: z.string().min(1).max(4096), pinned: z.boolean(), removed: z.boolean() }).strict();
const ProjectMenuState = z.object({ path: z.string().min(1).max(4096), pinned: z.boolean(), active: z.boolean(), canRemove: z.boolean() }).strict();
const ModelOption = z.object({ id: z.string().min(1).max(256), catalogId: z.string().min(1).max(256), displayName: z.string().min(1).max(256), description: z.string().max(2048), isDefault: z.boolean(), defaultEffort: z.string().min(1).max(64).nullable(), efforts: z.array(z.object({ id: z.string().min(1).max(64), description: z.string().max(1024) }).strict()).max(32) }).strict();
const ModelCatalog = z.object({ models: z.array(ModelOption).max(500) }).strict();
const ModelConfig = z.object({ modelId: z.string().min(1).max(256).nullable(), reasoningEffort: z.string().min(1).max(64).nullable() }).strict();
const SessionMessage = z.object({
  id: Uuid, role: z.enum(['user', 'assistant']), text: z.string(), createdAt: z.string().datetime(),
  taskId: Uuid.optional(), status: z.enum(['pending', 'completed', 'failed', 'cancelled']).optional(), finishedAt: z.string().datetime().optional(), error: z.string().nullable().optional()
}).strict();
const SessionSummary = z.object({
  id: Uuid, title: z.string(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  codexThreadId: z.string().nullable(), toolCatalogFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(), toolCatalogCompatibility: z.enum(['new','current','partial','incompatible','unknown']).optional(), availableToolNames: z.array(z.enum(['list_workspace_files','read_workspace_file','read_workspace_passage'])).max(100).optional(), modelId: z.string().min(1).max(256).nullable(), reasoningEffort: z.string().min(1).max(64).nullable(), workspaceRoot: z.string().min(1).max(4096).nullable(), pinned: z.boolean(), messageCount: z.number().int().nonnegative(), preview: z.string(),
  threadState: z.enum(['new', 'history', 'connected'])
}).strict();
const Session = z.object({
  id: Uuid, title: z.string(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  codexThreadId: z.string().nullable(), toolCatalogFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(), modelId: z.string().min(1).max(256).nullable(), reasoningEffort: z.string().min(1).max(64).nullable(), workspaceRoot: z.string().min(1).max(4096).nullable(), pinned: z.boolean(), messages: z.array(SessionMessage)
}).strict();
const SessionView = z.object({
  session: Session, threadState: z.enum(['new', 'history', 'connected']), connectionError: z.string().nullable(), toolCatalogCompatibility: z.enum(['new','current','partial','incompatible','unknown']).optional(), availableToolNames: z.array(z.enum(['list_workspace_files','read_workspace_file','read_workspace_passage'])).max(100).optional()
}).strict();
const AgentEvent = z.union([
  z.object({ type: z.literal('task-started'), taskId: Uuid, sessionId: Uuid, text: z.string(), status: z.literal('running'), userMessage: SessionMessage, assistantMessage: SessionMessage }).strict(),
  z.object({ type: z.literal('message-delta'), taskId: Uuid, sessionId: Uuid, messageId: Uuid, delta: z.string() }).strict(),
  z.object({ type: z.literal('message-status'), taskId: Uuid, sessionId: Uuid, record: SessionMessage }).strict(),
  z.object({ type: z.literal('task-status'), taskId: Uuid, sessionId: Uuid, status: z.enum(['running', 'cancelling', 'completed', 'failed', 'cancelled']), error: z.string().nullable().optional(), message: z.string().optional(), cause: z.enum(['runtime-disconnected']).optional() }).strict(),
  z.object({ type: z.literal('activity'), taskId: Uuid.optional(), sessionId: Uuid.optional(), message: z.string() }).strict(),
  z.object({ type: z.literal('session-updated'), session: SessionSummary }).strict(),
  z.object({ type: z.literal('storage-warning'), message: z.string() }).strict(),
  z.object({ type: z.literal('storage-error'), message: z.string() }).strict(),
  z.object({ type: z.literal('workspace-updated'), workspace: WorkspaceState }).strict(),
  z.object({ type: z.literal('projects-updated'), projects: z.array(ProjectEntry).max(500) }).strict(),
  z.object({ type: z.literal('tool-approval-requested'), approvalId: Uuid, serverRequestId: z.union([z.string().max(256), z.number()]), callId: z.string().min(1).max(256), sessionId: Uuid, taskId: Uuid, threadId: z.string().min(1).max(512), turnId: z.string().min(1).max(512), toolName: z.enum(['list_workspace_files', 'read_workspace_file', 'read_workspace_passage']), reason: z.string().max(500), relativePath: z.string().min(1).max(1024), operation: z.enum(['list', 'read']), lineRange: z.object({startLine:z.number().int().positive(),endLine:z.number().int().positive()}).strict().optional(), readOnly: z.literal(true), workspaceRoot: z.string().min(1).max(4096), workspaceRevision: z.number().int().positive(), createdAt: z.string().datetime(), expiresAt: z.string().datetime() }).strict(),
  z.object({ type: z.literal('tool-approval-resolved'), approvalId: Uuid, sessionId: Uuid, taskId: Uuid, status: z.enum(['approved', 'rejected', 'expired', 'cancelled']) }).strict(),
  z.object({ type: z.literal('tool-execution'), approvalId: Uuid, sessionId: Uuid, taskId: Uuid, toolName: z.enum(['list_workspace_files', 'read_workspace_file', 'read_workspace_passage']), stage: z.enum(['started', 'completed', 'failed', 'denied', 'cancelled']), summary: z.string().max(4096), error: z.string().max(4096).nullable() }).strict()
]);
const Request = z.object({
  version: z.literal(PROTOCOL_VERSION), type: z.literal('request'), requestId: Uuid,
  method: z.enum(['status', 'sessions:list', 'sessions:create', 'sessions:open', 'sessions:delete', 'sessions:menu-state', 'sessions:rename', 'sessions:pin', 'models:list', 'session:model-config', 'workspace:get', 'workspace:set', 'workspace:clear', 'workspace:references:validate', 'workspace:project-path:resolve', 'projects:list', 'project:pin', 'project:remove', 'approval:resolve', 'submit', 'cancel', 'shutdown']), payload: z.unknown()
}).strict();
const Response = z.discriminatedUnion('ok', [
  z.object({ version: z.literal(PROTOCOL_VERSION), type: z.literal('response'), requestId: Uuid, ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ version: z.literal(PROTOCOL_VERSION), type: z.literal('response'), requestId: Uuid, ok: z.literal(false), error: z.object({ message: z.string() }).strict() }).strict()
]);
const RuntimeMessage = z.union([
  z.object({ version: z.literal(PROTOCOL_VERSION), type: z.literal('ready'), status: RuntimeStatus }).strict(),
  z.object({ version: z.literal(PROTOCOL_VERSION), type: z.literal('status'), status: RuntimeStatus }).strict(),
  z.object({ version: z.literal(PROTOCOL_VERSION), type: z.literal('event'), event: AgentEvent }).strict(),
  z.object({ version: z.literal(PROTOCOL_VERSION), type: z.literal('child-process'), pid: z.number().int().positive().nullable() }).strict(),
  Response
]);
const Payloads = {
  status: z.object({}).strict(),
  'sessions:list': z.object({}).strict(),
  'sessions:create': z.object({}).strict(),
  'sessions:open': z.object({ sessionId: Uuid }).strict(),
  'sessions:delete': z.object({ sessionId: Uuid }).strict(),
  'sessions:menu-state': z.object({ sessionId: Uuid }).strict(),
  'sessions:rename': z.object({ sessionId: Uuid, title: z.string().trim().min(1).max(120) }).strict(),
  'sessions:pin': z.object({ sessionId: Uuid, pinned: z.boolean() }).strict(),
  'models:list': z.object({}).strict(),
  'session:model-config': z.object({ sessionId: Uuid, modelId: z.string().min(1).max(256).nullable(), reasoningEffort: z.string().min(1).max(64).nullable() }).strict(),
  'workspace:get': z.object({}).strict(),
  'workspace:set': z.object({ path: z.string().min(1).max(4096).refine(value => path.isAbsolute(value)) }).strict(),
  'workspace:clear': z.object({}).strict(),
  'workspace:references:validate': z.object({ paths: z.array(z.string().min(1).max(4096).refine(value => path.isAbsolute(value))).min(1).max(20) }).strict(),
  'workspace:project-path:resolve': z.object({ path: z.string().min(1).max(4096).refine(value => path.isAbsolute(value)) }).strict(),
  'projects:list': z.object({}).strict(),
  'project:pin': z.object({ path: z.string().min(1).max(4096).refine(value => path.isAbsolute(value)), pinned: z.boolean() }).strict(),
  'project:remove': z.object({ path: z.string().min(1).max(4096).refine(value => path.isAbsolute(value)) }).strict(),
  'approval:resolve': z.object({ approvalId: Uuid, sessionId: Uuid, taskId: Uuid, decision: z.enum(['approved', 'rejected']) }).strict(),
  submit: z.object({ sessionId: Uuid, text: z.string().trim().min(1).max(MAX_PROMPT_LENGTH) }).strict(),
  cancel: z.object({ taskId: Uuid }).strict(),
  shutdown: z.object({}).strict()
};
const Results = {
  status: RuntimeStatus,
  'sessions:list': z.object({ sessions: z.array(SessionSummary), storage: StorageHealth }).strict(),
  'sessions:create': SessionView,
  'sessions:open': SessionView,
  'sessions:delete': z.object({ sessionId: Uuid }).strict(),
  'sessions:menu-state': z.object({ sessionId: Uuid, title: z.string(), pinned: z.boolean(), hasCodexThread: z.boolean(), canDelete: z.boolean() }).strict(),
  'sessions:rename': SessionSummary,
  'sessions:pin': SessionSummary,
  'models:list': ModelCatalog,
  'session:model-config': ModelConfig,
  'workspace:get': WorkspaceState,
  'workspace:set': WorkspaceState,
  'workspace:clear': WorkspaceState,
  'workspace:references:validate': z.object({ references: z.array(z.object({ path: z.string().min(1).max(1024), kind: z.enum(['file', 'directory']) }).strict()).max(20) }).strict(),
  'workspace:project-path:resolve': ProjectMenuState,
  'projects:list': z.array(ProjectEntry).max(500),
  'project:pin': z.array(ProjectEntry).max(500),
  'project:remove': z.object({ projects: z.array(ProjectEntry).max(500), workspace: WorkspaceState }).strict(),
  'approval:resolve': z.object({ approvalId: Uuid, sessionId: Uuid, taskId: Uuid, status: z.enum(['approved', 'rejected']) }).strict(),
  submit: z.object({ taskId: Uuid, sessionId: Uuid }).strict(),
  cancel: z.object({ taskId: Uuid, status: z.literal('cancelling') }).strict(),
  shutdown: z.object({ status: z.literal('stopped') }).strict()
};

module.exports = { PROTOCOL_VERSION, MAX_PROMPT_LENGTH, RuntimeStatus, StorageHealth, WorkspaceState, ModelOption, ModelCatalog, ModelConfig, SessionMessage, SessionSummary, Session, SessionView, AgentEvent, Request, Response, RuntimeMessage, Payloads, Results };
