'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { constants: C } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { isIP } = require('node:net');
const { TTS_MODEL_MANIFEST } = require('./reader-tts-manifest.cjs');

const MIN_MEMORY_BYTES = 8 * 1024 ** 3;
const DEFAULT_RESERVE_BYTES = 512 * 1024 ** 2; // 512 MiB headroom on top of downloaded + extracted payloads
const MAX_REDIRECTS = 6;
const HEX_64 = /^[a-f0-9]{64}$/;
const REVISION_40 = /^[a-f0-9]{40}$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/;
const INSTALL_MARKER = '.vantilo-tts-install.json';

function validateTtsManifest(manifest) {
  if (!manifest || manifest.version !== 1 || typeof manifest.id !== 'string' || !SAFE_FILE.test(manifest.installDirName || '')) {
    throw new Error('语音模型安装清单无效');
  }
  const { runtime, model } = manifest;
  if (!runtime || !SAFE_FILE.test(runtime.archiveName || '') || !SAFE_FILE.test(runtime.binaryName || '') ||
      !Number.isSafeInteger(runtime.archiveBytes) || runtime.archiveBytes <= 0 || runtime.archiveBytes > 256 * 1024 ** 2 ||
      !HEX_64.test(runtime.archiveSha256 || '') ||
      !Number.isSafeInteger(runtime.binaryBytes) || runtime.binaryBytes <= 0 || runtime.binaryBytes > 256 * 1024 ** 2 ||
      !HEX_64.test(runtime.binarySha256 || '') ||
      typeof runtime.url !== 'string') {
    throw new Error('语音引擎安装清单无效');
  }
  if (!model || !SAFE_FILE.test(model.fileName || '') || !REVISION_40.test(model.revision || '') ||
      !Number.isSafeInteger(model.bytes) || model.bytes <= 0 || model.bytes > 4 * 1024 ** 3 ||
      !HEX_64.test(model.sha256 || '') || typeof model.url !== 'string' || typeof model.mirrorUrl !== 'string') {
    throw new Error('语音权重安装清单无效');
  }
  return manifest;
}

function checkTtsHardware({ platform = process.platform, arch = process.arch, memoryBytes = os.totalmem() } = {}) {
  const appleSilicon = platform === 'darwin' && arch === 'arm64';
  const memoryGiB = Math.round(memoryBytes / 1024 ** 3);
  const supported = appleSilicon && memoryBytes >= MIN_MEMORY_BYTES;
  const reason = !appleSilicon
    ? '本机离线 Qwen3-TTS 仅支持 Apple Silicon（M1–M4）Mac；Intel Mac 请在下方配置局域网 TTS 服务。'
    : memoryBytes < MIN_MEMORY_BYTES
      ? `本机内存（${memoryGiB} GB）低于离线语音最低要求（8 GB）。`
      : null;
  return { supported, appleSilicon, memoryGiB, reason };
}

function isPrivateOrLocalHost(hostname) {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) return true;
  const ipVersion = isIP(lower);
  if (ipVersion === 4) {
    const [a, b] = lower.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (ipVersion === 6) {
    return lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('::ffff:127.');
  }
  return false;
}

function trustedUrl(url, { kind, mirror = false }) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('语音模型下载地址无效'); }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || isPrivateOrLocalHost(host)) {
    throw new Error('不允许的语音模型下载地址');
  }
  if (kind === 'runtime') {
    const allowed = host === 'github.com' ||
      host === 'objects.githubusercontent.com' ||
      host === 'release-assets.githubusercontent.com' ||
      host === 'github-releases.githubusercontent.com';
    if (!allowed) throw new Error('不允许的语音引擎下载重定向');
    return parsed.href;
  }
  const officialHf = host === 'huggingface.co' || host.endsWith('.huggingface.co') ||
    host.endsWith('.hf.co') || host.endsWith('.xethub.hf.co') || host.endsWith('.cloudfront.net');
  if (officialHf) return parsed.href;
  if (mirror) {
    const allowedMirror = host === 'hf-mirror.com' || host.endsWith('.hf-mirror.com') ||
      host.endsWith('.aliyuncs.com') || host.endsWith('.myqcloud.com') ||
      host.endsWith('.qcloudcos.com') || host.endsWith('.volces.com');
    if (allowedMirror) return parsed.href;
  }
  throw new Error('不允许的语音模型下载重定向');
}

