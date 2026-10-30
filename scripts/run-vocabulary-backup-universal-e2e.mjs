import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPathInput = process.env.VANTILO_VOCABULARY_E2E_PACKAGE_APP;
const workspace = '/Volumes/Workspace/Development/Vantilo/workspaces/';
if (!appPathInput || !path.isAbsolute(appPathInput) || !appPathInput.startsWith(workspace)) {
  throw new Error('请提供位于 Workspace 外置工作副本内的 Universal .app 路径。');
}
if (path.resolve(appPathInput) !== appPathInput || await fs.realpath(appPathInput) !== appPathInput) {
  throw new Error('Universal .app 必须使用规范化的真实路径。');
}
const appPath = appPathInput;
const appBinary = path.join(appPath, 'Contents/MacOS/Vantilo Beta');
await fs.access(appBinary);
const packageAcceptanceRoot = path.dirname(appPath);
const testRoot = path.join(packageAcceptanceRoot, `universal-vocabulary-e2e-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}`);
await fs.mkdir(testRoot, { recursive: false, mode: 0o700 });

const backup = path.join(testRoot, 'Vantilo-Vocabulary-Backup-Universal-E2E.json');
const raceBackup = path.join(testRoot, 'Vantilo-Vocabulary-Race-Universal-E2E.json');
const expectedRaw = path.join(testRoot, 'expected-recovery-raw.json');
const driver = path.join(repo, 'scripts/vocabulary-backup-e2e-driver.cjs');
const verifyService = path.join(repo, 'electron/vocabulary-backup-service.cjs');
const fixtures = path.join(repo, 'scripts/vocabulary-backup-e2e-fixtures.cjs');
for (const file of [driver, verifyService, fixtures]) await fs.access(file);

