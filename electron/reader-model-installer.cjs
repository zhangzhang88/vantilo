'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { constants: C } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { MODEL_MANIFEST } = require('./reader-model-manifest.cjs');

const MIN_MEMORY_BYTES = 8 * 1024 ** 3;
const RECOMMENDED_MEMORY_BYTES = 16 * 1024 ** 3;
const DEFAULT_RESERVE_BYTES = 2 * 1024 ** 3;
const MAX_REDIRECTS = 5;
const HEX_64 = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const SIMPLE_ID = /^[a-z0-9][a-z0-9.-]{2,70}$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/;
const LOCAL_HEALTH_PENDING = 'needs-native-runtime-check';
function validateModelManifest(input) {
  if (!input || input.version !== 1 || !SIMPLE_ID.test(input.id) ||
      !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(input.repository) ||
      !REVISION.test(input.revision) || input.license !== 'Apache-2.0' ||
      !Array.isArray(input.files) || input.files.length < 1 || input.files.length > 30) {
    throw new Error('模型安装清单无效');
  }
  const used = new Set();
  for (const item of input.files) {
    if (!item || !SAFE_FILE.test(item.name) || item.name === '.' || item.name === '..' ||
        item.name.startsWith('.') || item.name.endsWith('.partial') || used.has(item.name.toLowerCase()) ||
        !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > 7 * 1024 ** 3 ||
        typeof item.sha256 !== 'string' || !HEX_64.test(item.sha256)) {
      throw new Error('模型安装清单文件无效');
    }
    used.add(item.name.toLowerCase());
  }
  return input;
}
function checkModelHardware({ platform = process.platform, arch = process.arch, memoryBytes = os.totalmem() } = {}) {
  const appleSilicon = platform === 'darwin' && arch === 'arm64';
  return {
    supported: appleSilicon && memoryBytes >= MIN_MEMORY_BYTES,
    appleSilicon,
    memoryGiB: Math.round(memoryBytes / 1024 ** 3),
    warning: !appleSilicon ? '只支持 Apple Silicon Mac' :
      memoryBytes < MIN_MEMORY_BYTES ? '物理内存不足 8GiB' :
      memoryBytes < RECOMMENDED_MEMORY_BYTES ? '内存低于已实测的 16GiB，需单独验证性能' : null,
  };
}
function assertConsent(consent) {
  if (consent !== true) throw new Error('下载或采用现有模型前必须由用户明确确认');
}
async function lstatOrNull(p) {
  try { return await fs.lstat(p); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function ensurePlainDirectory(dir) {
  const info = await lstatOrNull(dir);
  if (!info) await fs.mkdir(dir, { mode: 0o700 });
  const actual = await fs.lstat(dir);
  if (!actual.isDirectory() || actual.isSymbolicLink()) throw new Error('模型目录不能是符号链接');
}
async function assertStageInventory(dir, manifest, complete = false) {
  const allowed = new Set(manifest.files.map(f => f.name));
  if (!complete) for (const f of manifest.files) allowed.add(f.name + '.partial');
  allowed.add('.vantilo-install.json');
  for (const name of await fs.readdir(dir)) {
    if (!allowed.has(name)) throw new Error('模型暂存目录包含意外文件，拒绝发布');
    const info = await fs.lstat(path.join(dir, name));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('模型暂存目录包含非普通文件');
  }
}

async function readPlainFileBytes(file, maxBytes) {
  const handle = await fs.open(file, C.O_RDONLY | C.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) throw new Error('模型文件不是受支持的普通文件');
    return await handle.readFile();
  } finally { await handle.close(); }
}
async function sha256PlainFile(file, expectedBytes) {
  const handle = await fs.open(file, C.O_RDONLY | C.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== expectedBytes) return false;
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest('hex');
  } finally { await handle.close(); }
}
async function verifyModelFiles(dir, manifest) {
  validateModelManifest(manifest);
  const root = await fs.lstat(dir);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('模型来源必须是实际文件夹');
  for (const item of manifest.files) {
    const actual = await sha256PlainFile(path.join(dir, item.name), item.bytes);
    if (actual !== item.sha256) throw new Error('模型文件完整性校验失败: ' + item.name);
  }
  const config = manifest.files.some(f => f.name === 'config.json')
    ? JSON.parse((await readPlainFileBytes(path.join(dir, 'config.json'), 1024 * 128)).toString('utf8')) : null;
  if (config && (config.model_type !== 'qwen3_5' || config.quantization?.bits !== 4)) {
    throw new Error('模型结构或量化格式不兼容');
  }
  return { verified: true, status: LOCAL_HEALTH_PENDING, path: dir,
    modelId: manifest.id, revision: manifest.revision };
}
function trustedDownloadUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('模型下载地址无效'); }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
      !(host === 'huggingface.co' || host.endsWith('.huggingface.co') ||
        host.endsWith('.xethub.hf.co') || host.endsWith('.hf.co') ||
        host.endsWith('.cloudfront.net'))) {
    throw new Error('不允许的模型下载重定向');
  }
  return parsed.href;
}
function sourceUrl(manifest, item) {
  return trustedDownloadUrl('https://huggingface.co/' + manifest.repository +
    '/resolve/' + manifest.revision + '/' + encodeURIComponent(item.name) + '?download=true');
}
async function fetchPinned(url, { fetchImpl, signal, headers }) {
  for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
    const response = await fetchImpl(trustedDownloadUrl(url), {
      method: 'GET', redirect: 'manual', headers, signal,
      credentials: 'omit',
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get('location');
      if (!next || hops >= MAX_REDIRECTS) throw new Error('模型下载重定向次数过多');
      await response.body?.cancel();
      url = trustedDownloadUrl(new URL(next, url).href);
      continue;
    }
    return response;
  }
  throw new Error('模型下载重定向次数过多');
}
function cancelled(signal) { if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('模型下载已取消'); }
async function withLock(root, modelId, action) {
  const lockFile = path.join(root, '.' + modelId + '.install-lock');
  // Recover a lock left by an interrupted app ONLY if its PID is not alive.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await fs.open(lockFile, C.O_CREAT | C.O_EXCL | C.O_WRONLY | C.O_NOFOLLOW, 0o600);
      try { await file.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() })); }
      finally { await file.close(); }
      try { return await action(); } finally { await fs.unlink(lockFile).catch(() => {}); }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const record = JSON.parse((await readPlainFileBytes(lockFile, 1024)).toString('utf8'));
      if (!Number.isSafeInteger(record.pid) || record.pid < 1) throw new Error('模型安装锁无效');
      try { process.kill(record.pid, 0); throw new Error('另一个模型安装任务正在运行'); }
      catch (check) { if (check.code !== 'ESRCH') throw check; }
      await fs.unlink(lockFile);
    }
  }
  throw new Error('模型安装锁尚未释放');
}
async function downloadFile({ manifest, entry, stage, fetchImpl, signal, onProgress, progress }) {
  const complete = path.join(stage, entry.name);
  const part = complete + '.partial';
  if (await lstatOrNull(complete)) {
    if (await sha256PlainFile(complete, entry.bytes) === entry.sha256) {
      progress.current += entry.bytes;
      onProgress?.({ completedBytes: progress.current, totalBytes: progress.total, file: entry.name });
      return;
    }
    throw new Error('暂存文件校验不通过，请先执行受控清理: ' + entry.name);
  }
  let bytes = 0;
  const state = await lstatOrNull(part);
  if (state) {
    if (!state.isFile() || state.isSymbolicLink() || state.size > entry.bytes) throw new Error('临时模型文件不安全');
    bytes = state.size;
  }
  if (bytes === entry.bytes) {
    if (await sha256PlainFile(part, entry.bytes) !== entry.sha256) {
      await fs.unlink(part); throw new Error('下载文件 SHA-256 不匹配，已移除损坏的暂存文件');
    }
    await fs.rename(part, complete);
    progress.current += entry.bytes;
    onProgress?.({ completedBytes: progress.current, totalBytes: progress.total, file: entry.name });
    return;
  }
  cancelled(signal);
  const headers = { 'accept-encoding': 'identity' };
  if (bytes > 0) headers.range = 'bytes=' + bytes + '-';
  const response = await fetchPinned(sourceUrl(manifest, entry), { fetchImpl, signal, headers });
  if (response.status !== 200 && response.status !== 206) {
    await response.body?.cancel(); throw new Error('模型下载 HTTP ' + response.status);
  }
  if (response.headers.get('content-encoding') &&
      response.headers.get('content-encoding').toLowerCase() !== 'identity') {
    await response.body?.cancel(); throw new Error('不支持压缩传输模型原始字节');
  }
  if (response.status === 206) {
    const match = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/.exec(response.headers.get('content-range') || '');
    if (!match || Number(match[1]) !== bytes || Number(match[2]) < bytes ||
        Number(match[2]) >= entry.bytes || Number(match[3]) !== entry.bytes) {
      await response.body?.cancel(); throw new Error('服务器断点续传范围不正确');
    }
  } else if (bytes > 0) {
    // Server ignored Range; safely start again, never append to a full 200 response.
    bytes = 0;
  }
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) !==
      (response.status === 206 ? entry.bytes - bytes : entry.bytes)) {
    await response.body?.cancel(); throw new Error('模型下载长度不符合锁定版本');
  }
  if (!response.body) throw new Error('下载服务未返回文件内容');
  const flag = (await lstatOrNull(part))
    ? C.O_WRONLY | C.O_NOFOLLOW | (bytes ? C.O_APPEND : C.O_TRUNC)
    : C.O_CREAT | C.O_EXCL | C.O_WRONLY | C.O_NOFOLLOW;
  const handle = await fs.open(part, flag, 0o600);
  const reader = Readable.fromWeb(response.body);
  try {
    const baseline = progress.current;
    for await (const chunk of reader) {
      cancelled(signal);
      const data = Buffer.from(chunk);
      if (bytes + data.length > entry.bytes) throw new Error('模型下载超出预期字节数');
      let off = 0;
      while (off < data.length) {
        const { bytesWritten } = await handle.write(data, off, data.length - off);
        if (bytesWritten < 1) throw new Error('模型写入中断');
        off += bytesWritten;
      }
      bytes += data.length;
      onProgress?.({ completedBytes: baseline + bytes, totalBytes: progress.total, file: entry.name });
    }
    cancelled(signal);
    await handle.sync();
  } finally { await handle.close(); reader.destroy(); }
  if (bytes !== entry.bytes) throw new Error('模型下载未完成，可重新运行以续传');
  if (await sha256PlainFile(part, entry.bytes) !== entry.sha256) {
    await fs.unlink(part);
    throw new Error('下载文件 SHA-256 不匹配，已移除损坏的暂存文件');
  }
  await fs.rename(part, complete);
  progress.current += entry.bytes;
}
async function atomicJson(file, data) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temp, JSON.stringify(data, null, 2), {flag:'wx',mode:0o600});
    await fs.rename(temp,file);
  } finally { await fs.rm(temp,{force:true}).catch(()=>{}); }
}
function createReaderModelInstaller({
  root, manifest = MODEL_MANIFEST, fetchImpl = globalThis.fetch,
  statfsImpl = fs.statfs, platform = process.platform, arch = process.arch,
  memoryBytes = os.totalmem(), reserveBytes = DEFAULT_RESERVE_BYTES,
} = {}) {
  if (!path.isAbsolute(root || '') || root === '/' || root === path.parse(root).root) throw new Error('需设置独立的模型安装目录');
  validateModelManifest(manifest);
  if (!Number.isSafeInteger(reserveBytes) || reserveBytes < 0) throw new Error('磁盘安全余量无效');
  const destination = path.join(root, manifest.id + '-' + manifest.revision.slice(0,12));
  const stagingBase = path.join(root, '.staging');
  const staged = path.join(stagingBase, manifest.id + '-' + manifest.revision.slice(0,12));
  const totalBytes = manifest.files.reduce((sum,item)=>sum+item.bytes,0);
  async function inspect() {
    const hw = checkModelHardware({platform,arch,memoryBytes});
    const rootInfo = await lstatOrNull(root);
    if (rootInfo && (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())) throw new Error('模型目录不是普通文件夹');
    let diskCheckPath = root;
    while (!(await lstatOrNull(diskCheckPath))) {
      const parent = path.dirname(diskCheckPath);
      if (parent === diskCheckPath) throw new Error('无法定位模型所在磁盘');
      diskCheckPath = parent;
    }
    const filesystem = await statfsImpl(diskCheckPath);
    return { hardware: hw, disk: { availableBytes: Number(filesystem.bavail) * Number(filesystem.bsize),
      freshInstallBytes: totalBytes + reserveBytes, reserveBytes },
      model: { id:manifest.id, revision:manifest.revision, license:manifest.license,
        source:'https://huggingface.co/' + manifest.repository + '/tree/' + manifest.revision,
        bytes:totalBytes }, status: LOCAL_HEALTH_PENDING };
  }
  async function install({ consent, signal, onProgress } = {}) {
    assertConsent(consent);
    cancelled(signal);
    const info = await inspect();
    if (!info.hardware.supported) throw new Error(info.hardware.warning || '设备暂不支持本地 MLX');
    if (!(await lstatOrNull(staged)) && !(await lstatOrNull(destination)) &&
        info.disk.availableBytes < info.disk.freshInstallBytes) throw new Error('模型安装磁盘空间不足');
    // No write until the user consents and compatibility checks complete.
    await fs.mkdir(root,{recursive:true,mode:0o700});
    await ensurePlainDirectory(root);
    return withLock(root,manifest.id,async()=>{
      if (await lstatOrNull(destination)) return { ...await verifyModelFiles(destination,manifest), alreadyInstalled:true };
      await ensurePlainDirectory(stagingBase);
      await ensurePlainDirectory(staged);
      await assertStageInventory(staged, manifest);
      let completeBytes=0;
      for (const entry of manifest.files) {
        const existing = await lstatOrNull(path.join(staged,entry.name));
        const partial = await lstatOrNull(path.join(staged,entry.name+'.partial'));
        if (existing?.isFile()) completeBytes+=entry.bytes;
        else if (partial?.isFile()) completeBytes+=Math.min(entry.bytes,partial.size);
      }
      const free = await statfsImpl(root);
      if (Number(free.bavail)*Number(free.bsize) <
          totalBytes - completeBytes + reserveBytes) throw new Error('模型安装磁盘空间不足');
      const progress={current:0,total:totalBytes};
      for (const entry of manifest.files) {
        cancelled(signal);
        await downloadFile({manifest,entry,stage:staged,fetchImpl,signal,onProgress,progress});
      }
      cancelled(signal);
      await verifyModelFiles(staged,manifest);
      await assertStageInventory(staged, manifest, true);
      await atomicJson(path.join(staged,'.vantilo-install.json'),{
        version:1,modelId:manifest.id,revision:manifest.revision,verifiedAt:new Date().toISOString(),
      });
      if (await lstatOrNull(destination)) throw new Error('目标目录在下载过程中已被创建，未覆盖已有文件');
      await fs.rename(staged,destination);
      return { verified:true,status:LOCAL_HEALTH_PENDING,path:destination,
        modelId:manifest.id,revision:manifest.revision,alreadyInstalled:false };
    });
  }
  async function verifyExisting(folder) { return verifyModelFiles(folder,manifest); }
  async function adoptExisting({ consent, folder } = {}) {
    assertConsent(consent);
    if (!path.isAbsolute(folder || '') || folder === '/') throw new Error('请选择模型文件夹');
    const verified = await verifyModelFiles(folder,manifest);
    await fs.mkdir(root,{recursive:true,mode:0o700});
    await ensurePlainDirectory(root);
    await atomicJson(path.join(root,'.adopted-'+manifest.id+'.json'),{
      version:1,id:manifest.id,revision:manifest.revision,path:folder,
      // Adoption of externally managed weights NEVER claims inference readiness.
      status:LOCAL_HEALTH_PENDING,
    });
    return {...verified, adopted:true};
  }
  return { inspect, install, verifyExisting, adoptExisting, destination, manifest };
}
module.exports = {
  createReaderModelInstaller, verifyModelFiles, validateModelManifest,
  checkModelHardware, LOCAL_HEALTH_PENDING,
};
