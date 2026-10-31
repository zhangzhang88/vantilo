import { spawn, spawnSync } from 'node:child_process';
import { constants, createWriteStream, statfsSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import workspaceGuard from './workspace-test-environment.cjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { WORKSPACE, WORKSPACE_ROOT, RUNS_ROOT, OWNER_MARKER, PAYLOAD_DIRS, verifyWorkspaceVolume, assertWritableDirectory, isWithin } = workspaceGuard;
const rootVitest = path.join(repo, 'node_modules/vitest/vitest.mjs');
const readerVitest = path.join(repo, 'node_modules/vitest/vitest.mjs');
const keepArtifacts = process.argv.includes('--keep-artifacts');
const argv = process.argv.slice(2).filter(arg => arg !== '--keep-artifacts');

const nodeEntries = new Set([
  'scripts/run-vocabulary-backup-e2e.mjs',
  'scripts/run-vocabulary-backup-packaged-e2e.mjs',
  'scripts/run-vocabulary-backup-universal-e2e.mjs',
  'scripts/package-vocabulary-backup-e2e.mjs',
  'scripts/verify-real-codex-tools.cjs',
  'scripts/verify-real-codex-passage.cjs',
  'scripts/verify-tts-server.cjs',
  'scripts/verify-magazine-progress.cjs',
  'scripts/test-fixtures/workspace-runner-failure.mjs',
]);
const electronEntries = new Set([
  'scripts/verify-reader-first-run.cjs', 'scripts/diagnose-reader-embedded.cjs',
  'scripts/verify-reader-qwen-preview.cjs', 'scripts/verify-reader-pronunciation-voices.cjs',
  'scripts/diagnose-reader-qwen-white-screen.cjs', 'scripts/verify-reader-session-auth.cjs',
  'scripts/verify-reader-qwen-resident.cjs', 'scripts/verify-reader-growth-page-live.cjs',
  'scripts/verify-reader-dictionary-preview.cjs', 'scripts/verify-reader-setup-preview.cjs',
  'scripts/verify-reader-sentence-position-restart.cjs', 'scripts/verify-reader-layout.cjs',
  'scripts/verify-reader-growth-navigation.cjs', 'scripts/verify-chinese-toolbar.cjs',
  'scripts/verify-reader-data-management.cjs', 'scripts/diagnose-reader-iframe.cjs',
  'scripts/verify-packaged-reader.cjs', 'scripts/verify-reader-host.cjs',
  'scripts/verify-reader-translation-reuse.cjs', 'scripts/verify-reader-dictionary-theme.cjs',
  'scripts/verify-reader-growth-live.cjs', 'scripts/verify-reader-qwen-detail-view.cjs',
]);
const vocabularyEntries = new Set([
  'scripts/run-vocabulary-backup-e2e.mjs',
  'scripts/run-vocabulary-backup-packaged-e2e.mjs',
  'scripts/run-vocabulary-backup-universal-e2e.mjs',
]);

function fail(message) { process.stderr.write(`${message}\n`); process.exit(2); }
function psInfo(pid) {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart=,pgid=,command='], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  const match = result.stdout.trim().match(/^(.{24})\s+(\d+)\s+(.*)$/);
  return match ? { started: match[1].trim(), pgid: Number(match[2]), command: match[3] } : null;
}
function currentAvailableBytes() {
  const statfs = statfsSync(WORKSPACE);
  return statfs.bavail * statfs.bsize;
}
async function assertRealDirectory(target, label, { create = false } = {}) {
  let info;
  try { info = await lstat(target); }
  catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error;
    // Parent is validated first. Create only this component, never recurse
    // through a possibly substituted or symlinked path.
    await mkdir(target, { recursive: false, mode: 0o700 });
    info = await lstat(target);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} 必须是普通目录：${target}`);
  if (await realpath(target) !== target) throw new Error(`${label} 真实路径异常：${target}`);
}
async function warnOnPriorRuns(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^run-[0-9T-]+-\d+-[0-9a-f-]+$/i.test(entry.name)) continue;
    const candidate = path.join(root, entry.name);
    try {
      const marker = JSON.parse(await readFile(path.join(candidate, OWNER_MARKER), 'utf8'));
      if (marker.owner !== 'vantilo-e2e-run-v1' || marker.runRoot !== candidate || !['PREPARING', 'RUNNING', 'FINALIZING', 'CLEANUP_PENDING', 'CLEANUP_BLOCKED_ACTIVE_PROCESS'].includes(marker.status)) continue;
      const wrapper = psInfo(marker.wrapperPid);
      const child = marker.childPid ? psInfo(marker.childPid) : null;
      const isActive = (wrapper && wrapper.started === marker.wrapperStarted) || (child && child.started === marker.childStarted);
      process.stderr.write(`检测到先前测试运行 ${entry.name}（${isActive ? '仍有活动进程' : '可能中断'}）；未自动清理。检查后可运行 npm run test:cleanup -- --run-id ${entry.name}\n`);
    } catch { /* Unknown or malformed directories are never touched. */ }
  }
}
function commandFor(args) {
  if (args.length === 0) return { command: process.execPath, args: [rootVitest, 'run', '--configLoader', 'runner'], cwd: repo, kind: 'root-vitest' };
  if (args[0] === '--vitest') return { command: process.execPath, args: [rootVitest, 'run', '--configLoader', 'runner', ...args.slice(1)], cwd: repo, kind: 'root-vitest' };
  if (args[0] === '--reader') return { command: process.execPath, args: [readerVitest, 'run', '--configLoader', 'runner', '--config', path.join(repo, 'packages/reader/vitest.config.ts'), ...args.slice(1)], cwd: path.join(repo, 'packages/reader'), kind: 'reader-vitest' };
  const mode = args[0];
  const entry = args[1];
  if (!entry || !path.isAbsolute(path.resolve(repo, entry)) || !path.resolve(repo, entry).startsWith(`${repo}${path.sep}`)) throw new Error('测试脚本必须是仓库内路径。');
  if (mode === '--e2e' && vocabularyEntries.has(entry)) return { command: process.execPath, args: [path.join(repo, entry), ...args.slice(2)], cwd: repo, kind: 'electron-e2e' };
  if (mode === '--node' && nodeEntries.has(entry)) return { command: process.execPath, args: [path.join(repo, entry), ...args.slice(2)], cwd: repo, kind: 'node-e2e' };
  if (mode === '--electron' && electronEntries.has(entry)) return { command: process.execPath, args: [path.join(repo, 'node_modules/electron/cli.js'), path.join(repo, entry), ...args.slice(2)], cwd: repo, kind: 'electron-e2e' };
  throw new Error(`Workspace 测试入口拒绝未知命令：${mode} ${entry}`);
}

try { verifyWorkspaceVolume(); } catch (error) { fail(error.message); }
const workspaceReal = await realpath(WORKSPACE);
if (workspaceReal !== WORKSPACE) fail(`Workspace 挂载路径异常：${workspaceReal}`);
const runsParent = path.join(WORKSPACE_ROOT, 'test-runs');
await assertRealDirectory(WORKSPACE_ROOT, 'Workspace 项目根目录');
await assertRealDirectory(runsParent, 'test-runs 根目录', { create: true });
const runsRoot = path.join(runsParent, 'e2e');
await assertRealDirectory(runsRoot, 'E2E 运行根目录', { create: true });
const command = commandFor(argv);
const requiredFreeBytes = command.kind === 'root-vitest' ? 2 * 1024 ** 3 : 8 * 1024 ** 3;
const availableBytes = currentAvailableBytes();
if (availableBytes < requiredFreeBytes) fail(`Workspace 空间不足：本次运行至少需要 ${(requiredFreeBytes / 1024 ** 3).toFixed(1)} GiB，可用 ${(availableBytes / 1024 ** 3).toFixed(1)} GiB。`);
await warnOnPriorRuns(runsRoot);

const runId = `run-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}-${randomUUID()}`;
const runRoot = path.join(runsRoot, runId);
await mkdir(runRoot, { recursive: false, mode: 0o700 });
if (await realpath(runRoot) !== runRoot || !isWithin(runsRoot, runRoot)) fail(`拒绝使用异常运行目录：${runRoot}`);
try { assertWritableDirectory(runRoot); } catch (error) { fail(error.message); }
const wrapperInfo = psInfo(process.pid);
const ownerToken = randomUUID();
const marker = {
  owner: 'vantilo-e2e-run-v1', ownerToken, runId, runRoot, status: 'PREPARING',
  wrapperPid: process.pid, wrapperStarted: wrapperInfo?.started || null,
  childPid: null, childStarted: null, childPgid: null,
  startedAt: new Date().toISOString(), minimumFreeBytes: requiredFreeBytes,
  commandKind: command.kind, command: [argv[0] || 'root-vitest', argv[1] || ''].filter(Boolean),
  payloadDirectories: PAYLOAD_DIRS,
};
const markerPath = path.join(runRoot, OWNER_MARKER);
async function writeMarker() {
  const temp = path.join(runRoot, `.owner-${ownerToken}.tmp`);
  await (await import('node:fs/promises')).writeFile(temp, `${JSON.stringify(marker, null, 2)}\n`, { flag: 'w', mode: 0o600 });
  await rename(temp, markerPath);
}
await writeMarker();
const dirs = {
  runRoot,
  temp: path.join(runRoot, 'temp'),
  home: path.join(runRoot, 'home'),
  codex: path.join(runRoot, 'codex-home'),
  xdgConfig: path.join(runRoot, 'xdg-config'),
  xdgCache: path.join(runRoot, 'xdg-cache'),
  artifacts: path.join(runRoot, 'artifacts'),
  logs: path.join(runRoot, 'logs'),
  results: path.join(runRoot, 'results'),
  profiles: path.join(runRoot, 'electron-user-data'),
  chromium: path.join(runRoot, 'chromium-profile'),
  reader: path.join(runRoot, 'reader-data'),
};
for (const key of ['temp', 'home', 'codex', 'xdgConfig', 'xdgCache', 'artifacts', 'logs', 'results']) await mkdir(dirs[key], { recursive: false, mode: 0o700 });
const swcVersion = JSON.parse(await readFile(path.join(repo, 'node_modules/@swc/core/package.json'), 'utf8')).version;
const originalHome = process.env.HOME;
if (!originalHome || !path.isAbsolute(originalHome)) fail('无法验证受限的本地 SWC 缓存路径。');
const localCacheParent = path.join(originalHome, 'Library/Caches/Vantilo/swc-native');
const swcCache = path.join(localCacheParent, swcVersion);
const swcPathComponents = [path.join(originalHome, 'Library'), path.join(originalHome, 'Library/Caches'), path.join(originalHome, 'Library/Caches/Vantilo'), localCacheParent, swcCache];
for (const candidate of swcPathComponents) {
  try {
    const item = await lstat(candidate);
    if (item.isSymbolicLink() || !item.isDirectory() || await realpath(candidate) !== candidate) fail(`SWC 本地小型缓存路径不能包含符号链接或非目录：${candidate}`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await mkdir(localCacheParent, { recursive: true, mode: 0o700 });
await mkdir(swcCache, { recursive: true, mode: 0o700 });
if ((await stat(swcCache)).mode & 0o077) fail(`SWC 缓存权限过宽：${swcCache}`);
marker.status = 'RUNNING';
await writeMarker();

const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/(?:API.?KEY|TOKEN|PASSWORD|PASSWD|SECRET|CREDENTIAL|AUTHORIZATION|OAUTH)/i.test(name)));
const env = {
  ...inheritedEnv,
  HOME: dirs.home,
  CODEX_HOME: dirs.codex,
  XDG_CONFIG_HOME: dirs.xdgConfig,
  XDG_CACHE_HOME: dirs.xdgCache,
  TMPDIR: dirs.temp, TMP: dirs.temp, TEMP: dirs.temp,
  VANTILO_TEST_ROOT: runRoot,
  VANTILO_TEST_RUN_ROOT: runRoot,
  VANTILO_TEST_E2E_ROOT: runRoot,
  VANTILO_TEST_PROFILE_ROOT: dirs.profiles,
  VANTILO_TEST_CHROMIUM_ROOT: dirs.chromium,
  VANTILO_TEST_READER_ROOT: dirs.reader,
  VANTILO_TEST_ARTIFACT_ROOT: dirs.artifacts,
  VANTILO_TEST_RESULTS_ROOT: dirs.results,
  SWC_NATIVE_BINDING_CACHE: swcCache,
  VANTILO_RUNTIME_MODULE_INVENTORY_PATH: path.join(dirs.artifacts, 'runtime-modules/main-renderer.json'),
};
const header = `Vantilo isolated test run: ${runRoot}\nMode: ${command.kind}\nTMPDIR: ${env.TMPDIR}\nHOME: ${env.HOME}\nSWC native cache (small local exception): ${swcCache}\n`;
const logPath = path.join(dirs.logs, 'test-run.log');
const log = createWriteStream(logPath, { flags: 'wx', mode: 0o600 });
log.write(header);
process.stdout.write(header);
process.stdout.write(`Test log: ${logPath}\n`);

const child = spawn(command.command, command.args, { cwd: command.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
marker.childPid = child.pid ?? null;
const childInfo = child.pid ? psInfo(child.pid) : null;
marker.childStarted = childInfo?.started || null;
marker.childPgid = childInfo?.pgid || child.pid || null;
await writeMarker();
child.stdout?.on('data', chunk => { process.stdout.write(chunk); log.write(chunk); });
child.stderr?.on('data', chunk => { process.stderr.write(chunk); log.write(chunk); });
let requestedSignal = null;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  requestedSignal = signal;
  if (child.pid) { try { process.kill(-child.pid, signal); } catch {} }
});
const exitCode = await new Promise(resolve => {
  child.once('error', error => { log.write(`\nSpawn error: ${error.stack || error}\n`); resolve(1); });
  child.once('close', code => log.end(() => resolve(code ?? 1)));
});
async function groupHasProcesses(pgid) {
  try { process.kill(-Number(pgid), 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; }
}
let groupGone = !marker.childPgid;
if (marker.childPgid) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { if (!(await groupHasProcesses(marker.childPgid))) { groupGone = true; break; } }
    catch { break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

async function collectEvidence(sourceRoot, relativeRoot = '') {
  const found = [];
  let entries;
  try { entries = await readdir(sourceRoot, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(sourceRoot, entry.name);
    const relative = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) found.push(...await collectEvidence(full, relative));
    else if (entry.isFile() && (/^(summary|result-|isolation-proof|.*-evidence|.*-acceptance)/i.test(entry.name) && /\.(json|txt|md)$/i.test(entry.name))) {
      const info = await stat(full);
      if (info.size <= 10 * 1024 * 1024) found.push({ full, relative, size: info.size });
    }
  }
  return found;
}
async function preserveEvidence() {
  let total = 0;
  for (const sourceName of [...PAYLOAD_DIRS, 'temp']) {
    const source = path.join(runRoot, sourceName);
    for (const item of await collectEvidence(source, sourceName)) {
      if (total + item.size > 50 * 1024 * 1024) continue;
      const destination = path.join(dirs.results, item.relative);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await (await import('node:fs/promises')).copyFile(item.full, destination, constants.COPYFILE_EXCL).catch(error => { if (error.code !== 'EEXIST') throw error; });
      total += item.size;
    }
  }
  return total;
}
async function cleanupOwnedPayload({ preserveArtifacts = false } = {}) {
  if (await realpath(runRoot) !== runRoot || !isWithin(runsRoot, runRoot)) throw new Error('运行根路径改变；拒绝清理。');
  const current = JSON.parse(await readFile(markerPath, 'utf8'));
  if (current.ownerToken !== ownerToken || current.owner !== 'vantilo-e2e-run-v1') throw new Error('运行所有权标记不匹配；拒绝清理。');
  const names = preserveArtifacts ? PAYLOAD_DIRS.filter(name => name !== 'artifacts') : PAYLOAD_DIRS;
  for (const name of names) {
    const target = path.join(runRoot, name);
    let info;
    try { info = await lstat(target); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (info.isSymbolicLink()) { await rm(target); continue; }
    if (!info.isDirectory() || await realpath(target) !== target || !isWithin(runRoot, target)) throw new Error(`拒绝清理非本运行目录：${target}`);
    await rm(target, { recursive: true, force: false });
  }
}

const failed = exitCode !== 0 || requestedSignal !== null;
marker.childExitCode = exitCode;
marker.finishedAt = new Date().toISOString();
marker.status = failed ? 'FAILED' : 'FINALIZING';
marker.failurePreserved = failed;
await writeMarker();
let cleanupError = null;
if (groupGone) {
  try {
    marker.evidenceBytes = await preserveEvidence();
    await cleanupOwnedPayload({ preserveArtifacts: !failed && keepArtifacts });
    marker.status = keepArtifacts && !failed ? 'COMPLETED_ARTIFACTS_PRESERVED' : failed ? 'FAILED_CLEANED' : 'COMPLETED';
  } catch (error) { cleanupError = error; marker.status = 'CLEANUP_PENDING'; marker.cleanupError = error.message; }
} else {
  marker.status = 'CLEANUP_BLOCKED_ACTIVE_PROCESS';
  marker.cleanupError = '测试进程组退出未能确认，保留全部测试数据。';
}
await writeMarker();
process.stdout.write(`Test run status: ${marker.status}\nRetained log: ${logPath}\nRetained results: ${dirs.results}\n`);
if (cleanupError) process.stderr.write(`测试目录清理失败并已保留：${cleanupError.stack || cleanupError}\n`);
if (!groupGone) process.stderr.write(`${marker.cleanupError}\n`);
process.exitCode = cleanupError || !groupGone ? 1 : exitCode;
