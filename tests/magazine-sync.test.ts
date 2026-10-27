import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { MagazineSyncController } = require('../electron/magazine-sync-controller.cjs');
const { createMagazineFetch } = require('../electron/magazine-github-fetch.cjs');
const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function root() { const dir = await mkdtemp(path.join(os.tmpdir(), 'vantilo-sync-')); roots.push(dir); return path.join(dir, 'sync.json'); }

describe('magazine automatic updates', () => {
  it('initializes an empty install, coalesces manual checks, persists only scheduler metadata', async () => {
    let finish!: (value: unknown) => void;
    const syncImpl = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const stateFile = await root();
    const sync = new MagazineSyncController({ syncImpl, stateFile });
    await sync.initialize();
    sync.start();
    await vi.waitFor(() => expect(syncImpl).toHaveBeenCalledOnce());
    const manual = sync.check();
    expect(sync.getState().status).toBe('checking');
    finish({ importedCount: 4, failedCount: 0 });
    await manual;
    expect(sync.getState()).toMatchObject({ status: 'idle', importedCount: 4, failedCount: 0 });
    expect(Object.keys(JSON.parse(await readFile(stateFile, 'utf8'))).sort()).toEqual(['lastAttemptAt', 'lastSuccessAt', 'version']);
    await sync.stop();
  });
  it('checks again after three hours and catches up after relaunch without duplicate early requests', async () => {
    let now = Date.parse('2026-10-25T00:00:00Z');
    const syncImpl = vi.fn(async () => ({ importedCount: 0, failedCount: 0 }));
    const stateFile = await root();
    const first = new MagazineSyncController({ syncImpl, stateFile, now: () => now, intervalMs: 50 });
    await first.initialize(); await first.check(); await first.stop();
    const next = new MagazineSyncController({ syncImpl, stateFile, now: () => now, intervalMs: 50 });
    await next.initialize(); next.start();
    expect(syncImpl).toHaveBeenCalledOnce();
    now += 51;
    await vi.waitFor(() => expect(syncImpl).toHaveBeenCalledTimes(2));
    await next.stop();
  });
  it('reports partial imports and network failures without deleting existing issues, and retries manually', async () => {
    const syncImpl = vi.fn().mockResolvedValueOnce({ importedCount: 2, failedCount: 1 }).mockRejectedValueOnce(new Error('secret exception')).mockResolvedValueOnce({ importedCount: 0, failedCount: 0 });
    const sync = new MagazineSyncController({ syncImpl, stateFile: await root() });
    await sync.initialize();
    await sync.check(); expect(sync.getState()).toMatchObject({ status: 'error', importedCount: 2, failedCount: 1, lastSuccessAt: null });
    await sync.check(); expect(sync.getState().message).not.toContain('secret exception');
    await sync.check(); expect(sync.getState().lastSuccessAt).toEqual(expect.any(String));
    await sync.stop(); await sync.check(); expect(syncImpl).toHaveBeenCalledTimes(3);
  });
});

describe('fixed magazine network source', () => {
  it('only fetches the upstream GitHub repository and never forwards authorization or follows redirects', async () => {
    const fetchImpl = vi.fn(async () => new Response('[]', { headers: { 'content-type': 'application/json' } }));
    const fetcher = createMagazineFetch({ fetchImpl });
    await fetcher('https://api.github.com/repos/hehonghui/awesome-english-ebooks/contents/01_economist', { headers: { Authorization: 'secret' } });
    const options: any = (fetchImpl.mock.calls as any)[0][1];
    expect(options.redirect).toBe('error'); expect(options.headers.Authorization).toBeUndefined(); expect(options.signal).toBeInstanceOf(AbortSignal);
    for (const url of ['http://127.0.0.1:1234/', 'https://api.github.com/repos/other/repo/contents/a', 'https://raw.githubusercontent.com/other/repo/master/a', 'https://user@api.github.com/repos/hehonghui/awesome-english-ebooks/contents/a']) await expect(fetcher(url)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('bounds downloaded responses before buffering', async () => {
    const fetcher = createMagazineFetch({ fetchImpl: vi.fn(async () => new Response('x', { headers: { 'content-length': String(101*1024*1024) } })) });
    await expect(fetcher('https://raw.githubusercontent.com/hehonghui/awesome-english-ebooks/master/a.epub')).rejects.toThrow(/too large/);
  });
});

describe('empty library update recovery', () => {
  it('retries an interrupted first download immediately after relaunch', async () => {
    const stateFile = await root();
    await writeFile(stateFile, JSON.stringify({version:1,lastAttemptAt:new Date().toISOString(),lastSuccessAt:null}));
    const syncImpl = vi.fn(async () => ({importedCount:0,failedCount:0}));
    const sync = new MagazineSyncController({syncImpl,stateFile});
    await sync.initialize(); sync.start();
    await vi.waitFor(() => expect(syncImpl).toHaveBeenCalledOnce());
    await sync.stop();
  });
  it('publishes bounded per-source progress only during a live check', async () => {
    let finish!: (value: unknown) => void;
    const onState = vi.fn();
    const sync = new MagazineSyncController({stateFile:await root(),onState,syncImpl:()=>new Promise(resolve=>{finish=resolve;})});
    sync.reportProgress('ignored'); expect(onState).not.toHaveBeenCalled();
    const pending = sync.check();
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    sync.reportProgress('正在下载 The Economist EPUB');
    expect(sync.getState().message).toContain('The Economist');
    sync.reportProgress('x'.repeat(301)); expect(sync.getState().message).toContain('The Economist');
    finish({importedCount:1,failedCount:0}); await pending; await sync.stop();
    sync.reportProgress('stale'); expect(sync.getState().message).not.toBe('stale');
  });
  it('retries failed checks after the retry interval instead of the normal three hours', async () => {
    let now = Date.parse('2026-10-25T00:00:00Z');
    const syncImpl = vi.fn(async()=>({importedCount:0,failedCount:4}));
    const sync = new MagazineSyncController({stateFile:await root(),syncImpl,now:()=>now,intervalMs:50,retryMs:10});
    await sync.check(); sync.start(); expect(syncImpl).toHaveBeenCalledOnce();
    now += 11;
    await vi.waitFor(()=>expect(syncImpl).toHaveBeenCalledTimes(2));
    await sync.stop();
  });
  it('identifies checks and downloads without exposing the remote filename', async () => {
    const onProgress = vi.fn();
    const fetcher = createMagazineFetch({onProgress,fetchImpl:async()=>new Response('[]')});
    await fetcher('https://api.github.com/repos/hehonghui/awesome-english-ebooks/contents/02_new_yorker');
    expect(onProgress).toHaveBeenLastCalledWith(expect.stringContaining('正在检查 The New Yorker'));
    await fetcher('https://raw.githubusercontent.com/hehonghui/awesome-english-ebooks/master/05_wired/private.epub');
    expect(onProgress).toHaveBeenLastCalledWith(expect.stringContaining('正在下载 Wired EPUB'));
    expect(onProgress.mock.calls.flat().join('')).not.toContain('private.epub');
  });
});
