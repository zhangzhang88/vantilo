'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');
const JSZip = require('jszip');

const FORMAT_VERSION = 1;
const MAX_BROWSER_SNAPSHOT_BYTES = 96 * 1024 * 1024;
const SECRET_FIELD = /^(?:api.?key|access.?token|refresh.?token|oauth.?token|password|secret|authorization|cookie|encrypted.?api.?key|ciphertext)$/i;
const STRUCTURED_DATA_DIRECTORIES = new Set(['learning-materials']);
const EXCLUDED_MEDIA_DIRECTORIES = new Set(['learning-audio', 'science-article-media']);
const ALLOWED_DATA_FILES = new Set(['section-translations.json', 'guide-preparation-status.json', 'book-categories.json', 'book-toc-chinese.json', 'science-articles.json', 'science-article-auto-import.json', 'vantilo-magazine-sync.json', 'vantilo-magazine-sync.json.preferences.json']);
const EXCLUDED_DATA_FILE = /(?:codex|oauth|credential|secret|token|api.?provider|auth|system-dictionary-cache|\.tmp$|\.partial$)/i;
const ORIGINAL_BOOK_FILE = /\.(?:epub|zip|cbz|pdf|djvu)$/i;
const ORIGINAL_MEDIA_FILE = /\.(?:png|apng|jpe?g|gif|webp|avif|heic|heif|bmp|tiff?|svgz?|psd|raw|mp3|m4a|m4b|aac|wav|wma|ogg|opus|flac|aiff?|caf|amr|mp4|m4v|mov|mkv|webm|avi|mpg|mpeg|3gp|3g2|ts|m2ts|wmv)$/i;

function fail(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

function assertPlainReaderData(value, label, depth = 0) {
  if (depth > 48) throw fail('ERR_READER_BACKUP_DATA', `${label} 嵌套过深，已停止备份`);
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (Array.isArray(value)) { for (const item of value) assertPlainReaderData(item, label, depth + 1); return; }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw fail('ERR_READER_BACKUP_DATA', `${label} 含有不支持的数据类型`);
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) throw fail('ERR_READER_BACKUP_SECRET_FIELD', `${label} 检测到敏感字段“${key}”，已停止备份`);
    assertPlainReaderData(item, label, depth + 1);
  }
}

function safeApiMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('ERR_READER_BACKUP_API_METADATA', 'Reader API 配置摘要格式无效');
  const cleanProfile = item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.baseUrl !== 'string' || typeof item.model !== 'string') {
      throw fail('ERR_READER_BACKUP_API_METADATA', 'Reader API 配置摘要不完整');
    }
    // Deliberately select the public, non-secret fields; never spread the source object.
    return { id: item.id, name: item.name, baseUrl: item.baseUrl, model: item.model };
  };
  const profiles = Array.isArray(value.profiles) ? value.profiles.map(cleanProfile) : [];
  return { version: 1, configured: value.configured === true, activeId: typeof value.activeId === 'string' ? value.activeId : '', profiles };
}

function validateBrowserSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.origins) || !snapshot.localStorage || !Array.isArray(snapshot.indexedDB)) {
    throw fail('ERR_READER_BACKUP_SNAPSHOT', 'Reader 浏览器数据快照格式无效');
  }
  const serialized = JSON.stringify(snapshot);
  if (Buffer.byteLength(serialized) > MAX_BROWSER_SNAPSHOT_BYTES) throw fail('ERR_READER_BACKUP_SNAPSHOT_TOO_LARGE', 'Reader 浏览器数据超过安全导出上限（96 MB）');
  assertPlainReaderData(snapshot.localStorage, 'Reader localStorage');
  assertPlainReaderData(snapshot.indexedDB, 'Reader IndexedDB');
  if (snapshot.excludedIndexedDbBlobs !== undefined && (!Array.isArray(snapshot.excludedIndexedDbBlobs) || snapshot.excludedIndexedDbBlobs.some(item => !item || typeof item.mimeType !== 'string' || !Number.isSafeInteger(item.size) || item.size < 0))) {
    throw fail('ERR_READER_BACKUP_SNAPSHOT', 'IndexedDB 排除资源清单格式无效');
  }
  if (snapshot.origins.some(origin => typeof origin !== 'string' || !(origin === 'file://' || /^https?:\/\/(?:127\.0\.0\.1(?::\d+)?|localhost(?::\d+)?)$/.test(origin)))) {
    throw fail('ERR_READER_BACKUP_ORIGIN', '快照包含未授权的浏览器来源');
  }
  return serialized;
}

