import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createGutenbergIntroService, fetchOpening, parseIntro } = require('../electron/gutenberg-intro.cjs');

const quote = 'At the edge of the forest the travelers saw the lantern.';
const source = 'Title: Sample\n*** START OF THE PROJECT GUTENBERG EBOOK TEST ***\n' +
  ('It was a long journey. ' + quote + ' The weather changed before morning.\n').repeat(80);
const generated = {
  titleZh: '树林边的旅人',
  introZh: '旅人们走到森林边缘，看到一盏远处的灯，天气也正在改变。他们还不知道接下来的路会发生什么，身边的景物显得既熟悉又充满不确定性。这段开头把人物带到了陌生的环境里。',
  highlightsZh: '通过旅行与天气的细节营造悬念，同时介绍人物所处的地点。',
  questionZh: '如果你看到远处的一盏灯，会选择继续前进吗？',
  readingNoteZh: '注意旅行、方向和天气相关的常见词汇，先理解动作与场景。',
  evidenceQuote: quote
};
const custom = () => ({
  get: vi.fn(async () => ({ configured: true, id: 'profile-1', model: 'qwen3.5-4b', baseUrl: 'http://127.0.0.1:18437/v1/responses' })),
  complete: vi.fn(async (_request?: { instruction: string; input: string }) => JSON.stringify(generated))
});
const response = () => new Response(source, { headers: { 'content-type': 'text/plain; charset=utf-8' } });

