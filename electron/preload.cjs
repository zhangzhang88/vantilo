const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('Event callback must be a function.');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('vantilo', Object.freeze({
  getAccountStatus: () => ipcRenderer.invoke('account:status'),
  loginWithChatGPT: () => ipcRenderer.invoke('account:login'),
  logoutAccount: () => ipcRenderer.invoke('account:logout'),
  getRuntimeStatus: () => ipcRenderer.invoke('runtime:status'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  createSession: () => ipcRenderer.invoke('sessions:create'),
  openSession: sessionId => ipcRenderer.invoke('sessions:open', sessionId),
  deleteSession: sessionId => ipcRenderer.invoke('sessions:delete', sessionId),
  showSessionMenu: sessionId => ipcRenderer.invoke('sessions:context-menu', sessionId),
  renameSession: (sessionId, title) => ipcRenderer.invoke('sessions:rename', sessionId, title),
  listCodexModels: () => ipcRenderer.invoke('models:list'),
  setSessionModelConfig: (sessionId, modelId, reasoningEffort) => ipcRenderer.invoke('session:model-config', sessionId, modelId, reasoningEffort),
  getWorkspace: () => ipcRenderer.invoke('workspace:state'),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  clearWorkspace: () => ipcRenderer.invoke('workspace:clear'),
  showProjectMenu: projectPath => ipcRenderer.invoke('workspace:project-menu', projectPath),
  pickWorkspaceReferences: () => ipcRenderer.invoke('workspace:pick-references'),
  resolveToolApproval: (approvalId, sessionId, taskId, decision) => ipcRenderer.invoke('tool:approval', { approvalId, sessionId, taskId, decision }),
  submitTask: (sessionId, text, permissionMode) => permissionMode === undefined ? ipcRenderer.invoke('agent:submit', sessionId, text) : ipcRenderer.invoke('agent:submit', sessionId, text, permissionMode),
  cancelTask: taskId => ipcRenderer.invoke('agent:cancel', taskId),
  getReaderSetupState: () => ipcRenderer.invoke('reader:setup-state'),
  checkReaderSetup: () => ipcRenderer.invoke('reader:setup-check'),
  finishReaderSetup: decision => ipcRenderer.invoke('reader:setup-finish', decision),
  openDictionaryApp: () => ipcRenderer.invoke('reader:setup-dictionary'),
  syncMagazineReader: () => ipcRenderer.invoke('magazine-reader:sync'),
  getMagazineReaderStatus: () => ipcRenderer.invoke('magazine-reader:status'),
  startMagazineReader: () => ipcRenderer.invoke('magazine-reader:start'),
  requestGutenberg: request => ipcRenderer.invoke('gutenberg:request', request),
  onRuntimeStatus: callback => subscribe('agent:status', callback),
  onAgentEvent: callback => subscribe('agent:event', callback)
}));
