// Compile Reader entry points and record provenance/notices; personal library seeding is a separate opt-in task.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import {copyCodexRuntime} from './codex-runtime-assets.mjs';
import parcelMacros from 'unplugin-parcel-macros';
import {sharedReaderComposerPlugin} from './reader-assistant-adapter.mjs';
import { adaptReaderSource, readerVariantPlugin } from './reader-variant.mjs';
import {readerSourceRoot} from './reader-source-path.mjs';
import {findPackageRoot} from './package-root-resolution.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readerSourceRoot;
const output = path.join(repo, 'build/reader');
const legacySeedPath = path.join(output, 'seed');
try {
  await fs.lstat(legacySeedPath);
  throw new Error('Reader build output contains a legacy seed directory; inspect it manually and move it out of the build tree before rebuilding');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const requireReader = createRequire(path.join(source, 'package.json'));
const readerPackage = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
if (readerPackage.name !== '@vantilo/reader') throw new Error('Not Vantilo\'s embedded Reader workspace');
await fs.mkdir(output, { recursive: true });
const { build: buildWeb } = await import(pathToFileURL(requireReader.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(requireReader.resolve('@vitejs/plugin-react')).href);
await buildWeb({ root: source, configFile: false, envFile: false, publicDir: false,
  cacheDir: path.join(repo, 'build/reader-vite-cache'), resolve:{dedupe:['react','react-dom']}, plugins: [sharedReaderComposerPlugin(), parcelMacros.vite(), readerVariantPlugin(), react()], base: '/',
  build: { outDir: path.join(output, 'web'), emptyOutDir: true, sourcemap: false },
});
const api = await build({ stdin: {
  contents: `export { buildServer } from ${JSON.stringify(path.join(source, 'src/server/app.ts'))}; export { GitHubMagazineSyncService } from ${JSON.stringify(path.join(source, 'src/server/services/github-magazine-sync-service.ts'))};`,
  resolveDir: source, sourcefile: 'vantilo-reader-api-entry.ts', loader: 'ts',
}, outfile: path.join(output, 'api.cjs'), bundle: true, platform: 'node', target: 'node22', format: 'cjs', metafile: true,
  plugins: [{ name: 'vantilo-reader-api', setup(builder) { builder.onLoad({ filter: /\.ts$/ }, async args => {
    if (!args.path.startsWith(source + '/src/')) return;
    // Match the release API: importing an EPUB must not start background AI translation.
    return { contents: adaptReaderSource(await fs.readFile(args.path, 'utf8'), args.path, {catalogPreview:true}), loader: 'ts' };
  }); } }],
  legalComments: 'eof', minify: true, logLevel: 'info',
});
// Keep code provenance and dependency notices; seed content has its own manifest, never source config/data.
const inputs = Object.keys(api.metafile.inputs).filter(input => input !== 'vantilo-reader-api-entry.ts');
const provenance = { sourceProject: readerPackage.sourceProject, version: readerPackage.version,
  sourceCommit: readerPackage.sourceCommit,
  sourceFiles: {}, builtAt: new Date().toISOString(),
};
const packages = new Set();
for (const input of inputs) {
  const filename = path.resolve(repo, input);
  if (filename.startsWith(source + '/src/')) provenance.sourceFiles[path.relative(source, filename)] = createHash('sha256').update(await fs.readFile(filename)).digest('hex');
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) {
    const packageRoot = await findPackageRoot(filename);
    if (!packageRoot) throw new Error(`Unable to identify bundled third-party package: ${path.relative(repo, filename)}`);
    packages.add(packageRoot);
  }
}
// Frontend production dependencies also need attribution.
for (const name of Object.keys(readerPackage.dependencies)) {
  let dir = path.dirname(requireReader.resolve(name));
  while (dir !== path.dirname(dir)) {
    try { const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')); if (pkg.name === name) { packages.add(dir); break; } } catch {}
    dir = path.dirname(dir);
  }
}
let notices = 'Compiled Reader code attribution. Offline reading content is inventoried separately by seed/manifest.json. Personal records, credentials and local provider settings are excluded.\n';
for (const dir of [...packages].sort()) {
  const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
  if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') throw new Error(`Third-party package identity is incomplete: ${dir}`);
  notices += `\n===== ${pkg.name}@${pkg.version} (${pkg.license || 'see notice'}) =====\n`;
  for (const name of await fs.readdir(dir)) if (/^(licen[cs]e|copying|notice)(\.|$)/i.test(name)) {
    const file = path.join(dir, name);
    if ((await fs.stat(file)).isFile()) notices += await fs.readFile(file, 'utf8') + '\n';
  }
}
await fs.writeFile(path.join(output, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
await fs.writeFile(path.join(output, 'THIRD_PARTY_NOTICES.txt'), notices);
console.log('Reader production assets built without modifying the source project.');

const nativePackage = path.dirname(requireReader.resolve('@openai/codex-darwin-' + process.arch + '/package.json'));
const triple = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
await copyCodexRuntime(path.join(nativePackage, 'vendor', triple, 'bin'), output);

// Compile a small native Dictionary Services bridge once, not per word lookup.
// The helper reads installed macOS dictionaries; no dictionary data is bundled.
if (process.platform === 'darwin') {
  const nativeDir = path.join(output, 'native');
  await fs.mkdir(nativeDir, { recursive: true });
  execFileSync('/usr/bin/xcrun', [
    'swiftc', '-O', path.join(repo, 'scripts/reader-system-dictionary.swift'),
    '-o', path.join(nativeDir, 'vantilo-dictionary'),
  ], { cwd: repo, stdio: 'inherit', timeout: 120000 });
}
