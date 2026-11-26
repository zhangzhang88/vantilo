const {createSoftwareUpdateService,resolveUpdateCurrentVersion}=require('./software-update-service.cjs');
const softwareUpdateSource=require('../resources/software-update-source.json');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, utilityProcess, session, nativeImage, safeStorage, powerMonitor, net } = require('electron');
const path = require('node:path');
const { installReaderNavigation } = require('./magazine-reader-navigation.cjs');
const { PortableReaderSupervisor } = require('./portable-reader-supervisor.cjs');
const { packagedReaderSeedDir } = require('./reader-seed-path.cjs');
const { readerSessionCookies } = require('./reader-session-cookie.cjs');
const { createReaderOnboarding } = require('./reader-onboarding.cjs');
const { createReaderTtsInstaller, createElectronNetFetch } = require('./reader-tts-installer.cjs');
const { createReaderCustomApi } = require('./reader-custom-api.cjs');
const { createGutenbergIntroService } = require('./gutenberg-intro.cjs');
const { listGutenbergIntroEngines } = require('./gutenberg-intro-engines.cjs');
const { isTrustedSender, isTrustedPageUrl, PACKAGED_RENDERER_PATH } = require('./ipc-security.cjs');
const { checkStartupTransactions } = require('./transaction-startup-guard.cjs');
const { acquireReaderDataLockSync } = require('./reader-data-lock.cjs');
const { createVocabularyBackupDocument, writeVocabularyBackupAtomic, formatVocabularyBackupFilename, sanitizeVocabularySnapshot } = require('./vocabulary-backup-service.cjs');

// Preserve the existing userData directory while branding the native app as Vantilo.
const existingUserDataPath = app.getPath('userData');
app.setName('Vantilo');
app.setPath('userData', existingUserDataPath);

// Acquire the OS shared lock synchronously before app.whenReady(), BrowserWindow,
// or the Reader service can open protected Reader stores. macOS O_SHLOCK
// is atomic and the kernel releases it only when this process closes the descriptor.
let readerDataLease = null;
let readerDataLockError = null;
const explicitUserDataPath = Boolean(app.commandLine?.hasSwitch?.('user-data-dir') || process.argv.some(value => value.startsWith('--user-data-dir=')));
if (process.platform === 'darwin') {
  try { readerDataLease = acquireReaderDataLockSync(existingUserDataPath, { createIfMissing: !explicitUserDataPath }); }
  catch (error) { readerDataLockError = error; }
}
let primaryApplicationInstance = true;
try { primaryApplicationInstance = app.requestSingleInstanceLock?.() ?? true; }
catch (error) { primaryApplicationInstance = false; readerDataLockError ||= error; }
if (!primaryApplicationInstance) { readerDataLease?.close(); readerDataLease = null; }

let win;
let readerCustomApiService;
const vocabularyBackupSessions = new Map();
let lastVocabularyBackup = null;
let gutenbergIntroService;
const gutenbergIntroRequests = new Map();
function getGutenbergIntroService() {
  if (!gutenbergIntroService) gutenbergIntroService = createGutenbergIntroService({
    cacheDir: path.join(app.getPath('userData'), 'gutenberg-intros-v1'),
    customApi: getReaderCustomApiService(),
  });
  return gutenbergIntroService;
}
function getReaderCustomApiService() {
  if(!readerCustomApiService)readerCustomApiService=createReaderCustomApi({
    filePath:path.join(app.getPath('userData'),'reader-custom-api-v1.json'),
    safeStorage,
    fetchImpl:(url,init)=>(typeof net?.fetch==='function'?net.fetch(url,init):globalThis.fetch(url,init)),
  });
  return readerCustomApiService;
}
const readerAssets = !app.isPackaged && process.env.VANTILO_DEV_SERVER_URL && process.env.VANTILO_DEV_READER_ASSETS
  ? path.resolve(process.env.VANTILO_DEV_READER_ASSETS)
  : path.join(__dirname, app.isPackaged ? '../reader' : '../build/reader');
