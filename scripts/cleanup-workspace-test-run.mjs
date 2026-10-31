import { spawnSync } from 'node:child_process';
import { lstat, readFile, realpath, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import workspaceGuard from './workspace-test-environment.cjs';

const { RUNS_ROOT, OWNER_MARKER, PAYLOAD_DIRS, verifyWorkspaceVolume, isWithin } = workspaceGuard;
function refuse(message) { process.stderr.write(`拒绝清理测试运行目录：${message}\n`); process.exit(2); }
function readProcess(pid) {
  if (!pid) return { alive: false };
  try { process.kill(Number(pid), 0); }
  catch (error) { if (error.code === 'ESRCH') return { alive: false }; if (error.code !== 'EPERM') throw error; }
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart=,pgid=,command='], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`无法确认 PID ${pid} 的进程身份；为安全起见保留目录。`);
  const match = result.stdout.trim().match(/^(.{24})\s+(\d+)\s+(.*)$/);
  if (!match) throw new Error(`无法解析 PID ${pid} 的进程身份；为安全起见保留目录。`);
  return { alive: true, started: match[1].trim(), pgid: Number(match[2]), command: match[3] };
}

try { verifyWorkspaceVolume(); } catch (error) { refuse(error.message); }
const args = process.argv.slice(2);
const option = args.indexOf('--run-id');
const runId = option >= 0 ? args[option + 1] : null;
if (!runId || !/^run-\d{14}-\d+-[a-f0-9-]+$/i.test(runId) || args.length !== 2) {
  refuse('请指定唯一的 --run-id run-<时间>-<PID>-<UUID>；不会按时间或通配符清理。');
}
if (await realpath(RUNS_ROOT) !== RUNS_ROOT) refuse('Workspace 测试根目录不是规范真实路径。');
const runRoot = path.join(RUNS_ROOT, runId);
if (!isWithin(RUNS_ROOT, runRoot) || await realpath(runRoot) !== runRoot) refuse('目标路径越出 E2E 运行根目录或含符号链接。');
const rootStat = await lstat(runRoot);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) refuse('目标不是普通运行目录。');
const markerPath = path.join(runRoot, OWNER_MARKER);
const markerStat = await lstat(markerPath);
if (!markerStat.isFile() || markerStat.isSymbolicLink()) refuse('缺少有效的 Vantilo 所有权标记。');
const marker = JSON.parse(await readFile(markerPath, 'utf8'));
if (marker.owner !== 'vantilo-e2e-run-v1' || marker.runId !== runId || marker.runRoot !== runRoot || !marker.ownerToken) refuse('所有权清单与目标目录不匹配。');
if (marker.status === 'RUNNING' || marker.status === 'FINALIZING') refuse(`运行状态为 ${marker.status}，不能清理。`);

for (const [label, pid, expectedStart] of [['运行器', marker.wrapperPid, marker.wrapperStarted], ['测试子进程', marker.childPid, marker.childStarted]]) {
  const processInfo = readProcess(pid);
  if (processInfo.alive && (!expectedStart || processInfo.started === expectedStart)) refuse(`${label} PID ${pid} 仍在运行。`);
}
if (marker.childPgid) {
  try { process.kill(-Number(marker.childPgid), 0); refuse(`测试进程组 ${marker.childPgid} 仍在运行。`); }
  catch (error) { if (error.code !== 'ESRCH' && error.code !== 'EPERM') refuse(`无法检查测试进程组：${error.message}`); if (error.code === 'EPERM') refuse(`无法确认测试进程组 ${marker.childPgid} 已退出。`); }
}
const openFiles = spawnSync('lsof', ['-nP', '+D', runRoot], { encoding: 'utf8' });
if (openFiles.error || (openFiles.status !== 0 && openFiles.status !== 1)) refuse(`无法检查打开文件：${openFiles.stderr || openFiles.error}`);
const openLines = (openFiles.stdout || '').trim().split('\n').filter(Boolean).slice(1);
if (openLines.length) refuse(`仍有进程打开该运行目录文件：${openLines.slice(0, 4).join('；')}`);

marker.status = 'CLEANING';
marker.cleanupStartedAt = new Date().toISOString();
const markerTemp = path.join(runRoot, `.cleanup-${marker.ownerToken}.tmp`);
await writeFile(markerTemp, `${JSON.stringify(marker, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
await rename(markerTemp, markerPath);
for (const name of PAYLOAD_DIRS) {
  const target = path.join(runRoot, name);
  let item;
  try { item = await lstat(target); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (item.isSymbolicLink()) { await rm(target); continue; }
  if (!item.isDirectory() || await realpath(target) !== target || !isWithin(runRoot, target)) refuse(`拒绝删除越界或异常目录：${target}`);
  await rm(target, { recursive: true, force: false });
}
marker.status = 'CLEANED_MANUALLY';
marker.cleanedAt = new Date().toISOString();
await writeFile(markerTemp, `${JSON.stringify(marker, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
await rename(markerTemp, markerPath);
process.stdout.write(`已清理本次运行的受控临时数据；保留 owner 清单、日志和结果：${runRoot}\n`);
