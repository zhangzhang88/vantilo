const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('Event callback must be a function.');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('vantilo', Object.freeze({
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
  submitTask: (sessionId, text) => ipcRenderer.invoke('agent:submit', sessionId, text),
  cancelTask: taskId => ipcRenderer.invoke('agent:cancel', taskId),
  createBrowserTab: () => ipcRenderer.invoke('browser:create'),
  navigateBrowserTab: (id, url) => ipcRenderer.invoke('browser:navigate', id, url),
  setBrowserBounds: (id, bounds) => ipcRenderer.invoke('browser:bounds', id, bounds),
  setBrowserVisible: (id, visible) => ipcRenderer.invoke('browser:visible', id, visible),
  goBrowserBack: id => ipcRenderer.invoke('browser:back', id),
  goBrowserForward: id => ipcRenderer.invoke('browser:forward', id),
  reloadBrowserTab: id => ipcRenderer.invoke('browser:reload', id),
  closeBrowserTab: id => ipcRenderer.invoke('browser:close', id),
  onBrowserState: callback => subscribe('browser:state', callback),
  onRuntimeStatus: callback => subscribe('agent:status', callback),
  onAgentEvent: callback => subscribe('agent:event', callback)
}));