// A missing build must fail startup; never fall back to the source project's independent auth/API.
const usePortableReader = true;
const readerOnboarding = createReaderOnboarding({ userData: app.getPath('userData'), assetsDir: readerAssets });
let magazineReaderSupervisor;
const readerTtsInstaller = createReaderTtsInstaller({
  userData: app.getPath('userData'),
  fetchImpl: typeof net?.request === 'function'
    ? createElectronNetFetch(net)
    : (url, init) => (typeof net?.fetch === 'function' ? net.fetch(url, init) : globalThis.fetch(url, init)),
  onInstalledChange: info => {
    magazineReaderSupervisor?.resetLocalSpeech?.();
    publish('reader:tts-updated', { installed: Boolean(info?.installed) });
  },
});
const softwareUpdates=createSoftwareUpdateService({userData:app.getPath('userData'),currentVersion:resolveUpdateCurrentVersion({isPackaged:app.isPackaged,currentVersion:app.getVersion(),testVersion:process.env.VANTILO_UPDATE_TEST_CURRENT_VERSION}),source:softwareUpdateSource,openExternal:url=>shell.openExternal(url),showItemInFolder:file=>shell.showItemInFolder(file),chooseDownloadDirectory:async()=>{let defaultPath;try{defaultPath=app.getPath('downloads');}catch{}const result=await dialog.showOpenDialog(win,{title:'选择更新包下载位置',defaultPath,properties:['openDirectory','createDirectory']});return result.canceled?null:result.filePaths[0];},
  onAvailable:async state=>{if(!win||win.isDestroyed())return;const result=await dialog.showMessageBox(win,{type:'info',title:'Vantilo 软件更新',message:'发现新版本 '+state.latestVersion,detail:'当前版本 '+state.currentVersion+'。可前往 GitHub 发布页下载安装，应用不会强制退出。',buttons:['稍后','前往发布页'],defaultId:0,cancelId:0});if(result.response===1)await softwareUpdates.openRelease();}
});
magazineReaderSupervisor = new PortableReaderSupervisor({
  softwareUpdates,
  ttsInstaller: readerTtsInstaller,
  utilityProcess,
  enableTranslation: true,
  enableReaderPreviews: true,
  customApi: async (operation,payload,signal) => {
    const service=getReaderCustomApiService();
    const result=operation==='activate'||operation==='remove'?await service[operation](payload.id):operation==='models'?await service.listModels(payload):await service[operation](operation==='complete'?{...payload,signal}:payload);
    return operation==='complete'?{output:result}:result;
  },
  assetsDir: readerAssets,
  libraryRoot: path.join(app.getPath('userData'), 'reader-library'),
  userDataRoot: app.getPath('userData'),
  seedDir: packagedReaderSeedDir({ isPackaged: app.isPackaged, assetsDir: readerAssets }),
  cancelAi: async () => ({ canceled: false }),
  getAccountStatus: async () => ({ connected: false, email: null }),
  listModels: async () => ({ models: [] }),
  runAi: async () => { throw new Error('已移除 ChatGPT / Codex 登录，请在阅读设置中选择 AI 模型服务。'); },
  ...readerSessionCookies(()=>session.defaultSession),
});
let quitting = false;
let startupAborted = false;

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
  if (process.platform === 'darwin') readerDataLease?.assertHeld();
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
}

