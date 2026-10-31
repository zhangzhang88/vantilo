import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import workspaceGuard from './workspace-test-environment.cjs';

workspaceGuard.assertWorkspaceTestEnvironment();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `vantilo-vocabulary-backup-e2e-${stamp}-`)));
const dirs = {
  reader: path.join(base, 'reader-assets'),
  tmp: path.join(base, 'tmp'),
  home: path.join(base, 'home'),
  codex: path.join(base, 'codex-home'),
  xdgConfig: path.join(base, 'xdg-config'),
  xdgCache: path.join(base, 'xdg-cache'),
  downloadsA: path.join(base, 'downloads-a'),
  downloadsB: path.join(base, 'downloads-b'),
  profileA: path.join(base, 'user-data-a'),
  profileB: path.join(base, 'user-data-b'),
};
for (const directory of Object.values(dirs)) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
const backup = path.join(base, 'Vantilo-Vocabulary-Backup-E2E.json');
const raceBackup = path.join(base, 'Vantilo-Vocabulary-Race-E2E.json');
const expectedRecovery = path.join(base, 'expected-recovery-raw.json');
const existingBackup = process.env.VANTILO_VOCABULARY_E2E_EXISTING_BACKUP;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${code}\n${stderr.slice(-5000)}`)));
  });
}

async function waitForVite(child, ready, timeoutMs = 30000) {
  let output = '';
  const timer = setTimeout(() => ready.reject(new Error(`Vite startup timeout: ${output.slice(-3000)}`)), timeoutMs);
  child.stdout.on('data', chunk => {
    const text = chunk.toString(); output += text; process.stdout.write(text);
    if (/Local:\s+http:\/\/127\.0\.0\.1:5173\//.test(output)) ready.resolve();
  });
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  child.once('error', error => ready.reject(error));
  child.once('exit', code => ready.reject(new Error(`Vite exited before ready (${code})`)));
  try { await ready.promise; } finally { clearTimeout(timer); }
}

function electronEnv(mode, profile, downloads, resultPath, { backupPath = backup, expectedRawPath = expectedRecovery } = {}) {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: process.env.LANG || 'en_US.UTF-8',
    HOME: dirs.home,
    CODEX_HOME: dirs.codex,
    XDG_CONFIG_HOME: path.join(base, 'xdg-config'),
    XDG_CACHE_HOME: path.join(base, 'xdg-cache'),
    TMPDIR: dirs.tmp,
    SWC_NATIVE_BINDING_CACHE: process.env.SWC_NATIVE_BINDING_CACHE,
    VANTILO_TEST_RUN_ROOT: process.env.VANTILO_TEST_RUN_ROOT,
    VANTILO_TEST_PROFILE_ROOT: process.env.VANTILO_TEST_PROFILE_ROOT,
    VANTILO_TEST_CHROMIUM_ROOT: process.env.VANTILO_TEST_CHROMIUM_ROOT,
    VANTILO_TEST_READER_ROOT: process.env.VANTILO_TEST_READER_ROOT,
    VANTILO_TEST_ARTIFACT_ROOT: process.env.VANTILO_TEST_ARTIFACT_ROOT,
    VANTILO_TEST_RESULTS_ROOT: process.env.VANTILO_TEST_RESULTS_ROOT,
    VANTILO_RUNTIME_MODULE_INVENTORY_PATH: process.env.VANTILO_RUNTIME_MODULE_INVENTORY_PATH,
    VANTILO_DEV_SERVER_URL: 'http://127.0.0.1:5173',
    VANTILO_DEV_READER_ASSETS: dirs.reader,
    VANTILO_VOCABULARY_E2E_ROOT: base,
    VANTILO_VOCABULARY_E2E_MODE: mode,
    VANTILO_VOCABULARY_E2E_USER_DATA: profile,
    VANTILO_VOCABULARY_E2E_DOWNLOADS: downloads,
    VANTILO_VOCABULARY_E2E_RESULT: resultPath,
    VANTILO_VOCABULARY_E2E_BACKUP: backupPath,
    VANTILO_VOCABULARY_E2E_EXPECTED_RAW: expectedRawPath,
    VANTILO_VOCABULARY_E2E_RACE_BACKUP: raceBackup,
  };
}

async function runElectron(mode, profile, downloads, options = {}) {
  for (const [label, candidate] of [['userData', profile], ['downloads', downloads]]) {
    const relative = path.relative(base, path.resolve(candidate));
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`${label} 必须位于本次新建的 E2E 根目录：${candidate}`);
  }
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  await fs.mkdir(downloads, { recursive: true, mode: 0o700 });
  const resultPath = path.join(base, `result-${mode}.json`);
  const child = spawn(process.execPath, [path.join(root, 'node_modules/electron/cli.js'), `--user-data-dir=${profile}`, path.join(root, 'scripts/vocabulary-backup-e2e-main.cjs')], {
    cwd: root, env: electronEnv(mode, profile, downloads, resultPath, options), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 110000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  clearTimeout(timeout);
  let result;
  try { result = JSON.parse(await fs.readFile(resultPath, 'utf8')); }
  catch { throw new Error(`Electron E2E ${mode} did not write evidence (exit ${code}).\n${stderr.slice(-5000)}\n${stdout.slice(-2000)}`); }
  if (code !== 0 || result.status !== 'PASS') throw new Error(`Electron E2E ${mode} failed: ${JSON.stringify(result)}\n${stderr.slice(-5000)}`);
  return result;
}

async function createFullApfsTestVolume() {
  if (process.platform !== 'darwin') throw new Error('本机不是 macOS；无法创建 APFS 容量受限测试卷。');
  const image = path.join(base, 'capacity-limited-test.sparseimage');
  const mount = path.join(base, 'capacity-limited-apfs');
  await fs.mkdir(mount, { mode: 0o700 });
  await run('/usr/bin/hdiutil', ['create', '-size', '128m', '-type', 'SPARSE', '-fs', 'APFS', '-volname', `VantiloSafety-${path.basename(base).slice(-8)}`, image]);
  let attached = false;
  try {
    await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-mountpoint', mount, image]);
    attached = true;
    const fillPath = path.join(mount, 'capacity-reservation.bin');
    const handle = await fs.open(fillPath, 'wx', 0o600);
    const blockBytes = 1024 * 1024;
    let written = 0;
    let hitEnospc = false;
    try {
      // Deliberately write beyond the sparse image's declared capacity; the
      // virtual APFS volume, not the host filesystem, must return ENOSPC.
      while (written < 256 * blockBytes) {
        const block = crypto.randomBytes(blockBytes);
        try {
          const result = await handle.write(block, 0, block.length, written);
          if (!result.bytesWritten) { hitEnospc = true; break; }
          written += result.bytesWritten;
        } catch (error) {
          if (error.code === 'ENOSPC') { hitEnospc = true; break; }
          throw error;
        }
      }
      // APFS can report reserved blocks even after a 1 MiB allocation fails.
      // Drain those using small writes so the backup's 16 KiB preflight also
      // sees insufficient space, or the actual JSON write gets ENOSPC.
      const smallBytes = 4096;
      while (written < 256 * blockBytes) {
        const block = crypto.randomBytes(smallBytes);
        try {
          const result = await handle.write(block, 0, block.length, written);
          if (!result.bytesWritten) { hitEnospc = true; break; }
          written += result.bytesWritten;
        } catch (error) {
          if (error.code === 'ENOSPC') { hitEnospc = true; break; }
          throw error;
        }
      }
      await handle.sync();
    } finally { await handle.close(); }
    const stat = await fs.statfs(mount);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    if (!hitEnospc) throw new Error(`测试 APFS 卷没有返回 ENOSPC：写入 ${written} 字节，剩余 ${freeBytes} 字节。`);
    return { image, mount, written, freeBytes, hitEnospc, attached: true };
  } catch (error) {
    if (attached) await run('/usr/bin/hdiutil', ['detach', mount]).catch(() => {});
    const expectedPrefix = `${base}${path.sep}`;
    for (const target of [mount, image]) if (!path.resolve(target).startsWith(expectedPrefix)) throw new Error(`拒绝清理测试目录之外的路径：${target}`);
    await fs.rm(mount, { recursive: true, force: true }).catch(() => {});
    await fs.rm(image, { force: true }).catch(() => {});
    throw error;
  }
}

async function removeFullApfsTestVolume(volume) {
  if (!volume?.attached) return;
  const expectedPrefix = `${base}${path.sep}`;
  for (const target of [volume.mount, volume.image]) if (!path.resolve(target).startsWith(expectedPrefix)) throw new Error(`拒绝清理隔离测试目录之外的路径：${target}`);
  await run('/usr/bin/hdiutil', ['detach', volume.mount]);
  await fs.rm(volume.mount, { recursive: true, force: false });
  await fs.rm(volume.image, { force: false });
  volume.attached = false;
}

let vite;
try {
  console.log(`E2E isolation root: ${base}`);
  console.log('Building Reader production assets into a fresh temporary directory.');
  await run(process.execPath, [path.join(root, 'scripts/build-reader.mjs')], {
    env: { PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin', HOME: dirs.home, TMPDIR: dirs.tmp, SWC_NATIVE_BINDING_CACHE: process.env.SWC_NATIVE_BINDING_CACHE, LANG: process.env.LANG || 'en_US.UTF-8', VANTILO_READER_BUILD_OUTPUT: dirs.reader, VANTILO_SWIFT_MODULE_CACHE_PATH: path.join(base, 'swift-module-cache') },
  });

  let resolveReady, rejectReady;
  const ready = { promise: new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }), resolve: null, reject: null };
  ready.resolve = resolveReady;
  ready.reject = rejectReady;
  vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin', HOME: dirs.home, TMPDIR: dirs.tmp, SWC_NATIVE_BINDING_CACHE: process.env.SWC_NATIVE_BINDING_CACHE, VANTILO_TEST_ARTIFACT_ROOT: process.env.VANTILO_TEST_ARTIFACT_ROOT, VANTILO_RUNTIME_MODULE_INVENTORY_PATH: process.env.VANTILO_RUNTIME_MODULE_INVENTORY_PATH, LANG: process.env.LANG || 'en_US.UTF-8' } });
  await waitForVite(vite, ready);
  const results = [];
  const only = process.env.VANTILO_VOCABULARY_E2E_ONLY;
  let capacityVolume;
  if (only === 'target') {
    if (!existingBackup) throw new Error('target 单项调试需要 VANTILO_VOCABULARY_E2E_EXISTING_BACKUP');
    results.push(await runElectron('target', dirs.profileB, dirs.downloadsB, { backupPath: existingBackup }));
  } else if (only === 'source-target') {
    results.push(await runElectron('source', dirs.profileA, dirs.downloadsA));
    results.push(await runElectron('target', dirs.profileB, dirs.downloadsB));
    results.push(await runElectron('verify', dirs.profileB, dirs.downloadsB));
  } else if (only === 'rollback') {
    if (!existingBackup) throw new Error('rollback 单项测试需要 VANTILO_VOCABULARY_E2E_EXISTING_BACKUP');
    const profile = path.join(base, 'user-data-rollback-failure');
    const downloads = path.join(base, 'downloads-rollback-failure');
    results.push(await runElectron('rollback-failure', profile, downloads, { backupPath: existingBackup }));
    results.push(await runElectron('rollback-recovery', profile, downloads));
  } else if (only === 'disk') {
    // The shared isolated-APFS test block below runs this scenario.
  } else {
    results.push(await runElectron('source', dirs.profileA, dirs.downloadsA));
    results.push(await runElectron('target', dirs.profileB, dirs.downloadsB));
    results.push(await runElectron('verify', dirs.profileB, dirs.downloadsB));
    results.push(await runElectron('race-source', path.join(base, 'user-data-race-source'), path.join(base, 'downloads-race-source'), { backupPath: raceBackup }));
    results.push(await runElectron('race-target', path.join(base, 'user-data-race-target'), path.join(base, 'downloads-race-target'), { backupPath: raceBackup, expectedRawPath: expectedRecovery }));
    results.push(await runElectron('rollback-failure', path.join(base, 'user-data-rollback-failure'), path.join(base, 'downloads-rollback-failure')));
    results.push(await runElectron('rollback-recovery', path.join(base, 'user-data-rollback-failure'), path.join(base, 'downloads-rollback-failure')));
  }

  if (!only || only === 'disk') {
    try {
      capacityVolume = await createFullApfsTestVolume();
      const diskBackup = path.join(capacityVolume.mount, 'Vantilo-Vocabulary-Disk-Full.json');
      results.push(await runElectron('disk-full', path.join(base, 'user-data-disk-full'), path.join(base, 'downloads-disk-full'), { backupPath: diskBackup }));
    } finally { if (capacityVolume?.attached) await removeFullApfsTestVolume(capacityVolume); }
  }

  if (!only) {
    const unwritable = path.join(base, 'unwritable-directory');
    await fs.mkdir(unwritable, { mode: 0o700 });
    await fs.chmod(unwritable, 0o500);
    try {
      results.push(await runElectron('unwritable', path.join(base, 'user-data-unwritable'), path.join(base, 'downloads-unwritable'), { backupPath: path.join(unwritable, 'Vantilo-Vocabulary-Unwritable.json') }));
    } finally { await fs.chmod(unwritable, 0o700); }
  }

  const summary = {
    status: 'PASS', base, backup, raceBackup,
    capacityLimitedApfs: capacityVolume ? { imageSizeBytes: 128 * 1024 * 1024, bytesWrittenBeforeEnospc: capacityVolume.written, availableBytesAtEnospc: capacityVolume.freeBytes, enospcObserved: capacityVolume.hitEnospc, detached: !capacityVolume.attached } : null,
    modes: results.map(item => ({ mode: item.mode, pid: item.pid, isolationProof: item.isolationProof, evidence: item.evidence })),
  };
  await fs.writeFile(path.join(base, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
  console.log(`VOCABULARY_BACKUP_E2E_PASS ${JSON.stringify(summary)}`);
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  if (vite && vite.exitCode === null) {
    vite.kill('SIGTERM');
    await new Promise(resolve => vite.once('exit', resolve));
  }
}
