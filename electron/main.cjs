const { app, BrowserWindow, WebContentsView, Menu, dialog, ipcMain, session, shell, utilityProcess } = require('electron');
const path = require('node:path');
const { RuntimeSupervisor } = require('./runtime-supervisor.cjs');
const { isTrustedSender, isTrustedPageUrl, PACKAGED_RENDERER_PATH } = require('./ipc-security.cjs');
const { installIsolatedWebTabs } = require('./isolated-web-tabs.cjs');

// Preserve the existing userData directory while branding the native app as Vantilo.
const existingUserDataPath = app.getPath('userData');
app.setName('Vantilo');
app.setPath('userData', existingUserDataPath);

let win;
let runtime;
let quitting = false;

function trustedSender(event) { return isTrustedSender(event, { win, packaged: app.isPackaged, rendererPath: PACKAGED_RENDERER_PATH }); }
function requireTrustedSender(event) {
  if (!trustedSender(event)) throw new Error('Untrusted renderer IPC request rejected.');
}

function publish(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function installApplicationMenu() {
  const template = [
    { label: 'Vantilo', submenu: [
      { label: '关于 Vantilo', role: 'about' }, { type: 'separator' },
      { label: '隐藏 Vantilo', role: 'hide' }, { label: '隐藏其他应用', role: 'hideOthers' },
      { label: '显示全部应用', role: 'unhide' }, { type: 'separator' }, { label: '退出 Vantilo', role: 'quit' }
    ] },
    { label: '文件', submenu: [{ label: '关闭窗口', role: 'close' }] },
    { label: '编辑', submenu: [
      { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' },
      { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' },
      { label: '全选', role: 'selectAll' }
    ] },
    { label: '视图', submenu: [
      { label: '重新加载', role: 'reload' }, { label: '强制重新加载', role: 'forceReload' },
      { type: 'separator' }, { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' },
      { label: '恢复默认缩放', role: 'resetZoom' }, { type: 'separator' }, { label: '切换全屏', role: 'togglefullscreen' }
    ] },
    { label: '窗口', submenu: [
      { label: '最小化', role: 'minimize' }, { label: '缩放', role: 'zoom' },
      { type: 'separator' }, { label: '置于最前', role: 'front' }
    ] },
    { label: '帮助', submenu: [{ label: '帮助文档（即将支持）', enabled: false }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 800, minHeight: 600, title: 'Vantilo', backgroundColor: '#111214',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, target) => {
    if (!isTrustedPageUrl(target, { packaged: app.isPackaged, rendererPath: PACKAGED_RENDERER_PATH })) event.preventDefault();
  });
  if (app.isPackaged) win.loadFile(PACKAGED_RENDERER_PATH);
  else {
    const url = process.env.VANTILO_DEV_SERVER_URL;
    if (!url || new URL(url).origin !== 'http://127.0.0.1:5173') throw new Error('Refusing to load an unverified Vite development server URL');
    win.loadURL(url);
  }
  win.webContents.on('did-finish-load', () => publish('agent:status', runtime.getStatus()));
}

ipcMain.handle('runtime:status', event => { requireTrustedSender(event); return runtime?.getStatus() || { status: 'stopped', error: 'Runtime is not available.' }; });
ipcMain.handle('sessions:list', event => { requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.'); return runtime.listSessions(); });
ipcMain.handle('sessions:create', event => { requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.'); return runtime.createSession(); });
ipcMain.handle('sessions:open', (event, sessionId) => { requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.'); return runtime.openSession(sessionId); });
ipcMain.handle('sessions:rename', (event, sessionId, title) => { requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.'); return runtime.renameSession(sessionId, title); });
ipcMain.handle('sessions:context-menu', async (event, sessionId) => {
  requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.');
  const state = await runtime.getSessionMenuState(sessionId);
  const reportError = error => dialog.showErrorBox('会话操作失败', error instanceof Error ? error.message : String(error));
  const menu = Menu.buildFromTemplate([
    { label: '重命名', click: () => publish('agent:event', { type: 'session-rename-requested', sessionId, title: state.title }) },
    { label: state.pinned ? '取消置顶' : '置顶', click: () => { void runtime.setSessionPinned(sessionId, !state.pinned).catch(reportError); } },
    { type: 'separator' },
    { label: '永久删除', enabled: state.canDelete, click: () => {
      void (async () => {
        const confirmation = await dialog.showMessageBox(win, {
          type: 'warning', title: '永久删除会话', message: `永久删除「${state.title}」？`,
          detail: state.hasCodexThread
            ? 'Vantilo 本地会话记录与对应的 Codex 线程都会永久删除。项目文件不会被删除。'
            : '此会话尚无 Codex 线程；只会永久删除 Vantilo 本地会话记录。',
          buttons: ['取消', '永久删除'], defaultId: 0, cancelId: 0, noLink: true
        });
        if (confirmation.response !== 1) return;
        await runtime.deleteSession(sessionId);
        publish('agent:event', { type: 'session-deleted', sessionId });
      })().catch(reportError);
    } }
  ]);
  menu.popup({ window: win });
  return { shown: true };
});
ipcMain.handle('sessions:delete', async (event, sessionId) => {
  requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.');
  const confirmation = await dialog.showMessageBox(win, {
    type: 'warning', title: '永久删除会话', message: '永久删除此会话？',
    detail: '此操作无法撤销。Vantilo 本地会话记录与对应的 Codex 线程都会永久删除；项目文件不会被删除。',
    buttons: ['取消', '永久删除'], defaultId: 0, cancelId: 0, noLink: true
  });
  if (confirmation.response !== 1) return { sessionId, deleted: false };
  return { ...(await runtime.deleteSession(sessionId)), deleted: true };
});
ipcMain.handle('models:list', event => { requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.'); return runtime.listModels(); });
ipcMain.handle('session:model-config', (event, sessionId, modelId, reasoningEffort) => { requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.'); return runtime.setSessionModelConfig(sessionId, modelId, reasoningEffort); });
ipcMain.handle('workspace:state', event => { requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.'); return runtime.getWorkspace(); });
ipcMain.handle('workspace:choose', async event => {
  requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.');
  const current = await runtime.getWorkspace();
  const options = { title: '选择 Vantilo 授权工作区文件夹', properties: ['openDirectory'], ...(current.root ? { defaultPath: current.root } : {}) };
  const selected = await dialog.showOpenDialog(win, options);
  if (selected.canceled || !selected.filePaths[0]) return { canceled: true, workspace: await runtime.getWorkspace() };
  return { canceled: false, workspace: await runtime.setWorkspace(selected.filePaths[0]) };
});
ipcMain.handle('workspace:pick-references', async event => {
  requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.');
  const current = await runtime.getWorkspace();
  if (!current.root) throw new Error('请先选择已授权的工作区，再附加工作区引用。');
  const selected = await dialog.showOpenDialog(win, { title: '从已授权工作区附加文件或文件夹', defaultPath: current.root, properties: ['openFile', 'openDirectory', 'multiSelections'] });
  if (selected.canceled || !selected.filePaths.length) return { canceled: true, references: [] };
  return { canceled: false, references: await runtime.validateWorkspaceReferences(selected.filePaths) };
});
ipcMain.handle('workspace:clear', async event => { requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.'); return runtime.clearWorkspace(); });
ipcMain.handle('projects:list', event => { requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.'); return runtime.listProjects(); });
ipcMain.handle('workspace:project-menu', async (event, requestedPath) => {
  requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.');
  const project = await runtime.resolveKnownProjectPath(requestedPath);
  const finderLabel = process.platform === 'darwin' ? '在 Finder 中显示' : '在文件管理器中显示';
  const reportError = error => dialog.showErrorBox('项目操作失败', error instanceof Error ? error.message : String(error));
  const menu = Menu.buildFromTemplate([
    { label: project.pinned ? '取消置顶' : '置顶', click: () => {
      void runtime.setProjectPinned(project.path, !project.pinned).catch(reportError);
    } },
    { type: 'separator' },
    { label: finderLabel, click: () => {
      try { shell.showItemInFolder(project.path); }
      catch (error) { reportError(error); }
    } },
    { type: 'separator' },
    { label: '移除项目', enabled: project.canRemove, click: () => {
      void (async () => {
        const confirmation = await dialog.showMessageBox(win, {
          type: 'warning', title: '移除项目', message: `从 Vantilo 移除「${path.basename(project.path)}」？`,
          detail: `项目文件夹及其中的文件不会被删除。相关会话历史会保留在「最近」中。${project.active ? '当前工作区授权也会一并清除。' : ''}`,
          buttons: ['取消', '移除项目'], defaultId: 0, cancelId: 0, noLink: true
        });
        if (confirmation.response !== 1) return;
        await runtime.removeProject(project.path);
      })().catch(reportError);
    } }
  ]);
  menu.popup({ window: win });
  return { shown: true };
});
ipcMain.handle('tool:approval', (event, request) => { requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.'); return runtime.resolveToolApproval(request.approvalId, request.sessionId, request.taskId, request.decision); });
ipcMain.handle('agent:submit', (event, sessionId, text) => { requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.'); return runtime.submit(sessionId, text); });
ipcMain.handle('agent:cancel', (event, taskId) => { requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.'); return runtime.cancel(taskId); });

app.whenReady().then(() => {
  installApplicationMenu();
  installIsolatedWebTabs({ ipcMain, BrowserWindow, WebContentsView, session, trustedSender });
  runtime = new RuntimeSupervisor({ utilityProcess, entryPath: path.join(__dirname, 'runtime-entry.cjs'), args: [app.getPath('userData')], cwd: process.cwd() });
  runtime.on('status', status => publish('agent:status', status));
  runtime.on('event', event => publish('agent:event', event));
  runtime.on('exit', () => {});
  createWindow();
  runtime.start().catch(() => { /* the structured status is shown by the renderer */ });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', event => {
  if (quitting || !runtime) return;
  event.preventDefault(); quitting = true;
  runtime.stop().finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());

module.exports = { trustedSender };