ipcMain.handle('reader:setup-state', (event, ...args) => {
  requireTrustedSender(event); if (args.length) throw new Error('Invalid setup request');
  return readerOnboarding.getState();
});
ipcMain.handle('reader:setup-check', (event, ...args) => {
  requireTrustedSender(event); if (args.length) throw new Error('Invalid setup request');
  return readerOnboarding.check();
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
ipcMain.handle('reader:tts-status', (event, ...args) => {
  requireTrustedSender(event); if (args.length) throw new Error('Invalid TTS status request');
  return readerTtsInstaller.getStatus();
});
ipcMain.handle('reader:tts-install', (event, options, ...args) => {
  requireTrustedSender(event);
  if (args.length || !options || typeof options !== 'object' || Array.isArray(options) || options.consent !== true || (options.mirror !== undefined && typeof options.mirror !== 'boolean')) {
    throw new Error('下载离线语音模型前必须由用户明确确认');
  }
  return readerTtsInstaller.install({ consent: true, mirror: Boolean(options.mirror) });
});
ipcMain.handle('reader:tts-cancel', (event, ...args) => {
  requireTrustedSender(event); if (args.length) throw new Error('Invalid TTS cancel request');
  return readerTtsInstaller.cancel();
});
ipcMain.handle('reader:tts-remove', (event, ...args) => {
  requireTrustedSender(event); if (args.length) throw new Error('Invalid TTS remove request');
  return readerTtsInstaller.remove();
});
ipcMain.handle('reader:custom-api-get', (event, ...args) => {
  requireTrustedSender(event); if (args.length) throw new Error('Invalid custom API request');
  return getReaderCustomApiService().get();
});
ipcMain.handle('reader:custom-api-save', async (event, config, ...args) => {
  requireTrustedSender(event);
  if (args.length || !config || typeof config !== 'object' || Array.isArray(config)) throw new Error('自定义 API 设置无效');
  const saved = await getReaderCustomApiService().save(config);
  publish('reader:custom-api-updated', { configured: Boolean(saved?.configured) });
  return saved;
});
ipcMain.handle('reader:custom-api-test', (event, config, ...args) => {
  requireTrustedSender(event);
  if (args.length || !config || typeof config !== 'object' || Array.isArray(config)) throw new Error('自定义 API 设置无效');
  return getReaderCustomApiService().test(config);
});
ipcMain.handle('reader:custom-api-models', (event, config, ...args) => {
  requireTrustedSender(event);
  if (args.length || !config || typeof config !== 'object' || Array.isArray(config)) throw new Error('模型列表请求参数无效');
  return getReaderCustomApiService().listModels(config);
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
  if (process.platform === 'darwin') readerDataLease?.assertHeld();
  return magazineReaderSupervisor.start();
});
ipcMain.handle('vocabulary-backup:start', async (event, requestId, ...args) => {
  requireTrustedSender(event);
  if (args.length || typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error('词汇备份请求无效');
  if (vocabularyBackupSessions.size) throw new Error('已有词汇备份正在进行中');
  if (quitting || magazineReaderSupervisor.getStatus().status !== 'ready') throw new Error('请先打开 Reader，再开始词汇备份');
  let defaultPath;
  try {
    const downloads = app.getPath('downloads');
    const stat = await require('node:fs/promises').stat(downloads);
    await require('node:fs/promises').access(downloads, require('node:fs').constants.W_OK);
    if (stat.isDirectory()) defaultPath = path.join(downloads, formatVocabularyBackupFilename());
  } catch { /* Do not fall back to a stale or external Downloads path. */ }
  let chosen;
  try {
    chosen = await dialog.showSaveDialog(win, {
      title: '保存词汇备份', ...(defaultPath ? { defaultPath } : {}), buttonLabel: '保存备份',
      filters: [{ name: 'Vantilo 词汇备份', extensions: ['json'] }],
    });
  } catch (error) {
    publish('vocabulary-backup:event', { type: 'status', requestId, phase: 'FAILED', progress: 0, message: error instanceof Error ? error.message : '无法打开备份保存位置' });
    publish('vocabulary-backup:event', { type: 'resume', requestId });
    throw error;
  }
  if (chosen.canceled || !chosen.filePath) {
    publish('vocabulary-backup:event', { type: 'status', requestId, phase: 'CANCELLED', progress: 0, message: '已取消词汇备份。' });
    publish('vocabulary-backup:event', { type: 'resume', requestId });
    return { canceled: true };
  }
  const savePath = path.resolve(chosen.filePath);
  if (path.extname(savePath).toLowerCase() !== '.json') {
    const error = new Error('词汇备份必须保存为 .json 文件');
    publish('vocabulary-backup:event', { type: 'status', requestId, phase: 'FAILED', progress: 0, message: error.message });
    publish('vocabulary-backup:event', { type: 'resume', requestId });
    throw error;
  }
  const controller = new AbortController();
  let resolveSnapshot, rejectSnapshot, snapshotReceived = false;
  const snapshotPromise = new Promise((resolve, reject) => { resolveSnapshot = resolve; rejectSnapshot = reject; });
  let finishBackup;
  const finished = new Promise(resolve => { finishBackup = resolve; });
  const context = { requestId, controller, savePath, resolveSnapshot, rejectSnapshot, snapshotPromise, finished, phase: 'FREEZING', get snapshotReceived() { return snapshotReceived; }, set snapshotReceived(value) { snapshotReceived = value; } };
  vocabularyBackupSessions.set(requestId, context);
  try {
    publish('vocabulary-backup:event', { type: 'status', requestId, phase: 'FREEZING', progress: 0, message: '正在暂停词汇写入并创建一致性快照' });
    publish('vocabulary-backup:event', { type: 'freeze', requestId });
    let snapshotTimer;
    const snapshot = await Promise.race([
      snapshotPromise,
      new Promise((_, reject) => { snapshotTimer = setTimeout(() => reject(new Error('词汇数据快照超时，未写入备份文件')), 60000); }),
    ]).finally(() => clearTimeout(snapshotTimer));
    controller.signal.throwIfAborted();
    publish('vocabulary-backup:event', { type: 'status', requestId, phase: 'WRITING', progress: 35, message: '正在写入并校验词汇备份' });
    context.phase = 'WRITING';
    const document = createVocabularyBackupDocument({ snapshot: sanitizeVocabularySnapshot(snapshot), appVersion: app.getVersion() });
    const result = await writeVocabularyBackupAtomic({ savePath, document });
    lastVocabularyBackup = { createdAt: new Date().toISOString(), name: result.name, path: result.path, size: result.size, sha256: result.sha256, vocabularyCount: document.counts.vocabulary };
    try {
      const fs = require('node:fs/promises');
      const file = path.join(app.getPath('userData'), 'vocabulary-backup-status-v1.json');
      const temporary = `${file}.${require('node:crypto').randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify({ version: 1, lastBackup: lastVocabularyBackup }), { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, file);
    } catch { /* A verified export remains valid if the convenience status cannot be stored. */ }
    publish('vocabulary-backup:event', { type: 'status', requestId, phase: 'COMPLETED', progress: 100, message: '备份完成，SHA-256 校验通过', result: { name: result.name, size: result.size, sha256: result.sha256, vocabularyCount: document.counts.vocabulary } });
    return { completed: true, ...result, vocabularyCount: document.counts.vocabulary };
  } catch (error) {
    const message = error instanceof Error ? error.message : '词汇备份失败';
    publish('vocabulary-backup:event', { type: 'status', requestId, phase: controller.signal.aborted ? 'CANCELLED' : 'FAILED', progress: 0, message });
    throw error;
  } finally {
    publish('vocabulary-backup:event', { type: 'resume', requestId });
    vocabularyBackupSessions.delete(requestId);
    finishBackup();
  }
});
ipcMain.handle('vocabulary-backup:snapshot', (event, requestId, snapshot, ...args) => {
  requireTrustedSender(event);
  if (args.length || typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error('词汇备份快照请求无效');
  const context = vocabularyBackupSessions.get(requestId);
  if (!context || context.snapshotReceived) throw new Error('词汇备份请求已结束或快照重复');
  const safeSnapshot = sanitizeVocabularySnapshot(snapshot);
  context.snapshotReceived = true;
  context.resolveSnapshot(safeSnapshot);
  publish('vocabulary-backup:event', { type: 'unfreeze', requestId });
  return { accepted: true };
});
ipcMain.handle('vocabulary-backup:cancel', (event, requestId, ...args) => {
  requireTrustedSender(event);
  if (args.length || typeof requestId !== 'string') throw new Error('词汇备份取消请求无效');
  const context = vocabularyBackupSessions.get(requestId);
  if (!context) return { canceled: false };
  if (context.phase === 'WRITING') return { canceled: false };
  context.controller.abort(new Error('用户取消词汇备份'));
  context.rejectSnapshot(new Error('词汇备份已取消'));
  return { canceled: true };
});
ipcMain.handle('vocabulary-backup:reveal', async event => {
  requireTrustedSender(event);
  if (!lastVocabularyBackup?.path) throw new Error('当前没有可定位的词汇备份文件');
  const info = await require('node:fs/promises').lstat(lastVocabularyBackup.path);
  if (!info.isFile() || info.isSymbolicLink() || path.extname(lastVocabularyBackup.path).toLowerCase() !== '.json') throw new Error('词汇备份文件已不可用');
  shell.showItemInFolder(lastVocabularyBackup.path);
  return { shown: true };
});
ipcMain.handle('vocabulary-backup:status', async event => {
  requireTrustedSender(event);
  if (lastVocabularyBackup) return { lastBackup: lastVocabularyBackup };
  const file = path.join(app.getPath('userData'), 'vocabulary-backup-status-v1.json');
  try {
    const value = JSON.parse(await require('node:fs/promises').readFile(file, 'utf8'));
    const item = value?.lastBackup;
    if (value?.version !== 1 || !item || typeof item.createdAt !== 'string' || typeof item.name !== 'string' || typeof item.path !== 'string'
      || !Number.isSafeInteger(item.size) || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.vocabularyCount)) return { lastBackup: null };
    lastVocabularyBackup = item;
    return { lastBackup: item };
  } catch (error) { if (error.code === 'ENOENT') return { lastBackup: null }; throw new Error('无法读取词汇备份记录'); }
});
ipcMain.handle('gutenberg:request', async (event, request) => {
  requireTrustedSender(event);
  if (!usePortableReader || quitting || magazineReaderSupervisor.status !== 'ready') throw new Error('请先打开阅读空间');
  if (!request || typeof request !== 'object' || Array.isArray(request) || !['search','detail','acquire','intro','introCached','introCancel','introEngines'].includes(request.operation)) throw new Error('Invalid Gutenberg request');
  const isIntro = ['intro','introCached','introCancel'].includes(request.operation);
  const allowed = request.operation === 'introEngines' ? ['operation'] : isIntro ? ['operation','id','engine','force','modelId','reasoningEffort','customEngineId'] : request.operation === 'detail' ? ['operation','id'] : request.operation === 'search' ? ['operation','query','topic','page'] : ['operation','id','filename','categoryId'];
  if (Object.keys(request).some(key => !allowed.includes(key))) throw new Error('Invalid Gutenberg request');
  if (request.operation === 'introEngines') {
    return listGutenbergIntroEngines({ customApi: getReaderCustomApiService() });
  }
  if (isIntro) {
    if (!Number.isSafeInteger(request.id) || request.id < 1 || request.id > 10000000) throw new Error('Gutenberg ID 无效');
    if (request.engine !== undefined && request.engine !== 'custom') throw new Error('已移除 Codex 引擎，请在阅读设置中选择自定义 API 服务');
    if (request.customEngineId !== undefined && (request.operation === 'introCancel' || typeof request.customEngineId !== 'string' ||
      !/^custom-api:[a-f0-9]{12}$/.test(request.customEngineId))) throw new Error('自定义 API 模型标识无效');
    if (request.modelId !== undefined && request.modelId !== null && (typeof request.modelId !== 'string' || request.modelId.length > 256 || !request.modelId)) throw new Error('模型设置无效');
    if (request.reasoningEffort !== undefined && request.reasoningEffort !== null && (typeof request.reasoningEffort !== 'string' || request.reasoningEffort.length > 64 || !request.reasoningEffort)) throw new Error('思考强度无效');
    if (request.force !== undefined && (request.operation !== 'intro' || typeof request.force !== 'boolean')) throw new Error('重新生成参数无效');
    if (request.operation === 'introCancel') {
      gutenbergIntroRequests.get(request.id)?.abort(new Error('用户取消生成'));
      return { canceled: true };
    }
    if (request.operation === 'introCached') return getGutenbergIntroService().cached({ id: request.id, engine: 'custom', modelId: request.modelId ?? null, reasoningEffort: request.reasoningEffort ?? null, customEngineId: request.customEngineId });
    gutenbergIntroRequests.get(request.id)?.abort(new Error('新请求已替换旧请求'));
    const controller = new AbortController();
    gutenbergIntroRequests.set(request.id, controller);
    const timer = setTimeout(() => controller.abort(new Error('中文介绍生成超时')), 75000);
    try { return await getGutenbergIntroService().generate({ id: request.id, engine: 'custom', force: request.force ?? false, modelId: request.modelId ?? null, reasoningEffort: request.reasoningEffort ?? null, customEngineId: request.customEngineId }, { signal: controller.signal }); }
    finally { clearTimeout(timer); if (gutenbergIntroRequests.get(request.id) === controller) gutenbergIntroRequests.delete(request.id); }
  }
  const targetPath = request.operation==='search' ? '/api/vantilo-gutenberg/search' : request.operation==='detail' ? '/api/vantilo-gutenberg/books/'+encodeURIComponent(String(request.id)) : '/api/vantilo-gutenberg/acquire';
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
  try {
    const url=new URL(targetPath,magazineReaderSupervisor.apiOrigin);
    if(request.operation==='search')for(const key of ['query','topic','page'])if(request[key]!==undefined&&request[key]!=='' )url.searchParams.set(key,String(request[key]));
    const token=magazineReaderSupervisor.sessionToken;
    const response=await fetch(url,{method:request.operation==='acquire'?'POST':'GET',redirect:'error',signal:controller.signal,headers:{host:new URL(magazineReaderSupervisor.apiOrigin).host,origin:magazineReaderSupervisor.webOrigin,'sec-fetch-site':'same-origin',cookie:'__Host-vantilo-reader='+token,...(request.operation==='acquire'?{'content-type':'application/json'}:{})},...(request.operation==='acquire'?{body:JSON.stringify({id:request.id,filename:request.filename,categoryId:request.categoryId})}:{})});
    const body=await response.json();if(!response.ok)throw new Error(body.error||'Project Gutenberg 服务暂不可用');return body;
  } finally {clearTimeout(timer);}
});

app.whenReady().then(async () => {
  if (process.env.VANTILO_VOCABULARY_E2E_MODE && global.__vocabularyIsolatedE2E === true) {
    try {
      if (!global.__vocabularyIsolationVerificationPromise) throw new Error('Vocabulary E2E did not install its fail-closed userData verification gate.');
      await global.__vocabularyIsolationVerificationPromise;
    } catch (error) {
      startupAborted = true;
      console.error('Vocabulary E2E isolation gate rejected startup:', error?.message || error);
      app.quit();
      return;
    }
  }
  if (!primaryApplicationInstance) { startupAborted = true; app.quit(); return; }
  if (readerDataLockError) {
    startupAborted = true;
    const detail = readerDataLockError.code === 'ERR_READER_DATA_LOCK_BUSY'
      ? 'Reader 数据正在维护，或另一个 Vantilo 实例仍在访问它。请等待当前操作结束后再启动。'
      : '无法确认 Reader 数据目录和访问锁。为保护原数据，Vantilo 未启动 Reader 或窗口。请确认数据卷已挂载且路径未更改。';
    try { await dialog.showMessageBox({type:'error', title:'Vantilo 数据保护', message:'无法安全打开 Reader 数据', detail, buttons:['退出']}); }
    finally { app.quit(); }
    return;
  }
  let transactionState;
  try { transactionState = await checkStartupTransactions(app.getPath('userData')); }
  catch { transactionState = { safe: false, reason: 'invalid' }; }
  if (startupAborted) return;
  if (!transactionState.safe) {
    const detail = transactionState.reason === 'maintenance_lock'
      ? '发现数据维护锁。请保留锁记录和所有恢复材料，确认维护状态后再处理。'
      : transactionState.reason === 'maintenance_requested'
        ? '发现尚未完成的 Reader 维护请求。请保留请求记录和所有恢复材料，确认维护状态后再启动。'
      : transactionState.reason === 'unfinished'
        ? '发现尚未完成的数据事务。请保留事务记录和所有恢复材料，联系支持人员处理。'
        : '事务记录无法读取或已损坏。请保留原始记录和所有恢复材料，联系支持人员处理。';
    try { await dialog.showMessageBox({type:'error', title:'Vantilo 数据保护', message:'无法安全启动', detail, buttons:['退出']}); }
    finally { app.quit(); }
    return;
  }
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, '../resources/vantilo-icon.png')));
  }
  installApplicationMenu();
  createWindow();
  void softwareUpdates.start();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on('second-instance', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); } });
  powerMonitor.on('suspend', () => { if (win && !win.isDestroyed()) win.webContents.send('system:suspended'); });
  powerMonitor.on('lock-screen', () => { if (win && !win.isDestroyed()) win.webContents.send('system:suspended'); });
});

app.on('before-quit', event => {
  startupAborted = true;
  if (!quitting && vocabularyBackupSessions.size) {
    event.preventDefault();
    const activeBackups = [...vocabularyBackupSessions.values()];
    for (const backup of activeBackups) {
      backup.controller.abort(new Error('Vantilo 正在关闭'));
      backup.rejectSnapshot(new Error('Vantilo 正在关闭，词汇备份已取消'));
    }
    void Promise.allSettled(activeBackups.map(backup => backup.finished)).finally(() => { quitting = false; app.quit(); });
    return;
  }
  if (quitting || magazineReaderSupervisor.getStatus().status === 'idle') {
    void readerTtsInstaller?.cancel().catch(() => {});
    return;
  }
  event.preventDefault(); quitting = true;
  Promise.allSettled([readerTtsInstaller?.cancel(), magazineReaderSupervisor.stop(), softwareUpdates?.stop()]).finally(() => app.quit());
});
app.on('will-quit', () => { readerDataLease?.close(); readerDataLease = null; });
app.on('window-all-closed', () => app.quit());

module.exports = { trustedSender };
