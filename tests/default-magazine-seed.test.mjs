import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {copyDefaultMagazines,readDefaultMagazines} from '../scripts/default-magazine-seed.mjs';
const {initializeReaderLibrary}=createRequire(import.meta.url)('../electron/reader-library-seed.cjs');
async function fixture(fn){
 const root=await mkdtemp(path.join(os.tmpdir(),'default-four-magazines-'));const seed=path.join(root,'seed'),target=path.join(root,'target'),library=path.join(root,'library');await mkdir(path.join(seed,'issues'),{recursive:true});
 const entries=[];for(const id of ['economist','new-yorker','atlantic','wired']){const data=Buffer.from('synthetic opaque seed bytes: '+id);const filename=id+'.epub';await writeFile(path.join(seed,'issues',filename),data);entries.push({kind:'issues',publicationId:id,filename,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),rights:'Original test bytes',rightsEvidence:'Authored in this unit test'});}
 const manifest={version:1,audience:'redistributable',entries};await writeFile(path.join(seed,'manifest.json'),JSON.stringify(manifest));
 try{await fn({root,seed,target,library,manifest});}finally{await rm(root,{recursive:true,force:true});}
}
describe('four authorized default issues only',()=>{
 it('copies only listed issues, initializes four offline defaults and respects user deletion',()=>fixture(async f=>{
  await writeFile(path.join(f.seed,'issues/private-not-in-manifest.epub'),'excluded');
  await copyDefaultMagazines(f.target,f.seed);expect((await readdir(path.join(f.target,'issues'))).sort()).toEqual(f.manifest.entries.map(e=>e.filename).sort());
  expect((await initializeReaderLibrary({seedDir:f.target,libraryRoot:f.library})).installedCount).toBe(4);
  expect((await initializeReaderLibrary({seedDir:f.target,libraryRoot:f.library})).skippedCount).toBe(4);
  await rm(path.join(f.library,'issues/economist.epub'));
  await initializeReaderLibrary({seedDir:f.target,libraryRoot:f.library});expect(await readdir(path.join(f.library,'issues'))).toHaveLength(3);
 }));
 it('rejects corruption before publishing any copied manifest',()=>fixture(async f=>{
  await writeFile(path.join(f.seed,'issues/wired.epub'),'damaged');await expect(copyDefaultMagazines(f.target,f.seed)).rejects.toThrow('完整性');
  await expect(readFile(path.join(f.target,'manifest.json'))).rejects.toMatchObject({code:'ENOENT'});
 }));
 it('requires four distinct publications and distribution evidence',()=>fixture(async f=>{
  const incomplete={...f.manifest,entries:f.manifest.entries.slice(0,3)};await writeFile(path.join(f.seed,'manifest.json'),JSON.stringify(incomplete));await expect(readDefaultMagazines(f.seed)).rejects.toThrow('四种');
  const noRights={...f.manifest,entries:f.manifest.entries.map(({rightsEvidence,...entry})=>entry)};await writeFile(path.join(f.seed,'manifest.json'),JSON.stringify(noRights));await expect(readDefaultMagazines(f.seed)).rejects.toThrow('授权');
 }));
});
