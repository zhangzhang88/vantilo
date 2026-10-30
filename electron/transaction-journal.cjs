'use strict';

// Experimental journal primitive. Startup may inspect it, but it is not
// connected to restore until all writers participate in a quiescence protocol.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const transitions = Object.freeze({
  PREPARING:['QUIESCING','RECOVERY_REQUIRED'], QUIESCING:['SNAPSHOTTING','RECOVERY_REQUIRED'],
  SNAPSHOTTING:['RESTORING','RECOVERY_REQUIRED'], RESTORING:['VERIFYING','ROLLING_BACK','RECOVERY_REQUIRED'],
  VERIFYING:['COMMITTING','ROLLING_BACK','RECOVERY_REQUIRED'], COMMITTING:['COMPLETED','ROLLING_BACK','RECOVERY_REQUIRED'],
  ROLLING_BACK:['COMPLETED','RECOVERY_REQUIRED'], RECOVERY_REQUIRED:['ROLLING_BACK'], COMPLETED:[]
});
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = value => createHash('sha256').update(value).digest('hex');
const relative = value => typeof value === 'string' && value.length > 0 && value.length < 1024 && !path.isAbsolute(value) && !value.includes('\\') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
function validate(record) {
  if (!record || record.version !== 1 || !uuid.test(record.id) || record.operation !== 'restore' ||
      !Number.isSafeInteger(record.revision) || record.revision < 0 || record.revision > 999999 ||
      !Object.hasOwn(transitions, record.phase) || !Number.isFinite(Date.parse(record.startedAt)) ||
      !(record.previousDigest === null || /^[a-f0-9]{64}$/.test(record.previousDigest)) ||
      !(record.lastSuccessfulPhase === null || Object.hasOwn(transitions, record.lastSuccessfulPhase)) ||
      !Array.isArray(record.stores) || record.stores.length < 1 || record.stores.length > 100 ||
      record.stores.some(store => !store || typeof store.name !== 'string' || !/^[a-z0-9_-]{1,80}$/.test(store.name) ||
        !relative(store.snapshot) || !relative(store.target) || !(store.sha256 === null || /^[a-f0-9]{64}$/.test(store.sha256))) ||
      (['RESTORING','VERIFYING','COMMITTING'].includes(record.phase) && record.stores.some(store => store.sha256 === null))) {
    throw new Error('事务日志无效，必须保留数据并人工检查');
  }
  if (new Set(record.stores.map(s => s.name)).size !== record.stores.length) throw new Error('事务存储项目重复');
  return record;
}
function filename(revision) { return String(revision).padStart(6,'0') + '.json'; }
async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function load(directory) {
  if (!path.isAbsolute(directory)) throw new Error('事务目录必须是绝对路径');
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('事务目录无效');
  const entries = await fs.readdir(directory);
  const files = entries.filter(name => /^\d{6}\.json$/.test(name)).sort();
  if (!files.length || entries.some(name => !/^\d{6}\.json$/.test(name) && !/^\.pending-[a-f0-9-]+$/.test(name))) throw new Error('事务日志缺失或含未知文件');
  let previous = null, digest = null;
  for (let i=0;i<files.length;i++) {
    if (files[i] !== filename(i)) throw new Error('事务日志序列不完整');
    const file = path.join(directory, files[i]);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024*1024) throw new Error('事务日志文件无效');
    const text = await fs.readFile(file,'utf8');
    let envelope; try { envelope = JSON.parse(text); } catch { throw new Error('事务日志损坏'); }
    if (!envelope || typeof envelope.digest !== 'string' || hash(JSON.stringify(envelope.record)) !== envelope.digest) throw new Error('事务日志完整性校验失败');
    const record = validate(envelope.record);
    if (record.revision !== i || record.previousDigest !== digest ||
        (previous && (record.id !== previous.id || record.startedAt !== previous.startedAt || record.operation !== previous.operation || JSON.stringify(record.stores.map(({name,snapshot,target})=>({name,snapshot,target}))) !== JSON.stringify(previous.stores.map(({name,snapshot,target})=>({name,snapshot,target}))) || (previous.phase !== 'SNAPSHOTTING' || record.phase !== 'RESTORING') && JSON.stringify(record.stores) !== JSON.stringify(previous.stores) || !transitions[previous.phase].includes(record.phase) || record.lastSuccessfulPhase !== (['ROLLING_BACK','RECOVERY_REQUIRED'].includes(record.phase) ? previous.lastSuccessfulPhase : previous.phase))) ||
        (!previous && (record.phase !== 'PREPARING' || record.previousDigest !== null || record.lastSuccessfulPhase !== null))) throw new Error('事务日志状态链无效');
    previous = record; digest = envelope.digest;
  }
  return {record:previous,digest};
}
async function publish(directory, record) {
  validate(record);
  const serialized = JSON.stringify({record,digest:hash(JSON.stringify(record))});
  const temporary = path.join(directory,'.pending-'+randomUUID());
  let handle;
  try {
    handle = await fs.open(temporary,'wx',0o600);
    await handle.writeFile(serialized,'utf8'); await handle.sync(); await handle.close(); handle = null;
    // link is exclusive: two writers cannot both publish the same revision.
    await fs.link(temporary,path.join(directory,filename(record.revision)));
    await syncDirectory(directory);
  } finally { await handle?.close().catch(()=>{}); await fs.unlink(temporary).catch(()=>{}); }
  return {record,digest:hash(JSON.stringify(record))};
}
async function create(directory, {id=randomUUID(), stores}) {
  if (!path.isAbsolute(directory)) throw new Error('事务目录必须是绝对路径');
  const record = validate({version:1,id,operation:'restore',startedAt:new Date().toISOString(),phase:'PREPARING',revision:0,previousDigest:null,lastSuccessfulPhase:null,stores});
  await fs.mkdir(directory,{mode:0o700});
  await syncDirectory(path.dirname(directory));
  return publish(directory,record);
}
async function advance(directory, expectedDigest, phase, snapshotHashes) {
  const current = await load(directory);
  if (current.digest !== expectedDigest || !transitions[current.record.phase].includes(phase)) throw new Error('事务状态已变化或转换无效');
  const lastSuccessfulPhase = ['ROLLING_BACK','RECOVERY_REQUIRED'].includes(phase) ? current.record.lastSuccessfulPhase : current.record.phase;
  let stores = current.record.stores;
  if (snapshotHashes !== undefined) {
    if (current.record.phase !== 'SNAPSHOTTING' || phase !== 'RESTORING' || !snapshotHashes || typeof snapshotHashes !== 'object' || Array.isArray(snapshotHashes) || Object.keys(snapshotHashes).length !== stores.length) throw new Error('快照哈希无效');
    stores = stores.map(store => ({...store,sha256:snapshotHashes[store.name]}));
  }
  const record = {...current.record,stores,phase,revision:current.record.revision+1,previousDigest:current.digest,lastSuccessfulPhase};
  return publish(directory,record);
}
module.exports = {create,load,advance};