async function hashFile(file) {
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); size += chunk.length; }
  return { size, sha256: hash.digest('hex') };
}

async function walkTree(root, relativeRoot, entries, { signal, countBytes, excludedFiles }) {
  const visit = async relative => {
    signal?.throwIfAborted();
    const full = path.join(root, relative);
    const info = await fs.lstat(full);
    if (info.isSymbolicLink()) throw fail('ERR_READER_BACKUP_SYMLINK', `Reader 数据包含符号链接，无法安全备份：${relative}`);
    if (info.isDirectory()) {
      for (const name of (await fs.readdir(full)).sort()) {
        if (!name || name.startsWith('.') || name.endsWith('.tmp') || name.endsWith('.partial')) continue;
        await visit(path.join(relative, name));
      }
      return;
    }
    if (!info.isFile()) throw fail('ERR_READER_BACKUP_FILE_TYPE', `Reader 数据包含不支持的文件：${relative}`);
    if (ORIGINAL_BOOK_FILE.test(relative) || ORIGINAL_MEDIA_FILE.test(relative)) {
      excludedFiles.push(path.posix.join(relativeRoot, relative.split(path.sep).join('/'))); return;
    }
    if (relativeRoot.endsWith('/learning-materials') && !/\.json$/i.test(relative)) {
      excludedFiles.push(path.posix.join(relativeRoot, relative.split(path.sep).join('/'))); return;
    }
    entries.push({ source: full, relative: path.posix.join(relativeRoot, relative.split(path.sep).join('/')), sourceStat: info, category: relativeRoot });
    countBytes.bytes += info.size;
  };
  await visit('');
}

async function collectReaderLibrary(libraryRoot) {
  const entries = []; const countBytes = { bytes: 0 }; const excludedFiles = [];
  // Original EPUBs and their bundled media are deliberately never opened,
  // copied, compressed, or hashed by this backup path.
  const dataRoot = path.join(libraryRoot, 'data');
  let dataNames = [];
  try {
    const dataInfo = await fs.lstat(dataRoot);
    if (!dataInfo.isDirectory() || dataInfo.isSymbolicLink()) throw fail('ERR_READER_BACKUP_SYMLINK', 'Reader data 目录无效，已停止备份');
    dataNames = await fs.readdir(dataRoot);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of dataNames.sort()) {
    if (name.startsWith('.')) continue;
    if (EXCLUDED_DATA_FILE.test(name)) { excludedFiles.push(`reader-library/data/${name}`); continue; }
    const full = path.join(dataRoot, name); const info = await fs.lstat(full);
    if (info.isSymbolicLink()) throw fail('ERR_READER_BACKUP_SYMLINK', `Reader 数据包含符号链接，无法安全备份：data/${name}`);
    if (info.isDirectory()) {
      if (EXCLUDED_MEDIA_DIRECTORIES.has(name)) {
        excludedFiles.push(...(await inventoryExcludedTree(full, `reader-library/data/${name}`)).map(item => item.path));
        continue;
      }
      if (!STRUCTURED_DATA_DIRECTORIES.has(name)) {
        excludedFiles.push(...(await inventoryExcludedTree(full, `reader-library/data/${name}`)).map(item => item.path));
        if (!(await fs.readdir(full)).length) excludedFiles.push(`reader-library/data/${name}/（空目录）`);
        continue;
      }
      await walkTree(full, `reader-library/data/${name}`, entries, { countBytes, excludedFiles });
    } else if (info.isFile() && ALLOWED_DATA_FILES.has(name) && !ORIGINAL_BOOK_FILE.test(name)) {
      entries.push({ source: full, relative: `reader-library/data/${name}`, sourceStat: info, category: `data/${name}` }); countBytes.bytes += info.size;
    } else if (info.isFile()) excludedFiles.push(`reader-library/data/${name}`);
  }
  return { entries, totalBytes: countBytes.bytes, excludedFiles };
}

