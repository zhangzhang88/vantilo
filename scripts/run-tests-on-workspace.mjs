import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = '/Volumes/Workspace';
const expectedUuid = '2BA2763B-3ED8-47DF-B569-EC8A2F0AFAAE';
const verify = spawnSync('/bin/sh', ['/Volumes/Workspace/_System/verify-workspace-volume.sh'], { encoding: 'utf8' });
const verification = `${verify.stdout || ''}${verify.stderr || ''}`;
if (verify.status !== 0 || !verification.includes(expectedUuid) || !/APFS/.test(verification) || !/writable/i.test(verification)) {
  process.stderr.write(`拒绝运行测试：Workspace 卷验证失败。\n${verification}`);
  process.exit(2);
}

const workspaceReal = await realpath(workspace);
if (workspaceReal !== workspace) throw new Error(`Workspace 挂载路径异常：${workspaceReal}`);
const runsRoot = path.join(workspaceReal, 'Development/Vantilo/test-runs');
try {
const existing = await lstat(runsRoot);
  if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error('test-runs 已存在但不是普通目录');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(runsRoot, { recursive: true, mode: 0o700 });
if (await realpath(runsRoot) !== runsRoot) throw new Error('test-runs 不能是符号链接或解析到其他路径');
const runId = `run-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}`;
const runRoot = path.join(runsRoot, runId);
const dirs = {
  runRoot,
  e2e: path.join(runRoot, 'e2e'),
  profiles: path.join(runRoot, 'electron-profiles'),
  readerData: path.join(runRoot, 'reader-test-data'),
  temp: path.join(runRoot, 'temp'),
  cache: path.join(runRoot, 'cache'),
  artifacts: path.join(runRoot, 'artifacts'),
  logs: path.join(runRoot, 'logs'),
};
for (const directory of Object.values(dirs)) await mkdir(directory, { recursive: false, mode: 0o700 });
const actualRunRoot = await realpath(runRoot);
if (!actualRunRoot.startsWith(`${runsRoot}${path.sep}`)) throw new Error('测试目录解析后不在 Workspace test-runs 中');

const swcVersion = JSON.parse(await readFile(path.join(repo, 'node_modules/@swc/core/package.json'), 'utf8')).version;
const localCacheParent = path.join(process.env.HOME || '', 'Library/Caches/Vantilo/swc-native');
const swcCache = path.join(localCacheParent, swcVersion);
await mkdir(localCacheParent, { recursive: true, mode: 0o700 });
for (const candidate of [path.join(process.env.HOME || '', 'Library'), path.join(process.env.HOME || '', 'Library/Caches'), path.join(process.env.HOME || '', 'Library/Caches/Vantilo'), localCacheParent]) {
  if ((await lstat(candidate)).isSymbolicLink()) throw new Error(`SWC 本地小型缓存路径不能包含符号链接：${candidate}`);
}
await mkdir(swcCache, { recursive: true, mode: 0o700 });
if ((await stat(swcCache)).mode & 0o077) throw new Error(`SWC 缓存权限过宽：${swcCache}`);

const env = {
  ...process.env,
  VANTILO_TEST_ROOT: actualRunRoot,
  VANTILO_TEST_RUN_ROOT: actualRunRoot,
  VANTILO_TEST_E2E_ROOT: dirs.e2e,
  VANTILO_TEST_PROFILE_ROOT: dirs.profiles,
  VANTILO_TEST_READER_ROOT: dirs.readerData,
  VANTILO_TEST_ARTIFACT_ROOT: dirs.artifacts,
  TMPDIR: dirs.temp,
  TMP: dirs.temp,
  TEMP: dirs.temp,
  XDG_CACHE_HOME: dirs.cache,
  SWC_NATIVE_BINDING_CACHE: swcCache,
};
const runHeader = `Vantilo test run: ${actualRunRoot}\nTMPDIR: ${env.TMPDIR}\nSWC native cache (small local cache): ${env.SWC_NATIVE_BINDING_CACHE}\n`;
process.stdout.write(runHeader);
const vitest = path.join(repo, 'node_modules/vitest/vitest.mjs');
const suppliedArgs = process.argv.slice(2).filter((value, index) => !(index === 0 && value === '--'));
let command;
let args;
let cwd = repo;
if (suppliedArgs[0] === '--reader') {
  command = process.execPath;
  args = [vitest, 'run', '--config', path.join(repo, 'packages/reader/vitest.config.ts'), ...suppliedArgs.slice(1)];
  cwd = path.join(repo, 'packages/reader');
} else if (suppliedArgs[0] === '--e2e') {
  const script = suppliedArgs[1];
  const allowed = new Set(['scripts/run-vocabulary-backup-e2e.mjs', 'scripts/run-vocabulary-backup-packaged-e2e.mjs', 'scripts/run-vocabulary-backup-universal-e2e.mjs']);
  if (!allowed.has(script)) throw new Error('Workspace E2E wrapper 拒绝未知脚本');
  command = process.execPath;
  args = [path.join(repo, script), ...suppliedArgs.slice(2)];
} else {
  command = process.execPath;
  args = [vitest, 'run', ...suppliedArgs];
}
const logPath = path.join(dirs.logs, 'test-run.log');
const log = createWriteStream(logPath, { flags: 'wx', mode: 0o600 });
log.write(runHeader);
process.stdout.write(`Test log: ${logPath}\n`);
const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', chunk => { process.stdout.write(chunk); log.write(chunk); });
child.stderr.on('data', chunk => { process.stderr.write(chunk); log.write(chunk); });
const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', code => log.end(() => resolve(code ?? 1)));
});
process.exit(exitCode);
