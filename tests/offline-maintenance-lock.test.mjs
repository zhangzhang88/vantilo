import {describe,it,expect} from 'vitest';
import {mkdtemp,realpath,readFile,rm,symlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(import.meta.url);
const lock=require('../electron/offline-maintenance-lock.cjs');
const {checkStartupTransactions}=require('../electron/transaction-startup-guard.cjs');
const modulePath=require.resolve('../electron/offline-maintenance-lock.cjs');
async function temp(){return realpath(await mkdtemp(path.join(os.tmpdir(),'vantilo-offline-lock-')));}

describe('offline maintenance reservation primitive',()=>{
 it('blocks a new startup while reserved and only permits the owner to release',async()=>{
  const root=await temp();try{const owner=await lock.reserve(root);expect(await checkStartupTransactions(root)).toMatchObject({safe:false,reason:'maintenance_lock'});const before=await readFile(path.join(root,lock.LOCK_NAME,'owner.json'),'utf8');await expect(lock.release(root,{...owner,token:'incorrect'})).rejects.toThrow();expect(await readFile(path.join(root,lock.LOCK_NAME,'owner.json'),'utf8')).toBe(before);await lock.release(root,owner);expect(await checkStartupTransactions(root)).toEqual({safe:true});}finally{await rm(root,{recursive:true,force:true});}
 });
 it('keeps a crashed owner reservation and prevents a second real process from acquiring it',async()=>{
  const root=await temp();const script=`const l=require(process.argv[1]);l.reserve(process.argv[2]).then(()=>{process.send({acquired:true});setInterval(()=>{},1000)}).catch(()=>{process.send({acquired:false});process.disconnect()})`;
  const launch=()=>spawn(process.execPath,['-e',script,modulePath,root],{stdio:['ignore','ignore','ignore','ipc']});let first;
  try{first=launch();const exited=new Promise(resolve=>first.once('exit',resolve));const firstResult=await new Promise((resolve,reject)=>{first.once('message',resolve);first.once('error',reject)});expect(firstResult.acquired).toBe(true);
   const second=launch();const secondExit=new Promise(resolve=>second.once('exit',resolve));const secondResult=await new Promise((resolve,reject)=>{second.once('message',resolve);second.once('error',reject)});expect(secondResult.acquired).toBe(false);await secondExit;
   first.kill('SIGKILL');await exited;expect(await lock.isReserved(root)).toBe(true);expect(await checkStartupTransactions(root)).toMatchObject({safe:false,reason:'maintenance_lock'});expect(await readFile(path.join(root,lock.LOCK_NAME,'owner.json'),'utf8')).toContain('tokenDigest');
  }finally{if(first&&!first.killed)first.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
 });
 it('demonstrates that a prior startup check alone does not stop a later writer',async()=>{
  const root=await temp();const guardPath=require.resolve('../electron/transaction-startup-guard.cjs');const script=`const g=require(process.argv[1]),fs=require('node:fs/promises'),path=require('node:path');g.checkStartupTransactions(process.argv[2]).then(x=>process.send(x));process.once('message',async()=>{await fs.writeFile(path.join(process.argv[2],'synthetic-write'),'written');process.disconnect()});`;
  const child=spawn(process.execPath,['-e',script,guardPath,root],{stdio:['ignore','ignore','ignore','ipc']});const exited=new Promise(resolve=>child.once('exit',resolve));
  try{const result=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject)});expect(result.safe).toBe(true);const owner=await lock.reserve(root);child.send('continue');await exited;expect(await readFile(path.join(root,'synthetic-write'),'utf8')).toBe('written');await lock.release(root,owner);}
  finally{if(child.exitCode===null&&!child.killed)child.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
 });
 it('fails closed for a symlink lock and never creates a missing user directory',async()=>{
  const root=await temp();try{await symlink(path.join(root,'missing'),path.join(root,lock.LOCK_NAME));expect(await checkStartupTransactions(root)).toMatchObject({safe:false,reason:'maintenance_lock'});await expect(lock.reserve(path.join(root,'not-mounted'))).rejects.toMatchObject({code:'ENOENT'});}finally{await rm(root,{recursive:true,force:true});}
 });
});
