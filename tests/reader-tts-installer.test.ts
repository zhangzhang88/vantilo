import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { speechCppPaths } from '../packages/reader/src/server/services/speech-cpp-tts';

const require = createRequire(import.meta.url);
const { TTS_MODEL_MANIFEST } = require('../electron/reader-tts-manifest.cjs');
const { createReaderTtsInstaller, createElectronNetFetch, checkTtsHardware, validateTtsManifest, extractSingleEntryFromZip } = require('../electron/reader-tts-installer.cjs');

function sha256(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex');
}

// Build a minimal valid ZIP archive containing the given entries (stored or deflated).
function makeSyntheticZip(entries: Array<{ name: string; content: Buffer; deflate?: boolean; unixMode?: number }>): Buffer {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const compressed = entry.deflate ? zlib.deflateRawSync(entry.content) : entry.content;
    const method = entry.deflate ? 8 : 0;
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    localParts.push(local, compressed);

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(entry.content.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt32LE(((entry.unixMode ?? 0o100755) << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    nameBuf.copy(cd, 46);
    cdParts.push(cd);

    offset += local.length + compressed.length;
  }
  const cdBuffer = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, cdBuffer, eocd]);
}

function makeTestManifest(binaryContent: Buffer, modelContent: Buffer) {
  const archive = makeSyntheticZip([
    { name: 'speech', content: binaryContent, deflate: true },
    { name: 'speech.h', content: Buffer.from('// header'), deflate: false },
  ]);
  return {
    archive,
    manifest: {
      version: 1,
      id: 'qwen3-tts-test',
      displayName: 'Test Qwen3-TTS',
      installDirName: 'qwen3-tts-0.6b',
      runtime: {
        id: 'speech-cpp-test',
        repository: 'nyosegawa/speech.cpp',
        releaseTag: 'v0.10.1',
        license: 'MIT',
        archiveName: 'speech-test.zip',
        archiveBytes: archive.length,
        archiveSha256: sha256(archive),
        url: 'https://github.com/nyosegawa/speech.cpp/releases/download/v0.10.1/speech-test.zip',
        binaryName: 'speech',
        binaryBytes: binaryContent.length,
        binarySha256: sha256(binaryContent),
      },
      model: {
        id: 'qwen3-tts-model-test',
        repository: 'sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF',
        upstreamRepository: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
        revision: 'fd9df9364613a92a86b4137074bc281204823033',
        license: 'Apache-2.0',
        fileName: 'Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf',
        bytes: modelContent.length,
        sha256: sha256(modelContent),
        url: 'https://huggingface.co/sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF/resolve/fd9df9364613a92a86b4137074bc281204823033/Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf?download=true',
        mirrorUrl: 'https://hf-mirror.com/sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF/resolve/fd9df9364613a92a86b4137074bc281204823033/Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf?download=true',
      },
    },
  };
}

function makeRangeFetch(files: Record<string, Buffer>) {
  const requests: Array<{ url: string; range: string | null }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const range = headers.get('range');
    requests.push({ url, range });
    const data = files[url];
    if (!data) return new Response('not found', { status: 404 });
    if (range) {
      const match = /^bytes=(\d+)-$/.exec(range);
      if (match) {
        const start = Number(match[1]);
        const slice = data.subarray(start);
        return new Response(new Uint8Array(slice), {
          status: 206,
          headers: {
            'content-length': String(slice.length),
            'content-range': `bytes ${start}-${data.length - 1}/${data.length}`,
          },
        });
      }
    }
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: { 'content-length': String(data.length) },
    });
  });
  return { fetchImpl, requests };
}

