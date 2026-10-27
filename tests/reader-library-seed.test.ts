import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { initializeReaderLibrary, validateManifest } = require('../electron/reader-library-seed.cjs');
const { startPortableReader } = require('../electron/portable-reader-service.cjs');
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, {recursive:true,force:true}))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(),'vantilo-seed-')); roots.push(root);
  const seedDir = path.join(root,'seed'), libraryRoot = path.join(root,'library');
  await mkdir(seedDir); await mkdir(libraryRoot);
  const data = await readFile('tests/fixtures/minimal-magazine.epub');
  const entries = [];
  for (const [kind,filename] of [['issues','TheEconomist.2026.10.24.epub'],['books','StarterBook.epub']]) {
    await mkdir(path.join(seedDir,kind!));
    await writeFile(path.join(seedDir,kind!,filename!),data);
    entries.push({kind,filename,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
  }
  const manifest = {version:1,audience:'personal-development',entries};
  await writeFile(path.join(seedDir,'manifest.json'),JSON.stringify(manifest));
  return {root,seedDir,libraryRoot,manifest,data};
}

it('initializes both shelves offline, deduplicates, and respects subsequent user deletion', async () => {
  const f = await fixture();
  expect(await initializeReaderLibrary(f)).toMatchObject({installedCount:2});
  expect(await initializeReaderLibrary(f)).toMatchObject({installedCount:0,skippedCount:2});
  await rm(path.join(f.libraryRoot,'books','StarterBook.epub'));
  await initializeReaderLibrary(f);
  expect(await readdir(path.join(f.libraryRoot,'books'))).toEqual([]);
  expect(await readFile(path.join(f.seedDir,'books','StarterBook.epub'))).toEqual(f.data);
});

it('preserves a conflicting user file and recognizes an identical book imported under another name', async () => {
  const f = await fixture();
  await mkdir(path.join(f.libraryRoot,'books')); await mkdir(path.join(f.libraryRoot,'issues'));
  await writeFile(path.join(f.libraryRoot,'issues',f.manifest.entries[0]!.filename!), 'user content');
  await writeFile(path.join(f.libraryRoot,'books','Renamed.epub'), f.data);
  expect(await initializeReaderLibrary(f)).toMatchObject({installedCount:0,preservedCount:2});
  expect(await readFile(path.join(f.libraryRoot,'issues',f.manifest.entries[0]!.filename!), 'utf8')).toBe('user content');
  expect(await readdir(path.join(f.libraryRoot,'books'))).toEqual(['Renamed.epub']);
});

it('resumes per-entry initialization after an interrupted or corrupt later file', async () => {
  const f = await fixture();
  await writeFile(path.join(f.seedDir,'books','StarterBook.epub'),'broken');
  await expect(initializeReaderLibrary(f)).rejects.toThrow(/完整性/);
  expect(await readdir(path.join(f.libraryRoot,'issues'))).toHaveLength(1);
  await writeFile(path.join(f.seedDir,'books','StarterBook.epub'),f.data);
  expect(await initializeReaderLibrary(f)).toMatchObject({installedCount:1,skippedCount:1});
  expect((await readdir(path.join(f.libraryRoot,'books'))).some(name=>name.endsWith('.tmp'))).toBe(false);
});

it('adds later seed content without restoring an earlier deleted book', async () => {
  const f = await fixture(); await initializeReaderLibrary(f);
  await rm(path.join(f.libraryRoot,'books','StarterBook.epub'));
  const data=Buffer.concat([f.data,Buffer.from('new edition')]);
  const entry={kind:'books',filename:'NewBook.epub',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
  f.manifest.entries.push(entry); await writeFile(path.join(f.seedDir,'books',entry.filename),data);
  await writeFile(path.join(f.seedDir,'manifest.json'),JSON.stringify(f.manifest));
  expect(await initializeReaderLibrary(f)).toMatchObject({installedCount:1,skippedCount:2});
  expect(await readdir(path.join(f.libraryRoot,'books'))).toEqual(['NewBook.epub']);
});

it('rejects traversal, corrupt ledgers and symlink destinations without following them', async () => {
  const f = await fixture();
  expect(()=>validateManifest({...f.manifest,entries:[{...f.manifest.entries[0],filename:'../outside.epub'}]})).toThrow();
  const outside=path.join(f.root,'outside');await mkdir(outside);
  await symlink(outside,path.join(f.libraryRoot,'issues'));
  await expect(initializeReaderLibrary(f)).rejects.toThrow(/符号链接/);
  expect(await readdir(outside)).toEqual([]);
  await rm(path.join(f.libraryRoot,'issues'));await mkdir(path.join(f.libraryRoot,'data'),{recursive:true});
  await writeFile(path.join(f.libraryRoot,'data/vantilo-library-seed.json'),'broken');
  await expect(initializeReaderLibrary(f)).rejects.toThrow();
});

it('rejects development EPUBs for release and requires per-content rights metadata', async () => {
  const f=await fixture();
  expect(()=>validateManifest(f.manifest,{distribution:true})).toThrow(/个人开发/);
  expect(()=>validateManifest({...f.manifest,audience:'redistributable'},{distribution:true})).toThrow(/授权/);
  expect(validateManifest({...f.manifest,audience:'redistributable',entries:f.manifest.entries.map(entry=>({...entry,rights:'Test-only fixture',rightsEvidence:'Authored synthetic fixture'}))},{distribution:true})).toBeTruthy();
});

it('exposes a seeded magazine and ebook through the actual original API before any network or AI request', async () => {
  const f=await fixture(); const fetchImpl=vi.fn(); const runAi=vi.fn();
  const sessionToken='b'.repeat(64),cookie='__Host-vantilo-reader='+sessionToken;
  const service=await startPortableReader({assetsDir:path.resolve('build/reader'),libraryRoot:f.libraryRoot,seedDir:f.seedDir,apiPort:0,webPort:0,autoSync:false,fetchImpl,runAi,sessionToken});
  try {
    expect(await fetch(service.apiOrigin+'/api/issues',{headers:{cookie}}).then(r=>r.json())).toHaveLength(1);
    const books=await fetch(service.apiOrigin+'/api/books',{headers:{cookie}}).then(r=>r.json());
    expect(books).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled(); expect(runAi).not.toHaveBeenCalled();
  } finally { await service.close(); }
});
