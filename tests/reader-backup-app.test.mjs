import { beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { readerSourceRoot } from '../scripts/reader-source-path.mjs';
import { adaptReaderSource } from '../scripts/reader-variant.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { installReaderBackupDownloads } = require('../electron/reader-backup-download.cjs');

let api;
beforeAll(async () => {
  const entry = `${readerSourceRoot}/src/frontend/user-data-backup.ts`;
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'reader-adaptation', setup(builder) { builder.onLoad({ filter: /\.ts$/ }, async args => ({ contents: adaptReaderSource(await readFile(args.path, 'utf8'), args.path, { translationPreview: true, qwenPreview: false }), loader: 'ts' })); } }] });
  api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
});
function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), keys: () => [...values.keys()] };
}
const paragraph = 'magazine-reader-paragraph-translations-v1:vantilo-v2:custom-api:012345abcdef';
const sentence = 'magazine-reader-sentence-translations-v1:vantilo-v2:codex:gpt-6-sol';
const document = { kind: 'book-chapter', bookId: 'book:one', chapterId: 'chapter:one', documentId: 'reading:book:book:one:chapter:one' };
const base = { document, paragraphIndex: 0, sourceText: 'The book opens.', translationZh: '书开始了。', model: 'test-model', provider: 'custom-api', generatedAt: '2026-10-28T00:00:00.000Z' };

describe('desktop reading backup', () => {
  it('exports, previews and restores saved data and per-model translations while preserving unrelated data', () => {
    const from = storage();
    from.setItem('economist-reader-state-v1', JSON.stringify({ version: 1, progress: {}, bookProgress: { [document.documentId]: 42 } }));
    from.setItem(paragraph, JSON.stringify([base]));
    from.setItem(sentence, JSON.stringify([{ ...base, startOffset: 0 }]));
    from.setItem('unrelated-api-secret', 'secret');
    const backup = api.parseUserDataBackup(JSON.stringify(api.buildUserDataBackup(from)));
    expect(backup.data[paragraph]).toHaveLength(1);
    expect(backup.data[sentence]).toHaveLength(1);
    expect(JSON.stringify(backup)).not.toContain('secret');
    expect(api.summarizeUserDataBackup(backup).entries.some(entry => entry.key === paragraph && entry.count === 1)).toBe(true);
    const target = storage(); target.setItem('unrelated-api-secret', 'preserved');
    api.restoreUserDataBackup(target, backup);
    expect(JSON.parse(target.getItem(paragraph))[0].translationZh).toBe('书开始了。');
    expect(JSON.parse(target.getItem(sentence))[0].model).toBe('test-model');
    expect(target.getItem('unrelated-api-secret')).toBe('preserved');
    api.clearUserData(target);
    expect(target.getItem(paragraph)).toBeNull(); expect(target.getItem(sentence)).toBeNull();
    expect(target.getItem('unrelated-api-secret')).toBe('preserved');
  });
  it('exports Reader records while excluding unrelated Agent and credential keys', () => {
    const source=storage();
    source.setItem('economist-reader-state-v1', JSON.stringify({version:1,progress:{'fixture:article':32},lastPosition:null}));
    source.setItem(paragraph, JSON.stringify([base]));
    for (const key of ['agent-sessions','agent-projects','codex-oauth','chromium-cookie','api-key','encryptedApiKey']) source.setItem(key, 'excluded-fixture-'+key);
    const backup=api.buildUserDataBackup(source);
    expect(backup.data['economist-reader-state-v1'].progress['fixture:article']).toBe(32);
    expect(backup.data[paragraph]).toHaveLength(1);
    expect(JSON.stringify(backup)).not.toContain('excluded-fixture-');
  });
  it('exports and validates the host growth record while preserving the host-owned copy during Reader-side restore', () => {
    const from=storage();const growth={days:{'2026-10-29':{seconds:1800,books:{'book:one':1200,'book:two':600}}}};
    const backup=api.parseUserDataBackup(JSON.stringify(api.buildUserDataBackup({getItem:key=>key==='vantilo-reading-growth-v1'?JSON.stringify(growth):from.getItem(key)})));
    expect(backup.data['vantilo-reading-growth-v1']).toEqual(growth);
    const growthPreview=api.summarizeUserDataBackup(backup).entries.find(entry=>entry.key==='vantilo-reading-growth-v1');
    expect(growthPreview).toMatchObject({label:'阅读成长记录',count:1,description:'1 天 · 0.5 小时 · 1 个达标日'});
    expect(()=>api.parseUserDataBackup(JSON.stringify({...backup,data:{...backup.data,'vantilo-reading-growth-v1':{days:{'2026-10-29':{seconds:NaN,books:{}}}}}}))).toThrow('阅读成长记录');
    const target=storage();target.setItem('vantilo-reading-growth-v1',JSON.stringify({days:{'2026-10-28':{seconds:30,books:{'book:old':30}}}}));
    api.restoreUserDataBackup(target,backup);
    expect(JSON.parse(target.getItem('vantilo-reading-growth-v1'))).toMatchObject({days:{'2026-10-28':{seconds:30}}});
  });
  it('keeps model caches when restoring an old backup that could not contain them', () => {
    const target = storage(); target.setItem(paragraph, JSON.stringify([base]));
    const old = api.parseUserDataBackup(JSON.stringify({ app: 'magazine-reader', version: 1, exportedAt: '2026-10-28T00:00:00Z', data: {} }));
    api.restoreUserDataBackup(target, old);
    expect(target.getItem(paragraph)).not.toBeNull();
  });
  it('rejects unknown cache names and rolls back a failed restore', () => {
    const bad = { app: 'magazine-reader', version: 1, exportedAt: '2026-10-28T00:00:00Z', variantKeysIncluded: true, data: { 'unrelated:vantilo-v2:custom-api:012345abcdef': [] } };
    expect(() => api.parseUserDataBackup(JSON.stringify(bad))).toThrow('未知数据项');
    const source = storage(); source.setItem(paragraph, JSON.stringify([base]));
    const backup = api.buildUserDataBackup(source);
    const target = storage(); target.setItem('economist-reader-state-v1', JSON.stringify({ version: 1, progress: { a: 32 } }));
    const before = target.getItem('economist-reader-state-v1');
    const write = target.setItem; target.setItem = (key, value) => { if (key === paragraph) throw new Error('disk full'); write(key, value); };
    expect(() => api.restoreUserDataBackup(target, backup)).toThrow('disk full');
    expect(target.getItem('economist-reader-state-v1')).toBe(before);
  });
});

it('uses a native save dialog only for a Reader backup requested by the application window', () => {
  let handler; const session = { on: (event, fn) => { expect(event).toBe('will-download'); handler = fn; } };
  const contents = {}; const win = { webContents: contents, isDestroyed: () => false };
  installReaderBackupDownloads(session, () => win, '/tmp/downloads');
  const options = []; const item = { getURL: () => 'blob:http://127.0.0.1:5175/abcdef01-1234', getFilename: () => 'vantilo-reading-backup-2026-10-28.json', setSaveDialogOptions: value => options.push(value) };
  handler({}, item, {}); expect(options).toHaveLength(0);
  handler({}, item, contents); expect(options[0].defaultPath).toBe('/tmp/downloads/vantilo-reading-backup-2026-10-28.json');
});
