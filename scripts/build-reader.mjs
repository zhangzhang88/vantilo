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
import {collectPackageRootsFromModules, packageRecordsFromRoots, renderThirdPartyNotices} from './third-party-notices.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readerSourceRoot;
const output = process.env.VANTILO_READER_BUILD_OUTPUT
  ? path.resolve(process.env.VANTILO_READER_BUILD_OUTPUT)
  : path.join(repo, 'build/reader');
const viteCache = path.join(path.dirname(output), `${path.basename(output)}-vite-cache`);
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
const readerWebModules = new Set();
const readerInventoryPlugin = {
  name: 'vantilo-reader-runtime-module-inventory',
  generateBundle(_options, bundle) {
    for (const item of Object.values(bundle)) if (item.type === 'chunk') for (const id of Object.keys(item.modules)) readerWebModules.add(id);
  },
};
await buildWeb({ root: source, configFile: false, envFile: false, publicDir: false,
  cacheDir: viteCache, resolve:{dedupe:['react','react-dom']}, plugins: [sharedReaderComposerPlugin(), parcelMacros.vite(), readerVariantPlugin(), react(), readerInventoryPlugin], base: '/',
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
for (const input of inputs) {
  const filename = path.resolve(repo, input);
  if (filename.startsWith(source + '/src/')) provenance.sourceFiles[path.relative(source, filename)] = createHash('sha256').update(await fs.readFile(filename)).digest('hex');
}
const packageRoots = await collectPackageRootsFromModules(repo, [...readerWebModules, ...inputs]);
const packageRecords = await packageRecordsFromRoots(repo, packageRoots);
const codexManifest = JSON.parse(await fs.readFile(requireReader.resolve('@openai/codex-darwin-arm64/package.json'), 'utf8'));
const codexVersion = /^(\d+\.\d+\.\d+)-darwin-arm64$/.exec(codexManifest.version)?.[1];
if (!codexVersion) throw new Error(`Unable to identify the bundled Codex runtime version: ${codexManifest.version}`);
const binaryDocuments = [
  { name: 'OpenAI Codex', version: codexVersion, license: 'Apache-2.0', label: 'licenses/OpenAI-Codex/LICENSE', text: await fs.readFile(path.join(repo, 'licenses/OpenAI-Codex/LICENSE'), 'utf8') },
  { name: 'OpenAI Codex', version: codexVersion, license: 'Apache-2.0', label: 'licenses/OpenAI-Codex/NOTICE.md', text: await fs.readFile(path.join(repo, 'licenses/OpenAI-Codex/NOTICE.md'), 'utf8') },
];
const notices = await renderThirdPartyNotices({ repoRoot: repo, appVersion: JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8')).version, packageRecords, binaryDocuments });
await fs.writeFile(path.join(output, 'runtime-package-roots.json'), JSON.stringify(packageRecords, null, 2) + '\n');
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
  const swiftModuleCacheArgs = process.env.VANTILO_SWIFT_MODULE_CACHE_PATH
    ? ['-module-cache-path', path.resolve(process.env.VANTILO_SWIFT_MODULE_CACHE_PATH)]
    : [];
  execFileSync('/usr/bin/xcrun', [
    'swiftc', '-O', ...swiftModuleCacheArgs, path.join(repo, 'scripts/reader-system-dictionary.swift'),
    '-o', path.join(nativeDir, 'vantilo-dictionary'),
  ], { cwd: repo, stdio: 'inherit', timeout: 120000 });
}
