'use strict';

// Reservation primitive only. It does not prove that writers have stopped and
// must never be used as authority to read, back up, or modify user data.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const LOCK_NAME = '.vantilo-offline-maintenance-v1.lock';

function directory(userData) {
  if (typeof userData !== 'string' || !path.isAbsolute(userData)) throw new Error('用户数据路径无效');
  return path.join(userData, LOCK_NAME);
}
async function syncDir(dir) {
  const handle = await fs.open(dir, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function isReserved(userData) {
  try { await fs.lstat(directory(userData)); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function reserve(userData) {
  const root = directory(userData);
  const info = await fs.lstat(userData);
  if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(userData) !== userData) throw new Error('用户数据目录无效或包含符号链接');
  // The existing user-data directory must be present. Never create missing mount points.
  await fs.mkdir(root, {mode:0o700});
  const token = randomBytes(32).toString('hex');
  const record = {version:1,pid:process.pid,createdAt:new Date().toISOString(),tokenDigest:createHash('sha256').update(token).digest('hex')};
  try {
    const handle = await fs.open(path.join(root,'owner.json'),'wx',0o600);
    try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
    await syncDir(root); await syncDir(userData);
  } catch (error) {
    // Incomplete reservation remains as evidence; never automatically remove it.
    throw new Error('维护锁未能安全写入，已保留锁目录',{cause:error});
  }
  return {token,pid:record.pid};
}
async function release(userData, owner) {
  const root = directory(userData);
  const info = await fs.lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('维护锁目录无效');
  const file = path.join(root,'owner.json');
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('维护锁记录无效');
  let record; try { record = JSON.parse(await fs.readFile(file,'utf8')); } catch { throw new Error('维护锁记录损坏'); }
  const digest = typeof owner?.token === 'string' ? createHash('sha256').update(owner.token).digest('hex') : '';
  if (record.version !== 1 || record.pid !== process.pid || owner?.pid !== process.pid || record.tokenDigest !== digest) throw new Error('当前进程不是维护锁所有者');
  // Any additional files indicate an unknown state; preserve the whole directory.
  const entries = await fs.readdir(root);
  if (entries.length !== 1 || entries[0] !== 'owner.json') throw new Error('维护锁目录包含未知材料');
  await fs.unlink(file); await fs.rmdir(root); await syncDir(userData);
}
module.exports = {LOCK_NAME,isReserved,reserve,release};