async function inventoryExcludedTree(root, category) {
  const files = [];
  const visit = async relative => {
    const full = path.join(root, relative);
    let info;
    try { info = await fs.lstat(full); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) { files.push({ path: path.posix.join(category, relative.split(path.sep).join('/')), kind: 'symlink', originalFileIncluded: false }); return; }
    if (info.isDirectory()) {
      for (const name of (await fs.readdir(full)).sort()) await visit(path.join(relative, name));
      return;
    }
    files.push({ path: path.posix.join(category, relative.split(path.sep).join('/')), kind: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', originalFileIncluded: false });
  };
  await visit('');
  return files;
}

async function copyAndHash(source, target, expectedStat, signal) {
  const before = await fs.lstat(source);
  if (!before.isFile() || before.isSymbolicLink() || before.dev !== expectedStat.dev || before.ino !== expectedStat.ino) throw fail('ERR_READER_BACKUP_SOURCE_CHANGED', `备份期间源文件身份发生变化：${source}`);
  const hash = createHash('sha256'); let size = 0;
  const { Transform } = require('node:stream');
  const meter = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); size += chunk.length; callback(null, chunk); } });
  await pipeline(createReadStream(source), meter, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
  const after = await fs.lstat(source);
  if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino || after.dev !== before.dev) throw fail('ERR_READER_BACKUP_SOURCE_CHANGED', `备份期间源文件内容发生变化：${source}`);
  return { size, sha256: hash.digest('hex') };
}

function runZipVerifier(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/unzip', ['-tq', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errorText = ''; child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { errorText += chunk.slice(0, 500); });
    child.once('error', error => reject(fail('ERR_READER_BACKUP_ZIP_VERIFY', '无法运行系统 ZIP 完整性检查', error)));
    child.once('exit', code => code === 0 ? resolve() : reject(fail('ERR_READER_BACKUP_ZIP_VERIFY', `ZIP 完整性检查失败${errorText ? `：${errorText.trim()}` : ''}`)));
  });
}

function readZipEntry(file, entryPath, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/unzip', ['-p', file, entryPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let size = 0; let errorText = '';
    child.stdout.on('data', chunk => { size += chunk.length; if (size > limit) { child.kill('SIGTERM'); reject(fail('ERR_READER_BACKUP_ZIP_VERIFY', `ZIP 内的 ${entryPath} 超出验证读取上限`)); return; } chunks.push(chunk); });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { errorText += chunk.slice(0, 500); });
    child.once('error', error => reject(fail('ERR_READER_BACKUP_ZIP_VERIFY', `无法读取 ZIP 条目 ${entryPath}`, error)));
    child.once('exit', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(fail('ERR_READER_BACKUP_ZIP_VERIFY', `ZIP 条目读取失败：${entryPath}${errorText ? `：${errorText.trim()}` : ''}`)));
  });
}

function verifyZipEntry(file, expected) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/unzip', ['-p', file, expected.path], { stdio: ['ignore', 'pipe', 'pipe'] });
    const hash = createHash('sha256'); let size = 0; let errorText = '';
    child.stdout.on('data', chunk => { size += chunk.length; hash.update(chunk); });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { errorText += chunk.slice(0, 500); });
    child.once('error', error => reject(fail('ERR_READER_BACKUP_ZIP_VERIFY', `无法验证 ZIP 条目 ${expected.path}`, error)));
    child.once('exit', code => {
      if (code !== 0) return reject(fail('ERR_READER_BACKUP_ZIP_VERIFY', `ZIP 条目验证失败：${expected.path}${errorText ? `：${errorText.trim()}` : ''}`));
      const actual = hash.digest('hex');
      if (size !== expected.size || actual !== expected.sha256) return reject(fail('ERR_READER_BACKUP_ZIP_HASH', `ZIP 内数据校验失败：${expected.path}`));
      resolve();
    });
  });
}

