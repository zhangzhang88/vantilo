import {readDefaultMagazines,copyDefaultMagazines} from './default-magazine-seed.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { packager } from '@electron/packager';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await import('./build-app-icon.mjs');
const require = createRequire(import.meta.url);
if (process.platform !== 'darwin') throw new Error('This build targets macOS; run it on a Mac.');
const { validateManifest } = require('../electron/reader-library-seed.cjs');
await readDefaultMagazines(); // Default release content is the four authorized issues only.
const stage = path.join(repo, 'build/package-app');
await fs.rm(stage, { recursive: true, force: true });
await fs.mkdir(path.join(stage, 'electron'), { recursive: true });
for (const name of ['dist', 'licenses', 'resources']) await fs.cp(path.join(repo, name), path.join(stage, name), { recursive: true });
await fs.mkdir(path.join(stage,'reader'),{recursive:true});
for(const name of ['web','native','api.cjs','codex','codex-code-mode-host','provenance.json','THIRD_PARTY_NOTICES.txt'])await fs.cp(path.join(repo,'build/reader',name),path.join(stage,'reader',name),{recursive:true});
await copyDefaultMagazines(path.join(stage,'reader/seed'));
const metadata = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: 'vantilo', version: metadata.version, main: 'electron/main.cjs', private: true }));
// Explicit runtime allowlist; the separately validated seed is the only bundled reading content. No repository, tests, .env or private records are copied.
for (const entry of ['main.cjs', 'preload.cjs', 'runtime-entry.cjs', 'portable-reader-entry.cjs', 'portable-reader-service.cjs']) {
  await build({ entryPoints: [path.join(repo, 'electron', entry)], outfile: path.join(stage, 'electron', entry),
    platform: 'node', target: 'node22', format: 'cjs', bundle: true, external: ['electron'], minify: true, legalComments: 'eof' });
}
// Unbundled provenance notices for the Vantilo runtime dependency.
await fs.copyFile(path.join(repo, 'node_modules/zod/LICENSE'), path.join(stage, 'licenses/Zod-LICENSE.txt'));
const electron = require('electron/package.json');
const outputs = await packager({ dir: stage, out: path.join(repo, 'out'), name: 'Vantilo', platform: 'darwin', arch: process.arch,
  electronVersion: electron.version, electronDist: path.join(repo, 'node_modules/electron/dist'),
  icon: path.join(repo, 'resources/vantilo.icns'),
  appBundleId: 'com.vantilo.desktop', overwrite: true, prune: false, asar: false,
});
console.log('Packaged Mac application:', outputs.join(', '));
