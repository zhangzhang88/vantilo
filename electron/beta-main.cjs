'use strict';

const { app, session, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const userDataOverride = app.commandLine.getSwitchValue('user-data-dir');

function failIsolatedE2E(message) {
  throw new Error(`Packaged vocabulary E2E isolation failed: ${message}`);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function resolveIsolatedDirectory(root, envName) {
  const candidate = process.env[envName];
  if (!candidate || !path.isAbsolute(candidate) || path.resolve(candidate) !== candidate) {
    failIsolatedE2E(`${envName} must be a normalized absolute path`);
  }
  if (!isWithin(root, candidate)) failIsolatedE2E(`${envName} must be inside the unique test root`);

  let cursor = root;
  for (const part of path.relative(root, candidate).split(path.sep)) {
    cursor = path.join(cursor, part);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) failIsolatedE2E(`${envName} contains a symbolic link`);
  }
  const stat = fs.statSync(candidate);
  if (!stat.isDirectory()) failIsolatedE2E(`${envName} is not a directory`);
  const real = fs.realpathSync(candidate);
  if (real !== candidate || !isWithin(root, real)) failIsolatedE2E(`${envName} resolves outside the test root`);
  return real;
}

function startPackagedVocabularyE2EIsolation() {
  if (process.env.VANTILO_PACKAGED_E2E !== '1') return false;

  if (!app.isPackaged) failIsolatedE2E('test mode is only valid for a packaged app');
  if (!process.env.VANTILO_VOCABULARY_E2E_MODE) failIsolatedE2E('missing E2E mode');
  if (!process.argv.some(value => /^--inspect=127\.0\.0\.1:\d+$/.test(value))) {
    failIsolatedE2E('packaged E2E requires a loopback-only Node Inspector');
  }

  const rootInput = process.env.VANTILO_VOCABULARY_E2E_ROOT;
  if (!rootInput || !path.isAbsolute(rootInput) || path.resolve(rootInput) !== rootInput) {
    failIsolatedE2E('test root must be a normalized absolute path');
  }
  const root = fs.realpathSync(rootInput);
  const rootStat = fs.lstatSync(root);
  if (root !== rootInput || rootStat.isSymbolicLink() || !rootStat.isDirectory()) failIsolatedE2E('test root is not a canonical directory');
  const allowedModes = new Set(['source', 'target', 'verify', 'race-source', 'race-target', 'rollback-failure', 'rollback-recovery', 'disk-full', 'unwritable']);
  if (!allowedModes.has(process.env.VANTILO_VOCABULARY_E2E_MODE)) failIsolatedE2E('unrecognized vocabulary E2E mode');

  const envPaths = {
    home: 'VANTILO_VOCABULARY_E2E_HOME',
    appData: 'VANTILO_VOCABULARY_E2E_APP_DATA',
    userData: 'VANTILO_VOCABULARY_E2E_USER_DATA',
    sessionData: 'VANTILO_VOCABULARY_E2E_SESSION_DATA',
    temp: 'VANTILO_VOCABULARY_E2E_TEMP',
    downloads: 'VANTILO_VOCABULARY_E2E_DOWNLOADS',
    logs: 'VANTILO_VOCABULARY_E2E_LOGS',
    crashDumps: 'VANTILO_VOCABULARY_E2E_CRASH_DUMPS',
    cache: 'VANTILO_VOCABULARY_E2E_CACHE',
    codexHome: 'CODEX_HOME',
    xdgConfig: 'XDG_CONFIG_HOME',
    xdgCache: 'XDG_CACHE_HOME',
  };
  const paths = Object.fromEntries(Object.entries(envPaths).map(([key, envName]) => [key, resolveIsolatedDirectory(root, envName)]));

  if (userDataOverride !== paths.userData) failIsolatedE2E('Chromium --user-data-dir does not exactly match the isolated userData');
  if (process.env.HOME !== paths.home || process.env.TMPDIR !== paths.temp) {
    failIsolatedE2E('HOME or TMPDIR does not point at the isolated test directory');
  }

  const appRootInput = process.env.VANTILO_PACKAGED_E2E_APP_ROOT;
  if (!appRootInput || !path.isAbsolute(appRootInput) || path.resolve(appRootInput) !== appRootInput) {
    failIsolatedE2E('packaged app root must be a normalized absolute path');
  }
  const appRoot = fs.realpathSync(appRootInput);
  const derivedAppRoot = path.resolve(path.dirname(process.execPath), '../..');
  if (appRoot !== appRootInput || appRoot !== derivedAppRoot || !appRoot.endsWith('.app')) {
    failIsolatedE2E('process executable is not inside the expected packaged app');
  }
  if (!userDataOverride || path.resolve(userDataOverride) !== paths.userData) {
    failIsolatedE2E('userData command-line switch is missing or non-canonical');
  }

  const startupResultPath = process.env.VANTILO_VOCABULARY_E2E_RESULT;
  if (!startupResultPath || !path.isAbsolute(startupResultPath) || path.resolve(startupResultPath) !== startupResultPath || path.dirname(startupResultPath) !== root) {
    failIsolatedE2E('isolation proof path must be inside the test root');
  }

  // This code runs in beta-main before the bundled main process, BrowserWindow,
  // Runtime, Reader Service, or the default Chromium session is initialized.
  for (const key of ['home', 'appData', 'userData', 'sessionData', 'temp', 'downloads', 'logs', 'crashDumps', 'cache']) {
    app.setPath(key, paths[key]);
  }

  let resolveVerification;
  let rejectVerification;
  global.__vocabularyIsolatedE2E = true;
  global.__vocabularyIsolationVerificationPromise = new Promise((resolve, reject) => {
    resolveVerification = resolve;
    rejectVerification = reject;
  });
  global.__vocabularyBackupDialogResults = [];
  dialog.showSaveDialog = async () => global.__vocabularyBackupDialogResults.shift() || { canceled: true };
  shell.showItemInFolder = filePath => { global.__vocabularyLastRevealedBackup = filePath; };

  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw);
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return nativeFetch(input, init);
    return Promise.reject(Object.assign(new TypeError('Network disabled in packaged isolated E2E'), { code: 'ENETUNREACH' }));
  };

  app.whenReady().then(() => {
    try {
      const expected = {
        home: paths.home,
        appData: paths.appData,
        userData: paths.userData,
        sessionData: paths.sessionData,
        temp: paths.temp,
        downloads: paths.downloads,
        logs: paths.logs,
        crashDumps: paths.crashDumps,
        cache: paths.cache,
      };
      const actual = Object.fromEntries(Object.keys(expected).map(key => [key, fs.realpathSync(app.getPath(key))]));
      for (const [key, value] of Object.entries(expected)) {
        if (actual[key] !== value) failIsolatedE2E(`app.getPath(${key}) does not match its isolated directory`);
      }
      const chromiumStorage = fs.realpathSync(session.defaultSession.getStoragePath());
      if (chromiumStorage !== paths.sessionData) failIsolatedE2E('Chromium default session storage is not isolated');
      if (app.getVersion() !== process.env.VANTILO_VOCABULARY_E2E_VERSION) {
        failIsolatedE2E('packaged version does not match the expected E2E version');
      }

      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        let allowed = false;
        try {
          const url = new URL(details.url);
          allowed = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || ['file:', 'data:', 'devtools:'].includes(url.protocol);
        } catch {}
        callback({ cancel: !allowed });
      });

      const proof = {
        status: 'PASS',
        mode: process.env.VANTILO_VOCABULARY_E2E_MODE,
        pid: process.pid,
        isPackaged: app.isPackaged,
        appVersion: app.getVersion(),
        appRoot,
        executable: process.execPath,
        checkedAt: new Date().toISOString(),
        isolationRoot: root,
        chromiumUserDataSwitch: userDataOverride,
        expectedUserData: paths.userData,
        actualUserData: actual.userData,
        actualSessionData: actual.sessionData,
        chromiumStorage,
        actualPaths: actual,
        codexHome: paths.codexHome,
        xdgConfig: paths.xdgConfig,
        xdgCache: paths.xdgCache,
      };
      const proofPath = path.join(root, `isolation-proof-${proof.mode}-${process.pid}.json`);
      fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      global.__vocabularyIsolationProof = proof;
      resolveVerification(proof);
    } catch (error) {
      rejectVerification(error);
      console.error('Packaged vocabulary E2E isolation gate rejected startup:', error?.message || error);
      app.quit();
    }
  }, error => {
    rejectVerification(error);
    console.error('Packaged vocabulary E2E isolation gate rejected startup:', error?.message || error);
    app.quit();
  });

  return true;
}

const isolatedE2E = startPackagedVocabularyE2EIsolation();
if (!isolatedE2E) {
  app.setPath('userData', userDataOverride && path.isAbsolute(userDataOverride)
    ? userDataOverride
    : path.join(app.getPath('appData'), 'Vantilo Beta'));
}

process.env.VANTILO_BETA_BUILD = '1';
require('./main.cjs');