const cases = [
  { mode: 'source', profile: 'user-data-source' },
  { mode: 'race-source', profile: 'user-data-race-source' },
  { mode: 'target', profile: 'user-data-target' },
  { mode: 'verify', profile: 'user-data-target' },
  { mode: 'race-target', profile: 'user-data-race-target' },
  { mode: 'rollback-failure', profile: 'user-data-rollback' },
  { mode: 'rollback-recovery', profile: 'user-data-rollback' },
  { mode: 'disk-full', profile: 'user-data-disk-full' },
  { mode: 'unwritable', profile: 'user-data-unwritable' },
];
const summaries = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function availableLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForInspector(port, child, tail) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`打包应用在 Inspector 启动前退出：${tail()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(item => item.webSocketDebuggerUrl);
        if (target) return target.webSocketDebuggerUrl;
      }
    } catch {}
    await wait(200);
  }
  throw new Error(`打包应用没有开放 loopback Inspector：${tail()}`);
}

async function waitForIsolationReady(inspector, child, tail) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`打包应用在隔离验证前退出：${tail()}`);
    try {
      const response = await inspector.send('Runtime.evaluate', {
        expression: "(()=>{const {app}=process.mainModule.require('electron');return app.isReady()&&global.__vocabularyIsolationProof?.status==='PASS'})()",
        returnByValue: true,
      });
      if (response.result?.value === true) return;
    } catch {}
    await wait(200);
  }
  throw new Error(`打包应用未在隔离验收期限内完成 app ready 和隔离证明：${tail()}`);
}

function connectInspector(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let nextId = 0;
    socket.addEventListener('open', () => resolve({
      socket,
      send(method, params = {}, timeoutMs = 12000) {
        return new Promise((resolveCommand, rejectCommand) => {
          const id = ++nextId;
          const timer = setTimeout(() => {
            pending.delete(id);
            rejectCommand(new Error(`Inspector 请求超时：${method}`));
          }, timeoutMs);
          pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { socket.close(); },
    }), { once: true });
    socket.addEventListener('error', reject, { once: true });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    });
  });
}

function assertNoEvaluationError(response, label) {
  if (response.exceptionDetails) {
    throw new Error(`${label}: ${response.exceptionDetails.exception?.description || response.exceptionDetails.text}`);
  }
  return response.result?.value;
}

async function waitForExit(child, timeoutMs = 30000) {
  return Promise.race([
    new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal }))),
    wait(timeoutMs).then(() => ({ timeout: true })),
  ]);
}

async function processGroupMembers(groupId) {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,command=']);
  return stdout.split('\n').filter(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match && Number(match[3]) === groupId && match[4].includes('Vantilo Beta.app');
  });
}

function buildEnvironment(mode, profile, directories, resultPath, backupPath) {
  return {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'zh_CN.UTF-8',
    HOME: directories.home,
    CODEX_HOME: directories.codex,
    XDG_CONFIG_HOME: directories.xdgConfig,
    XDG_CACHE_HOME: directories.xdgCache,
    TMPDIR: directories.temp,
    TMP: directories.temp,
    TEMP: directories.temp,
    VANTILO_PACKAGED_E2E: '1',
    VANTILO_PACKAGED_E2E_APP_ROOT: appPath,
    VANTILO_PACKAGED_E2E_DRIVER: driver,
    VANTILO_PACKAGED_E2E_VERIFY_SERVICE: verifyService,
    VANTILO_PACKAGED_E2E_FIXTURES: fixtures,
    VANTILO_VOCABULARY_E2E_VERSION: '0.1.14',
    VANTILO_VOCABULARY_E2E_ROOT: testRoot,
    VANTILO_VOCABULARY_E2E_MODE: mode,
    VANTILO_VOCABULARY_E2E_USER_DATA: profile,
    VANTILO_VOCABULARY_E2E_HOME: directories.home,
    VANTILO_VOCABULARY_E2E_APP_DATA: directories.appData,
    VANTILO_VOCABULARY_E2E_SESSION_DATA: directories.sessionData,
    VANTILO_VOCABULARY_E2E_TEMP: directories.temp,
    VANTILO_VOCABULARY_E2E_DOWNLOADS: directories.downloads,
    VANTILO_VOCABULARY_E2E_LOGS: directories.logs,
    VANTILO_VOCABULARY_E2E_CRASH_DUMPS: directories.crashDumps,
    VANTILO_VOCABULARY_E2E_CACHE: directories.cache,
    VANTILO_VOCABULARY_E2E_RESULT: resultPath,
    VANTILO_VOCABULARY_E2E_BACKUP: backupPath || backup,
    VANTILO_VOCABULARY_E2E_EXPECTED_RAW: expectedRaw,
    VANTILO_VOCABULARY_E2E_RACE_BACKUP: raceBackup,
  };
}

async function runCase({ mode, profileName, backupPath }) {
  const profile = path.join(testRoot, profileName);
  const directories = {
    userData: profile,
    sessionData: path.join(profile, 'session-data'),
    home: path.join(testRoot, `home-${mode}`),
    appData: path.join(testRoot, `app-data-${mode}`),
    downloads: path.join(testRoot, `downloads-${mode}`),
    temp: path.join(testRoot, `tmp-${mode}`),
    logs: path.join(testRoot, `logs-${mode}`),
    crashDumps: path.join(testRoot, `crash-dumps-${mode}`),
    cache: path.join(testRoot, `cache-${mode}`),
    codex: path.join(testRoot, `codex-home-${mode}`),
    xdgConfig: path.join(testRoot, `xdg-config-${mode}`),
    xdgCache: path.join(testRoot, `xdg-cache-${mode}`),
  };
  for (const directory of Object.values(directories)) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  // Keep a packaged acceptance run offline: first-run Reader magazine sync is
  // a real network feature and is unrelated to vocabulary backup coverage.
  const readerData = path.join(profile, 'reader-library', 'data');
  await fs.mkdir(readerData, { recursive: true, mode: 0o700 });
  const preferencePath = path.join(readerData, 'vantilo-magazine-sync.json.preferences.json');
  let preferences;
  try {
    preferences = JSON.parse(await fs.readFile(preferencePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    preferences = { version: 1, automatic: false };
    await fs.writeFile(preferencePath, JSON.stringify(preferences), { flag: 'wx', mode: 0o600 });
  }
  if (preferences?.version !== 1 || preferences?.automatic !== false) {
    throw new Error(`隔离 Reader 测试配置无效，拒绝覆盖：${preferencePath}`);
  }
  const resultPath = path.join(testRoot, `result-${mode}.json`);
  const port = await availableLoopbackPort();
  const env = buildEnvironment(mode, profile, directories, resultPath, backupPath);
  const child = spawn(appBinary, [`--user-data-dir=${profile}`, `--inspect=127.0.0.1:${port}`], {
    detached: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  const append = chunk => {
    const value = chunk.toString();
    output.push(value);
    if (output.join('').length < 2000) process.stdout.write(value);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const tail = () => output.join('').slice(-5000);
  let inspector;
  try {
    console.log(`UNIVERSAL_E2E_START ${JSON.stringify({ mode, appBinary, pid: child.pid, profile })}`);
    const webSocketUrl = await waitForInspector(port, child, tail);
    inspector = await connectInspector(webSocketUrl);
    await inspector.send('Runtime.enable');
    await waitForIsolationReady(inspector, child, tail);
    const proofExpression = `(() => {
      const main = process.mainModule;
      if (!main || typeof main.require !== 'function') throw new Error('Electron main module is unavailable');
      const { app } = main.require('electron');
      const proof = global.__vocabularyIsolationProof;
      if (!app.isReady()) throw new Error('app did not become ready after isolation verification');
      if (!proof || proof.status !== 'PASS') throw new Error('pre-ready isolation proof is missing');
      if (app.getVersion() !== '0.1.14') throw new Error('wrong packaged app version');
      if (app.getPath('userData') !== ${JSON.stringify(profile)}) throw new Error('actual app.getPath(userData) differs from exact test profile');
      return proof;
    })()`;
    const proofResponse = await inspector.send('Runtime.evaluate', {
      expression: proofExpression,
      returnByValue: true,
      awaitPromise: true,
    });
    const proof = assertNoEvaluationError(proofResponse, '读取打包版 userData 隔离证据');
    if (!proof || proof.actualUserData !== profile || proof.chromiumUserDataSwitch !== profile || proof.appVersion !== '0.1.14') {
      throw new Error(`隔离证明与预期不一致：${JSON.stringify(proof)}`);
    }
    for (const key of ['home', 'appData', 'userData', 'sessionData', 'temp', 'downloads', 'logs', 'crashDumps', 'cache']) {
      if (proof.actualPaths?.[key] !== directories[key]) throw new Error(`app.getPath(${key}) 没有落在隔离目录`);
    }
    if (proof.chromiumStorage !== directories.sessionData) throw new Error('Chromium default session storage 不在隔离目录');

    const adapterExpression = `(() => {
      const { dialog, shell } = process.mainModule.require('electron');
      global.__vocabularyBackupDialogResults ||= [];
      dialog.showSaveDialog = async () => global.__vocabularyBackupDialogResults.shift() || { canceled: true };
      shell.showItemInFolder = filePath => { global.__vocabularyLastRevealedBackup = filePath; };
      return true;
    })()`;
    const adapterResponse = await inspector.send('Runtime.evaluate', { expression: adapterExpression, returnByValue: true });
    if (assertNoEvaluationError(adapterResponse, '安装系统文件对话框测试适配') !== true) throw new Error('系统文件对话框测试适配未生效');

    const runExpression = `(async () => {
      const main = process.mainModule;
      await main.require(${JSON.stringify(driver)}).run();
      return true;
    })()`;
    const runResponse = await inspector.send('Runtime.evaluate', {
      expression: runExpression,
      returnByValue: true,
      awaitPromise: true,
    }, 150000);
    if (assertNoEvaluationError(runResponse, `Universal 包内 E2E ${mode}`) !== true) throw new Error(`Universal 包内 E2E ${mode} 没有返回完成结果`);

    const quitResponse = await inspector.send('Runtime.evaluate', {
      expression: "process.mainModule.require('electron').app.quit()",
      returnByValue: true,
    });
    assertNoEvaluationError(quitResponse, `关闭打包版 E2E ${mode}`);
    inspector.close();
    inspector = null;
    const exit = await waitForExit(child);
    if (exit.timeout) throw new Error(`E2E ${mode} 应用在正常退出请求后仍未关闭`);
    if (exit.code !== 0) throw new Error(`E2E ${mode} 进程退出码为 ${exit.code} (${exit.signal || 'no signal'})`);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const members = await processGroupMembers(child.pid);
      if (members.length === 0) break;
      if (attempt === 29) throw new Error(`E2E ${mode} 退出后仍有打包应用子进程：${members.join('\n')}`);
      await wait(250);
    }

    const result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
    if (result.status !== 'PASS' || result.mode !== mode || result.pid !== child.pid) {
      throw new Error(`E2E ${mode} 结果文件无效：${JSON.stringify(result)}`);
    }
    const proofPath = path.join(testRoot, `isolation-proof-${mode}-${child.pid}.json`);
    const persistedProof = JSON.parse(await fs.readFile(proofPath, 'utf8'));
    if (persistedProof.status !== 'PASS' || persistedProof.actualUserData !== profile) throw new Error(`E2E ${mode} 持久化隔离证据无效`);
    return { mode, pid: child.pid, exitCode: exit.code, isolationProof: persistedProof, evidence: result.evidence };
  } catch (error) {
    inspector?.close();
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    const exit = await waitForExit(child, 10000);
    throw new Error(`Universal E2E ${mode} 未通过；exit=${JSON.stringify(exit)}\n${tail()}\n${error?.stack || error}`);
  }
}

async function createCapacityLimitedApfsVolume() {
  const image = path.join(testRoot, 'capacity-limited-test.sparseimage');
  const mount = path.join(testRoot, 'capacity-limited-apfs');
  await fs.mkdir(mount, { recursive: false, mode: 0o700 });
  await execFileAsync('/usr/bin/hdiutil', ['create', '-size', '128m', '-type', 'SPARSE', '-fs', 'APFS', '-volname', `VantiloSafety-${process.pid}`, image]);
  let attached = false;
  try {
    await execFileAsync('/usr/bin/hdiutil', ['attach', '-nobrowse', '-mountpoint', mount, image]);
    attached = true;
    const reservationPath = path.join(mount, 'capacity-reservation.bin');
    const handle = await fs.open(reservationPath, 'wx', 0o600);
    const largeBlock = 1024 * 1024;
    let written = 0;
    let enospcObserved = false;
    try {
      while (written < 256 * largeBlock) {
        try {
          const result = await handle.write(crypto.randomBytes(largeBlock), 0, largeBlock, written);
          if (!result.bytesWritten) { enospcObserved = true; break; }
          written += result.bytesWritten;
        } catch (error) {
          if (error.code === 'ENOSPC') { enospcObserved = true; break; }
          throw error;
        }
      }
      const smallBlock = 4096;
      while (written < 256 * largeBlock) {
        try {
          const result = await handle.write(crypto.randomBytes(smallBlock), 0, smallBlock, written);
          if (!result.bytesWritten) { enospcObserved = true; break; }
          written += result.bytesWritten;
        } catch (error) {
          if (error.code === 'ENOSPC') { enospcObserved = true; break; }
          throw error;
        }
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    const stat = await fs.statfs(mount);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    if (!enospcObserved) throw new Error(`隔离 APFS 测试卷没有触发 ENOSPC：写入 ${written} 字节，剩余 ${freeBytes} 字节。`);
    return { image, mount, written, freeBytes, enospcObserved, attached: true };
  } catch (error) {
    if (attached) await execFileAsync('/usr/bin/hdiutil', ['detach', mount]).catch(() => {});
    throw error;
  }
}

async function detachCapacityLimitedApfsVolume(volume) {
  if (!volume?.attached) return;
  await execFileAsync('/usr/bin/hdiutil', ['detach', volume.mount]);
  volume.attached = false;
}

async function removeCapacityLimitedApfsVolume(volume) {
  const expectedPrefix = `${testRoot}${path.sep}`;
  for (const target of [volume.image, volume.mount]) {
    const resolved = path.resolve(target);
    if (!resolved.startsWith(expectedPrefix)) throw new Error(`拒绝清理隔离测试目录之外的 APFS 测试路径：${target}`);
  }
  await detachCapacityLimitedApfsVolume(volume);
  await fs.rmdir(volume.mount);
  await fs.rm(volume.image, { force: false });
  volume.removed = true;
}

console.log(`UNIVERSAL_E2E_TEST_ROOT=${testRoot}`);
console.log(`UNIVERSAL_E2E_APP=${appPath}`);
let capacityVolume;
for (const item of cases) {
  if (item.mode === 'disk-full') {
    capacityVolume = await createCapacityLimitedApfsVolume();
    let passed = false;
    try {
      const diskBackupPath = path.join(capacityVolume.mount, 'Vantilo-Vocabulary-Disk-Full.json');
      summaries.push(await runCase({ mode: item.mode, profileName: item.profile, backupPath: diskBackupPath }));
      passed = true;
    } finally {
      if (!passed) await detachCapacityLimitedApfsVolume(capacityVolume);
    }
    await removeCapacityLimitedApfsVolume(capacityVolume);
  } else if (item.mode === 'unwritable') {
    const unwritableDirectory = path.join(testRoot, 'unwritable-directory');
    await fs.mkdir(unwritableDirectory, { recursive: false, mode: 0o700 });
    await fs.chmod(unwritableDirectory, 0o500);
    try {
      const unwritableBackupPath = path.join(unwritableDirectory, 'Vantilo-Vocabulary-Unwritable.json');
      summaries.push(await runCase({ mode: item.mode, profileName: item.profile, backupPath: unwritableBackupPath }));
    } finally {
      await fs.chmod(unwritableDirectory, 0o700);
    }
  } else {
    summaries.push(await runCase({ mode: item.mode, profileName: item.profile }));
  }
}

const backupText = await fs.readFile(backup, 'utf8');
const backupDoc = JSON.parse(backupText);
const verify = await import(`file://${verifyService}`);
const checked = verify.verifyVocabularyBackupDocument(backupDoc, backupText);
const backupSha256 = await import('node:crypto').then(({ default: crypto }) => crypto.createHash('sha256').update(backupText).digest('hex'));
if (checked.sha256 !== backupSha256 || backupDoc.integrity.sha256 !== backupSha256) throw new Error('实际词汇备份 JSON SHA-256 与 manifest 不一致');
for (const secret of ['E2E_SYNTHETIC_API_KEY_PLAINTEXT', 'E2E_SYNTHETIC_API_KEY_CIPHERTEXT', 'E2E_SYNTHETIC_OAUTH_TOKEN']) {
  if (backupText.includes(secret)) throw new Error(`敏感标记意外进入词汇备份：${secret}`);
}

const summary = {
  status: 'PASS',
  appPath,
  appBinary,
  appVersion: '0.1.14',
  testRoot,
  backup,
  backupBytes: Buffer.byteLength(backupText),
  backupSha256,
  counts: backupDoc.counts,
  capacityLimitedApfs: capacityVolume ? { image: capacityVolume.image, writtenBytesBeforeEnospc: capacityVolume.written, availableBytesAtEnospc: capacityVolume.freeBytes, enospcObserved: capacityVolume.enospcObserved, detached: !capacityVolume.attached, imageRemoved: Boolean(capacityVolume.removed) } : null,
  syntheticSecretsExcluded: true,
  modes: summaries,
};
await fs.writeFile(path.join(testRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(`UNIVERSAL_VOCABULARY_E2E_PASS ${JSON.stringify({ status: summary.status, appPath, testRoot, backup, backupBytes: summary.backupBytes, backupSha256, counts: summary.counts, modes: summaries.map(item => item.mode) })}`);
