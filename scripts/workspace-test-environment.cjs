const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const WORKSPACE = '/Volumes/Workspace';
const WORKSPACE_ROOT = '/Volumes/Workspace/Development/Vantilo';
const RUNS_ROOT = path.join(WORKSPACE_ROOT, 'test-runs/e2e');
const EXPECTED_UUID = '2BA2763B-3ED8-47DF-B569-EC8A2F0AFAAE';
const OWNER_MARKER = '.vantilo-test-run.json';
const PAYLOAD_DIRS = ['temp', 'home', 'codex-home', 'xdg-config', 'xdg-cache', 'artifacts', 'electron-user-data', 'chromium-profile', 'reader-data'];

function assertWorkspaceVerifierReport(status, output) {
  if (status !== 0 || !String(output).includes(EXPECTED_UUID) || !/APFS/.test(String(output)) || !/writable/i.test(String(output))) {
    const error = new Error(`拒绝运行 Vantilo 测试：Workspace 身份、APFS 或可写验证失败。\n${output}`);
    error.code = 'workspace_unavailable';
    throw error;
  }
  return true;
}

function verifyWorkspaceVolume() {
  const result = spawnSync('/bin/sh', ['/Volumes/Workspace/_System/verify-workspace-volume.sh'], { encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assertWorkspaceVerifierReport(result.status, output);
  if (fs.realpathSync(WORKSPACE) !== WORKSPACE) throw new Error('拒绝运行 Vantilo 测试：Workspace 挂载点不是预期真实路径。');
  return output;
}

function assertWritableDirectory(directory) {
  const probe = path.join(directory, `.vantilo-write-probe-${crypto.randomUUID()}`);
  let fd;
  try {
    fd = fs.openSync(probe, 'wx', 0o600);
    fs.closeSync(fd); fd = undefined;
    fs.unlinkSync(probe);
    return true;
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    try { fs.unlinkSync(probe); } catch {}
    throw new Error(`拒绝运行 Vantilo 测试：目标目录不可写（${directory}）：${error.message}`);
  }
}

function assertAvailableSpace(availableBytes, minimumBytes) {
  if (!Number.isFinite(availableBytes) || !Number.isFinite(minimumBytes) || minimumBytes < 0 || availableBytes < minimumBytes) {
    const error = new Error(`Workspace 可用空间不足：需要 ${minimumBytes} 字节，可用 ${availableBytes} 字节。`);
    error.code = 'workspace_insufficient_space';
    throw error;
  }
  return true;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertWorkspaceTestEnvironment() {
  verifyWorkspaceVolume();
  const runRoot = process.env.VANTILO_TEST_RUN_ROOT;
  const tempRoot = process.env.TMPDIR;
  if (!runRoot || !path.isAbsolute(runRoot) || !runRoot.startsWith(`${RUNS_ROOT}${path.sep}`)) {
    throw new Error('拒绝运行 E2E：缺少 Workspace 独立运行目录；请使用 npm 测试入口。');
  }
  const canonicalRun = fs.realpathSync(runRoot);
  const canonicalTemp = tempRoot && fs.realpathSync(tempRoot);
  if (canonicalRun !== path.resolve(runRoot) || canonicalTemp !== path.resolve(tempRoot)) {
    throw new Error('拒绝运行 E2E：测试路径不是规范真实路径或包含符号链接。');
  }
  const runStat = fs.lstatSync(canonicalRun);
  const tempStat = fs.lstatSync(canonicalTemp);
  if (!runStat.isDirectory() || runStat.isSymbolicLink() || !tempStat.isDirectory() || tempStat.isSymbolicLink() || !isWithin(canonicalRun, canonicalTemp)) {
    throw new Error('拒绝运行 E2E：运行目录或 TMPDIR 不在隔离 Workspace 根目录内。');
  }
  if (os.tmpdir() !== canonicalTemp) throw new Error(`拒绝运行 E2E：Node 实际临时目录不匹配（${os.tmpdir()}）。`);
  const markerPath = path.join(canonicalRun, OWNER_MARKER);
  const markerStat = fs.lstatSync(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error('拒绝运行 E2E：Workspace 运行目录缺少有效所有权标记。');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (marker.owner !== 'vantilo-e2e-run-v1' || marker.runRoot !== canonicalRun || !['RUNNING'].includes(marker.status)) {
    throw new Error('拒绝运行 E2E：运行目录所有权或生命周期状态不匹配。');
  }
  const requiredFreeBytes = Number(marker.minimumFreeBytes || 0);
  const statfs = fs.statfsSync(WORKSPACE);
  const availableBytes = statfs.bavail * statfs.bsize;
  try { assertAvailableSpace(availableBytes, requiredFreeBytes); }
  catch (error) { throw new Error(`拒绝运行 E2E：${error.message}`); }
  for (const [label, variable] of [['HOME', 'HOME'], ['CODEX_HOME', 'CODEX_HOME'], ['XDG_CONFIG_HOME', 'XDG_CONFIG_HOME'], ['XDG_CACHE_HOME', 'XDG_CACHE_HOME']]) {
    const value = process.env[variable];
    if (!value || !path.isAbsolute(value) || !isWithin(canonicalRun, path.resolve(value))) throw new Error(`拒绝运行 E2E：${label} 未隔离到本次 Workspace 运行目录。`);
    const canonical = fs.realpathSync(value);
    if (canonical !== path.resolve(value) || fs.lstatSync(value).isSymbolicLink() || !isWithin(canonicalRun, canonical)) throw new Error(`拒绝运行 E2E：${label} 存在符号链接逃逸。`);
  }
  for (const variable of ['VANTILO_TEST_PROFILE_ROOT', 'VANTILO_TEST_CHROMIUM_ROOT', 'VANTILO_TEST_READER_ROOT', 'VANTILO_TEST_ARTIFACT_ROOT', 'VANTILO_TEST_RESULTS_ROOT']) {
    const value = process.env[variable];
    if (!value || !path.isAbsolute(value) || !isWithin(canonicalRun, path.resolve(value))) throw new Error(`拒绝运行 E2E：${variable} 未位于本次运行目录。`);
    let current = path.resolve(value);
    while (isWithin(canonicalRun, current)) {
      try {
        const item = fs.lstatSync(current);
        if (item.isSymbolicLink() || !item.isDirectory() || fs.realpathSync(current) !== current) throw new Error(`拒绝运行 E2E：${variable} 经过危险路径组件 ${current}。`);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      current = path.dirname(current);
    }
  }
  for (const variable of ['VANTILO_READER_LIBRARY', 'VANTILO_READER_USER_DATA', 'VANTILO_READER_DATA', 'VANTILO_GROWTH_SCREENSHOT_DIR', 'VANTILO_GROWTH_PAGE_SCREENSHOT_DIR', 'VANTILO_TOOLBAR_SCREENSHOT']) {
    const value = process.env[variable];
    if (value && (!path.isAbsolute(value) || !isWithin(canonicalRun, path.resolve(value)))) {
      throw new Error(`拒绝运行 E2E：${variable} 指向本次隔离运行目录之外。`);
    }
  }
  if (process.versions.electron) {
    const profileRoot = path.resolve(process.env.VANTILO_TEST_PROFILE_ROOT);
    const chromiumRoot = path.resolve(process.env.VANTILO_TEST_CHROMIUM_ROOT);
    fs.mkdirSync(profileRoot, { recursive: true, mode: 0o700 });
    fs.mkdirSync(chromiumRoot, { recursive: true, mode: 0o700 });
    const electron = require('electron');
    const expectedElectronPaths = { userData: profileRoot, sessionData: chromiumRoot };
    const nativeSetPath = electron.app.setPath.bind(electron.app);
    electron.app.setPath = (name, value) => {
      if (Object.hasOwn(expectedElectronPaths, name)) {
        if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`Electron ${name} 测试路径必须是绝对路径。`);
        expectedElectronPaths[name] = path.resolve(value);
      }
      return nativeSetPath(name, value);
    };
    // Set safe paths before the application is ready. Individual fixtures may
    // select a narrower profile later, but may never escape this run.
    electron.app.setPath('userData', profileRoot);
    electron.app.setPath('sessionData', chromiumRoot);
    electron.app.once('ready', () => {
      try {
        const actual = {};
        for (const name of ['userData', 'sessionData']) {
          const value = electron.app.getPath(name);
          const canonical = fs.realpathSync(value);
          const expected = fs.realpathSync(expectedElectronPaths[name]);
          if (canonical !== path.resolve(value) || canonical !== expected || !isWithin(canonicalRun, canonical)) {
            throw new Error(`${name} 实际路径与预期路径不一致或越出本次 Workspace 运行目录；预期 ${expected}，实际 ${canonical}`);
          }
          actual[name] = canonical;
        }
        process.stdout.write(`Workspace Electron isolation: ${JSON.stringify({ pid: process.pid, runRoot: canonicalRun, ...actual })}\n`);
      } catch (error) {
        process.stderr.write(`Electron 隔离核验失败，立即终止测试：${error.message}\n`);
        process.exit(86);
      }
    });
  }
  return { runRoot: canonicalRun, tempRoot: canonicalTemp, marker };
}

module.exports = { WORKSPACE, WORKSPACE_ROOT, RUNS_ROOT, EXPECTED_UUID, OWNER_MARKER, PAYLOAD_DIRS, assertWorkspaceVerifierReport, verifyWorkspaceVolume, assertWritableDirectory, assertAvailableSpace, isWithin, assertWorkspaceTestEnvironment };