const tempDirs: string[] = [];
async function makeTempUserData() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vantilo-tts-installer-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length) {
    await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('Reader Qwen3-TTS installer', () => {
  it('validates the pinned production manifest and distinguishes Apple Silicon vs Intel hardware', () => {
    expect(() => validateTtsManifest(TTS_MODEL_MANIFEST)).not.toThrow();
    expect(checkTtsHardware({ platform: 'darwin', arch: 'arm64', memoryBytes: 16 * 1024 ** 3 })).toMatchObject({
      supported: true, appleSilicon: true, memoryGiB: 16, reason: null,
    });
    expect(checkTtsHardware({ platform: 'darwin', arch: 'x64', memoryBytes: 16 * 1024 ** 3 })).toMatchObject({
      supported: false, appleSilicon: false,
    });
    expect(checkTtsHardware({ platform: 'darwin', arch: 'arm64', memoryBytes: 4 * 1024 ** 3 })).toMatchObject({
      supported: false, appleSilicon: true,
    });
  });

  it('rejects installation without explicit consent or with insufficient disk space', async () => {
    const userData = await makeTempUserData();
    const { manifest } = makeTestManifest(Buffer.from('bin'), Buffer.from('gguf'));
    const installer = createReaderTtsInstaller({
      userData,
      manifest,
      platform: 'darwin',
      arch: 'arm64',
      memoryBytes: 16 * 1024 ** 3,
      reserveBytes: 1024,
      statfsImpl: async () => ({ bavail: 10, bsize: 1 }),
    });
    await expect(installer.install({ consent: false })).rejects.toThrow(/明确确认/);
    await expect(installer.install({ consent: true })).rejects.toThrow(/磁盘可用空间不足/);
  });

  it('downloads, extracts, verifies SHA-256, atomically publishes, wires speechCppPaths, and cleanly removes', async () => {
    const userData = await makeTempUserData();
    const binaryContent = Buffer.from('#!/bin/sh\necho synthetic-speech-binary\n');
    const modelContent = Buffer.from('GGUF-synthetic-qwen3-tts-model-payload');
    const { archive, manifest } = makeTestManifest(binaryContent, modelContent);
    const { fetchImpl, requests } = makeRangeFetch({
      [manifest.runtime.url]: archive,
      [manifest.model.mirrorUrl]: modelContent,
    });
    const onInstalledChange = vi.fn();
    const installer = createReaderTtsInstaller({
      userData,
      manifest,
      fetchImpl,
      statfsImpl: async () => ({ bavail: 10 ** 9, bsize: 4096 }),
      platform: 'darwin',
      arch: 'arm64',
      memoryBytes: 16 * 1024 ** 3,
      reserveBytes: 1024,
      onInstalledChange,
    });

    expect((await installer.getStatus()).state).toBe('not-installed');
    await installer.install({ consent: true, mirror: true });
    await installer.waitForIdle();

    const status = await installer.getStatus();
    expect(status.state).toBe('installed');
    expect(status.paths).toEqual({
      binaryPath: path.join(userData, 'tts', 'qwen3-tts-0.6b', 'speech'),
      modelPath: path.join(userData, 'tts', 'qwen3-tts-0.6b', 'Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf'),
    });
    expect(requests.map(r => r.url)).toEqual([manifest.runtime.url, manifest.model.mirrorUrl]);
    expect(onInstalledChange).toHaveBeenCalledWith({
      installed: true,
      binaryPath: status.paths.binaryPath,
      modelPath: status.paths.modelPath,
    });
    // speechCppPaths immediately discovers the installed managed paths
    expect(speechCppPaths({}, userData)).toEqual({
      binary: status.paths.binaryPath,
      model: status.paths.modelPath,
    });

    const removed = await installer.remove();
    expect(removed.state).toBe('not-installed');
    expect(onInstalledChange).toHaveBeenLastCalledWith({ installed: false, binaryPath: null, modelPath: null });
    await expect(fs.stat(status.paths.binaryPath)).rejects.toThrow();
  });

  it('resumes a partial model download with HTTP Range and rejects corrupted SHA-256 without publishing', async () => {
    const userData = await makeTempUserData();
    const binaryContent = Buffer.from('binary-payload-0123456789');
    const modelContent = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
    const { archive, manifest } = makeTestManifest(binaryContent, modelContent);

    // Pre-seed a valid partial model file
    const stagingDir = path.join(userData, 'tts', '.staging', 'qwen3-tts-0.6b');
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.writeFile(path.join(stagingDir, `${manifest.model.fileName}.partial`), modelContent.subarray(0, 10));

    const { fetchImpl, requests } = makeRangeFetch({
      [manifest.runtime.url]: archive,
      [manifest.model.url]: modelContent,
    });
    const installer = createReaderTtsInstaller({
      userData,
      manifest,
      fetchImpl,
      statfsImpl: async () => ({ bavail: 10 ** 9, bsize: 4096 }),
      platform: 'darwin',
      arch: 'arm64',
      memoryBytes: 16 * 1024 ** 3,
      reserveBytes: 1024,
    });

    await installer.install({ consent: true, mirror: false });
    await installer.waitForIdle();
    expect((await installer.getStatus()).state).toBe('installed');
    expect(requests.find(r => r.url === manifest.model.url)?.range).toBe('bytes=10-');

    // Now test corrupt payload rejection
    const corruptUserData = await makeTempUserData();
    const corruptModel = Buffer.from('CORRUPTED-PAYLOAD-SAME-LENGTH-123456');
    expect(corruptModel.length).toBe(modelContent.length);
    const corruptFetch = makeRangeFetch({
      [manifest.runtime.url]: archive,
      [manifest.model.url]: corruptModel,
    }).fetchImpl;
    const corruptInstaller = createReaderTtsInstaller({
      userData: corruptUserData,
      manifest,
      fetchImpl: corruptFetch,
      statfsImpl: async () => ({ bavail: 10 ** 9, bsize: 4096 }),
      platform: 'darwin',
      arch: 'arm64',
      memoryBytes: 16 * 1024 ** 3,
      reserveBytes: 1024,
    });
    await corruptInstaller.install({ consent: true });
    await corruptInstaller.waitForIdle();
    const failed = await corruptInstaller.getStatus();
    expect(failed.state).toBe('error');
    expect(failed.error).toMatch(/SHA-256/);
    expect(failed.paths).toBeNull();
  });

  it('rejects ZIP path traversal and symlink binary entries', () => {
    const traversalZip = makeSyntheticZip([{ name: '../evil', content: Buffer.from('x') }]);
    expect(() => extractSingleEntryFromZip(traversalZip, 'speech', 1)).toThrow(/不安全路径/);

    const symlinkZip = makeSyntheticZip([{ name: 'speech', content: Buffer.from('/bin/sh'), unixMode: 0o120777 }]);
    expect(() => extractSingleEntryFromZip(symlinkZip, 'speech', 7)).toThrow(/符号链接/);
  });

  it('supports Electron net.request manual redirects and opaqueredirect fallback without breaking host validation', async () => {
    const userData = await makeTempUserData();
    const binaryContent = Buffer.from('electron-net-binary');
    const modelContent = Buffer.from('electron-net-model-bytes');
    const { archive, manifest } = makeTestManifest(binaryContent, modelContent);
    const redirectedRuntimeUrl = 'https://release-assets.githubusercontent.com/synthetic/speech-test.zip';
    const redirectedModelUrl = 'https://us.aws.cdn.hf.co/synthetic/model.gguf';
    const seenUrls: string[] = [];

    const fakeNet = {
      request({ url }: { url: string }) {
        seenUrls.push(url);
        const req = new EventEmitter() as EventEmitter & { setHeader: () => void; abort: () => void; end: () => void };
        let aborted = false;
        req.setHeader = () => {};
        req.abort = () => { aborted = true; };
        req.end = () => {
          queueMicrotask(() => {
            if (aborted) return;
            if (url === manifest.runtime.url) {
              req.emit('redirect', 302, 'GET', redirectedRuntimeUrl, {});
              return;
            }
            if (url === manifest.model.url) {
              req.emit('redirect', 302, 'GET', redirectedModelUrl, {});
              return;
            }
            const payload = url === redirectedRuntimeUrl ? archive : modelContent;
            const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> };
            res.statusCode = 200;
            res.headers = { 'content-length': String(payload.length) };
            req.emit('response', res);
            queueMicrotask(() => {
              res.emit('data', payload.subarray(0, 4));
              res.emit('data', payload.subarray(4));
              res.emit('end');
            });
          });
        };
        return req;
      },
    };

    const installer = createReaderTtsInstaller({
      userData,
      manifest,
      fetchImpl: createElectronNetFetch(fakeNet),
      statfsImpl: async () => ({ bavail: 10 ** 9, bsize: 4096 }),
      platform: 'darwin',
      arch: 'arm64',
      memoryBytes: 16 * 1024 ** 3,
      reserveBytes: 1024,
    });
    await installer.install({ consent: true, mirror: false });
    await installer.waitForIdle();
    expect((await installer.getStatus()).state).toBe('installed');
    expect(seenUrls).toEqual([manifest.runtime.url, redirectedRuntimeUrl, manifest.model.url, redirectedModelUrl]);
  });
});