async function lstatOrNull(filePath) {
  try { return await fs.lstat(filePath); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function ensurePlainDirectory(dir) {
  const info = await lstatOrNull(dir);
  if (!info) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const actual = await fs.lstat(dir);
  if (!actual.isDirectory() || actual.isSymbolicLink()) throw new Error('语音模型目录不能是符号链接');
}

async function sha256PlainFile(filePath, expectedBytes) {
  const handle = await fs.open(filePath, C.O_RDONLY | C.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== expectedBytes) return null;
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest('hex');
  } finally { await handle.close(); }
}

async function atomicJson(filePath, data) {
  const temp = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
    await fs.rename(temp, filePath);
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}

// Pure-Node ZIP extraction for a single pinned plain file (no subprocesses, no symlinks, no path traversal).
function extractSingleEntryFromZip(zipBuffer, targetEntryName, expectedSize) {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length < 22) throw new Error('语音引擎压缩包格式无效');
  const maxComment = Math.min(zipBuffer.length - 22, 65535);
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= zipBuffer.length - 22 - maxComment; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error('语音引擎压缩包缺少目录尾标记');
  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdSize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  if (cdOffset + cdSize > eocdOffset || totalEntries === 0 || totalEntries > 128) {
    throw new Error('语音引擎压缩包目录结构异常');
  }
  let pos = cdOffset;
  for (let idx = 0; idx < totalEntries; idx++) {
    if (pos + 46 > cdOffset + cdSize || zipBuffer.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error('语音引擎压缩包目录项损坏');
    }
    const flags = zipBuffer.readUInt16LE(pos + 8);
    const method = zipBuffer.readUInt16LE(pos + 10);
    const compressedSize = zipBuffer.readUInt32LE(pos + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(pos + 24);
    const nameLen = zipBuffer.readUInt16LE(pos + 28);
    const extraLen = zipBuffer.readUInt16LE(pos + 30);
    const commentLen = zipBuffer.readUInt16LE(pos + 32);
    const externalAttr = zipBuffer.readUInt32LE(pos + 38);
    const localHeaderOffset = zipBuffer.readUInt32LE(pos + 42);
    const name = zipBuffer.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos += 46 + nameLen + extraLen + commentLen;

    if (name.includes('\0') || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) {
      throw new Error('语音引擎压缩包包含不安全路径');
    }
    if (name !== targetEntryName) continue;
    if ((flags & 0x01) !== 0) throw new Error('不支持加密的语音引擎压缩包');
    const unixMode = (externalAttr >>> 16) & 0o170000;
    if (unixMode === 0o120000) throw new Error('语音引擎可执行文件不能是符号链接');
    if (uncompressedSize !== expectedSize) throw new Error('语音引擎可执行文件大小与清单不符');
    if (localHeaderOffset + 30 > zipBuffer.length || zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error('语音引擎压缩包本地文件头无效');
    }
    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zipBuffer.length) throw new Error('语音引擎压缩包数据截断');
    const compressed = zipBuffer.subarray(dataStart, dataEnd);
    let output;
    if (method === 0) output = Buffer.from(compressed);
    else if (method === 8) output = zlib.inflateRawSync(compressed, { maxOutputLength: expectedSize });
    else throw new Error('语音引擎压缩包使用了不支持的压缩算法');
    if (output.length !== expectedSize) throw new Error('语音引擎解压后大小不匹配');
    return output;
  }
  throw new Error(`语音引擎压缩包缺少必需文件：${targetEntryName}`);
}

