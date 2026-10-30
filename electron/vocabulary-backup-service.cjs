const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const FORMAT = 'vantilo-vocabulary-backup';
const FORMAT_VERSION = 1;
const MAX_SNIPPET = 320;
const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const EXCLUSIONS = [
  '电子书、EPUB、杂志、文章全文及其图片、音频、视频等原始内容',
  '阅读进度、逐句位置、Reader 设置、普通词典缓存和临时 AI 缓存',
  'API Key 明文或密文、OAuth Token、Codex 凭据、Agent 会话与 Runtime 数据',
  'Chromium Profile、Cookie、浏览器缓存、GPU 缓存和浏览历史',
];

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalValue(item)]));
  return value;
}

function canonicalJson(value) { return JSON.stringify(canonicalValue(value)); }
function normalizeText(value) { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); }
function vocabularyCount(data) { return new Set(data.savedSelections.map(item => normalizeText(item.text)).filter(Boolean)).size; }
function assertObject(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式无效`); }
function exactKeys(value, allowed, label) {
  assertObject(value, label);
  const actual = Object.keys(value).sort(), expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label}包含未允许的字段`);
}
function string(value, max, label) { if (typeof value !== 'string' || value.length > max) throw new Error(`${label}无效`); return value; }

function validateDocumentIdentity(value, label) {
  assertObject(value, label);
  const allowed = value.kind === 'article'
    ? ['kind', 'documentId', 'issueId', 'articleId']
    : value.kind === 'book-chapter' ? ['kind', 'documentId', 'bookId', 'chapterId']
      : value.kind === 'book-lesson' ? ['kind', 'documentId', 'bookId', 'lessonId'] : [];
  if (!allowed.length) throw new Error(`${label}类型无效`);
  exactKeys(value, allowed, label);
  const source = value.kind === 'article' ? `${value.issueId}:${value.articleId}` : value.kind === 'book-chapter' ? `${value.bookId}:${value.chapterId}` : `${value.bookId}:${value.lessonId}`;
  const fields = value.kind === 'article' ? [value.issueId, value.articleId] : value.kind === 'book-chapter' ? [value.bookId, value.chapterId] : [value.bookId, value.lessonId];
  if (fields.some(item => typeof item !== 'string' || !item || item.length > 512)) throw new Error(`${label}来源标识无效`);
  const issueId = value.kind === 'article' && /^\d{4}-\d{2}-\d{2}$/.test(value.issueId) ? `economist:${value.issueId}` : value.issueId;
  const expected = value.kind === 'article' ? `reading:article:${issueId}:${value.articleId}`
    : value.kind === 'book-chapter' ? `reading:book:${value.bookId}:${value.chapterId}` : `reading:lesson:${value.bookId}:${value.lessonId}`;
  if (typeof value.documentId !== 'string' || value.documentId !== expected) throw new Error(`${label}文档 ID 与来源不匹配`);
  return value;
}

