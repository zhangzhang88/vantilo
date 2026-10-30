'use strict';

// macOS whole-file advisory locks. Darwin's open(2) flags are not exposed by
// Node's fs.constants, so keep the SDK values here and fail closed elsewhere.
// O_SHLOCK/O_EXLOCK are atomic with opening a stable directory vnode; no
// replaceable lock file, PID lease or timeout-based ownership is involved.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const O_SHLOCK = 0x00000010;
const O_EXLOCK = 0x00000020;
const O_DIRECTORY = 0x00100000;
const INTENT_NAME = '.vantilo-reader-maintenance-intent-v1.json';
const LEGACY_RESERVATION_NAME = '.vantilo-offline-maintenance-v1.lock';
const MODES = Object.freeze({ reader: O_SHLOCK, maintenance: O_EXLOCK });

function fail(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function mountedVolumeRoot(root) {
  const volumes = '/Volumes';
  const relative = path.relative(volumes, root);
  if (relative === '' || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
  const first = relative.split(path.sep)[0];
  return path.join(volumes, first);
}

function canonicalDataRoot(userData, { createIfMissing = false } = {}) {
  if (process.platform !== 'darwin') throw fail('ERR_READER_LOCK_UNSUPPORTED', 'Reader 数据锁仅在 macOS 上可用');
  if (typeof userData !== 'string' || !path.isAbsolute(userData)) throw fail('ERR_READER_DATA_PATH', 'Reader 数据目录必须是绝对路径');
  const requestedRoot = path.resolve(userData);
  const externalRoot = mountedVolumeRoot(requestedRoot);

  let info;
  try { info = fs.lstatSync(requestedRoot); }
  catch (error) {
    if (error.code !== 'ENOENT') throw fail('ERR_READER_DATA_PATH', '无法检查 Reader 数据目录', error);
    // Never create an absent /Volumes mountpoint or a caller-selected profile.
    if (!createIfMissing || externalRoot) throw fail('ERR_READER_VOLUME_UNAVAILABLE', 'Reader 数据目录不存在；为保护原数据，未创建替代目录', error);
    fs.mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
    info = fs.lstatSync(requestedRoot);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) throw fail('ERR_READER_DATA_PATH', 'Reader 数据目录无效或是符号链接');

  let canonical;
  try { canonical = fs.realpathSync(requestedRoot); }
  catch (error) { throw fail('ERR_READER_DATA_PATH', '无法解析 Reader 数据目录', error); }
  const canonicalInfo = fs.lstatSync(canonical);
  if (!canonicalInfo.isDirectory() || canonicalInfo.isSymbolicLink() || canonicalInfo.dev !== info.dev || canonicalInfo.ino !== info.ino) {
    throw fail('ERR_READER_DATA_PATH', 'Reader 数据目录真实身份不一致');
  }

  if (externalRoot) {
    let mountInfo, volumeParentInfo;
    try {
      mountInfo = fs.statSync(externalRoot);
      volumeParentInfo = fs.statSync('/Volumes');
    } catch (error) {
      throw fail('ERR_READER_VOLUME_UNAVAILABLE', 'Reader 外置数据卷未挂载或无法检查', error);
    }
    if (mountInfo.dev === volumeParentInfo.dev || canonicalInfo.dev !== mountInfo.dev) {
      throw fail('ERR_READER_VOLUME_UNAVAILABLE', 'Reader 数据路径未指向已挂载的数据卷');
    }
  }

  return canonical;
}

function defaultLockResource(root) {
  // Lock a namespace vnode that is not the replaceable userData directory.
  // `/` remains stable if an internal profile or Application Support directory
  // is renamed/replaced. `/Volumes` remains stable if a disk mounted beneath it
  // is ejected and another volume appears at the same mount point.
  return mountedVolumeRoot(root) ? '/Volumes' : '/';
}

function assertPathIdentity(root, descriptorStat) {
  let current;
  try { current = fs.lstatSync(root); }
  catch (error) { throw fail('ERR_READER_DATA_PATH_CHANGED', 'Reader 数据目录已不可用；必须保留现有恢复材料', error); }
  if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== descriptorStat.dev || current.ino !== descriptorStat.ino) {
    throw fail('ERR_READER_DATA_PATH_CHANGED', 'Reader 数据目录身份已变化；必须停止维护');
  }
  try {
    if (fs.realpathSync(root) !== root) throw fail('ERR_READER_DATA_PATH_CHANGED', 'Reader 数据目录路径已变化；必须停止维护');
  } catch (error) {
    if (error.code === 'ERR_READER_DATA_PATH_CHANGED') throw error;
    throw fail('ERR_READER_DATA_PATH_CHANGED', 'Reader 数据目录已不可用；必须停止维护', error);
  }
}

function acquireDataLockSync(userData, mode, { createIfMissing = false, checkMaintenanceIntent = false, lockResourcePath } = {}) {
  if (!Object.hasOwn(MODES, mode)) throw fail('ERR_READER_LOCK_MODE', 'Reader 数据锁模式无效');
  const root = canonicalDataRoot(userData, { createIfMissing });
  const dataStat = fs.statSync(root);
  const lockRoot = canonicalDataRoot(lockResourcePath || defaultLockResource(root));
  const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | O_DIRECTORY | fs.constants.O_NONBLOCK | MODES[mode];
  let fd;
  try { fd = fs.openSync(lockRoot, flags); }
  catch (error) {
    if (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK') throw fail('ERR_READER_DATA_LOCK_BUSY', mode === 'reader' ? 'Reader 数据正在维护' : 'Reader 仍在使用数据，尚不能开始维护', error);
    throw fail('ERR_READER_DATA_LOCK_FAILED', '无法取得 Reader 数据的系统排他锁', error);
  }

  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isDirectory()) throw fail('ERR_READER_DATA_PATH', 'Reader 锁资源不是目录');
    assertPathIdentity(root, dataStat);
    assertPathIdentity(lockRoot, stat);
    const lease = {
      mode,
      root,
      lockRoot,
      pid: process.pid,
      device: stat.dev,
      inode: stat.ino,
      acquiredAt: new Date().toISOString(),
      closed: false,
      getInheritanceFd() {
        this.assertHeld();
        return fd;
      },
      assertHeld() {
        if (this.closed) throw fail('ERR_READER_DATA_LOCK_RELEASED', 'Reader 数据锁已释放');
        assertPathIdentity(root, dataStat);
        assertPathIdentity(lockRoot, stat);
        const held = fs.fstatSync(fd);
        if (held.dev !== stat.dev || held.ino !== stat.ino) throw fail('ERR_READER_DATA_LOCK_CHANGED', 'Reader 数据锁资源身份已变化');
      },
      close() {
        if (this.closed) return;
        fs.closeSync(fd);
        this.closed = true;
        this.releasedAt = new Date().toISOString();
      },
    };
    if (checkMaintenanceIntent) assertReaderMayStart(root);
    return lease;
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

function readMaintenanceIntentSync(userData) {
  const root = canonicalDataRoot(userData);
  const file = path.join(root, INTENT_NAME);
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw fail('ERR_READER_MAINTENANCE_INTENT', '无法检查 Reader 维护请求', error); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw fail('ERR_READER_MAINTENANCE_INTENT', 'Reader 维护请求无效；不得自动删除');
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw fail('ERR_READER_MAINTENANCE_INTENT', 'Reader 维护请求损坏；不得自动删除', error); }
  if (!value || value.version !== 1 || !/^[a-f0-9-]{36}$/i.test(value.id) || !['backup', 'restore'].includes(value.operation) ||
      !Number.isSafeInteger(value.requesterPid) || value.requesterPid < 1 || !Number.isFinite(Date.parse(value.createdAt))) {
    throw fail('ERR_READER_MAINTENANCE_INTENT', 'Reader 维护请求内容无效；不得自动删除');
  }
  return value;
}

function assertReaderMayStart(userData) {
  const intent = readMaintenanceIntentSync(userData);
  if (intent) throw fail('ERR_READER_MAINTENANCE_PENDING', 'Reader 数据维护已请求；保留请求记录并等待维护完成');
  const legacy = path.join(path.resolve(userData), LEGACY_RESERVATION_NAME);
  try { fs.lstatSync(legacy); throw fail('ERR_READER_MAINTENANCE_PENDING', '发现旧版 Reader 维护预留记录；必须人工核验'); }
  catch (error) { if (error.code === 'ENOENT') return; if (error.code === 'ERR_READER_MAINTENANCE_PENDING') throw error; throw fail('ERR_READER_MAINTENANCE_PENDING', '旧版 Reader 维护记录无法读取；必须人工核验', error); }
}

function acquireReaderDataLockSync(userData, options = {}) {
  return acquireDataLockSync(userData, 'reader', { ...options, checkMaintenanceIntent: true });
}

function acquireMaintenanceDataLockSync(userData, expectedIntentId, options = {}) {
  const intent = readMaintenanceIntentSync(userData);
  if (!intent || (expectedIntentId && intent.id !== expectedIntentId)) throw fail('ERR_READER_MAINTENANCE_INTENT', '缺少匹配的维护请求；不得访问 Reader 数据');
  const lease = acquireDataLockSync(userData, 'maintenance', options);
  try {
    lease.assertHeld();
    const current = readMaintenanceIntentSync(userData);
    if (!current || current.id !== intent.id) throw fail('ERR_READER_MAINTENANCE_INTENT', '维护请求在加锁期间发生变化；不得访问 Reader 数据');
    return { ...lease, intentId: intent.id };
  } catch (error) {
    lease.close();
    throw error;
  }
}

function createMaintenanceIntentSync(userData, operation) {
  if (!['backup', 'restore'].includes(operation)) throw fail('ERR_READER_MAINTENANCE_INTENT', '维护操作类型无效');
  const root = canonicalDataRoot(userData);
  if (readMaintenanceIntentSync(root)) throw fail('ERR_READER_MAINTENANCE_INTENT', '已有 Reader 维护请求；不得覆盖');
  const intent = { version: 1, id: randomUUID(), operation, requesterPid: process.pid, createdAt: new Date().toISOString() };
  const file = path.join(root, INTENT_NAME);
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); }
  catch (error) { throw fail('ERR_READER_MAINTENANCE_INTENT', '无法原子创建 Reader 维护请求；不得访问数据', error); }
  try {
    fs.writeFileSync(fd, JSON.stringify(intent));
    fs.fsyncSync(fd);
    const dirFd = fs.openSync(root, fs.constants.O_RDONLY | O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch (error) {
    // Leave partial request material in place to make startup fail closed.
    throw fail('ERR_READER_MAINTENANCE_INTENT', '维护请求写入未完成，已保留现场；不得访问 Reader 数据', error);
  } finally { fs.closeSync(fd); }
  return intent;
}

function completeMaintenanceIntentSync(userData, lease, intentId, { transactionCompleted = false } = {}) {
  if (!lease || lease.mode !== 'maintenance' || lease.intentId !== intentId || transactionCompleted !== true) {
    throw fail('ERR_READER_MAINTENANCE_STATE', '只有持有维护排他锁且事务已完成时才能清除维护请求');
  }
  lease.assertHeld();
  const current = readMaintenanceIntentSync(userData);
  if (!current || current.id !== intentId) throw fail('ERR_READER_MAINTENANCE_INTENT', '维护请求身份不匹配；不得清除');
  fs.unlinkSync(path.join(lease.root, INTENT_NAME));
  const dirFd = fs.openSync(lease.root, fs.constants.O_RDONLY | O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
}

async function acquireMaintenanceDataLock(userData, intentId, { timeoutMs = 30000, pollMs = 50, signal, lockResourcePath } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 10 * 60 * 1000 || !Number.isSafeInteger(pollMs) || pollMs < 10 || pollMs > 1000) {
    throw fail('ERR_READER_LOCK_OPTIONS', 'Reader 维护锁等待参数无效');
  }
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    signal?.throwIfAborted();
    try { return acquireMaintenanceDataLockSync(userData, intentId, { lockResourcePath }); }
    catch (error) {
      if (error.code !== 'ERR_READER_DATA_LOCK_BUSY') throw error;
      if (Date.now() >= deadline) throw fail('ERR_READER_DATA_LOCK_TIMEOUT', '等待 Reader 完全退出超时；未修改数据', error);
      await new Promise((resolve, reject) => {
        let timer;
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason || new Error('维护请求已取消')); };
        timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, Math.min(pollMs, deadline - Date.now()));
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
  }
}

module.exports = {
  INTENT_NAME,
  assertReaderMayStart,
  acquireDataLockSync,
  acquireReaderDataLockSync,
  acquireMaintenanceDataLockSync,
  acquireMaintenanceDataLock,
  createMaintenanceIntentSync,
  readMaintenanceIntentSync,
  completeMaintenanceIntentSync,
};
