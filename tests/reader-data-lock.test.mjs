import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, rename, rm, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const lock = require('../electron/reader-data-lock.cjs');
const modulePath = require.resolve('../electron/reader-data-lock.cjs');
const describeOnMac = process.platform === 'darwin' ? describe : describe.skip;
const CHILD = `
const lock=require(process.argv[1]),root=process.argv[2],lockRoot=process.argv[3]||root;
process.send({type:'ready',pid:process.pid,at:new Date().toISOString()});
process.on('message',message=>{
 if(message.type==='acquire'){
  try{
   const options={lockResourcePath:lockRoot};
   const lease=message.kind==='reader'?lock.acquireReaderDataLockSync(root,options):message.kind==='maintenance'?lock.acquireMaintenanceDataLockSync(root,message.intentId,options):lock.acquireDataLockSync(root,message.mode,options);
   process.send({type:'acquired',pid:process.pid,mode:lease.mode,at:lease.acquiredAt,resource:lease.lockRoot});
   process.on('message',next=>{
    if(next.type==='finish'&&lease.mode==='maintenance'&&lease.intentId){
     try{lock.completeMaintenanceIntentSync(root,lease,lease.intentId,{transactionCompleted:true});process.send({type:'finished'});}catch(error){process.send({type:'finish-error',code:error.code});return;}
    }
    if(next.type==='release'){
     lease.close();process.send({type:'released',pid:process.pid,at:lease.releasedAt});process.disconnect();
    }
   });
  }catch(error){process.send({type:'denied',pid:process.pid,code:error.code,at:new Date().toISOString()});process.disconnect();}
 }
});
`;

class Peer {
  constructor(child) {
    this.child = child; this.messages = []; this.waiters = [];
    child.on('message', message => {
      const index = this.waiters.findIndex(waiter => waiter.predicate(message));
      if (index >= 0) this.waiters.splice(index, 1)[0].resolve(message); else this.messages.push(message);
    });
  }
  next(predicate = () => true, timeoutMs = 10000) {
    const index = this.messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve: value => { clearTimeout(timer); resolve(value); } };
      const timer = setTimeout(() => { this.waiters = this.waiters.filter(item => item !== waiter); reject(new Error('child process did not report lock state')); }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
  send(message) { this.child.send(message); }
  exit() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return Promise.resolve({ code: this.child.exitCode, signal: this.child.signalCode });
    return new Promise((resolve, reject) => { this.child.once('error', reject); this.child.once('exit', (code, signal) => resolve({ code, signal })); });
  }
}

