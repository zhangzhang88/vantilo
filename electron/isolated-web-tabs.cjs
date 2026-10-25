const { checkBrowserUrl, isBrowserRequestAllowed, parseBrowserBounds, isBrowserTabId } = require('./web-navigation-policy.cjs');

function installIsolatedWebTabs({ ipcMain, BrowserWindow, WebContentsView, session, trustedSender }) {
  const records = new Map();
  const boundWindows = new WeakSet();
  let partition = null;
  let sequence = 0;

  function activeAppOrigins() {
    return BrowserWindow.getAllWindows().filter(window => !window.isDestroyed()).flatMap(window => {
      try { const origin = new URL(window.webContents.getURL()).origin; return origin === 'null' ? [] : [origin]; }
      catch { return []; }
    });
  }
  function privateSession() {
    if (partition) return partition;
    partition = session.fromPartition('persist:vantilo-browser');
    partition.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
    partition.setPermissionCheckHandler(() => false);
    partition.setDevicePermissionHandler(() => false);
    partition.webRequest.onBeforeRequest((request, answer) => answer({ cancel: !isBrowserRequestAllowed(request.url, activeAppOrigins()) }));
    partition.on('will-download', event => event.preventDefault());
    return partition;
  }
  function sendState(record) {
    const contents = record.view.webContents;
    if (record.owner.isDestroyed() || record.owner.webContents.isDestroyed() || contents.isDestroyed()) return;
    record.owner.webContents.send('browser:state', {
      id: record.id, url: contents.getURL(), title: contents.getTitle(),
      canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward(),
      loading: contents.isLoading(), error: record.error,
    });
  }
  function removeRecord(record) {
    records.delete(record.id);
    if (!record.owner.isDestroyed()) record.owner.contentView.removeChildView(record.view);
    if (!record.view.webContents.isDestroyed()) record.view.webContents.close();
  }
  function removeWindowTabs(window) { for (const record of [...records.values()]) if (record.owner === window) removeRecord(record); }
  function getOwner(event) {
    if (!trustedSender(event)) return null;
    const window = BrowserWindow.fromWebContents(event.sender);
    return window && window.webContents === event.sender ? window : null;
  }
  function getRecord(event, id) {
    const owner = getOwner(event);
    if (!owner || !isBrowserTabId(id)) return null;
    const record = records.get(id);
    return record && record.owner === owner && !record.view.webContents.isDestroyed() ? record : null;
  }
  function watchWindow(window) {
    if (boundWindows.has(window)) return;
    boundWindows.add(window);
    window.once('closed', () => removeWindowTabs(window));
    window.webContents.on('did-navigate', () => removeWindowTabs(window));
    window.webContents.once('render-process-gone', () => removeWindowTabs(window));
  }
  function attachObservers(record) {
    const page = record.view.webContents;
    page.setWindowOpenHandler(() => ({ action: 'deny' }));
    const intercept = event => {
      if (!event.isMainFrame) return;
      const verdict = checkBrowserUrl(event.url, { appOrigins: activeAppOrigins() });
      if (verdict.ok) return;
      event.preventDefault(); record.error = { kind: 'blocked', reason: verdict.reason, url: String(event.url).slice(0, 2048) }; sendState(record);
    };
    page.on('will-navigate', intercept);
    page.on('will-redirect', intercept);
    page.on('did-start-loading', () => { record.error = null; sendState(record); });
    page.on('did-stop-loading', () => sendState(record));
    page.on('did-navigate', () => { record.error = null; sendState(record); });
    page.on('did-navigate-in-page', (_event, _url, mainFrame) => { if (mainFrame) sendState(record); });
    page.on('page-title-updated', () => sendState(record));
    page.on('did-fail-load', (_event, code, description, url, mainFrame) => {
      if (!mainFrame || code === -3) return;
      record.error = { kind: 'failed', code, description: String(description).slice(0, 500), url: String(url).slice(0, 2048) }; sendState(record);
    });
    page.on('render-process-gone', () => { record.error = { kind: 'crashed' }; sendState(record); });
    page.once('destroyed', () => records.delete(record.id));
  }

  ipcMain.handle('browser:create', event => {
    const owner = getOwner(event);
    if (!owner) throw new Error('Untrusted browser request rejected.');
    if ([...records.values()].filter(record => record.owner === owner).length >= 12) throw new Error('Browser tab limit reached.');
    watchWindow(owner);
    const view = new WebContentsView({ webPreferences: {
      session: privateSession(), sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, webviewTag: false,
      navigateOnDragDrop: false, safeDialogs: true,
    } });
    view.setVisible(false); view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); owner.contentView.addChildView(view);
    const id = `web_${++sequence}_${Math.random().toString(36).slice(2, 10)}`;
    const record = { id, owner, view, error: null }; records.set(id, record); attachObservers(record); sendState(record);
    return id;
  });
  ipcMain.handle('browser:navigate', (event, id, address) => {
    const record = getRecord(event, id);
    if (!record) throw new Error('Browser tab is unavailable.');
    const result = checkBrowserUrl(address, { appOrigins: activeAppOrigins() });
    if (!result.ok) { record.error = { kind: 'blocked', reason: result.reason, url: typeof address === 'string' ? address.slice(0, 2048) : '' }; sendState(record); return result; }
    record.error = null; record.view.webContents.loadURL(result.url).catch(() => {}); return result;
  });
  ipcMain.handle('browser:bounds', (event, id, rawRect) => {
    const record = getRecord(event, id); const rect = parseBrowserBounds(rawRect);
    if (!record || !rect) return false;
    const bounds = record.owner.getContentBounds(); const left = Math.max(0, Math.min(rect.x, bounds.width)); const top = Math.max(0, Math.min(rect.y, bounds.height));
    record.view.setBounds({ x: left, y: top, width: Math.min(rect.width, bounds.width - left), height: Math.min(rect.height, bounds.height - top) }); return true;
  });
  ipcMain.handle('browser:visible', (event, id, visible) => { const record = getRecord(event, id); if (!record || typeof visible !== 'boolean') return false; record.view.setVisible(visible); return true; });
  ipcMain.handle('browser:back', (event, id) => { const record = getRecord(event, id); if (!record) return false; if (record.view.webContents.navigationHistory.canGoBack()) record.view.webContents.navigationHistory.goBack(); return true; });
  ipcMain.handle('browser:forward', (event, id) => { const record = getRecord(event, id); if (!record) return false; if (record.view.webContents.navigationHistory.canGoForward()) record.view.webContents.navigationHistory.goForward(); return true; });
  ipcMain.handle('browser:reload', (event, id) => { const record = getRecord(event, id); if (!record) return false; record.error = null; record.view.webContents.reload(); return true; });
  ipcMain.handle('browser:close', (event, id) => { const record = getRecord(event, id); if (!record) return false; removeRecord(record); return true; });
}

module.exports = { installIsolatedWebTabs };
