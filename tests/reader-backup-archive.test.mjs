import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { createReaderBackupArchive, safeApiMetadata } from '../electron/reader-backup-archive.cjs';

const roots = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vantilo-reader-backup-archive-')); roots.push(root);
  const userDataRoot = path.join(root, 'userData'), libraryRoot = path.join(userDataRoot, 'reader-library'), out = path.join(root, 'out');
  await mkdir(path.join(libraryRoot, 'books'), { recursive: true }); await mkdir(path.join(libraryRoot, 'issues'), { recursive: true });
  await mkdir(path.join(libraryRoot, 'data', 'learning-materials'), { recursive: true }); await mkdir(out);
  return { root, userDataRoot, libraryRoot, out };
}
const browserSnapshot = () => ({ version: 1, origins: ['http://127.0.0.1:5175', 'file://'], localStorage: { app: 'magazine-reader', version: 1, exportedAt: '2026-10-30T00:00:00.000Z', data: { 'reader-state': { version: 1, progress: { 'book:synthetic': 42 } } } }, indexedDB: [] });
const libraryIndex = { version: 1, books: [{ id: 'book:synthetic', title: '合成书名', authors: ['测试作者'], sourceFilename: 'private-book.epub', parts: [{ id: 'part:1', title: '第一部分', order: 1, chapterIds: ['chapter:1'] }], chapters: [{ id: 'chapter:1', title: '第一章', partId: 'part:1', order: 1, role: 'chapter', wordCount: 10, paragraphs: ['ORIGINAL_BOOK_SENTINEL'] }] }], issues: [{ id: 'issue:synthetic', title: '合成杂志', filename: 'private-issue.epub', articles: [{ id: 'article:1', title: '用户阅读记录关联', status: 'save', bodyText: 'FULL_MAGAZINE_CONTENT_SENTINEL' }] }] };
const apiMetadata = { configured: true, activeId: 'synthetic-provider', profiles: [{ id: 'synthetic-provider', name: '测试服务', baseUrl: 'https://api.example.invalid/v1', model: 'test-model', hasApiKey: true, apiKey: 'SYNTHETIC_API_KEY_73fd', encryptedApiKey: 'SYNTHETIC_ENCRYPTED_KEY_f028' }] };
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('Reader backup archive', () => {
  it('backs up reading records and indexes while explicitly excluding original books, magazines, and media', async () => {
    const f = await fixture();
    await writeFile(path.join(f.libraryRoot, 'books', 'private-book.epub'), Buffer.from('ORIGINAL_BOOK_SENTINEL'));
    await writeFile(path.join(f.libraryRoot, 'issues', 'private-issue.epub'), Buffer.from('ORIGINAL_ISSUE_SENTINEL'));
    await writeFile(path.join(f.libraryRoot, 'data', 'book-categories.json'), JSON.stringify({ version: 1, books: { 'book:synthetic': 'uncategorized' } }));
    await writeFile(path.join(f.libraryRoot, 'data', 'learning-materials', 'lesson.json'), JSON.stringify({ title: 'synthetic learning data' }));
    await writeFile(path.join(f.libraryRoot, 'data', 'learning-materials', 'book-photo.png'), Buffer.from('BOOK_MEDIA_SENTINEL'));
    await mkdir(path.join(f.libraryRoot, 'data', 'science-article-media', 'synthetic-article'), { recursive: true });
    await writeFile(path.join(f.libraryRoot, 'data', 'science-article-media', 'synthetic-article', 'large-image.webp'), Buffer.from('MAGAZINE_MEDIA_SENTINEL'));
    await mkdir(path.join(f.libraryRoot, 'data', 'learning-audio'), { recursive: true });
    await writeFile(path.join(f.libraryRoot, 'data', 'learning-audio', 'generated-audio.mp3'), Buffer.from('AUDIO_MEDIA_SENTINEL'));
    await writeFile(path.join(f.libraryRoot, 'data', 'science-article-media', 'synthetic-article', 'opaque-original.bin'), Buffer.from('UNKNOWN_MEDIA_SENTINEL'));
    await writeFile(path.join(f.libraryRoot, 'data', 'science-articles.json'), JSON.stringify({ version: 1, articles: [{ id: 'article:1', title: '保存的文章阅读记录', body: 'synthetic saved article text' }] }));
    await writeFile(path.join(f.libraryRoot, 'data', 'issue-content-cache.json'), 'FULL_MAGAZINE_CONTENT_SENTINEL');
    await writeFile(path.join(f.libraryRoot, 'config', 'ai-providers.local.json'), 'SYNTHETIC_CONFIG_SECRET_SENTINEL').catch(async () => { await mkdir(path.join(f.libraryRoot, 'config')); await writeFile(path.join(f.libraryRoot, 'config', 'ai-providers.local.json'), 'SYNTHETIC_CONFIG_SECRET_SENTINEL'); });
    const output = path.join(f.out, 'Vantilo-Reader-Backup-20261030-120000.zip');
    const result = await createReaderBackupArchive({ userDataRoot: f.userDataRoot, libraryRoot: f.libraryRoot, savePath: output, browserSnapshot: browserSnapshot(), libraryIndex, apiMetadata, appVersion: '0.1.13' });
    expect(result.verified).toBe(true);
    const zip = await JSZip.loadAsync(await readFile(output));
    const names = Object.keys(zip.files).sort();
    expect(names).toContain('manifest.json'); expect(names).toContain('reader-library-index/catalog.json');
    expect(names.some(name => /(?:\.epub|private-book|private-issue|ORIGINAL_)/i.test(name))).toBe(false);
    const payload = Buffer.concat(await Promise.all(names.filter(name => !zip.files[name].dir).map(async name => Buffer.from(await zip.file(name).async('nodebuffer'))))).toString('utf8');
    expect(payload).not.toContain('ORIGINAL_BOOK_SENTINEL'); expect(payload).not.toContain('ORIGINAL_ISSUE_SENTINEL');
    expect(payload).not.toContain('FULL_MAGAZINE_CONTENT_SENTINEL'); expect(payload).not.toContain('SYNTHETIC_CONFIG_SECRET_SENTINEL');
    expect(payload).not.toContain('BOOK_MEDIA_SENTINEL'); expect(payload).not.toContain('MAGAZINE_MEDIA_SENTINEL'); expect(payload).not.toContain('AUDIO_MEDIA_SENTINEL');
    expect(payload).not.toContain('UNKNOWN_MEDIA_SENTINEL');
    expect(payload).not.toContain('SYNTHETIC_API_KEY_73fd'); expect(payload).not.toContain('SYNTHETIC_ENCRYPTED_KEY_f028');
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    expect(manifest.backupFormatVersion).toBe(1);
    expect(manifest.excludedOriginalContent.books.indexed).toEqual([{ id: 'book:synthetic', title: '合成书名', sourceFilename: 'private-book.epub', originalFileIncluded: false, originalFileStatus: 'not_backed_up' }]);
    expect(manifest.excludedOriginalContent.books.files).toContainEqual({ path: 'reader-library/books/private-book.epub', kind: 'file', originalFileIncluded: false });
    expect(manifest.excludedOriginalContent.magazines.indexed[0]).toMatchObject({ id: 'issue:synthetic', title: '合成杂志', filename: 'private-issue.epub', originalFileIncluded: false, originalFileStatus: 'not_backed_up' });
    expect(manifest.excludedOriginalContent.magazines.files).toContainEqual({ path: 'reader-library/issues/private-issue.epub', kind: 'file', originalFileIncluded: false });
    expect(manifest.excludedOriginalContent.serviceFiles).toContain('reader-library/data/issue-content-cache.json');
    expect(manifest.excludedOriginalContent.mediaFiles).toEqual(expect.arrayContaining([
      'reader-library/data/learning-materials/book-photo.png',
      'reader-library/data/science-article-media/synthetic-article/large-image.webp',
      'reader-library/data/learning-audio/generated-audio.mp3',
      'reader-library/data/science-article-media/synthetic-article/opaque-original.bin',
    ]));
    expect(manifest.recordCounts).toMatchObject({ indexedBooks: 1, indexedIssues: 1, excludedOriginalBookFiles: 1, excludedOriginalMagazineFiles: 1 });
    expect(manifest.files.map(entry => entry.path)).toContain('reader-library/data/science-articles.json');
    expect(manifest.files.some(entry => /(?:\.epub|science-article-media|learning-audio|\.webp|\.mp3)$/i.test(entry.path))).toBe(false);
    expect(manifest.excludedOriginalContent.restoreBehavior).toContain('显示内容缺失');
    expect(manifest.excludedOriginalContent.restoreBehavior).toContain('不得创建空书籍或覆盖已有阅读记录');
    expect(manifest.files.every(entry => /^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.size))).toBe(true);
    for (const entry of manifest.files) {
      const bytes = await zip.file(entry.path).async('nodebuffer');
      const { createHash } = await import('node:crypto');
      expect(bytes.length).toBe(entry.size);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    }
    const catalog = JSON.parse(await zip.file('reader-library-index/catalog.json').async('string'));
    expect(catalog.books[0]).toMatchObject({ id: 'book:synthetic', title: '合成书名', originalFileIncluded: false, originalFileStatus: 'not_backed_up', chapters: [{ id: 'chapter:1', title: '第一章' }] });
    expect(JSON.stringify(catalog)).not.toContain('ORIGINAL_BOOK_SENTINEL');
    expect(catalog.issues[0].articles).toEqual([{ id: 'article:1', title: '用户阅读记录关联', status: 'save' }]);
    expect(JSON.stringify(catalog)).not.toContain('FULL_MAGAZINE_CONTENT_SENTINEL');
    expect(safeApiMetadata(apiMetadata).profiles[0]).toEqual({ id: 'synthetic-provider', name: '测试服务', baseUrl: 'https://api.example.invalid/v1', model: 'test-model' });
  });

  it('refuses to overwrite a previous backup', async () => {
    const f = await fixture(), output = path.join(f.out, 'kept.zip');
    await writeFile(output, 'KEEP_EXISTING_BACKUP');
    await expect(createReaderBackupArchive({ userDataRoot: f.userDataRoot, libraryRoot: f.libraryRoot, savePath: output, browserSnapshot: browserSnapshot(), libraryIndex, apiMetadata, appVersion: '0.1.13' })).rejects.toMatchObject({ code: 'ERR_READER_BACKUP_EXISTS' });
    expect(await readFile(output, 'utf8')).toBe('KEEP_EXISTING_BACKUP');
    expect(await readdir(f.out)).toEqual(['kept.zip']);
  });

  it('fails closed when browser data contains a credential field', async () => {
    const f = await fixture(), output = path.join(f.out, 'never.zip');
    const snapshot = browserSnapshot(); snapshot.localStorage.data.apiKey = 'SYNTHETIC_API_KEY';
    await expect(createReaderBackupArchive({ userDataRoot: f.userDataRoot, libraryRoot: f.libraryRoot, savePath: output, browserSnapshot: snapshot, libraryIndex, apiMetadata, appVersion: '0.1.13' })).rejects.toMatchObject({ code: 'ERR_READER_BACKUP_SECRET_FIELD' });
    expect((await readdir(f.out)).filter(name => name.endsWith('.zip'))).toEqual([]);
  });
});