function validateSelection(value) {
  const allowed = ['id', 'document', 'articleTitle', 'text', 'context', 'paragraphIndex', 'createdAt', 'startOffset', 'usageExplanationZh', 'meaningVersion', 'translationZh', 'translationSource', 'familiarity'];
  assertObject(value, '词汇记录');
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('词汇记录包含未允许的字段');
  for (const key of ['id', 'document', 'articleTitle', 'text', 'context', 'paragraphIndex', 'createdAt', 'familiarity']) if (!(key in value)) throw new Error(`词汇记录缺少 ${key}`);
  string(value.id, 1024, '词汇 ID'); validateDocumentIdentity(value.document, '词汇来源'); string(value.articleTitle, 500, '来源名称');
  string(value.text, 2048, '词汇'); string(value.context, MAX_SNIPPET, '词汇短语境'); string(value.createdAt, 100, '创建时间');
  if (!value.id.trim() || !value.articleTitle.trim() || !value.text.trim() || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('词汇记录缺少有效标识、词形、来源名称或时间');
  if (!Number.isInteger(value.paragraphIndex) || value.paragraphIndex < 0 || ![0, 1, 2, 3, 4, 5].includes(value.familiarity)) throw new Error('词汇学习状态无效');
  if (value.startOffset !== undefined && (!Number.isInteger(value.startOffset) || value.startOffset < 0)) throw new Error('词汇位置无效');
  if (value.usageExplanationZh !== undefined) string(value.usageExplanationZh, 20000, '用户释义');
  if (value.meaningVersion !== undefined && value.meaningVersion !== 2) throw new Error('词汇释义版本无效');
  if (value.translationZh !== undefined) string(value.translationZh, 20000, '中文释义');
  if (value.translationSource !== undefined && !['auto', 'dictionary', 'user'].includes(value.translationSource)) throw new Error('释义来源无效');
  return value;
}

function validateContext(value) {
  const allowed = ['key', 'document', 'paragraphIndex', 'startOffset', 'text', 'paragraph', 'sentence', 'generatedAt', 'meaningSource', 'editedAt', 'meaningVersion', 'sentenceTranslationZh', 'meaningZh', 'explanationZh', 'meaningEn', 'explanationEn', 'examplesEn', 'partOfSpeech', 'model', 'provider'];
  assertObject(value, '语境释义');
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('语境释义包含未允许的字段');
  const required = ['key', 'document', 'paragraphIndex', 'startOffset', 'text', 'paragraph', 'sentence', 'generatedAt', 'meaningZh', 'explanationZh', 'meaningEn', 'explanationEn', 'examplesEn', 'partOfSpeech', 'model', 'provider'];
  for (const key of required) if (!(key in value)) throw new Error(`语境释义缺少 ${key}`);
  validateDocumentIdentity(value.document, '语境来源');
  for (const [key, max] of Object.entries({ key: 2048, text: 2048, paragraph: MAX_SNIPPET, sentence: MAX_SNIPPET, generatedAt: 100, meaningZh: 20000, explanationZh: 20000, meaningEn: 20000, explanationEn: 20000, partOfSpeech: 120, model: 200 })) string(value[key], max, `语境释义 ${key}`);
  if (!value.key.trim() || !value.text.trim() || !Number.isFinite(Date.parse(value.generatedAt))) throw new Error('语境释义标识或时间无效');
  if (!Number.isInteger(value.paragraphIndex) || value.paragraphIndex < 0 || !Number.isInteger(value.startOffset) || value.startOffset < 0) throw new Error('语境释义位置无效');
  if (!Array.isArray(value.examplesEn) || value.examplesEn.length > 20) throw new Error('语境例句无效');
  value.examplesEn.forEach(item => string(item, 1000, '语境例句'));
  if (value.provider !== 'easycliproxy') throw new Error('语境服务标识无效');
  if (value.meaningSource !== undefined && !['ai', 'user'].includes(value.meaningSource)) throw new Error('语境释义来源无效');
  if (value.editedAt !== undefined) string(value.editedAt, 100, '释义编辑时间');
  if (value.meaningVersion !== undefined && value.meaningVersion !== 2) throw new Error('语境释义版本无效');
  if (value.sentenceTranslationZh !== undefined) string(value.sentenceTranslationZh, 20000, '句子译文');
  const target = encodeURIComponent(normalizeText(value.text));
  const expectedKey = `${value.document.documentId}:${value.paragraphIndex}:${value.startOffset}:${target}`;
  if (value.key !== expectedKey) throw new Error('语境释义来源键与记录不匹配');
  return value;
}

function validateSchedule(value) {
  exactKeys(value, ['key', 'text', 'familiarity', 'intervalDays', 'reviewCount', 'lastReviewedAt', 'dueAt'], '复习记录');
  string(value.text, 2048, '复习词汇'); string(value.key, 2048, '复习键');
  if (!value.text.trim()) throw new Error('复习词汇不能为空');
  if (value.key !== normalizeText(value.text) || ![1, 2, 3, 4].includes(value.familiarity)
    || typeof value.intervalDays !== 'number' || !Number.isFinite(value.intervalDays) || value.intervalDays < 0
    || !Number.isInteger(value.reviewCount) || value.reviewCount < 0
    || !Number.isFinite(Date.parse(value.lastReviewedAt)) || !Number.isFinite(Date.parse(value.dueAt))) throw new Error('复习记录无效');
  string(value.lastReviewedAt, 100, '上次复习时间'); string(value.dueAt, 100, '下次复习时间');
  return value;
}

function sanitizeVocabularySnapshot(snapshot) {
  assertObject(snapshot, '词汇快照');
  exactKeys(snapshot, ['savedSelections', 'contextualMeanings', 'reviewSchedules'], '词汇快照');
  if (!Array.isArray(snapshot.savedSelections) || snapshot.savedSelections.length > 500
    || !Array.isArray(snapshot.contextualMeanings) || snapshot.contextualMeanings.length > 2000
    || !Array.isArray(snapshot.reviewSchedules) || snapshot.reviewSchedules.length > 2000) throw new Error('词汇快照记录数量超出限制');
  snapshot.savedSelections.forEach(validateSelection); snapshot.contextualMeanings.forEach(validateContext); snapshot.reviewSchedules.forEach(validateSchedule);
  return snapshot;
}

function createDocument({ snapshot, appVersion, createdAt = new Date().toISOString() }) {
  const data = sanitizeVocabularySnapshot(snapshot);
  string(appVersion, 100, '应用版本');
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('备份创建时间无效');
  const payload = {
    format: FORMAT,
    backupFormatVersion: FORMAT_VERSION,
    appVersion,
    createdAt,
    counts: { vocabulary: vocabularyCount(data), savedSelections: data.savedSelections.length, contextualMeanings: data.contextualMeanings.length, reviewSchedules: data.reviewSchedules.length },
    exclusions: EXCLUSIONS,
    data,
  };
  const canonical = canonicalJson(payload);
  const document = { ...payload, integrity: { algorithm: 'SHA-256', sha256: crypto.createHash('sha256').update(canonical).digest('hex'), payloadBytes: Buffer.byteLength(canonical), fileBytes: 0 } };
  let fileBytes = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const size = Buffer.byteLength(JSON.stringify({ ...document, integrity: { ...document.integrity, fileBytes } }, null, 2) + '\n');
    if (size === fileBytes) break;
    fileBytes = size;
  }
  document.integrity.fileBytes = fileBytes;
  if (fileBytes > MAX_BACKUP_BYTES) throw new Error('词汇备份超过 25 MB 安全上限；未创建文件或修改本机词汇。');
  return document;
}

