'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const journal = require('./transaction-journal.cjs');
const { isReserved } = require('./offline-maintenance-lock.cjs');
const { readMaintenanceIntentSync } = require('./reader-data-lock.cjs');

// This is a read-only startup check, not a cross-process lock or recovery engine.
const TRANSACTION_DIRECTORY = 'vantilo-data-transactions-v1';
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
async function checkStartupTransactions(userData) {
  if (!path.isAbsolute(userData)) throw new Error('用户数据路径无效');
  // A stale, partial or active reservation all fail closed; no PID-based cleanup.
  if (await isReserved(userData)) return { safe: false, reason: 'maintenance_lock' };
  if (readMaintenanceIntentSync(userData)) return { safe: false, reason: 'maintenance_requested' };
  const root = path.join(userData, TRANSACTION_DIRECTORY);
  let info;
  try { info = await fs.lstat(root); }
  catch (error) { if (error.code === 'ENOENT') return { safe: true }; throw new Error('无法检查事务目录'); }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('事务目录无效');
  const entries = await fs.readdir(root, { withFileTypes: true });
  if (entries.length > 1000) throw new Error('事务记录数量异常');
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !ID.test(entry.name)) throw new Error('事务目录包含无法识别的记录');
    const result = await journal.load(path.join(root, entry.name));
    if (result.record.id !== entry.name) throw new Error('事务身份不匹配');
    if (result.record.phase !== 'COMPLETED') return { safe: false, reason: 'unfinished', transactionId: entry.name, phase: result.record.phase };
  }
  return { safe: true };
}
module.exports = { checkStartupTransactions, TRANSACTION_DIRECTORY };
