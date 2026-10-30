import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const appPath = process.env.VANTILO_VOCABULARY_E2E_PACKAGE_APP;
if (!appPath || !path.isAbsolute(appPath) || !appPath.startsWith('/Volumes/Workspace/Development/Vantilo/workspaces/')) {
  throw new Error('请提供位于 Workspace 外置工作副本内的隔离 E2E 应用路径。');
}
const appBinary = path.join(appPath, 'Contents/MacOS/Vantilo Vocabulary E2E');
await fs.access(appBinary);
const base = await fs.mkdtemp(path.join(os.tmpdir(), `vantilo-vocabulary-packaged-e2e-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-`));
const dirs = {
  home: path.join(base, 'home'),
  tmp: path.join(base, 'tmp'),
  codex: path.join(base, 'codex-home'),
  xdgConfig: path.join(base, 'xdg-config'),
  xdgCache: path.join(base, 'xdg-cache'),
  downloadsA: path.join(base, 'downloads-a'),
  downloadsB: path.join(base, 'downloads-b'),
  profileA: path.join(base, 'user-data-a'),
  profileB: path.join(base, 'user-data-b'),
};
for (const directory of Object.values(dirs)) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
const backup = path.join(base, 'Vantilo-Vocabulary-Packaged-E2E.json');

function run(mode, profile, downloads) {
  const resultPath = path.join(base, `result-${mode}.json`);
  const env = { ...process.env };
  delete env.VANTILO_DEV_SERVER_URL;
  delete env.VANTILO_DEV_READER_ASSETS;
  Object.assign(env, {
    HOME: dirs.home,
    CODEX_HOME: dirs.codex,
    XDG_CONFIG_HOME: dirs.xdgConfig,
    XDG_CACHE_HOME: dirs.xdgCache,
    TMPDIR: dirs.tmp,
    VANTILO_VOCABULARY_E2E_MODE: mode,
    VANTILO_VOCABULARY_E2E_USER_DATA: profile,
    VANTILO_VOCABULARY_E2E_DOWNLOADS: downloads,
    VANTILO_VOCABULARY_E2E_RESULT: resultPath,
    VANTILO_VOCABULARY_E2E_BACKUP: backup,
  });
  return new Promise((resolve, reject) => {
    const child = spawn(appBinary, [`--user-data-dir=${profile}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
    const timeout = setTimeout(() => child.kill('SIGTERM'), 90000);
    child.once('error', reject);
    child.once('exit', async code => {
      clearTimeout(timeout);
      try {
        const result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
        if (code !== 0 || result.status !== 'PASS') throw new Error(`打包应用 E2E ${mode} 未通过：${JSON.stringify(result)}\n${stderr.slice(-4000)}`);
        resolve(result);
      } catch (error) {
        reject(new Error(`打包应用 E2E ${mode} 未生成通过证据（退出码 ${code}）。\n${stderr.slice(-4000)}\n${stdout.slice(-2000)}\n${error}`));
      }
    });
  });
}

console.log(`Packaged E2E isolation root: ${base}`);
console.log(`Packaged app: ${appPath}`);
const modes = [];
modes.push(await run('source', dirs.profileA, dirs.downloadsA));
modes.push(await run('target', dirs.profileB, dirs.downloadsB));
modes.push(await run('verify', dirs.profileB, dirs.downloadsB));
const summary = { status: 'PASS', appPath, appBinary, base, backup, modes: modes.map(({ mode, pid, evidence }) => ({ mode, pid, evidence })) };
await fs.writeFile(path.join(base, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
console.log(`VOCABULARY_BACKUP_PACKAGED_E2E_PASS ${JSON.stringify(summary)}`);
