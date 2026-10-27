import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {validateManifest}=createRequire(import.meta.url)('../electron/reader-library-seed.cjs');
export const defaultMagazineSeed=path.join(repo,'build/reader-default-magazines/seed');
const expected=['atlantic','economist','new-yorker','wired'];
export async function readDefaultMagazines(seedDir=defaultMagazineSeed){
  const manifest=validateManifest(JSON.parse(await fs.readFile(path.join(seedDir,'manifest.json'),'utf8')),{distribution:true});
  if(manifest.entries.length!==4||manifest.entries.some(e=>e.kind!=='issues')||manifest.entries.map(e=>e.publicationId).sort().join(',')!==expected.join(','))throw new Error('默认书库必须恰好包含四种杂志各一期');
  for(const entry of manifest.entries){
    const file=path.join(seedDir,'issues',entry.filename),stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error('默认杂志必须是普通文件');
    const data=await fs.readFile(file);
    if(data.length!==entry.bytes||createHash('sha256').update(data).digest('hex')!==entry.sha256)throw new Error('默认杂志完整性校验失败');
  }
  return manifest;
}
// Copy only allowlisted manifest files; never a personal library or stale files.
export async function copyDefaultMagazines(target,seedDir=defaultMagazineSeed){
  const manifest=await readDefaultMagazines(seedDir);
  await fs.mkdir(path.join(target,'issues'),{recursive:true});await fs.mkdir(path.join(target,'books'),{recursive:true});
  for(const entry of manifest.entries)await fs.copyFile(path.join(seedDir,'issues',entry.filename),path.join(target,'issues',entry.filename));
  const temp=path.join(target,'manifest.json.default-update');await fs.writeFile(temp,JSON.stringify(manifest,null,2)+'\n');await fs.rename(temp,path.join(target,'manifest.json'));
  return manifest;
}
