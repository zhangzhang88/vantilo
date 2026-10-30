import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(import.meta.url);
const journal=require('../electron/transaction-journal.cjs');
const {checkStartupTransactions,TRANSACTION_DIRECTORY}=require('../electron/transaction-startup-guard.cjs');
const dataLock=require('../electron/reader-data-lock.cjs');
const stores=[{name:'reader',snapshot:'snapshots/reader',target:'reader-library',sha256:'a'.repeat(64)}];
const id='12345678-1234-4234-9234-123456789abc';
async function pending(root){const dir=path.join(root,TRANSACTION_DIRECTORY,id);await mkdir(path.dirname(dir));await journal.create(dir,{id,stores});return dir;}

describe('transaction startup protection',()=>{
 it('permits an empty profile without creating a transaction directory',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-startup-'));try{expect(await checkStartupTransactions(root)).toEqual({safe:true});await expect(readFile(path.join(root,TRANSACTION_DIRECTORY))).rejects.toMatchObject({code:'ENOENT'});}finally{await rm(root,{recursive:true,force:true});}});
 it('blocks an unfinished journal and preserves it intact',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-startup-'));try{const dir=await pending(root);const before=await readFile(path.join(dir,'000000.json'),'utf8');expect(await checkStartupTransactions(root)).toMatchObject({safe:false,reason:'unfinished',phase:'PREPARING'});expect(await readFile(path.join(dir,'000000.json'),'utf8')).toBe(before);}finally{await rm(root,{recursive:true,force:true});}});
 it('rejects malformed and mismatched journals without changing them',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-startup-'));try{const dir=await pending(root);await writeFile(path.join(dir,'000000.json'),'{');await expect(checkStartupTransactions(root)).rejects.toThrow();expect(await readFile(path.join(dir,'000000.json'),'utf8')).toBe('{');}finally{await rm(root,{recursive:true,force:true});}});
 it('permits a complete validated journal',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-startup-'));try{const dir=await pending(root);let state=await journal.load(dir);for(const phase of ['QUIESCING','SNAPSHOTTING','RESTORING','VERIFYING','COMMITTING','COMPLETED'])state=await journal.advance(dir,state.digest,phase);expect(await checkStartupTransactions(root)).toEqual({safe:true});}finally{await rm(root,{recursive:true,force:true});}});
 it.each(['unfinished','corrupt','lock','intent'])('blocks the Electron main bootstrap for %s before the window and Runtime start',async(kind)=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-startup-main-'));try{if(kind==='lock')await mkdir(path.join(root,'.vantilo-offline-maintenance-v1.lock'));else if(kind==='intent')dataLock.createMaintenanceIntentSync(root,'backup');else{const dir=await pending(root);if(kind==='corrupt')await writeFile(path.join(dir,'000000.json'),'{');}const handlers=new Map();const appEvents=new Map();const window=vi.fn();const runtime=vi.fn();const quit=vi.fn(()=>{appEvents.get('before-quit')?.({preventDefault(){}});appEvents.get('will-quit')?.();});const notice=vi.fn(async()=>({response:0}));
   const app={getPath:()=>root,getVersion:()=> '0.1.13',setName(){},setPath(){},isPackaged:false,commandLine:{hasSwitch:()=>true},requestSingleInstanceLock:()=>true,on:(event,fn)=>appEvents.set(event,fn),whenReady:()=>Promise.resolve(),quit};
   runInNewContext(await readFile('electron/main.cjs','utf8'),{require:name=>name==='electron'?{app,BrowserWindow:window,Menu:{},dialog:{showMessageBox:notice},ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},shell:{},utilityProcess:{},session:{},nativeImage:{},safeStorage:{},powerMonitor:{}}:name==='./runtime-supervisor.cjs'?{RuntimeSupervisor:runtime}:name==='./portable-reader-supervisor.cjs'?{PortableReaderSupervisor:function(){return {getStatus:()=>({status:'idle'})}}}:name.startsWith('./')?require('../electron/'+name.slice(2)):require(name),process:{platform:'darwin',env:{},argv:[],cwd:()=>root},__dirname:path.join(root,'electron'),module:{exports:{}},URL});
   await vi.waitFor(()=>expect(quit).toHaveBeenCalledOnce());expect(notice).toHaveBeenCalledOnce();expect(window).not.toHaveBeenCalled();expect(runtime).not.toHaveBeenCalled();
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('does not open a BrowserWindow when the OS maintenance lock is already held',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-startup-oslock-'));let exclusive;try{exclusive=dataLock.acquireDataLockSync(root,'maintenance');const handlers=new Map(),appEvents=new Map(),window=vi.fn(),runtime=vi.fn(),notice=vi.fn(async()=>({response:0}));const quit=vi.fn(()=>{appEvents.get('before-quit')?.({preventDefault(){}});appEvents.get('will-quit')?.();});const app={getPath:()=>root,getVersion:()=> '0.1.13',setName(){},setPath(){},isPackaged:false,commandLine:{hasSwitch:()=>true},requestSingleInstanceLock:()=>true,on:(event,fn)=>appEvents.set(event,fn),whenReady:()=>Promise.resolve(),quit};
   runInNewContext(await readFile('electron/main.cjs','utf8'),{require:name=>name==='electron'?{app,BrowserWindow:window,Menu:{},dialog:{showMessageBox:notice},ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},shell:{},utilityProcess:{},session:{},nativeImage:{},safeStorage:{},powerMonitor:{}}:name==='./runtime-supervisor.cjs'?{RuntimeSupervisor:runtime}:name==='./portable-reader-supervisor.cjs'?{PortableReaderSupervisor:function(){return {getStatus:()=>({status:'idle'})}}}:name.startsWith('./')?require('../electron/'+name.slice(2)):require(name),process:{platform:'darwin',env:{},argv:[],cwd:()=>root},__dirname:path.join(root,'electron'),module:{exports:{}},URL});
   await vi.waitFor(()=>expect(quit).toHaveBeenCalledOnce());expect(notice).toHaveBeenCalledOnce();expect(window).not.toHaveBeenCalled();expect(runtime).not.toHaveBeenCalled();
  }finally{exclusive?.close();await rm(root,{recursive:true,force:true});}
 });
 it('rejects an unfinished transaction in a real child before its business child launches',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vantilo-startup-process-'));try{await pending(root);const script=`const {checkStartupTransactions}=require(process.argv[1]);const {fork}=require('node:child_process');checkStartupTransactions(process.argv[2]).then(x=>{if(x.safe)fork(process.argv[3],[],{stdio:'ignore'});if(process.send)process.send(x);}).catch(()=>process.send({safe:false}));`;const child=spawn(process.execPath,['-e',script,require.resolve('../electron/transaction-startup-guard.cjs'),root,path.join(root,'nonexistent.cjs')],{stdio:['ignore','ignore','ignore','ipc']});const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});const result=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code)reject(Error('child exit '+code));});});expect(result).toMatchObject({safe:false,reason:'unfinished'});expect(await exited).toBe(0);}finally{await rm(root,{recursive:true,force:true});}
 });
});
