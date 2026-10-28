const {createSoftwareUpdateService}=require('./software-update-service.cjs');
const softwareUpdateSource=require('../resources/software-update-source.json');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, utilityProcess, session, nativeImage, safeStorage } = require('electron');
const path = require('node:path');
const { installReaderNavigation } = require('./magazine-reader-navigation.cjs');
const { RuntimeSupervisor } = require('./runtime-supervisor.cjs');
const { PortableReaderSupervisor } = require('./portable-reader-supervisor.cjs');
const { readerSessionCookies } = require('./reader-session-cookie.cjs');
const { createReaderOnboarding, MODEL_INFO_URL } = require('./reader-onboarding.cjs');
const { createReaderModelService } = require('./reader-model-service.cjs');
const { createReaderCustomApi } = require('./reader-custom-api.cjs');
const { isTrustedSender, isTrustedPageUrl, PACKAGED_RENDERER_PATH } = require('./ipc-security.cjs');

// Preserve the existing userData directory while branding the native app as Vantilo.
const existingUserDataPath = app.getPath('userData');
app.setName('Vantilo');
app.setPath('userData', existingUserDataPath);

let win;
let runtime;
let readerCustomApiService;
function getReaderCustomApiService() {
  if(!readerCustomApiService)readerCustomApiService=createReaderCustomApi({filePath:path.join(app.getPath('userData'),'reader-custom-api-v1.json'),safeStorage});
  return readerCustomApiService;
}
const readerAssets = path.join(__dirname, app.isPackaged ? '../reader' : '../build/reader');
// A missing build must fail startup; never fall back to the source project's independent auth/API.
const usePortableReader = true;
const readerOnboarding = createReaderOnboarding({ userData: app.getPath('userData'), assetsDir: readerAssets });
// Experimental model controls are intentionally isolated to the separately branded preview.
const modelSetupPreview = app.isPackaged && process.env.VANTILO_READER_PREVIEW === '1';
const readerQwenIntegrated = modelSetupPreview && process.arch === 'arm64' && path.basename(app.getPath('userData')) === 'Vantilo Qwen Setup Preview';
// Local Qwen is supported only by the existing Apple Silicon MLX path.
// Intel devices use configured cloud/LAN APIs instead of a second local runtime.
const readerModelService = modelSetupPreview && process.platform === 'darwin' && process.arch === 'arm64' ? createReaderModelService({ userData: app.getPath('userData'), assetsDir: readerAssets }) : null;
function requireModelPreview(event, args) {
  requireTrustedSender(event);
  if (args.length || !readerModelService) throw new Error('本地模型安装功能尚未开放。');
}
const softwareUpdates=createSoftwareUpdateService({userData:app.getPath('userData'),currentVersion:app.getVersion(),source:softwareUpdateSource,openExternal:url=>shell.openExternal(url),
  onAvailable:async state=>{if(!win||win.isDestroyed())return;const result=await dialog.showMessageBox(win,{type:'info',title:'Vantilo 软件更新',message:'发现新版本 '+state.latestVersion,detail:'当前版本 '+state.currentVersion+'。可前往 GitHub 发布页下载安装，应用不会强制退出。',buttons:['稍后','前往发布页'],defaultId:0,cancelId:0});if(result.response===1)await softwareUpdates.openRelease();}
});
const magazineReaderSupervisor = new PortableReaderSupervisor({ softwareUpdates, utilityProcess, enableLocalQwen: readerQwenIntegrated && process.arch === 'arm64', enableTranslation: true, enableReaderPreviews: true, customApi: async (operation,payload,signal) => {const service=getReaderCustomApiService();const result=operation==='activate'||operation==='remove'?await service[operation](payload.id):await service[operation](operation==='complete'?{...payload,signal}:payload);return operation==='complete'?{output:result}:result;}, edgeTtsExecutable: process.env.VANTILO_EDGE_TTS_EXECUTABLE || null, assetsDir: readerAssets, libraryRoot: path.join(app.getPath('userData'), 'reader-library'), cancelAi: requestId => runtime.request('reader:cancel', {requestId}), getAccountStatus: () => runtime.request('account:status', {}), listModels: () => runtime.request('models:list', {}), runAi: payload => { if (!runtime) return Promise.reject(new Error('Agent 未连接')); return runtime.request('reader:ai', payload); },
  ...readerSessionCookies(()=>session.defaultSession),
});
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
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, target) => {
    if (!isTrustedPageUrl(target, { packaged: app.isPackaged, rendererPath: PACKAGED_RENDERER_PATH })) event.preventDefault();
  });
  installReaderNavigation(win.webContents, { packaged: app.isPackaged, rendererPath: PACKAGED_RENDERER_PATH });
  if (app.isPackaged) win.loadFile(PACKAGED_RENDERER_PATH);
  else {
    const url = process.env.VANTILO_DEV_SERVER_URL;
    if (!url || new URL(url).origin !== 'http://127.0.0.1:5173') throw new Error('Refusing to load an unverified Vite development server URL');
    win.loadURL(url);
  }
  win.webContents.on('did-finish-load', () => publish('agent:status', runtime.getStatus()));
}