// Wraps Electron's net.request so downloads honor macOS system proxies (Clash/Surge/PAC)
// while still exposing 3xx redirect Location headers before following (unlike Chromium's
// net.fetch with redirect:'manual', which returns an opaque status-0 response).
function createElectronNetFetch(netModule) {
  return async function electronNetFetch(url, init = {}) {
    const signal = init.signal;
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      let settled = false;
      const req = netModule.request({
        method: init.method || 'GET',
        url,
        redirect: init.redirect || 'manual',
        useSessionCookies: false,
      });
      const headersInit = init.headers || {};
      const entries = headersInit instanceof Headers ? [...headersInit.entries()] : Object.entries(headersInit);
      for (const [key, value] of entries) {
        if (value !== undefined && value !== null) req.setHeader(key, String(value));
      }

      const onAbort = () => {
        try { req.abort(); } catch { /* ignore */ }
        if (!settled) {
          settled = true;
          reject(signal.reason instanceof Error ? signal.reason : Object.assign(new Error('语音模型下载已取消'), { name: 'AbortError' }));
        }
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      const cleanupAbort = () => {
        if (signal) signal.removeEventListener('abort', onAbort);
      };

      const toHeaders = (rawHeaders = {}) => {
        const result = new Headers();
        for (const [k, v] of Object.entries(rawHeaders)) {
          if (Array.isArray(v)) {
            for (const item of v) result.append(k, String(item));
          } else if (v !== undefined && v !== null) {
            result.set(k, String(v));
          }
        }
        return result;
      };

      req.on('redirect', (statusCode, _method, redirectUrl, responseHeaders) => {
        if (settled) return;
        settled = true;
        cleanupAbort();
        try { req.abort(); } catch { /* ignore */ }
        const headers = toHeaders(responseHeaders);
        if (redirectUrl) headers.set('location', redirectUrl);
        resolve({ status: statusCode, type: 'basic', url, headers, body: null });
      });

      req.on('response', (res) => {
        if (settled) return;
        settled = true;
        const headers = toHeaders(res.headers);
        const queue = [];
        let waiter = null;
        let done = false;
        let streamError = null;

        const wake = () => {
          if (waiter) {
            const fn = waiter;
            waiter = null;
            fn();
          }
        };

        res.on('data', (chunk) => {
          queue.push(Buffer.from(chunk));
          if (queue.length >= 64 && typeof res.pause === 'function') res.pause();
          wake();
        });
        res.on('end', () => {
          done = true;
          cleanupAbort();
          wake();
        });
        res.on('aborted', () => {
          done = true;
          cleanupAbort();
          if (!streamError) streamError = Object.assign(new Error('下载连接中断'), { name: signal?.aborted ? 'AbortError' : 'Error' });
          wake();
        });
        res.on('error', (error) => {
          done = true;
          cleanupAbort();
          streamError = error instanceof Error ? error : new Error(String(error));
          wake();
        });
        if (signal) {
          signal.addEventListener('abort', () => {
            done = true;
            streamError = signal.reason instanceof Error ? signal.reason : Object.assign(new Error('语音模型下载已取消'), { name: 'AbortError' });
            try { req.abort(); } catch { /* ignore */ }
            wake();
          }, { once: true });
        }

        const body = {
          async cancel() {
            done = true;
            cleanupAbort();
            try { req.abort(); } catch { /* ignore */ }
            wake();
          },
          [Symbol.asyncIterator]() {
            return {
              async next() {
                while (queue.length === 0 && !done) {
                  await new Promise(r => { waiter = r; });
                }
                if (queue.length > 0) {
                  const value = queue.shift();
                  if (queue.length <= 16 && typeof res.resume === 'function') res.resume();
                  return { value, done: false };
                }
                if (streamError) throw streamError;
                return { value: undefined, done: true };
              },
            };
          },
        };

        resolve({ status: res.statusCode, type: 'basic', url, headers, body });
      });

      req.on('error', (error) => {
        cleanupAbort();
        if (!settled) {
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });

      req.end();
    });
  };
}