async function temp() { return await mkdtemp(path.join(os.tmpdir(), 'vantilo-reader-oslock-')); }
function isolated(root) { return { lockResourcePath: root }; }
async function launch(root, lockResourcePath = root) {
  const child = spawn(process.execPath, ['-e', CHILD, modulePath, root, lockResourcePath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const peer = new Peer(child); await peer.next(message => message.type === 'ready'); return peer;
}
async function acquire(peer, value) {
  peer.send({ type: 'acquire', ...value });
  return peer.next(message => message.type === 'acquired' || message.type === 'denied');
}
async function release(peer) {
  peer.send({ type: 'release' });
  const released = await peer.next(message => message.type === 'released');
  return { released, exit: await peer.exit() };
}
async function stop(peer) {
  if (!peer || peer.child.exitCode !== null) return;
  peer.child.kill('SIGKILL'); await peer.exit();
}

describeOnMac('Reader 数据目录 macOS OS 锁', () => {
  it('T01 Reader 先持有共享锁时，维护方不能取得排他锁；Reader 释放后可以交接', async () => {
    const root = await temp(); let reader, maintainer;
    try {
      reader = lock.acquireReaderDataLockSync(root, isolated(root));
      const intent = lock.createMaintenanceIntentSync(root, 'backup');
      maintainer = await launch(root);
      expect(await acquire(maintainer, { kind: 'maintenance', intentId: intent.id })).toMatchObject({ type: 'denied', code: 'ERR_READER_DATA_LOCK_BUSY' });
      await maintainer.exit(); maintainer = await launch(root);
      reader.close(); reader = null;
      expect(await acquire(maintainer, { kind: 'maintenance', intentId: intent.id })).toMatchObject({ type: 'acquired', mode: 'maintenance' });
      maintainer.send({ type: 'finish' });
      expect(await maintainer.next(message => message.type === 'finished' || message.type === 'finish-error')).toMatchObject({ type: 'finished' });
      await release(maintainer);
    } finally { reader?.close(); await stop(maintainer); await rm(root, { recursive: true, force: true }); }
  });

  it('T02 维护方先持有排他锁时阻止 Reader；释放锁但保留意图时仍阻止启动', async () => {
    const root = await temp(); let maintainer;
    try {
      const intent = lock.createMaintenanceIntentSync(root, 'restore');
      const maintenance = lock.acquireMaintenanceDataLockSync(root, intent.id, isolated(root));
      expect(() => lock.acquireReaderDataLockSync(root, isolated(root))).toThrow(/维护|访问锁/);
      maintenance.close();
      expect(() => lock.acquireReaderDataLockSync(root, isolated(root))).toThrow('Reader 数据维护已请求；保留请求记录并等待维护完成');
      expect(lock.readMaintenanceIntentSync(root)).toEqual(intent);
      const recovery = lock.acquireMaintenanceDataLockSync(root, intent.id, isolated(root));
      lock.completeMaintenanceIntentSync(root, recovery, intent.id, { transactionCompleted: true }); recovery.close();
      const reader = lock.acquireReaderDataLockSync(root, isolated(root)); reader.close();
    } finally { await stop(maintainer); await rm(root, { recursive: true, force: true }); }
  });

  it('T03 两个真实进程同时竞争时，Reader 与维护方只能有一方取得锁', async () => {
    const root = await temp(); let reader, maintainer;
    try {
      reader = await launch(root); maintainer = await launch(root);
      const results = await Promise.all([
        acquire(reader, { mode: 'reader' }), acquire(maintainer, { mode: 'maintenance' }),
      ]);
      expect(results.filter(value => value.type === 'acquired')).toHaveLength(1);
      expect(results.map(value => value.pid)).toHaveLength(2);
      const winner = results[0].type === 'acquired' ? reader : maintainer;
      const loser = results[0].type === 'denied' ? reader : maintainer;
      await release(winner); await loser.exit();
    } finally { await stop(reader); await stop(maintainer); await rm(root, { recursive: true, force: true }); }
  });

  it('T04 Reader 正常释放后，独立进程可以立即取得维护排他锁', async () => {
    const root = await temp(); let reader, maintainer;
    try {
      reader = await launch(root); expect(await acquire(reader, { kind: 'reader' })).toMatchObject({ type: 'acquired' });
      const evidence = await release(reader); expect(evidence.released.at).toBeTruthy();
      maintainer = await launch(root); expect(await acquire(maintainer, { mode: 'maintenance' })).toMatchObject({ type: 'acquired' });
      await release(maintainer);
    } finally { await stop(reader); await stop(maintainer); await rm(root, { recursive: true, force: true }); }
  });

  it('T05 维护请求期间重新启动 Reader 会被拒绝，并保留请求记录', async () => {
    const root = await temp(); let peer;
    try {
      const intent = lock.createMaintenanceIntentSync(root, 'backup');
      peer = await launch(root);
      expect(await acquire(peer, { kind: 'reader' })).toMatchObject({ type: 'denied', code: 'ERR_READER_MAINTENANCE_PENDING' });
      expect(lock.readMaintenanceIntentSync(root)).toEqual(intent);
    } finally { await stop(peer); await rm(root, { recursive: true, force: true }); }
  });

  it('T06 Reader 主进程退出后，仍持有继承锁的真实写入子进程继续阻止维护', async () => {
    const root = await temp(); let reader, writerProcess, maintainer;
    try {
      reader = lock.acquireReaderDataLockSync(root, isolated(root));
      const pythonScript = 'import os,sys,time; os.fstat(3); output=open(os.path.join(sys.argv[1],"writer-events.log"),"a",buffering=1); output.write("synthetic write\\n"); print(os.getpid(), flush=True); time.sleep(30)';
      writerProcess = spawn('python3', ['-c', pythonScript, root], { stdio: ['ignore', 'pipe', 'ignore', reader.getInheritanceFd()] });
      let line = ''; writerProcess.stdout.setEncoding('utf8'); writerProcess.stdout.on('data', value => { line += value; });
      const pid = await new Promise((resolve, reject) => { const timer=setTimeout(()=>reject(Error('Python writer did not start')),10000);writerProcess.stdout.on('data',()=>{if(line.includes('\n')){clearTimeout(timer);resolve(Number(line.trim().split('\n')[0]));}});writerProcess.once('error',reject); });
      reader.close(); reader = null; // Simulate the Reader Service / parent process exiting.
      expect(Number.isInteger(pid)).toBe(true);
      expect(await readFile(path.join(root, 'writer-events.log'), 'utf8')).toContain('synthetic write');
      expect(() => lock.acquireDataLockSync(root, 'maintenance', isolated(root))).toThrow(expect.objectContaining({ code: 'ERR_READER_DATA_LOCK_BUSY' }));
      const exited = new Promise(resolve => writerProcess.once('exit', resolve)); writerProcess.kill('SIGKILL'); await exited; writerProcess = null;
      maintainer = await launch(root); expect(await acquire(maintainer, { mode: 'maintenance' })).toMatchObject({ type: 'acquired' });
      await release(maintainer);
    } finally { reader?.close(); if (writerProcess && writerProcess.exitCode === null && writerProcess.signalCode === null) { const exited = new Promise(resolve => writerProcess.once('exit', resolve)); writerProcess.kill('SIGKILL'); await exited; } await stop(maintainer); await rm(root, { recursive: true, force: true }); }
  });

  it('T07 Reader 正常关闭会由内核释放共享锁', async () => {
    const root = await temp(); let reader;
    try {
      reader = await launch(root); expect(await acquire(reader, { kind: 'reader' })).toMatchObject({ type: 'acquired' });
      await release(reader); reader = null;
      const maintenance = lock.acquireDataLockSync(root, 'maintenance', isolated(root)); maintenance.close();
    } finally { await stop(reader); await rm(root, { recursive: true, force: true }); }
  });

  it('T08 Reader 被 SIGKILL 后，系统锁随进程退出释放', async () => {
    const root = await temp(); let reader;
    try {
      reader = await launch(root); expect(await acquire(reader, { kind: 'reader' })).toMatchObject({ type: 'acquired' });
      reader.child.kill('SIGKILL'); await reader.exit(); reader = null;
      const maintenance = lock.acquireDataLockSync(root, 'maintenance', isolated(root)); maintenance.close();
    } finally { await stop(reader); await rm(root, { recursive: true, force: true }); }
  });

  it('T09 维护程序崩溃释放排他锁但不删除持久化意图', async () => {
    const root = await temp(); let maintainer;
    try {
      const intent = lock.createMaintenanceIntentSync(root, 'restore');
      maintainer = await launch(root); expect(await acquire(maintainer, { kind: 'maintenance', intentId: intent.id })).toMatchObject({ type: 'acquired' });
      maintainer.child.kill('SIGKILL'); await maintainer.exit(); maintainer = null;
      expect(lock.readMaintenanceIntentSync(root)).toEqual(intent);
      expect(() => lock.acquireReaderDataLockSync(root, isolated(root))).toThrow(/维护已请求/);
      const retry = lock.acquireMaintenanceDataLockSync(root, intent.id, isolated(root));
      lock.completeMaintenanceIntentSync(root, retry, intent.id, { transactionCompleted: true }); retry.close();
    } finally { await stop(maintainer); await rm(root, { recursive: true, force: true }); }
  });

  it('T10 两个真实维护进程同时启动时只有一个取得排他锁', async () => {
    const root = await temp(); let first, second;
    try {
      first = await launch(root); second = await launch(root);
      const results = await Promise.all([acquire(first, { mode: 'maintenance' }), acquire(second, { mode: 'maintenance' })]);
      expect(results.filter(value => value.type === 'acquired')).toHaveLength(1);
      await release(results[0].type === 'acquired' ? first : second);
      await (results[0].type === 'denied' ? first : second).exit();
    } finally { await stop(first); await stop(second); await rm(root, { recursive: true, force: true }); }
  });

  it('T11 Reader 数据目录被替换时仍使用同一稳定系统锁资源，不会分裂成双锁', async () => {
    const stableLockRoot = await temp();
    const root = path.join(stableLockRoot, 'userData');
    const movedRoot = path.join(stableLockRoot, 'userData-original');
    await mkdir(root);
    let reader, contender;
    try {
      reader = lock.acquireReaderDataLockSync(root, { lockResourcePath: stableLockRoot });
      await rename(root, movedRoot);
      await mkdir(root);
      contender = await launch(root, stableLockRoot);
      expect(await acquire(contender, { mode: 'maintenance' })).toMatchObject({ type: 'denied', code: 'ERR_READER_DATA_LOCK_BUSY' });
      expect(() => reader.assertHeld()).toThrow(expect.objectContaining({ code: 'ERR_READER_DATA_PATH_CHANGED' }));
      reader.close(); reader = null;
      const maintenance = lock.acquireDataLockSync(root, 'maintenance', { lockResourcePath: stableLockRoot });
      maintenance.close();
    } finally { reader?.close(); await stop(contender); await rm(stableLockRoot, { recursive: true, force: true }); }
  });

  it('T12 外置卷路径不存在时安全失败，不创建挂载点或替代数据目录', async () => {
    const missing = path.join('/Volumes', `Vantilo-unmounted-test-${process.pid}`, 'userData');
    expect(() => lock.acquireReaderDataLockSync(missing, { createIfMissing: true })).toThrow(expect.objectContaining({ code: 'ERR_READER_VOLUME_UNAVAILABLE' }));
    await expect(lstat(missing)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('T13 残留维护请求阻止 Reader，且请求内容不会被自动清除', async () => {
    const root = await temp();
    try {
      const intent = lock.createMaintenanceIntentSync(root, 'backup');
      const before = await readFile(path.join(root, lock.INTENT_NAME), 'utf8');
      expect(() => lock.acquireReaderDataLockSync(root, isolated(root))).toThrow(/维护已请求/);
      expect(await readFile(path.join(root, lock.INTENT_NAME), 'utf8')).toBe(before);
      expect(lock.readMaintenanceIntentSync(root)).toEqual(intent);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('T14 快速连续关闭和重启 100 次，不留下陈旧的 OS 锁', async () => {
    const root = await temp(); let reader, maintainer;
    try {
      for (let index = 0; index < 100; index++) {
        reader = await launch(root);
        expect(await acquire(reader, { mode: 'reader' })).toMatchObject({ type: 'acquired', mode: 'reader' });
        await release(reader); reader = null;
        maintainer = await launch(root);
        expect(await acquire(maintainer, { mode: 'maintenance' })).toMatchObject({ type: 'acquired', mode: 'maintenance' });
        await release(maintainer); maintainer = null;
      }
    } finally { await stop(reader); await stop(maintainer); await rm(root, { recursive: true, force: true }); }
  }, 60000);

  it('T15 真实子进程并发启动重复 100 轮，每轮 Reader/维护互斥结果唯一', async () => {
    const root = await temp(); const evidence = []; let activeReader, activeMaintainer;
    try {
      for (let index = 0; index < 100; index++) {
        activeReader = await launch(root); activeMaintainer = await launch(root);
        const jobs = index % 2 === 0
          ? [acquire(activeReader, { mode: 'reader' }), acquire(activeMaintainer, { mode: 'maintenance' })]
          : [acquire(activeMaintainer, { mode: 'maintenance' }), acquire(activeReader, { mode: 'reader' })];
        const attempts = index % 2 === 0 ? ['reader', 'maintenance'] : ['maintenance', 'reader'];
        const results = await Promise.all(jobs);
        expect(results.filter(value => value.type === 'acquired'), `round ${index}: ${JSON.stringify(results)}`).toHaveLength(1);
        const winnerMode = results[0].type === 'acquired' ? attempts[0] : attempts[1];
        const winner = winnerMode === 'reader' ? activeReader : activeMaintainer;
        const loser = winner === activeReader ? activeMaintainer : activeReader;
        const releaseEvidence = await release(winner);
        if (winner === activeReader) activeReader = null; else activeMaintainer = null;
        await loser.exit();
        if (loser === activeReader) activeReader = null; else activeMaintainer = null;
        evidence.push(...results.map(({ pid, mode, at, type, code }, attemptIndex) => ({ round: index + 1, pid, mode: mode || attempts[attemptIndex], decisionAt: at, acquiredAt: type === 'acquired' ? at : null, releasedAt: type === 'acquired' ? releaseEvidence.released.at : null, result: type, ...(code ? { code } : {}) })));
      }
      expect(evidence).toHaveLength(200);
      expect(evidence.every(item => Number.isInteger(item.pid) && item.decisionAt && ['acquired', 'denied'].includes(item.result))).toBe(true);
      expect(evidence.filter(item => item.result === 'acquired').every(item => item.acquiredAt)).toBe(true);
      expect(evidence.filter(item => item.result === 'acquired').every(item => item.releasedAt)).toBe(true);
      console.info('[reader-lock-evidence] ' + JSON.stringify({ rounds: 100, attempts: evidence.length, acquired: evidence.filter(item => item.result === 'acquired').length, denied: evidence.filter(item => item.result === 'denied').length, uniquePids: new Set(evidence.map(item => item.pid)).size, sample: evidence.slice(0, 4), lastRound: evidence.slice(-2) }));
    } finally { await stop(activeReader); await stop(activeMaintainer); await rm(root, { recursive: true, force: true }); }
  }, 180000);
});