ipcMain.handle('account:status', (event, ...args) => { requireTrustedSender(event); if (args.length || !runtime) throw new Error('Invalid account request'); return runtime.request('account:status', {}); });
ipcMain.handle('account:login', async (event, ...args) => {
  requireTrustedSender(event); if (args.length || !runtime) throw new Error('Invalid account request');
  const result = await runtime.request('account:login', {});
  const url = new URL(result.url);
  if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.username || url.password) throw new Error('Invalid login URL');
  await shell.openExternal(url.href);
  return { pending: true };
});
ipcMain.handle('account:logout', (event, ...args) => { requireTrustedSender(event); if (args.length || !runtime) throw new Error('Invalid account request'); return runtime.request('account:logout', {}); });
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
ipcMain.handle('session:permission-mode', (event, sessionId, permissionMode) => { requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.'); return runtime.setSessionPermissionMode(sessionId, permissionMode); });
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
ipcMain.handle('agent:submit', (event, sessionId, text, permissionMode) => { requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.'); return runtime.submit(sessionId, text, {permissionMode:permissionMode ?? 'supervised'}); });
ipcMain.handle('agent:cancel', (event, taskId) => { requireTrustedSender(event); if (!runtime) throw new Error('Runtime is not available.'); return runtime.cancel(taskId); });
ipcMain.handle('reader:setup-state', (event, ...args) => {
  requireTrustedSender(event); if (args.length) throw new Error('Invalid setup request');
  return readerOnboarding.getState();
});
ipcMain.handle('reader:setup-check', (event, ...args) => {
  requireTrustedSender(event); if (args.length) throw new Error('Invalid setup request');
  // Qwen Reader integration exists only in the explicitly isolated Qwen preview.
  return readerOnboarding.check().then(state => ({ ...state, ...(modelSetupPreview ? { modelSetupPreview:Boolean(readerModelService), readerQwenIntegrated } : {}) }));
});
ipcMain.handle('reader:setup-finish', (event, decision, ...args) => {
  requireTrustedSender(event); if (args.length) throw new Error('Invalid setup request');
  return readerOnboarding.finish(decision);
});
ipcMain.handle('reader:setup-dictionary', async (event, ...args) => {
  requireTrustedSender(event); if (args.length) throw new Error('Invalid setup request');
  if (process.platform !== 'darwin') return { opened: false, error: '该设置仅支持 macOS' };
  const result = await shell.openPath('/System/Applications/Dictionary.app');
  return { opened: !result, ...(result ? { error: '未能打开系统词典，请在应用程序中手动打开。' } : {}) };
});
ipcMain.handle('reader:setup-model-info', (event, ...args) => {
  requireTrustedSender(event); if (args.length) throw new Error('Invalid setup request');
  return shell.openExternal(MODEL_INFO_URL);
});
ipcMain.handle('reader:model-inspect', (event, ...args) => {
  requireModelPreview(event, args);
  return readerModelService.inspect();
});
ipcMain.handle('reader:model-check', (event, ...args) => {
  requireModelPreview(event, args);
  return readerModelService.recheck();
});
ipcMain.handle('reader:model-choose', async (event, ...args) => {
  requireModelPreview(event, args);
  const selected = await dialog.showOpenDialog(win, {
    title:'选择已经下载好的 Qwen3.5 4B MLX 模型文件夹',
    properties:['openDirectory'],
  });
  if (selected.canceled || selected.filePaths.length !== 1) return { canceled:true };
  const confirmation = await dialog.showMessageBox(win, {
    type:'question', title:'验证并采用现有模型',
    message:'使用你选择的本地模型？',
    detail:'Vantilo 将逐个校验文件，不复制或改写模型。通过校验后会运行一次固定英文句子的本机推理健康检查。',
    buttons:['取消','验证并使用'], defaultId:0,cancelId:0,noLink:true,
  });
  if (confirmation.response !== 1) return { canceled:true };
  return { canceled:false, result:await readerModelService.chooseExisting(selected.filePaths[0]) };
});
ipcMain.handle('reader:model-install', async (event, ...args) => {
  requireModelPreview(event, args);
  const info = await readerModelService.inspect();
  if (!info.hardware.supported) throw new Error('此 Mac 尚不支持该 MLX 模型');
  if (info.disk.availableBytes < info.disk.freshInstallBytes) throw new Error('磁盘可用空间不足');
  const confirmation = await dialog.showMessageBox(win, {
    type:'warning', title:'下载 Qwen3.5 模型',
    message:'确认从 Hugging Face 下载约 3.1GB 的 Qwen 模型？',
    detail:'仅从固定版本下载并进行 SHA-256 校验，下载需要网络。此操作完全可选；取消后暂存部分可供继续下载，不会自动启动模型。',
    buttons:['取消','确认下载'], defaultId:0,cancelId:0,noLink:true,
  });
  if (confirmation.response !== 1) return { canceled:true };
  return readerModelService.startDownload(payload => publish('reader:model-progress',payload));
});
ipcMain.handle('reader:model-cancel', (event, ...args) => {
  requireModelPreview(event, args);
  return readerModelService.cancelDownload();
});
ipcMain.handle('magazine-reader:sync', (event, ...args) => {
  requireTrustedSender(event);
  if (args.length || quitting || !usePortableReader) throw new Error('请先构建安装版阅读模块。');
  return magazineReaderSupervisor.synchronize();
});
ipcMain.handle('magazine-reader:status', event => {
  requireTrustedSender(event);
  return magazineReaderSupervisor.checkHealth();
});
ipcMain.handle('magazine-reader:start', (event, ...args) => {
  requireTrustedSender(event);
  if (args.length || quitting) throw new Error('Invalid Reader startup request.');
  return magazineReaderSupervisor.start();
});
ipcMain.handle('gutenberg:request', async (event, request) => {
  requireTrustedSender(event);
  if (!usePortableReader || quitting || magazineReaderSupervisor.status !== 'ready') throw new Error('请先打开阅读空间');
  if (!request || typeof request !== 'object' || Array.isArray(request) || !['search','detail','acquire'].includes(request.operation)) throw new Error('Invalid Gutenberg request');
  const allowed=request.operation==='search'?['operation','query','topic','page']:request.operation==='detail'?['operation','id']:['operation','id','filename','categoryId'];
  if(Object.keys(request).some(key=>!allowed.includes(key)))throw new Error('Invalid Gutenberg request');
  const path = request.operation==='search' ? '/api/vantilo-gutenberg/search' : request.operation==='detail' ? '/api/vantilo-gutenberg/books/'+encodeURIComponent(String(request.id)) : '/api/vantilo-gutenberg/acquire';
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
  try {
    const url=new URL(path,magazineReaderSupervisor.apiOrigin);
    if(request.operation==='search')for(const key of ['query','topic','page'])if(request[key]!==undefined&&request[key]!=='' )url.searchParams.set(key,String(request[key]));
    const token=magazineReaderSupervisor.sessionToken;
    const response=await fetch(url,{method:request.operation==='acquire'?'POST':'GET',redirect:'error',signal:controller.signal,headers:{host:new URL(magazineReaderSupervisor.apiOrigin).host,origin:magazineReaderSupervisor.webOrigin,'sec-fetch-site':'same-origin',cookie:'__Host-vantilo-reader='+token,...(request.operation==='acquire'?{'content-type':'application/json'}:{})},...(request.operation==='acquire'?{body:JSON.stringify({id:request.id,filename:request.filename,categoryId:request.categoryId})}:{})});
    const body=await response.json();if(!response.ok)throw new Error(body.error||'Project Gutenberg 服务暂不可用');return body;
  } finally {clearTimeout(timer);}
});

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, '../resources/vantilo-icon.png')));
  }
  installApplicationMenu();
  runtime = new RuntimeSupervisor({ utilityProcess, entryPath: path.join(__dirname, 'runtime-entry.cjs'), args: [app.getPath('userData'), ...(usePortableReader ? [path.join(readerAssets, 'codex')] : [])], cwd: usePortableReader ? app.getPath('userData') : process.cwd() });
  runtime.on('status', status => publish('agent:status', status));
  runtime.on('event', event => publish('agent:event', event));
  runtime.on('reader-delta', payload => magazineReaderSupervisor.deliverDelta(payload));
  runtime.on('exit', () => {});
  createWindow();
  runtime.start().catch(() => { /* the structured status is shown by the renderer */ });
  // This isolated preview checks new issues from app launch, even while Agent is visible.
  void softwareUpdates.start();
  if(readerQwenIntegrated)void magazineReaderSupervisor.start().catch(()=>{});
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', event => {
  if (quitting || (!runtime && magazineReaderSupervisor.getStatus().status === 'idle')) return;
  event.preventDefault(); quitting = true;
  readerModelService?.cancelDownload(); // Leave partial downloads resumable on shutdown.
  Promise.allSettled([runtime?.stop(), magazineReaderSupervisor.stop(), softwareUpdates?.stop()]).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());

module.exports = { trustedSender };
