const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('Event callback must be a function.');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('vantilo', Object.freeze({
  getReaderSetupState: () => ipcRenderer.invoke('reader:setup-state'),
  checkReaderSetup: () => ipcRenderer.invoke('reader:setup-check'),
  finishReaderSetup: decision => ipcRenderer.invoke('reader:setup-finish', decision),
  openDictionaryApp: () => ipcRenderer.invoke('reader:setup-dictionary'),
  getTtsInstallStatus: () => ipcRenderer.invoke('reader:tts-status'),
  installTtsModel: options => ipcRenderer.invoke('reader:tts-install', options),
  cancelTtsInstall: () => ipcRenderer.invoke('reader:tts-cancel'),
  removeTtsModel: () => ipcRenderer.invoke('reader:tts-remove'),
  onTtsInstallUpdated: callback => subscribe('reader:tts-updated', callback),
  getCustomApiSettings: () => ipcRenderer.invoke('reader:custom-api-get'),
  saveCustomApiSettings: config => ipcRenderer.invoke('reader:custom-api-save', config),
  testCustomApiSettings: config => ipcRenderer.invoke('reader:custom-api-test', config),
  listCustomApiModels: config => ipcRenderer.invoke('reader:custom-api-models', config),
  onCustomApiUpdated: callback => subscribe('reader:custom-api-updated', callback),
  syncMagazineReader: () => ipcRenderer.invoke('magazine-reader:sync'),
  getMagazineReaderStatus: () => ipcRenderer.invoke('magazine-reader:status'),
  startMagazineReader: () => ipcRenderer.invoke('magazine-reader:start'),
  startVocabularyBackup: requestId => ipcRenderer.invoke('vocabulary-backup:start', requestId),
  submitVocabularyBackupSnapshot: (requestId, snapshot) => ipcRenderer.invoke('vocabulary-backup:snapshot', requestId, snapshot),
  cancelVocabularyBackup: requestId => ipcRenderer.invoke('vocabulary-backup:cancel', requestId),
  revealVocabularyBackup: () => ipcRenderer.invoke('vocabulary-backup:reveal'),
  getVocabularyBackupStatus: () => ipcRenderer.invoke('vocabulary-backup:status'),
  onVocabularyBackupEvent: callback => subscribe('vocabulary-backup:event', callback),
  onSystemSuspended: callback => subscribe('system:suspended', callback)
}));