describe('Gutenberg Chinese introduction V0.2', () => {
  it('uses verified source excerpt and existing custom API, then persists model-scoped cache', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vantilo-intro-'));
    try {
      const api = custom();
      const fetch = vi.fn(async (_url: unknown) => response());
      const service = createGutenbergIntroService({ cacheDir: dir, customApi: api, fetchImpl: fetch });
      const first = await service.generate({ id: 35 });
      expect(first).toMatchObject({ id: 35, titleZh: '树林边的旅人', cached: false, model: 'qwen3.5-4b', sourceScope: '原著开头节选' });
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0][0]).toBe('https://www.gutenberg.org/cache/epub/35/pg35.txt');
      expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({
        profileId: 'profile-1', input: expect.stringContaining(quote)
      }));
      expect(await service.generate({ id: 35 })).toMatchObject({ cached: true });
      expect((await createGutenbergIntroService({ cacheDir: dir, customApi: api, fetchImpl: fetch }).cached({ id: 35 }))?.introZh).toBe(generated.introZh);
      expect(api.complete).toHaveBeenCalledOnce();
      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^35-[a-f0-9]{64}\.json$/);
      const saved = await readFile(path.join(dir, files[0]), 'utf8');
      expect(saved).not.toContain('apiKey');
      expect(saved).not.toContain('18437');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('invalidates previous cache when the active model or API profile changes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vantilo-intro-'));
    try {
      const api = custom(); const fetch = vi.fn(async () => response());
      const service = createGutenbergIntroService({ cacheDir: dir, customApi: api, fetchImpl: fetch });
      await service.generate({ id: 174 });
      api.get.mockResolvedValue({ configured: true, id: 'profile-2', model: 'different-model', baseUrl: 'https://example.com/v1' });
      expect(await service.cached({ id: 174 })).toBeNull();
      expect((await service.generate({ id: 174 })).cached).toBe(false);
      expect(api.complete).toHaveBeenCalledTimes(2);
      api.get.mockResolvedValue({ configured: true, id: 'profile-1', model: 'qwen3.5-4b', baseUrl: 'http://127.0.0.1:18437/v1/responses' });
      expect((await service.cached({ id: 174 }))?.cached).toBe(true);
      expect(api.complete).toHaveBeenCalledTimes(2);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('keeps custom and Codex caches separate, keyed by the selected live model and effort, and supports force regenerate', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vantilo-intro-engine-'));
    try {
      const api = custom();
      const codex = { get:vi.fn(async ({modelId,reasoningEffort}:any = {}) => ({configured:true,id:'codex-book-introduction',model:modelId??'future-gpt-8',reasoningEffort:reasoningEffort??'high',baseUrl:'codex-app-server'})),complete:vi.fn(async () => JSON.stringify({ ...generated, titleZh:'Codex 版本' })) };
      const service = createGutenbergIntroService({ cacheDir:dir, customApi:api, codexApi:codex, fetchImpl:vi.fn(async () => response()) });
      expect((await service.generate({id:174,engine:'custom'})).engine).toBe('custom');
      expect((await service.generate({id:174,engine:'codex',modelId:'future-gpt-8',reasoningEffort:'high'})).engine).toBe('codex');
      expect((await service.cached({id:174,engine:'custom'}))?.titleZh).toBe(generated.titleZh);
      expect((await service.cached({id:174,engine:'codex',modelId:'future-gpt-8',reasoningEffort:'high'}))?.titleZh).toBe('Codex 版本');
      expect(await service.cached({id:174,engine:'codex',modelId:'future-gpt-8',reasoningEffort:'medium'})).toBeNull();
      const unchanged = await service.generate({id:174,engine:'codex',modelId:'future-gpt-8',reasoningEffort:'high'});
      expect(unchanged.cached).toBe(true);
      expect(codex.complete).toHaveBeenCalledOnce();
      const regenerated = await service.generate({id:174,engine:'codex',force:true,modelId:'future-gpt-8',reasoningEffort:'high'});
      expect(regenerated.cached).toBe(false);
      expect(codex.complete).toHaveBeenCalledTimes(2);
      expect((await service.cached({id:174,engine:'custom'}))?.titleZh).toBe(generated.titleZh);
      expect((await readdir(dir)).length).toBe(2);
    } finally { await rm(dir,{recursive:true,force:true}); }
  });

  it('rejects invented citations and malformed output without caching', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vantilo-intro-'));
    try {
      const api = custom(); const fetch = vi.fn(async () => response());
      api.complete.mockResolvedValueOnce(JSON.stringify({ ...generated, evidenceQuote: 'A fabricated passage that never appeared in the book.' }));
      const service = createGutenbergIntroService({ cacheDir: dir, customApi: api, fetchImpl: fetch });
      await expect(service.generate({ id: 120 })).rejects.toThrow(/无法在节选中核实/);
      expect(await service.cached({ id: 120 })).toBeNull();
      api.complete.mockResolvedValueOnce('Definitely a book about dinosaurs.');
      api.complete.mockResolvedValueOnce('Still not JSON.');
      await expect(service.generate({ id: 120 })).rejects.toThrow(/JSON/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('never calls the model if the source marker is missing, and rejects external URLs by constructing an ID-only address', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vantilo-intro-'));
    try {
      const api = custom(); const fetch = vi.fn(async () => new Response('fiction '.repeat(800), { headers: { 'content-type': 'text/plain' } }));
      const service = createGutenbergIntroService({ cacheDir: dir, customApi: api, fetchImpl: fetch });
      await expect(service.generate({ id: 35 })).rejects.toThrow(/正文标记/);
      await expect(service.generate({ id: 'https://evil.test/book' })).rejects.toThrow();
      expect(api.complete).not.toHaveBeenCalled();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('supports cancellation before saving the generated response', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vantilo-intro-'));
    try {
      const api = custom(); const controller = new AbortController();
      api.complete.mockImplementationOnce(async () => { controller.abort(); return JSON.stringify(generated); });
      const service = createGutenbergIntroService({ cacheDir: dir, customApi: api, fetchImpl: vi.fn(async () => response()) });
      await expect(service.generate({ id: 244 }, { signal: controller.signal })).rejects.toThrow(/取消/);
      expect(await service.cached({ id: 244 })).toBeNull();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('parses valid JSON fenced output but requires a directly matched English passage', () => {
    const opening = 'Intro '.repeat(350) + quote;
    expect(parseIntro('```json\n' + JSON.stringify(generated) + '\n```', opening).titleZh).toBe('树林边的旅人');
  });

  it('accepts prose-wrapped model JSON and ordinary output length variation while preserving quote verification', () => {
    const opening = 'Intro '.repeat(350) + quote;
    const concise = { ...generated, introZh: '旅人来到森林边，看见远处的灯，天气也逐渐变化。他们试着寻找方向，但前方的旅途仍然充满未知。' };
    expect(parseIntro('Here is the requested JSON:\n' + JSON.stringify(concise) + '\nHope this helps.', opening).introZh).toBe(concise.introZh);
    expect(() => parseIntro('Result: ' + JSON.stringify({ ...concise, evidenceQuote: 'A made-up quote from nowhere.' }), opening)).toThrow(/无法在节选中核实/);
  });

  it('repairs a short or incomplete first draft once and still enforces a verified source quote', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vantilo-intro-repair-'));
    try {
      const api = custom();
      api.complete.mockResolvedValueOnce(JSON.stringify({ ...generated, introZh: '短', questionZh: undefined, extra: 'harmless' }));
      api.complete.mockResolvedValueOnce(JSON.stringify({ ...generated, extra: 'ignored by schema' }));
      const service = createGutenbergIntroService({ cacheDir: dir, customApi: api, fetchImpl: vi.fn(async () => response()) });
      const result = await service.generate({ id: 174 });
      expect(result.cached).toBe(false);
      expect(result.evidenceQuote).toBe(quote);
      expect(api.complete).toHaveBeenCalledTimes(2);
      expect(api.complete.mock.calls[1]?.[0]?.instruction).toContain('格式校验');
      expect((await service.cached({ id: 174 }))?.cached).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('derives a verified original-text excerpt when the small model omits evidenceQuote', () => {
    const opening = 'A short heading.\n\n' +
      'At the beginning, the characters approach the old house and see a faint light in the window. ' +
      'They hesitate before entering because they cannot see who is inside.\n\n' +
      'A later passage explains what they discover.\n';
    const withoutQuote = { ...generated, evidenceQuote: undefined };
    const result = parseIntro(JSON.stringify(withoutQuote), opening);
    expect(result.evidenceQuote.length).toBeGreaterThan(10);
    expect(opening.replace(/\s+/g, ' ')).toContain(result.evidenceQuote);
    expect(() => parseIntro(JSON.stringify({ ...generated, evidenceQuote: 'Fabricated evidence text.' }), opening)).toThrow(/无法在节选中核实/);
  });

  it('uses the real Gutenberg text structure when fetching three different public-domain books', async () => {
    if (process.env.VANTILO_LIVE_GUTENBERG !== '1') return;
    for (const id of [35, 174, 120]) {
      const result = await fetchOpening(id, { fetchImpl: fetch, signal: AbortSignal.timeout(15000) });
      expect(result.opening.length).toBeGreaterThan(1500);
      expect(result.sourceUrl).toContain('/' + id + '/pg' + id + '.txt');
    }
  });
});