function verifyDocument(document, serialized) {
  assertObject(document, '备份文件');
  exactKeys(document, ['format', 'backupFormatVersion', 'appVersion', 'createdAt', 'counts', 'exclusions', 'data', 'integrity'], '备份文件');
  if (document.format !== FORMAT || document.backupFormatVersion !== FORMAT_VERSION) throw new Error('词汇备份格式不受支持');
  const data = sanitizeVocabularySnapshot(document.data);
  if (!document.counts || typeof document.counts !== 'object' || Array.isArray(document.counts)) throw new Error('备份数量清单无效');
  exactKeys(document.counts, ['vocabulary', 'savedSelections', 'contextualMeanings', 'reviewSchedules'], '备份数量清单');
  const expected = { vocabulary: vocabularyCount(data), savedSelections: data.savedSelections.length, contextualMeanings: data.contextualMeanings.length, reviewSchedules: data.reviewSchedules.length };
  if (Object.keys(expected).some(key => document.counts[key] !== expected[key])) throw new Error('备份数量清单与数据不一致');
  if (!Array.isArray(document.exclusions) || canonicalJson(document.exclusions) !== canonicalJson(EXCLUSIONS)) throw new Error('备份范围清单不匹配');
  const integrity = document.integrity;
  if (!integrity || typeof integrity !== 'object' || Array.isArray(integrity)) throw new Error('备份完整性信息缺失');
  exactKeys(integrity, ['algorithm', 'sha256', 'payloadBytes', 'fileBytes'], '完整性信息');
  const payload = { format: document.format, backupFormatVersion: document.backupFormatVersion, appVersion: document.appVersion, createdAt: document.createdAt, counts: document.counts, exclusions: document.exclusions, data };
  const canonical = canonicalJson(payload);
  const digest = crypto.createHash('sha256').update(canonical).digest('hex');
  if (integrity.algorithm !== 'SHA-256' || integrity.sha256 !== digest || integrity.payloadBytes !== Buffer.byteLength(canonical)) throw new Error('备份 SHA-256 或数据长度校验失败');
  if (serialized && integrity.fileBytes !== Buffer.byteLength(serialized)) throw new Error('备份文件大小校验失败');
  return { data, sha256: digest };
}