async function fetchPinned(url, { fetchImpl, signal, headers, kind, mirror }) {
  let current = trustedUrl(url, { kind, mirror });
  for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
    const response = await fetchImpl(current, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'Vantilo-TTS-Installer', ...headers },
      signal,
      credentials: 'omit',
    });
    if (response.type === 'opaqueredirect' || response.status === 0) {
      await response.body?.cancel?.().catch(() => {});
      const followed = await fetchImpl(current, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': 'Vantilo-TTS-Installer', ...headers },
        signal,
        credentials: 'omit',
      });
      if (followed.url) {
        try {
          trustedUrl(followed.url, { kind, mirror });
        } catch (error) {
          await followed.body?.cancel?.().catch(() => {});
          throw error;
        }
      }
      return followed;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get('location');
      await response.body?.cancel?.().catch(() => {});
      if (!next || hops >= MAX_REDIRECTS) throw new Error('语音模型下载重定向次数过多');
      current = trustedUrl(new URL(next, current).href, { kind, mirror });
      continue;
    }
    return response;
  }
  throw new Error('语音模型下载重定向次数过多');
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error('语音模型下载已取消'), { name: 'AbortError' });
  }
}

async function downloadResumableFile({ url, targetPath, expectedBytes, expectedSha256, kind, mirror, fetchImpl, signal, onChunk }) {
  const partPath = `${targetPath}.partial`;
  const existingComplete = await lstatOrNull(targetPath);
  if (existingComplete) {
    if (existingComplete.isFile() && !existingComplete.isSymbolicLink() &&
        await sha256PlainFile(targetPath, expectedBytes) === expectedSha256) {
      onChunk(expectedBytes);
      return;
    }
    await fs.rm(targetPath, { force: true });
  }

  let offset = 0;
  const partStat = await lstatOrNull(partPath);
  if (partStat) {
    if (!partStat.isFile() || partStat.isSymbolicLink() || partStat.size > expectedBytes) {
      await fs.rm(partPath, { force: true });
    } else {
      offset = partStat.size;
    }
  }

  if (offset === expectedBytes) {
    if (await sha256PlainFile(partPath, expectedBytes) === expectedSha256) {
      await fs.rename(partPath, targetPath);
      onChunk(expectedBytes);
      return;
    }
    await fs.unlink(partPath);
    offset = 0;
  }

  throwIfAborted(signal);
  onChunk(offset);

  const headers = { 'accept-encoding': 'identity' };
  if (offset > 0) headers.range = `bytes=${offset}-`;
  const response = await fetchPinned(url, { fetchImpl, signal, headers, kind, mirror });
  if (response.status !== 200 && response.status !== 206) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error(`下载失败（HTTP ${response.status}）`);
  }
  const encoding = response.headers.get('content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') {
    await response.body?.cancel?.().catch(() => {});
    throw new Error('不支持压缩传输语音模型原始字节');
  }
  if (response.status === 206) {
    const match = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/.exec(response.headers.get('content-range') || '');
    if (!match || Number(match[1]) !== offset || Number(match[2]) < offset ||
        Number(match[2]) >= expectedBytes || Number(match[3]) !== expectedBytes) {
      await response.body?.cancel?.().catch(() => {});
      throw new Error('服务器断点续传范围不正确');
    }
  } else if (offset > 0) {
    offset = 0;
    onChunk(0);
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) !== (response.status === 206 ? expectedBytes - offset : expectedBytes)) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error('下载文件长度与锁定清单不符');
  }
  if (!response.body) throw new Error('下载服务未返回文件内容');

  const flag = (await lstatOrNull(partPath))
    ? C.O_WRONLY | C.O_NOFOLLOW | (offset > 0 ? C.O_APPEND : C.O_TRUNC)
    : C.O_CREAT | C.O_EXCL | C.O_WRONLY | C.O_NOFOLLOW;
  const handle = await fs.open(partPath, flag, 0o600);
  try {
    for await (const rawChunk of response.body) {
      throwIfAborted(signal);
      const data = Buffer.from(rawChunk);
      if (offset + data.length > expectedBytes) throw new Error('下载字节数超出锁定清单限制');
      let written = 0;
      while (written < data.length) {
        const { bytesWritten } = await handle.write(data, written, data.length - written);
        if (bytesWritten < 1) throw new Error('语音模型写入中断');
        written += bytesWritten;
      }
      offset += data.length;
      onChunk(offset);
    }
    throwIfAborted(signal);
    await handle.sync();
  } finally {
    await handle.close();
  }

  if (offset !== expectedBytes) throw new Error('下载意外中断，可点击重试继续断点续传');
  if (await sha256PlainFile(partPath, expectedBytes) !== expectedSha256) {
    await fs.unlink(partPath).catch(() => {});
    throw new Error('下载文件 SHA-256 校验失败，已移除损坏的暂存文件，请重新下载');
  }
  await fs.rename(partPath, targetPath);
}

