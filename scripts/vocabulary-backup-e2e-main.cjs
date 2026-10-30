'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { app, dialog, shell, session } = require('electron');

const userData = process.env.VANTILO_VOCABULARY_E2E_USER_DATA;
const downloads = process.env.VANTILO_VOCABULARY_E2E_DOWNLOADS;
const resultPath = process.env.VANTILO_VOCABULARY_E2E_RESULT;
if (!userData || !path.isAbsolute(userData) || !downloads || !path.isAbsolute(downloads) || !resultPath || !path.isAbsolute(resultPath)) {
  throw new Error('词汇 E2E 仅允许使用明确指定的隔离目录。');
}

function prepare() {
  fsSync.mkdirSync(userData, { recursive: true, mode: 0o700 });
  fsSync.mkdirSync(downloads, { recursive: true, mode: 0o700 });
  app.setPath('userData', userData);
  app.setPath('downloads', downloads);
  const queue = [];
  global.__vocabularyBackupDialogResults = queue;
  dialog.showSaveDialog = async () => queue.shift() || { canceled: true };
  shell.showItemInFolder = filename => { global.__vocabularyLastRevealedBackup = filename; };

  // The E2E has no network dependency. Keep the actual app services but refuse
  // external requests so no GitHub, Codex, or provider endpoint is contacted.
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]') return nativeFetch(input, init);
    return Promise.reject(Object.assign(new TypeError('Network disabled in isolated vocabulary E2E'), { code: 'ENETUNREACH' }));
  };
  const installNetworkFilter = () => session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let local = false;
    try { const url = new URL(details.url); local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || ['file:', 'data:', 'devtools:'].includes(url.protocol); } catch {}
    callback({ cancel: !local });
  });
  if (app.isReady()) installNetworkFilter(); else app.once('ready', installNetworkFilter);
}

try {
  prepare();
  require('../electron/main.cjs');
  const { run } = require('./vocabulary-backup-e2e-driver.cjs');
  let finished = false;
  const timeout = setTimeout(() => { if (!finished) void fail(new Error(`隔离 Electron E2E 超时；阶段=${JSON.stringify(global.__vocabularyE2EStage || null)}`)); }, 90000);
  async function fail(error) {
    if (finished) return;
    finished = true; clearTimeout(timeout);
    const result = { status: 'FAIL', mode: process.env.VANTILO_VOCABULARY_E2E_MODE, pid: process.pid, error: error?.stack || String(error) };
    try { await fs.writeFile(resultPath, JSON.stringify(result, null, 2) + '\n', { flag: 'w', mode: 0o600 }); } catch {}
    console.error(`VOCABULARY_E2E_FAILURE ${JSON.stringify(result)}`);
    // The host's normal shutdown hook also stops Agent Runtime and Reader
    // services. That is outside these isolated vocabulary assertions and can
    // wait on optional local runtimes. Terminate only this synthetic E2E app
    // after its result file is durable; the next phase restarts the same
    // isolated userData to verify persistence.
    app.exit(1);
  }
  app.whenReady().then(() => run().then(() => { finished = true; clearTimeout(timeout); app.exit(0); }, fail));
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
  app.quit();
}