async function verifyZipManifest(file, expectedManifest) {
  const raw = await readZipEntry(file, 'manifest.json');
  let actual;
  try { actual = JSON.parse(raw.toString('utf8')); }
  catch (error) { throw fail('ERR_READER_BACKUP_ZIP_VERIFY', 'ZIP 中的 manifest.json 无法解析', error); }
  if (JSON.stringify(actual) !== JSON.stringify(expectedManifest)) throw fail('ERR_READER_BACKUP_ZIP_VERIFY', 'ZIP 中的 manifest.json 与待验清单不一致');
  for (const entry of actual.files) await verifyZipEntry(file, entry);
}

async function createReaderBackupArchive({ userDataRoot, libraryRoot, savePath, browserSnapshot, libraryIndex, apiMetadata, appVersion, signal, onProgress = () => {} }) {
  if (typeof userDataRoot !== 'string' || !path.isAbsolute(userDataRoot) || typeof libraryRoot !== 'string' || !path.isAbsolute(libraryRoot)) throw fail('ERR_READER_BACKUP_PATH', 'Reader 数据路径无效');
  if (typeof savePath !== 'string' || !path.isAbsolute(savePath) || path.extname(savePath).toLowerCase() !== '.zip') throw fail('ERR_READER_BACKUP_PATH', '备份文件路径无效');
  signal?.throwIfAborted();
  const browserJson = validateBrowserSnapshot(browserSnapshot);
  if (!libraryIndex || libraryIndex.version !== 1 || !Array.isArray(libraryIndex.books) || !Array.isArray(libraryIndex.issues)) throw fail('ERR_READER_BACKUP_INDEX', 'Reader 书库索引快照格式无效');
  assertPlainReaderData(libraryIndex, 'Reader 书库索引');
  const restorableIndex = {
    version: 1,
    books: libraryIndex.books.map(item => ({
      id: item.id, sourceFilename: item.sourceFilename, title: item.title,
      authors: Array.isArray(item.authors) ? item.authors : [], language: item.language ?? null,
      publisher: item.publisher ?? null, publishedAt: item.publishedAt ?? null,
      partCount: item.partCount ?? 0,
      parts: Array.isArray(item.parts) ? item.parts.map(part => ({ id: part.id, title: part.title, order: part.order, chapterIds: Array.isArray(part.chapterIds) ? part.chapterIds : [] })) : [],
      chapters: Array.isArray(item.chapters) ? item.chapters.map(chapter => ({ id: chapter.id, partId: chapter.partId ?? null, order: chapter.order, role: chapter.role, title: chapter.title, wordCount: chapter.wordCount })) : [],
      indexAvailable: item.indexAvailable === true,
      originalFileIncluded: false, originalFileStatus: 'not_backed_up',
    })),
    issues: libraryIndex.issues.map(item => ({
      id: item.id, publicationId: item.publicationId, publicationName: item.publicationName,
      filename: item.filename, title: item.title, date: item.date, label: item.label,
      sections: Array.isArray(item.sections) ? item.sections : [], articleCount: item.articleCount ?? 0,
      articles: Array.isArray(item.articles) ? item.articles.map(article => ({ id: article.id, title: article.title, status: article.status ?? null })) : [],
      indexAvailable: item.indexAvailable === true, originalFileIncluded: false, originalFileStatus: 'not_backed_up',
    })),
  };
  const indexJson = JSON.stringify(restorableIndex, null, 2) + '\n';
  const apiJson = JSON.stringify(safeApiMetadata(apiMetadata), null, 2) + '\n';
  const library = await collectReaderLibrary(libraryRoot);
  const excludedBookFiles = await inventoryExcludedTree(path.join(libraryRoot, 'books'), 'reader-library/books');
  const excludedIssueFiles = await inventoryExcludedTree(path.join(libraryRoot, 'issues'), 'reader-library/issues');
  const excludedOriginalMedia = [
    ...excludedBookFiles,
    ...excludedIssueFiles,
    ...library.excludedFiles.map(file => ({ path: file, kind: 'file', originalFileIncluded: false })),
  ].filter(item => item.kind === 'file' && (ORIGINAL_MEDIA_FILE.test(item.path) || /reader-library\/data\/(?:learning-audio|science-article-media)\//.test(item.path))).map(({ path: filePath }) => filePath).sort();
  const required = library.totalBytes + Buffer.byteLength(browserJson) + Buffer.byteLength(indexJson) + Buffer.byteLength(apiJson) + 16 * 1024 * 1024;
  const parent = path.dirname(savePath); const canonicalParent = await fs.realpath(parent);
  const finalPath = path.join(canonicalParent, path.basename(savePath));
  const dirStat = await fs.stat(parent); if (!dirStat.isDirectory()) throw fail('ERR_READER_BACKUP_PATH', '保存位置不是目录');
  const fsInfo = await fs.statfs(canonicalParent);
  if (fsInfo.bavail * fsInfo.bsize < required * 2) throw fail('ERR_READER_BACKUP_NO_SPACE', '保存位置剩余空间不足，未创建备份');
  try { await fs.access(canonicalParent, require('node:fs').constants.W_OK); } catch (error) { throw fail('ERR_READER_BACKUP_UNWRITABLE', '保存位置不可写', error); }
  try { await fs.lstat(finalPath); throw fail('ERR_READER_BACKUP_EXISTS', '该位置已存在同名备份，未覆盖原文件'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const staging = await fs.mkdtemp(path.join(canonicalParent, '.vantilo-reader-backup-'));
  const partial = `${finalPath}.${randomUUID()}.partial`;
  const records = [];
  const writeJson = async (relative, value, category) => {
    const target = path.join(staging, ...relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const bytes = Buffer.from(value); await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
    if (category !== 'manifest') records.push({ path: relative, category, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  };
  try {
    onProgress({ phase: 'SNAPSHOTTING', progress: 0, message: '正在导出阅读数据' });
    await writeJson('reader-storage/localStorage.json', JSON.stringify(browserSnapshot.localStorage), 'browser-localStorage');
    await writeJson('reader-storage/indexeddb.json', JSON.stringify({ origins: browserSnapshot.origins, databases: browserSnapshot.indexedDB }), 'browser-indexedDB');
    await writeJson('reader-library-index/catalog.json', indexJson, 'reader-library-index');
    await writeJson('reader-preferences/custom-api-services.json', apiJson, 'reader-api-nonsecret-metadata');
    let done = 0;
    for (const item of library.entries) {
      signal?.throwIfAborted();
      const target = path.join(staging, ...item.relative.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const integrity = await copyAndHash(item.source, target, item.sourceStat, signal);
      records.push({ path: item.relative, category: item.category, ...integrity });
      done++;
      onProgress({ phase: 'SNAPSHOTTING', progress: library.entries.length ? Math.round(done / library.entries.length * 100) : 100, message: '正在导出 Reader 书库和服务文件' });
    }
    await writeJson('integrity/README.txt', 'manifest.json 列出所有数据文件及 integrity/README.txt 的字节数和 SHA-256；manifest.json 自身由 ZIP CRC 和最终 ZIP SHA-256 保护。原始书刊文件明确不包含。Reader API 凭据不包含在本普通备份中。\n', 'integrity');
    records.sort((a,b) => a.path.localeCompare(b.path));
    const manifest = {
      format: 'vantilo-reader-backup', backupFormatVersion: FORMAT_VERSION,
      appVersion: typeof appVersion === 'string' ? appVersion : 'unknown', createdAt: new Date().toISOString(),
      storageOrigins: [...new Set(browserSnapshot.origins)].sort(),
      dataCategories: [...new Set(records.map(item => item.category))].sort(),
      schemaVersions: { readerLocalStorage: browserSnapshot.localStorage?.version ?? null, indexedDB: 1, readerServiceFiles: 1 },
      recordCounts: {
        localStorageKeys: Object.keys(browserSnapshot.localStorage?.data || {}).length,
        indexedDBDatabases: browserSnapshot.indexedDB.length,
        readerServiceFiles: library.entries.length,
        indexedBooks: libraryIndex.books.length,
        indexedIssues: libraryIndex.issues.length,
        excludedOriginalBookFiles: excludedBookFiles.filter(item => item.kind === 'file').length,
        excludedOriginalMagazineFiles: excludedIssueFiles.filter(item => item.kind === 'file').length,
        excludedOriginalMediaFiles: excludedOriginalMedia.length,
      },
      files: records,
      excluded: ['所有电子书、EPUB、下载的杂志原始文件及文章原始内容；不复制、不压缩、不迁移、不计算内容 SHA-256', '书籍和杂志附带的大型图片、音频、视频及其他原始资源；仅在排除清单列出路径，不计为备份文件', 'Agent 会话与项目管理数据', 'Codex Runtime、CLI 数据及 OAuth 凭据', 'Chromium Cookie、缓存、浏览历史和 GPU 缓存', 'Reader API Key 明文与密文', 'Keychain 内容', 'Reader config/ 下未分类配置', '下载中的临时文件与符号链接'],
      excludedOriginalContent: {
        books: { indexed: restorableIndex.books.map(({ id, title, sourceFilename }) => ({ id, title, sourceFilename, originalFileIncluded: false, originalFileStatus: 'not_backed_up' })), files: excludedBookFiles },
        magazines: { indexed: restorableIndex.issues.map(({ id, publicationId, publicationName, title, filename }) => ({ id, publicationId, publicationName, title, filename, originalFileIncluded: false, originalFileStatus: 'not_backed_up' })), files: excludedIssueFiles },
        serviceFiles: library.excludedFiles,
        mediaFiles: excludedOriginalMedia,
        restoreBehavior: '保留原书籍和杂志索引、内部 ID、文件名及阅读记录关联。恢复后若原始文件不存在，应显示内容缺失并允许用户重新导入或关联；不得创建空书籍或覆盖已有阅读记录。',
        indexedDbBlobs: Array.isArray(browserSnapshot.excludedIndexedDbBlobs) ? browserSnapshot.excludedIndexedDbBlobs : [],
      },
    };
    await writeJson('manifest.json', JSON.stringify(manifest, null, 2) + '\n', 'manifest');
    onProgress({ phase: 'VERIFYING', progress: 0, message: '正在生成备份文件' });
    const zip = new JSZip();
    for (const entry of records) zip.file(entry.path, createReadStream(path.join(staging, ...entry.path.split('/'))), { binary: true, date: new Date() });
    zip.file('manifest.json', createReadStream(path.join(staging, 'manifest.json')), { binary: true });
    const stream = zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 1 } });
    const output = createWriteStream(partial, { flags: 'wx', mode: 0o600 });
    await pipeline(stream, output, { signal });
    signal?.throwIfAborted();
    onProgress({ phase: 'VERIFYING', progress: 80, message: '正在验证 ZIP 完整性' });
    await runZipVerifier(partial);
    await verifyZipManifest(partial, manifest);
    const zipIntegrity = await hashFile(partial);
    signal?.throwIfAborted();
    if (await fs.realpath(parent) !== canonicalParent) throw fail('ERR_READER_BACKUP_PATH', '保存目录在备份期间发生变化，已停止提交');
    try { await fs.lstat(finalPath); throw fail('ERR_READER_BACKUP_EXISTS', '备份目标已被其他文件占用，未覆盖原文件'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const archiveHandle = await fs.open(partial, 'r+');
    try { await archiveHandle.sync(); } finally { await archiveHandle.close(); }
    await fs.link(partial, finalPath); await fs.unlink(partial);
    onProgress({ phase: 'COMPLETED', progress: 100, message: '备份完成，SHA-256 校验通过', sha256: zipIntegrity.sha256, size: zipIntegrity.size });
    return { path: finalPath, size: zipIntegrity.size, sha256: zipIntegrity.sha256, manifest, verified: true };
  } catch (error) {
    await fs.rm(partial, { force: true }).catch(() => {});
    throw error;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { FORMAT_VERSION, MAX_BROWSER_SNAPSHOT_BYTES, assertPlainReaderData, safeApiMetadata, validateBrowserSnapshot, collectReaderLibrary, createReaderBackupArchive };
