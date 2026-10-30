import {describe,it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(import.meta.url);
const journal=require('../electron/transaction-journal.cjs');
const stores=[{name:'reader',snapshot:'snapshots/reader',target:'reader-library',sha256:'a'.repeat(64)}];

describe('durable transaction journal primitive',()=>{
 it('retains a durable phase after the actual writer process is killed',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-journal-'));const dir=path.join(root,'tx');
  const script=`const j=require(process.argv[1]);(async()=>{let s=await j.create(process.argv[2],{stores:${JSON.stringify(stores)}});s=await j.advance(process.argv[2],s.digest,'QUIESCING');process.stdout.write('ready\\n');setInterval(()=>{},1000)})().catch(e=>{console.error(e);process.exit(1)});`;
  const child=spawn(process.execPath,['-e',script,require.resolve('../electron/transaction-journal.cjs'),dir],{stdio:['ignore','pipe','pipe']});
  try{
   await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('child did not become ready')),5000);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('ready')){clearTimeout(timer);resolve();}});child.on('error',reject);child.on('exit',code=>{if(code!==null)reject(Error('child exited before kill: '+code));});});
   const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
   const recovered=await journal.load(dir);expect(recovered.record.phase).toBe('QUIESCING');expect(recovered.record.revision).toBe(1);expect(recovered.record.stores).toEqual(stores);
  }finally{if(child.exitCode===null&&!child.killed)child.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
 });
 it('allows only one of two separate writer processes to publish a revision',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-journal-process-race-'));const dir=path.join(root,'tx');
  try{const first=await journal.create(dir,{stores});const script="const j=require(process.argv[1]);j.advance(process.argv[2],process.argv[3],'QUIESCING').then(()=>process.exit(0),()=>process.exit(2))";const launch=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',script,require.resolve('../electron/transaction-journal.cjs'),dir,first.digest],{stdio:'ignore'});child.on('error',reject);child.on('exit',resolve);});const codes=await Promise.all([launch(),launch()]);expect(codes.sort()).toEqual([0,2]);expect((await journal.load(dir)).record.phase).toBe('QUIESCING');}
  finally{await rm(root,{recursive:true,force:true});}
 });
 it('records hashes after a real synthetic snapshot is written',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-journal-snapshot-'));const dir=path.join(root,'tx');
  try{let state=await journal.create(dir,{stores:[{...stores[0],sha256:null}]});state=await journal.advance(dir,state.digest,'QUIESCING');state=await journal.advance(dir,state.digest,'SNAPSHOTTING');await writeFile(path.join(root,'synthetic-snapshot'),'original fixture');const digest=createHash('sha256').update(await readFile(path.join(root,'synthetic-snapshot'))).digest('hex');state=await journal.advance(dir,state.digest,'RESTORING',{reader:digest});expect((await journal.load(dir)).record.stores[0].sha256).toBe(digest);}
  finally{await rm(root,{recursive:true,force:true});}
 });
 it('rejects corruption and never deletes the recorded snapshot',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-journal-corrupt-'));const dir=path.join(root,'tx');const marker=path.join(root,'snapshot');
  try{await writeFile(marker,'synthetic snapshot');await journal.create(dir,{stores});await writeFile(path.join(dir,'000000.json'),'{');await expect(journal.load(dir)).rejects.toThrow();expect(await readFile(marker,'utf8')).toBe('synthetic snapshot');}
  finally{await rm(root,{recursive:true,force:true});}
 });
 it('rejects competing revisions and invalid paths without overwriting a committed record',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-journal-race-'));const dir=path.join(root,'tx');
  try{const first=await journal.create(dir,{stores});const result=await Promise.allSettled([journal.advance(dir,first.digest,'QUIESCING'),journal.advance(dir,first.digest,'QUIESCING')]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await journal.load(dir)).record.phase).toBe('QUIESCING');expect((await readdir(dir)).filter(x=>x.endsWith('.json'))).toHaveLength(2);await expect(journal.create(path.join(root,'bad'),{stores:[{...stores[0],target:'../escape'}]})).rejects.toThrow();}
  finally{await rm(root,{recursive:true,force:true});}
 });
});
