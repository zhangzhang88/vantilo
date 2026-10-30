import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  createVocabularyBackupDocument,
  verifyVocabularyBackupDocument,
  writeVocabularyBackupAtomic,
  formatVocabularyBackupFilename,
} = require('../electron/vocabulary-backup-service.cjs');

const temporaryDirectories = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vantilo-vocabulary-backup-'));
  temporaryDirectories.push(directory); return directory;
}
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

const document = { kind: 'book-chapter', bookId: 'fixture-book', chapterId: 'chapter-1', documentId: 'reading:book:fixture-book:chapter-1' };
const selection = {
  id: 'fixture-selection', document, articleTitle: '合成测试书', text: 'meaning', context: 'A short synthetic context.', paragraphIndex: 2,
  startOffset: 7, createdAt: '2026-10-01T00:00:00.000Z', translationZh: '含义', translationSource: 'user', usageExplanationZh: '合成笔记', familiarity: 2,
};
const snapshot = { savedSelections: [selection], contextualMeanings: [], reviewSchedules: [] };

describe('vocabulary backup main-process file service', () => {
  it('creates a versioned vocabulary-only manifest with a non-self-referential digest', () => {
    const backup = createVocabularyBackupDocument({ snapshot, appVersion: '0.1.13', createdAt: '2026-10-30T00:00:00.000Z' });
    expect(backup).toMatchObject({ format: 'vantilo-vocabulary-backup', backupFormatVersion: 1, appVersion: '0.1.13', counts: { vocabulary: 1, savedSelections: 1 } });
    expect(verifyVocabularyBackupDocument(backup).sha256).toBe(backup.integrity.sha256);
  });

  it('rejects credential fields and unknown payload keys before creating an export', () => {
    expect(() => createVocabularyBackupDocument({ snapshot: { ...snapshot, apiKey: 'synthetic-key' }, appVersion: '0.1.13' })).toThrow('未允许的字段');
    expect(() => createVocabularyBackupDocument({ snapshot: { savedSelections: [{ ...selection, encryptedApiKey: 'synthetic-ciphertext' }], contextualMeanings: [], reviewSchedules: [] }, appVersion: '0.1.13' })).toThrow('未允许的字段');
  });

  it('writes through a same-directory temporary file and atomically rejects overwrite', async () => {
    const directory = await temporaryDirectory();
    const backup = createVocabularyBackupDocument({ snapshot, appVersion: '0.1.13', createdAt: '2026-10-30T00:00:00.000Z' });
    const output = path.join(directory, 'Vantilo-Vocabulary-Backup-20261030-000000.json');
    const written = await writeVocabularyBackupAtomic({ savePath: output, document: backup });
    expect(written).toMatchObject({ name: path.basename(output), size: backup.integrity.fileBytes, sha256: backup.integrity.sha256 });
    expect(verifyVocabularyBackupDocument(JSON.parse(await readFile(output, 'utf8')), await readFile(output, 'utf8')).sha256).toBe(backup.integrity.sha256);
    await expect(writeVocabularyBackupAtomic({ savePath: output, document: backup })).rejects.toThrow('同名备份');
    expect((await readdir(directory)).filter(name => name.endsWith('.partial'))).toEqual([]);
  });

  it('rejects bad extensions, corrupted data and wrong saved size', async () => {
    const directory = await temporaryDirectory();
    const backup = createVocabularyBackupDocument({ snapshot, appVersion: '0.1.13' });
    await expect(writeVocabularyBackupAtomic({ savePath: path.join(directory, 'backup.zip'), document: backup })).rejects.toThrow('.json');
    const serialized = JSON.stringify(backup, null, 2) + '\n';
    expect(() => verifyVocabularyBackupDocument({ ...backup, data: { ...backup.data, savedSelections: [] } })).toThrow('清单与数据不一致');
    expect(() => verifyVocabularyBackupDocument(backup, serialized + ' ')).toThrow('文件大小校验失败');
  });

  it('uses the required timestamped JSON filename and preserves UTF-8 content', async () => {
    const date = new Date(2026, 9, 30, 15, 4, 7);
    expect(formatVocabularyBackupFilename(date)).toBe('Vantilo-Vocabulary-Backup-20261030-150407.json');
    const directory = await temporaryDirectory();
    const backup = createVocabularyBackupDocument({ snapshot, appVersion: '0.1.13', createdAt: '2026-10-30T00:00:00.000Z' });
    const written = await writeVocabularyBackupAtomic({ savePath: path.join(directory, formatVocabularyBackupFilename(date)), document: backup });
    expect(await readFile(written.path, 'utf8')).toContain('含义');
  });
});
