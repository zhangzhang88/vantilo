'use strict';

require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { app, dialog, shell, session } = require('electron');

const root = process.env.VANTILO_VOCABULARY_E2E_ROOT;
const userData = process.env.VANTILO_VOCABULARY_E2E_USER_DATA;
const downloads = process.env.VANTILO_VOCABULARY_E2E_DOWNLOADS;
const resultPath = process.env.VANTILO_VOCABULARY_E2E_RESULT;
const mode = process.env.VANTILO_VOCABULARY_E2E_MODE;
const allowedModes = new Set(['source', 'target', 'verify', 'race-source', 'race-target', 'rollback-failure', 'rollback-recovery', 'disk-full', 'unwritable']);

function failClosed(message) {
  throw new Error(`词汇 E2E 隔离验证失败，已停止启动：${message}`);
}

function containedPath(candidate, label, { mustExist = true } = {}) {
  if (!candidate || !path.isAbsolute(candidate)) failClosed(`${label} 必须是绝对路径`);
  const resolved = path.resolve(candidate);
  const relative = path.relative(root, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) failClosed(`${label} 不在本次独立临时目录内`);
  const rootStat = fsSync.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) failClosed('隔离根目录不是实际目录');
  let cursor = root;
  for (const part of relative.split(path.sep)) {
    if (!part) continue;
    cursor = path.join(cursor, part);
    if (!fsSync.existsSync(cursor)) continue;
    if (fsSync.lstatSync(cursor).isSymbolicLink()) failClosed(`${label} 路径包含符号链接`);
  }
  if (mustExist && !fsSync.existsSync(resolved)) failClosed(`${label} 不存在`);
  const real = fsSync.existsSync(resolved)
    ? fsSync.realpathSync(resolved)
    : path.join(fsSync.realpathSync(path.dirname(resolved)), path.basename(resolved));
  const realRelative = path.relative(root, real);
  if (!realRelative || realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) failClosed(`${label} 实际解析位置逃逸隔离根目录`);
  return real;
}

function verifyDeclaredIsolationAndSetPaths() {
  if (!allowedModes.has(mode)) failClosed('未识别的测试模式');
  if (!root || !path.isAbsolute(root) || fsSync.realpathSync(root) !== path.resolve(root)) failClosed('隔离根目录必须是规范化的真实路径');
  const paths = [
    ['userData', userData, true], ['downloads', downloads, true], ['结果文件', resultPath, false],
    ['备份文件', process.env.VANTILO_VOCABULARY_E2E_BACKUP, false],
    ['恢复预期数据', process.env.VANTILO_VOCABULARY_E2E_EXPECTED_RAW, false],
    ['并发测试备份', process.env.VANTILO_VOCABULARY_E2E_RACE_BACKUP, false],
    ['HOME', process.env.HOME, true], ['CODEX_HOME', process.env.CODEX_HOME, true],
    ['XDG_CONFIG_HOME', process.env.XDG_CONFIG_HOME, true], ['XDG_CACHE_HOME', process.env.XDG_CACHE_HOME, true],
    ['TMPDIR', process.env.TMPDIR, true],
  ];
  for (const [label, candidate, mustExist] of paths) containedPath(candidate, label, { mustExist });
  const userDataReal = containedPath(userData, 'userData');
  const suppliedSwitch = app.commandLine.getSwitchValue('user-data-dir');
  if (!suppliedSwitch || path.resolve(suppliedSwitch) !== path.resolve(userData)) failClosed('Chromium 启动参数中的 user-data-dir 与测试 userData 不完全一致');

  const pathsToCreate = {
    sessionData: path.join(userDataReal, 'session-data'),
    appData: path.join(root, 'app-data'),
    logs: path.join(root, 'logs'),
    crashDumps: path.join(root, 'crash-dumps'),
  };
  for (const directory of Object.values(pathsToCreate)) fsSync.mkdirSync(directory, { recursive: true, mode: 0o700 });
  app.setName('Vantilo');
  app.setPath('home', process.env.HOME);
  app.setPath('userData', userDataReal);
  for (const [name, directory] of Object.entries(pathsToCreate)) app.setPath(name, directory);
  app.setPath('downloads', downloads);
  app.setPath('temp', process.env.TMPDIR);
  if (path.resolve(app.getPath('userData')) !== path.resolve(userDataReal)) failClosed('app.setPath 后 userData 路径发生偏离');
  if (path.resolve(app.getPath('downloads')) !== path.resolve(downloads)) failClosed('Electron 下载路径发生偏离');
}

