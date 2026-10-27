// Explicitly authorized local EPUB reuse; never copy source data/config/auth/history.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {readerSourceRoot} from './reader-source-path.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readerSourceRoot;
const output = path.join(repo, 'build/reader/seed');
const temporary = output + '.tmp';
const { initializeReaderLibrary, validateManifest } = createRequire(import.meta.url)('../electron/reader-library-seed.cjs');
await fs.rm(temporary, { recursive: true, force: true });
await fs.mkdir(temporary, { recursive: true });
const manifest = { version: 1, audience: 'personal-development', entries: [] };
for (const kind of ['issues', 'books']) {
  await fs.mkdir(path.join(temporary, kind));
  const directory = path.join(source, kind);
  if (!(await fs.lstat(directory)).isDirectory()) throw new Error('Source content directory must not be a symlink');
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.epub')) continue;
    const data = await fs.readFile(path.join(directory, entry.name));
    manifest.entries.push({ kind, filename: entry.name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    await fs.writeFile(path.join(temporary, kind, entry.name), data, { mode: 0o600 });
  }
}
validateManifest(manifest);
await fs.writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await fs.rm(output, { recursive: true, force: true });
await fs.rename(temporary, output);
console.log(`Prepared offline development library: ${manifest.entries.filter(e=>e.kind==='issues').length} issues, ${manifest.entries.filter(e=>e.kind==='books').length} books. Not cleared for redistribution.`);
if (process.argv.includes('--install-local')) {
  const libraryRoot = path.join(process.env.HOME, 'Library/Application Support/Vantilo/reader-library');
  console.log('Local library initialization:', await initializeReaderLibrary({ seedDir: output, libraryRoot }));
}
