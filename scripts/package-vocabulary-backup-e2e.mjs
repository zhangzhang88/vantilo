import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { packager } from '@electron/packager';
import workspaceGuard from './workspace-test-environment.cjs';

workspaceGuard.assertWorkspaceTestEnvironment();

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = '/Volumes/Workspace/Development/Vantilo/workspaces/';
if (process.platform !== 'darwin' || !repo.startsWith(workspaceRoot)) {
  throw new Error('词汇 E2E 应用必须在 macOS 的 Workspace 外置工作副本中构建。');
}

const require = createRequire(import.meta.url);
const packageInfo = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
const electronInfo = require('electron/package.json');
const buildRoot = path.join(repo, 'build');
const readerRoot = path.join(buildRoot, 'vocabulary-backup-e2e-reader');
const artifactRoot = process.env.VANTILO_TEST_ARTIFACT_ROOT;
const resultsRoot = process.env.VANTILO_TEST_RESULTS_ROOT;
if (!artifactRoot || !resultsRoot) throw new Error('Workspace test artifact and results roots are required.');
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const unique = `${stamp}-${randomUUID().slice(0, 8)}`;
const stage = path.join(artifactRoot, `vocabulary-backup-e2e-stage-${unique}`);
const output = path.join(artifactRoot, `vocabulary-backup-e2e-package-${unique}`);

for (const directory of [path.join(repo, 'dist'), path.join(repo, 'resources'), path.join(repo, 'licenses'), readerRoot]) {
  const stat = await fs.stat(directory).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`缺少 E2E 打包输入目录：${directory}`);
}
for (const target of [stage, output]) {
  if (await fs.lstat(target).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))) {
    throw new Error(`为保护已有构建材料，拒绝覆盖：${target}`);
  }
}
if (await fs.lstat(path.join(readerRoot, 'seed')).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))) {
  throw new Error('E2E 安装包输入意外包含 Reader seed；拒绝打包。');
}

await fs.mkdir(path.join(stage, 'electron'), { recursive: true });
await fs.mkdir(path.join(stage, 'scripts'), { recursive: true });
for (const name of ['dist', 'licenses', 'resources']) await fs.cp(path.join(repo, name), path.join(stage, name), { recursive: true });
await fs.mkdir(path.join(stage, 'reader'), { recursive: true });
for (const name of ['web', 'native', 'api.cjs', 'codex', 'codex-code-mode-host', 'provenance.json', 'THIRD_PARTY_NOTICES.txt']) {
  await fs.cp(path.join(readerRoot, name), path.join(stage, 'reader', name), { recursive: true });
}

const appMetadata = {
  name: 'vantilo-vocabulary-backup-e2e',
  version: packageInfo.version,
  private: true,
  main: 'scripts/vocabulary-backup-e2e-main.cjs',
};
await fs.writeFile(path.join(stage, 'package.json'), `${JSON.stringify(appMetadata, null, 2)}\n`, { flag: 'wx' });

for (const entry of ['main.cjs', 'preload.cjs', 'runtime-entry.cjs', 'portable-reader-entry.cjs', 'portable-reader-service.cjs']) {
  await build({
    entryPoints: [path.join(repo, 'electron', entry)],
    outfile: path.join(stage, 'electron', entry),
    platform: 'node', target: 'node22', format: 'cjs', bundle: true, external: ['electron'], minify: true, legalComments: 'eof',
  });
}
await fs.copyFile(path.join(repo, 'electron/vocabulary-backup-service.cjs'), path.join(stage, 'electron/vocabulary-backup-service.cjs'));
for (const entry of ['vocabulary-backup-e2e-main.cjs', 'vocabulary-backup-e2e-driver.cjs', 'vocabulary-backup-e2e-fixtures.cjs', 'workspace-test-environment.cjs']) {
  await fs.copyFile(path.join(repo, 'scripts', entry), path.join(stage, 'scripts', entry));
}

const outputs = await packager({
  dir: stage,
  out: output,
  name: 'Vantilo Vocabulary E2E',
  platform: 'darwin',
  arch: process.arch,
  electronVersion: electronInfo.version,
  electronDist: path.join(repo, 'node_modules/electron/dist'),
  icon: path.join(repo, 'resources/vantilo.icns'),
  appBundleId: 'com.vantilo.desktop.vocabulary-e2e',
  appVersion: packageInfo.version,
  overwrite: false,
  prune: false,
  asar: false,
});
const appPath = path.join(outputs[0], 'Vantilo Vocabulary E2E.app');
await fs.access(path.join(appPath, 'Contents', 'MacOS', 'Vantilo Vocabulary E2E'));
await fs.writeFile(path.join(resultsRoot, `vocabulary-backup-e2e-package-path-${unique}.txt`), `${appPath}\n`, { flag: 'wx', mode: 0o600 });
console.log(`VOCABULARY_BACKUP_E2E_APP=${appPath}`);