function formatVocabularyBackupFilename(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `Vantilo-Vocabulary-Backup-${stamp}.json`;
}

async function writeVocabularyBackupAtomic({ savePath, document, fsApi = fs }) {
  const finalPath = path.resolve(savePath);
  if (path.extname(finalPath).toLowerCase() !== '.json') throw new Error('词汇备份必须保存为 .json 文件');
  const directory = path.dirname(finalPath);
  const directoryStat = await fsApi.stat(directory);
  if (!directoryStat.isDirectory()) throw new Error('备份保存位置不是文件夹');
  await fsApi.access(directory, require('node:fs').constants.W_OK);
  const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n', 'utf8');
  verifyDocument(document, bytes.toString('utf8'));
  if (bytes.length > MAX_BACKUP_BYTES) throw new Error('词汇备份超过 25 MB 安全上限；未创建文件或修改本机词汇。');
  if (bytes.length !== document.integrity.fileBytes) throw new Error('备份文件大小计算不一致');
  if (typeof fsApi.statfs === 'function') {
    const space = await fsApi.statfs(directory);
    const free = Number(space.bavail) * Number(space.bsize);
    if (Number.isFinite(free) && free < bytes.length + Math.min(bytes.length, 1024 * 1024)) throw new Error('所选磁盘空间不足，未创建备份文件。');
  }
  try { await fsApi.lstat(finalPath); throw new Error('该位置已存在同名备份；为避免覆盖，请选择其他文件名。'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${finalPath}.${crypto.randomUUID()}.partial`;
  let handle;
  let linkedIdentity;
  try {
    handle = await fsApi.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    const temporaryStat = await handle.stat();
    linkedIdentity = { dev: temporaryStat.dev, ino: temporaryStat.ino };
    await handle.close(); handle = null;
    await fsApi.link(temporary, finalPath);
    await fsApi.unlink(temporary);
    try { const directoryHandle = await fsApi.open(directory, 'r'); await directoryHandle.sync(); await directoryHandle.close(); } catch { /* Some filesystems do not allow syncing a directory handle. */ }
    const written = await fsApi.readFile(finalPath, 'utf8');
    const checked = verifyDocument(JSON.parse(written), written);
    if (checked.sha256 !== document.integrity.sha256) throw new Error('写入后的备份校验失败');
    return { path: finalPath, name: path.basename(finalPath), size: Buffer.byteLength(written), sha256: checked.sha256 };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fsApi.unlink(temporary).catch(() => {});
    if (linkedIdentity) {
      try {
        const finalStat = await fsApi.lstat(finalPath);
        if (finalStat.dev === linkedIdentity.dev && finalStat.ino === linkedIdentity.ino) await fsApi.unlink(finalPath);
      } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError; }
    }
    throw error;
  }
}

module.exports = { FORMAT, FORMAT_VERSION, MAX_BACKUP_BYTES, EXCLUSIONS, canonicalJson, createVocabularyBackupDocument: createDocument, verifyVocabularyBackupDocument: verifyDocument, formatVocabularyBackupFilename, writeVocabularyBackupAtomic, sanitizeVocabularySnapshot };