function verifyActualIsolation() {
  const actualUserData = fsSync.realpathSync(app.getPath('userData'));
  const actualSessionData = fsSync.realpathSync(app.getPath('sessionData'));
  const chromiumStorageRaw = session.defaultSession.getStoragePath();
  if (!chromiumStorageRaw || !path.isAbsolute(chromiumStorageRaw)) failClosed('Chromium default session 没有可验证的绝对存储路径');
  const chromiumStorage = fsSync.realpathSync(chromiumStorageRaw);
  const expectedUserData = fsSync.realpathSync(userData);
  if (actualUserData !== expectedUserData) failClosed('真实 app.getPath(userData) 与预期测试目录不完全一致');
  if (actualSessionData !== path.join(actualUserData, 'session-data')) failClosed('真实 sessionData 不在本次 userData 下');
  if (chromiumStorage !== actualSessionData) failClosed('Chromium default session 实际存储路径与隔离 sessionData 不匹配');
  const actualHome = fsSync.realpathSync(app.getPath('home'));
  const actualAppData = fsSync.realpathSync(app.getPath('appData'));
  const actualTemp = fsSync.realpathSync(app.getPath('temp'));
  const actualLogs = fsSync.realpathSync(app.getPath('logs'));
  const actualCrashDumps = fsSync.realpathSync(app.getPath('crashDumps'));
  const actualDownloads = fsSync.realpathSync(app.getPath('downloads'));
  for (const [label, candidate] of [['真实 userData', actualUserData], ['真实 sessionData', actualSessionData], ['Chromium storage', chromiumStorage], ['真实 HOME', actualHome], ['appData', actualAppData], ['temp', actualTemp], ['logs', actualLogs], ['crashDumps', actualCrashDumps], ['真实下载目录', actualDownloads]]) containedPath(candidate, label);
  const proof = {
    status: 'PASS', mode, pid: process.pid, checkedAt: new Date().toISOString(),
    isolationRoot: fsSync.realpathSync(root), expectedUserData: path.resolve(userData), actualUserData,
    chromiumUserDataSwitch: path.resolve(app.commandLine.getSwitchValue('user-data-dir')),
    actualSessionData, chromiumStorage, actualHome, actualAppData, actualTemp, actualLogs, actualCrashDumps, actualDownloads,
    singleInstance: '主进程在验证后的唯一 userData 路径下请求单实例锁；本次测试不会复用默认配置目录。',
  };
  const proofPath = path.join(root, `isolation-proof-${mode}-${process.pid}.json`);
  fsSync.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  global.__vocabularyIsolationProof = proof;
  return proof;
}

function installTestAdapters() {
  const queue = [];
  global.__vocabularyBackupDialogResults = queue;
  dialog.showSaveDialog = async () => queue.shift() || { canceled: true };
  shell.showItemInFolder = filename => { global.__vocabularyLastRevealedBackup = filename; };
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return nativeFetch(input, init);
    return Promise.reject(Object.assign(new TypeError('Network disabled in isolated vocabulary E2E'), { code: 'ENETUNREACH' }));
  };
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let local = false;
    try { const url = new URL(details.url); local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || ['file:', 'data:', 'devtools:'].includes(url.protocol); } catch {}
    callback({ cancel: !local });
  });
}

async function writeFailure(error) {
  const result = { status: 'FAIL', mode, pid: process.pid, isolationProof: global.__vocabularyIsolationProof || null, error: error?.stack || String(error) };
  try {
    if (root && resultPath && path.isAbsolute(resultPath) && path.resolve(resultPath).startsWith(`${path.resolve(root)}${path.sep}`)) await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'w', mode: 0o600 });
  } catch {}
  console.error(`VOCABULARY_E2E_FAILURE ${JSON.stringify(result)}`);
  app.exit(1);
}

try {
  verifyDeclaredIsolationAndSetPaths();
} catch (error) {
  console.error(error?.stack || error);
  app.exit(1);
}

if (!process.exitCode) {
  global.__vocabularyIsolatedE2E = true;
  let resolveIsolation;
  let rejectIsolation;
  global.__vocabularyIsolationVerificationPromise = new Promise((resolve, reject) => { resolveIsolation = resolve; rejectIsolation = reject; });
  try {
    // The app's normal startup is held behind this promise until app.getPath
    // and Chromium's actual storage path are measured after Electron is ready.
    require('../electron/main.cjs');
    const { run } = require('./vocabulary-backup-e2e-driver.cjs');
    let finished = false;
    let timeout;
    const fail = async error => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      rejectIsolation(error);
      await writeFailure(error);
    };
    timeout = setTimeout(() => { void fail(new Error(`隔离 Electron E2E 超时；阶段=${JSON.stringify(global.__vocabularyE2EStage || null)}`)); }, 90000);
    app.whenReady().then(() => {
      let proof;
      try {
        proof = verifyActualIsolation();
        installTestAdapters();
        resolveIsolation(proof);
      } catch (error) {
        void fail(error);
        return;
      }
      run().then(() => { finished = true; clearTimeout(timeout); app.exit(0); }, fail);
    }, fail);
  } catch (error) {
    void writeFailure(error);
  }
}