function createReaderTtsInstaller({
  userData,
  manifest = TTS_MODEL_MANIFEST,
  fetchImpl = globalThis.fetch,
  statfsImpl = fs.statfs,
  platform = process.platform,
  arch = process.arch,
  memoryBytes = os.totalmem(),
  reserveBytes = DEFAULT_RESERVE_BYTES,
  onInstalledChange = () => {},
} = {}) {
  if (!path.isAbsolute(userData || '') || userData === '/' || userData === path.parse(userData).root) {
    throw new Error('语音模型安装目录无效');
  }
  validateTtsManifest(manifest);
  const rootDir = path.join(userData, 'tts');
  const installDir = path.join(rootDir, manifest.installDirName);
  const stagingBase = path.join(rootDir, '.staging');
  const stagingDir = path.join(stagingBase, manifest.installDirName);
  const binaryPath = path.join(installDir, manifest.runtime.binaryName);
  const modelPath = path.join(installDir, manifest.model.fileName);
  const markerPath = path.join(installDir, INSTALL_MARKER);
  const totalDownloadBytes = manifest.runtime.archiveBytes + manifest.model.bytes;
  const installedDiskBytes = manifest.runtime.binaryBytes + manifest.model.bytes;

  let activeTask = null;
  let activeController = null;
  let mirrorEnabled = false;
  let runtimeState = {
    phase: 'idle', // 'idle' | 'downloading' | 'extracting' | 'verifying' | 'error' | 'cancelled'
    phaseLabel: '',
    downloadedBytes: 0,
    totalBytes: totalDownloadBytes,
    percent: 0,
    bytesPerSecond: 0,
    error: null,
  };

  async function detectInstalled() {
    const [markerStat, binStat, modelStat] = await Promise.all([
      lstatOrNull(markerPath),
      lstatOrNull(binaryPath),
      lstatOrNull(modelPath),
    ]);
    if (!markerStat || !markerStat.isFile() || markerStat.isSymbolicLink()) return false;
    if (!binStat || !binStat.isFile() || binStat.isSymbolicLink() || binStat.size !== manifest.runtime.binaryBytes) return false;
    if (!modelStat || !modelStat.isFile() || modelStat.isSymbolicLink() || modelStat.size !== manifest.model.bytes) return false;
    return true;
  }

  async function availableDiskBytes() {
    let checkPath = rootDir;
    while (!(await lstatOrNull(checkPath))) {
      const parent = path.dirname(checkPath);
      if (parent === checkPath) return null;
      checkPath = parent;
    }
    try {
      const stat = await statfsImpl(checkPath);
      return Number(stat.bavail) * Number(stat.bsize);
    } catch { return null; }
  }

  async function partialDownloadedBytes() {
    let bytes = 0;
    const files = [
      [manifest.runtime.archiveName, manifest.runtime.archiveBytes],
      [manifest.model.fileName, manifest.model.bytes],
    ];
    for (const [name, expected] of files) {
      const complete = await lstatOrNull(path.join(stagingDir, name));
      if (complete?.isFile() && !complete.isSymbolicLink()) { bytes += expected; continue; }
      const part = await lstatOrNull(path.join(stagingDir, `${name}.partial`));
      if (part?.isFile() && !part.isSymbolicLink()) bytes += Math.min(expected, part.size);
    }
    return bytes;
  }

  async function getStatus() {
    const hardware = checkTtsHardware({ platform, arch, memoryBytes });
    const installed = await detectInstalled();
    const freeBytes = await availableDiskBytes();
    const requiredBytes = totalDownloadBytes + reserveBytes;
    let state;
    if (activeTask) {
      state = runtimeState.phase === 'extracting' ? 'extracting' : runtimeState.phase === 'verifying' ? 'verifying' : 'downloading';
    } else if (installed) {
      state = 'installed';
    } else if (!hardware.supported) {
      state = 'unsupported';
    } else if (runtimeState.phase === 'error') {
      state = 'error';
    } else {
      state = 'not-installed';
    }
    const resumableBytes = (!installed && !activeTask) ? await partialDownloadedBytes() : 0;
    return {
      state,
      hardware,
      mirror: mirrorEnabled,
      model: {
        id: manifest.id,
        displayName: manifest.displayName,
        totalDownloadBytes,
        installedDiskBytes,
        runtimeVersion: manifest.runtime.releaseTag,
        modelLicense: manifest.model.license,
      },
      disk: {
        availableBytes: freeBytes,
        requiredBytes,
        sufficient: freeBytes === null ? true : freeBytes >= (requiredBytes - resumableBytes),
      },
      progress: activeTask
        ? {
            downloadedBytes: runtimeState.downloadedBytes,
            totalBytes: totalDownloadBytes,
            percent: runtimeState.percent,
            bytesPerSecond: runtimeState.bytesPerSecond,
            phaseLabel: runtimeState.phaseLabel,
          }
        : {
            downloadedBytes: installed ? totalDownloadBytes : resumableBytes,
            totalBytes: totalDownloadBytes,
            percent: installed ? 100 : Math.floor((resumableBytes / totalDownloadBytes) * 100),
            bytesPerSecond: 0,
            phaseLabel: installed ? '已安装并就绪' : resumableBytes > 0 ? '已暂停，可断点续传' : '',
          },
      paths: installed ? { binaryPath, modelPath } : null,
      error: activeTask ? null : runtimeState.error,
    };
  }

  async function install({ consent, mirror = false } = {}) {
    if (consent !== true) throw new Error('下载离线语音模型前必须由用户明确确认');
    if (activeTask) return getStatus();
    const hardware = checkTtsHardware({ platform, arch, memoryBytes });
    if (!hardware.supported) throw new Error(hardware.reason || '当前设备暂不支持本地离线 Qwen3-TTS');
    if (await detectInstalled()) {
      runtimeState = { phase: 'idle', phaseLabel: '已安装并就绪', downloadedBytes: totalDownloadBytes, totalBytes: totalDownloadBytes, percent: 100, bytesPerSecond: 0, error: null };
      return getStatus();
    }

    mirrorEnabled = Boolean(mirror);
    const freeBytes = await availableDiskBytes();
    const alreadyDownloaded = await partialDownloadedBytes();
    if (freeBytes !== null && freeBytes < (totalDownloadBytes - alreadyDownloaded + reserveBytes)) {
      throw new Error('磁盘可用空间不足（需预留约 1.7 GB 空间）');
    }

    const controller = new AbortController();
    activeController = controller;
    const signal = controller.signal;
    const startedAt = Date.now();
    let baseDownloaded = alreadyDownloaded;

    runtimeState = {
      phase: 'downloading',
      phaseLabel: '正在准备下载语音引擎…',
      downloadedBytes: alreadyDownloaded,
      totalBytes: totalDownloadBytes,
      percent: Math.min(99, Math.floor((alreadyDownloaded / totalDownloadBytes) * 100)),
      bytesPerSecond: 0,
      error: null,
    };

    activeTask = (async () => {
      try {
        await ensurePlainDirectory(rootDir);
        await ensurePlainDirectory(stagingBase);
        await ensurePlainDirectory(stagingDir);

        const runtimeArchivePath = path.join(stagingDir, manifest.runtime.archiveName);
        const stagedModelPath = path.join(stagingDir, manifest.model.fileName);
        const stagedBinaryPath = path.join(stagingDir, manifest.runtime.binaryName);

        const updateProgress = (downloadedBytes, phase, phaseLabel) => {
          const elapsedSec = Math.max(0.25, (Date.now() - startedAt) / 1000);
          const delta = Math.max(0, downloadedBytes - baseDownloaded);
          runtimeState = {
            phase,
            phaseLabel,
            downloadedBytes,
            totalBytes: totalDownloadBytes,
            percent: Math.min(99, Math.floor((downloadedBytes / totalDownloadBytes) * 100)),
            bytesPerSecond: Math.round(delta / elapsedSec),
            error: null,
          };
        };

        // 1. Download speech.cpp v0.10.1 arm64 Metal zip (~6 MB) + verify SHA-256
        updateProgress(0, 'downloading', '正在下载语音引擎（speech.cpp v0.10.1）…');
        await downloadResumableFile({
          url: manifest.runtime.url,
          targetPath: runtimeArchivePath,
          expectedBytes: manifest.runtime.archiveBytes,
          expectedSha256: manifest.runtime.archiveSha256,
          kind: 'runtime',
          mirror: false,
          fetchImpl,
          signal,
          onChunk: (bytes) => updateProgress(bytes, 'downloading', '正在下载语音引擎（speech.cpp v0.10.1）…'),
        });

        // 2. Download Qwen3-TTS 0.6B Q8_0 GGUF (~1.13 GB) + verify SHA-256
        const modelUrl = mirrorEnabled ? manifest.model.mirrorUrl : manifest.model.url;
        await downloadResumableFile({
          url: modelUrl,
          targetPath: stagedModelPath,
          expectedBytes: manifest.model.bytes,
          expectedSha256: manifest.model.sha256,
          kind: 'model',
          mirror: mirrorEnabled,
          fetchImpl,
          signal,
          onChunk: (bytes) => updateProgress(
            manifest.runtime.archiveBytes + bytes,
            'downloading',
            mirrorEnabled ? '正在下载 Qwen3-TTS 语音模型（国内镜像）…' : '正在下载 Qwen3-TTS 语音模型…',
          ),
        });

        // 3. Safely extract `speech` executable from the SHA-256-verified ZIP and verify extracted SHA-256
        throwIfAborted(signal);
        updateProgress(totalDownloadBytes, 'extracting', '正在解压并校验语音引擎…');
        const zipBuffer = await fs.readFile(runtimeArchivePath);
        const binaryBytes = extractSingleEntryFromZip(zipBuffer, manifest.runtime.binaryName, manifest.runtime.binaryBytes);
        const binaryHash = createHash('sha256').update(binaryBytes).digest('hex');
        if (binaryHash !== manifest.runtime.binarySha256) {
          throw new Error('语音引擎解压后 SHA-256 校验失败');
        }
        await fs.rm(stagedBinaryPath, { force: true });
        await fs.writeFile(stagedBinaryPath, binaryBytes, { flag: 'wx', mode: 0o700 });
        await fs.chmod(stagedBinaryPath, 0o755);

        // 4. Final verification of staged binary & model before atomic publish
        throwIfAborted(signal);
        updateProgress(totalDownloadBytes, 'verifying', '正在完成最终完整性校验…');
        const [verifiedBin, verifiedModel] = await Promise.all([
          sha256PlainFile(stagedBinaryPath, manifest.runtime.binaryBytes),
          sha256PlainFile(stagedModelPath, manifest.model.bytes),
        ]);
        if (verifiedBin !== manifest.runtime.binarySha256 || verifiedModel !== manifest.model.sha256) {
          throw new Error('语音模型最终 SHA-256 校验失败');
        }

        // Remove the zip archive from staging before publishing so only clean runtime+model files are kept.
        await fs.rm(runtimeArchivePath, { force: true });
        await atomicJson(path.join(stagingDir, INSTALL_MARKER), {
          version: 1,
          id: manifest.id,
          runtimeVersion: manifest.runtime.releaseTag,
          modelRevision: manifest.model.revision,
          verifiedAt: new Date().toISOString(),
        });

        if (await lstatOrNull(installDir)) {
          await fs.rm(installDir, { recursive: true, force: true });
        }
        await fs.rename(stagingDir, installDir);

        runtimeState = {
          phase: 'idle',
          phaseLabel: '已安装并就绪',
          downloadedBytes: totalDownloadBytes,
          totalBytes: totalDownloadBytes,
          percent: 100,
          bytesPerSecond: 0,
          error: null,
        };
        try { await onInstalledChange({ installed: true, binaryPath, modelPath }); } catch { /* best-effort notify */ }
      } catch (error) {
        const aborted = signal.aborted || error?.name === 'AbortError';
        const message = aborted
          ? null
          : error instanceof TypeError
            ? '网络连接失败或被中断，请检查网络/代理或尝试切换国内镜像后重试。'
            : (error instanceof Error ? error.message : '离线语音模型安装失败');
        runtimeState = {
          phase: aborted ? 'cancelled' : 'error',
          phaseLabel: aborted ? '已暂停，可断点续传' : '安装失败',
          downloadedBytes: await partialDownloadedBytes().catch(() => runtimeState.downloadedBytes),
          totalBytes: totalDownloadBytes,
          percent: runtimeState.percent,
          bytesPerSecond: 0,
          error: message,
        };
      } finally {
        activeTask = null;
        if (activeController === controller) activeController = null;
      }
    })();

    return getStatus();
  }

  async function cancel() {
    if (activeController) {
      activeController.abort(Object.assign(new Error('语音模型下载已取消'), { name: 'AbortError' }));
      if (activeTask) await activeTask.catch(() => {});
    }
    return getStatus();
  }

  async function remove() {
    if (activeController) {
      activeController.abort(Object.assign(new Error('语音模型下载已取消'), { name: 'AbortError' }));
      if (activeTask) await activeTask.catch(() => {});
    }
    try { await onInstalledChange({ installed: false, binaryPath: null, modelPath: null }); } catch { /* stop worker before removing files */ }
    await fs.rm(installDir, { recursive: true, force: true });
    await fs.rm(stagingDir, { recursive: true, force: true });
    runtimeState = {
      phase: 'idle',
      phaseLabel: '',
      downloadedBytes: 0,
      totalBytes: totalDownloadBytes,
      percent: 0,
      bytesPerSecond: 0,
      error: null,
    };
    return getStatus();
  }

  async function waitForIdle() {
    if (activeTask) await activeTask.catch(() => {});
  }

  return {
    getStatus,
    install,
    cancel,
    remove,
    waitForIdle,
    installDir,
    binaryPath,
    modelPath,
    manifest,
  };
}

module.exports = {
  createReaderTtsInstaller,
  createElectronNetFetch,
  checkTtsHardware,
  validateTtsManifest,
  extractSingleEntryFromZip,
  INSTALL_MARKER,
};
