const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const fsConstants = require('node:fs').constants;
const path = require('node:path');
const os = require('node:os');
const { z } = require('zod');

const WORKSPACE_SETTINGS_VERSION = 1;
const MAX_WORKSPACE_SETTINGS_BYTES = 4096;
const MAX_READ_BYTES = 1024 * 1024;
const SENSITIVE_NAME = /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.docker|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|known_hosts|authorized_keys|credentials?(?:\..*)?|secrets?(?:\..*)?|auth(?:entication)?(?:\..*)?|tokens?(?:\..*)?|.*(?:api[_-]?key|client[_-]?secret|credential|password|passwd|secret|private[_-]?key|access[_-]?token|refresh[_-]?token)(?:\..*)?|.*\.(?:pem|key|p12|pfx|p8|der|crt|cer|keystore|jks)|.*\.tfstate(?:\.backup)?)$/i;
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.turbo', '.venv', 'venv', '__pycache__']);
const Settings = z.object({ version: z.literal(WORKSPACE_SETTINGS_VERSION), root: z.string().min(1).max(4096) }).strict();

class WorkspaceError extends Error {
  constructor(code, message) { super(message); this.name = 'WorkspaceError'; this.code = code; }
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function normalizeRelativePath(value, { allowRoot = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024 || value.includes('\0') || value.includes('\\')) {
    throw new WorkspaceError('invalid_path', 'A workspace-relative path is required.');
  }
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || value.startsWith('~')) {
    throw new WorkspaceError('invalid_path', 'Absolute paths are not accepted by workspace tools.');
  }
  const pieces = value.split('/');
  if (pieces.some(piece => piece === '..')) throw new WorkspaceError('out_of_scope', 'Path traversal outside the authorized workspace is not allowed.');
  const normalized = path.posix.normalize(value);
  if (!allowRoot && (normalized === '.' || normalized === '')) throw new WorkspaceError('invalid_path', 'A file path inside the workspace is required.');
  if (normalized === '..' || normalized.startsWith('../')) throw new WorkspaceError('out_of_scope', 'Path traversal outside the authorized workspace is not allowed.');
  if (normalized.split('/').some(part => part.length > 255)) throw new WorkspaceError('invalid_path', 'A path component is too long.');
  return normalized;
}

function isSensitivePath(relative) {
  return relative.split('/').some(part => SENSITIVE_NAME.test(part));
}

class WorkspaceAuthority {
  constructor({ userDataPath }) {
    if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) throw new Error('WorkspaceAuthority requires an absolute user-data directory.');
    this.settingsPath = path.join(userDataPath, 'workspace.json');
    this.root = null;
    this.error = null;
    this.revision = 0;
  }

  state() { return { root: this.root, error: this.error, revision: this.revision }; }

  async load() {
    let raw;
    try {
      const info = await fs.lstat(this.settingsPath);
      if (!info.isFile() || info.size > MAX_WORKSPACE_SETTINGS_BYTES) throw new WorkspaceError('invalid_settings', 'Saved workspace authorization is invalid.');
      raw = await fs.readFile(this.settingsPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return this.state();
      this.error = error instanceof WorkspaceError ? error.message : 'Saved workspace authorization could not be read.';
      return this.state();
    }
    let settings;
    try { settings = Settings.parse(JSON.parse(raw)); }
    catch { this.error = 'Saved workspace authorization is invalid; choose a workspace again.'; return this.state(); }
    try {
      this.root = await this.#canonicalDirectory(settings.root);
      this.revision++;
      this.error = null;
      try { await fs.chmod(this.settingsPath, 0o600); } catch { /* best effort on non-POSIX filesystems */ }
    } catch {
      this.root = null;
      this.error = 'The previously authorized workspace is unavailable; choose a workspace again.';
    }
    return this.state();
  }

  async setWorkspace(selectedPath) {
    if (typeof selectedPath !== 'string' || !path.isAbsolute(selectedPath) || selectedPath.length > 4096) {
      throw new WorkspaceError('invalid_workspace', 'Choose a valid local workspace directory.');
    }
    const root = await this.#canonicalDirectory(selectedPath);
    const directory = path.dirname(this.settingsPath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    try { await fs.chmod(directory, 0o700); } catch { /* best effort on non-POSIX filesystems */ }
    const temporary = `${this.settingsPath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ version: WORKSPACE_SETTINGS_VERSION, root }), 'utf8');
      await handle.sync(); await handle.close(); handle = null;
      await fs.rename(temporary, this.settingsPath);
    } catch (error) {
      try { await handle?.close(); } catch { /* best effort */ }
      try { await fs.unlink(temporary); } catch { /* best effort */ }
      throw new WorkspaceError('settings_write_failed', 'Workspace selection could not be saved safely.');
    }
    try { await fs.chmod(this.settingsPath, 0o600); } catch { /* best effort on non-POSIX filesystems */ }
    this.root = root;
    this.error = null;
    this.revision++;
    return this.state();
  }

  async clearWorkspace() {
    try { await fs.unlink(this.settingsPath); }
    catch (error) { if (error.code !== 'ENOENT') throw new WorkspaceError('settings_write_failed', 'Workspace access could not be cleared safely.'); }
    this.root = null; this.error = null; this.revision++;
    return this.state();
  }

  normalize(value, options) { return normalizeRelativePath(value, options); }
  isSensitive(value) { return isSensitivePath(value); }
  async canonicalizeDirectory(value) { return this.#canonicalDirectory(value); }

  async inspect(relativePath, { allowRoot = false, expectDirectory = false, expectFile = false } = {}) {
    if (!this.root) throw new WorkspaceError('workspace_unavailable', 'Choose an authorized workspace before using workspace tools.');
    const relative = normalizeRelativePath(relativePath, { allowRoot });
    if (isSensitivePath(relative)) throw new WorkspaceError('sensitive_path', 'This path is excluded because it may contain credentials or private keys.');
    if (relative.split('/').some(part => EXCLUDED_DIRS.has(part.toLowerCase()))) throw new WorkspaceError('excluded_path', 'This path is excluded from workspace tools.');
    const root = this.root;
    let candidate = root;
    if (relative !== '.') {
      for (const component of relative.split('/')) {
        candidate = path.join(candidate, component);
        let info;
        try { info = await fs.lstat(candidate); }
        catch (error) { throw this.#mapFsError(error); }
        if (info.isSymbolicLink()) throw new WorkspaceError('symlink_rejected', 'Symbolic links are not followed by workspace tools.');
      }
    }
    let canonical;
    try { canonical = await fs.realpath(candidate); }
    catch (error) { throw this.#mapFsError(error); }
    if (!isWithin(root, canonical)) throw new WorkspaceError('out_of_scope', 'The resolved path is outside the authorized workspace.');
    let info;
    try { info = await fs.lstat(candidate); }
    catch (error) { throw this.#mapFsError(error); }
    if (info.isSymbolicLink()) throw new WorkspaceError('symlink_rejected', 'Symbolic links are not followed by workspace tools.');
    if (expectDirectory && !info.isDirectory()) throw new WorkspaceError('not_directory', 'The requested workspace path is not a directory.');
    if (expectFile && !info.isFile()) throw new WorkspaceError('not_regular_file', 'Only regular text files can be read.');
    return { absolutePath: candidate, canonicalPath: canonical, relativePath: relative, stat: info };
  }

  async validateReferences(selectedPaths) {
    if (!Array.isArray(selectedPaths) || selectedPaths.length < 1 || selectedPaths.length > 20) throw new WorkspaceError('invalid_input', 'Select between 1 and 20 workspace files or folders.');
    if (!this.root) throw new WorkspaceError('workspace_unavailable', 'Choose an authorized workspace before attaching workspace references.');
    const references = [];
    const seen = new Set();
    for (const selectedPath of selectedPaths) {
      if (typeof selectedPath !== 'string' || !path.isAbsolute(selectedPath) || selectedPath.length > 4096) throw new WorkspaceError('invalid_path', 'A selected path is invalid.');
      const absolutePath = path.resolve(selectedPath);
      if (!isWithin(this.root, absolutePath)) throw new WorkspaceError('out_of_scope', 'Only files or folders inside the authorized workspace can be attached.');
      const relativePath = path.relative(this.root, absolutePath).split(path.sep).join('/');
      if (seen.has(relativePath)) continue;
      const inspected = await this.inspect(relativePath, { allowRoot: relativePath === '.' });
      const kind = inspected.stat.isDirectory() ? 'directory' : inspected.stat.isFile() ? 'file' : null;
      if (!kind) throw new WorkspaceError('invalid_reference', 'Only regular workspace files and folders can be attached.');
      if (kind === 'file' && inspected.stat.nlink > 1) throw new WorkspaceError('hard_link_rejected', 'Files with additional hard links cannot be attached.');
      seen.add(relativePath);
      references.push({ path: relativePath, kind });
    }
    return references;
  }

  async openReadOnly(relativePath) {
    const inspected = await this.inspect(relativePath, { expectFile: true });
    if (inspected.stat.nlink > 1) throw new WorkspaceError('hard_link_rejected', 'Files with additional hard links are not read by workspace tools.');
    if (inspected.stat.size > MAX_READ_BYTES) throw new WorkspaceError('file_too_large', `Files larger than ${MAX_READ_BYTES} bytes cannot be read.`);
    let handle;
    try {
      const noFollow = fsConstants.O_NOFOLLOW || 0;
      handle = await fs.open(inspected.absolutePath, fsConstants.O_RDONLY | noFollow);
      const info = await handle.stat();
      const reopenedCanonical = await fs.realpath(inspected.absolutePath);
      if (!isWithin(this.root, reopenedCanonical) || reopenedCanonical !== inspected.canonicalPath || !info.isFile() || info.nlink > 1 || info.dev !== inspected.stat.dev || info.ino !== inspected.stat.ino) throw new WorkspaceError('path_changed', 'The file changed while access was being checked.');
      if (info.size > MAX_READ_BYTES) throw new WorkspaceError('file_too_large', `Files larger than ${MAX_READ_BYTES} bytes cannot be read.`);
      const buffer = Buffer.alloc(MAX_READ_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_READ_BYTES) throw new WorkspaceError('file_too_large', `Files larger than ${MAX_READ_BYTES} bytes cannot be read.`);
      if (bytesRead !== info.size) throw new WorkspaceError('path_changed', 'The file changed while access was being checked.');
      const bytes = buffer.subarray(0, bytesRead);
      if (bytes.includes(0)) throw new WorkspaceError('binary_file', 'Only small UTF-8 text files can be read.');
      let content;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new WorkspaceError('binary_file', 'Only UTF-8 text files can be read.'); }
      return { path: inspected.relativePath, content, bytes: bytes.length, modifiedAt: info.mtime.toISOString() };
    } catch (error) { throw error instanceof WorkspaceError ? error : this.#mapFsError(error); }
    finally { if (handle) await handle.close().catch(() => {}); }
  }

  async listFiles(relativePath = '.', limit = 100, { signal, maxEntries = 10000 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new WorkspaceError('invalid_input', 'File listing limit must be between 1 and 200.');
    const base = await this.inspect(relativePath, { allowRoot: true, expectDirectory: true });
    const queue = [{ absolutePath: base.absolutePath, relativePath: base.relativePath }];
    const files = [];
    let inspectedCount = 0;
    let truncated = false;
    while (queue.length && files.length < limit) {
      if (signal?.aborted) throw new WorkspaceError('cancelled', 'The workspace request was cancelled.');
      const directory = queue.shift();
      const checkedDirectory = await this.inspect(directory.relativePath, { allowRoot: true, expectDirectory: true });
      if (checkedDirectory.absolutePath !== directory.absolutePath) throw new WorkspaceError('path_changed', 'The workspace directory changed while access was being checked.');
      let handle;
      try { handle = await fs.opendir(checkedDirectory.absolutePath); }
      catch (error) { throw this.#mapFsError(error); }
      try {
        for await (const entry of handle) {
          if (signal?.aborted) throw new WorkspaceError('cancelled', 'The workspace request was cancelled.');
          inspectedCount++;
          if (inspectedCount > maxEntries) { truncated = true; queue.length = 0; break; }
          if (entry.isSymbolicLink()) continue;
          const relative = directory.relativePath === '.' ? entry.name : `${directory.relativePath}/${entry.name}`;
          if (isSensitivePath(relative)) continue;
          if (entry.isDirectory()) {
            if (!EXCLUDED_DIRS.has(entry.name.toLowerCase())) queue.push({ absolutePath: path.join(directory.absolutePath, entry.name), relativePath: relative });
            continue;
          }
          if (!entry.isFile()) continue;
          const inspected = await this.inspect(relative, { expectFile: true });
          files.push({ path: relative, size: inspected.stat.size, modifiedAt: inspected.stat.mtime.toISOString() });
          if (files.length >= limit) { truncated = queue.length > 0 || inspectedCount > 0; break; }
        }
      } catch (error) { throw error instanceof WorkspaceError ? error : this.#mapFsError(error); }
    }
    if (queue.length) truncated = true;
    return { directory: base.relativePath, files, truncated };
  }

  async #canonicalDirectory(value) {
    let canonical;
    try { canonical = await fs.realpath(path.resolve(value)); }
    catch { throw new WorkspaceError('invalid_workspace', 'The selected workspace directory is unavailable.'); }
    let info;
    try { info = await fs.stat(canonical); }
    catch { throw new WorkspaceError('invalid_workspace', 'The selected workspace directory is unavailable.'); }
    if (!info.isDirectory()) throw new WorkspaceError('invalid_workspace', 'The selected workspace must be a directory.');
    const diskRoot = path.parse(canonical).root;
    let home;
    try { home = await fs.realpath(os.homedir()); } catch { home = path.resolve(os.homedir()); }
    if (canonical === diskRoot || canonical === home) throw new WorkspaceError('workspace_too_broad', 'Select a project subdirectory, not the disk root or entire user home.');
    return canonical;
  }

  #mapFsError(error) {
    if (error instanceof WorkspaceError) return error;
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return new WorkspaceError('not_found', 'The requested path was not found inside the authorized workspace.');
    if (error.code === 'EACCES' || error.code === 'EPERM') return new WorkspaceError('permission_denied', 'The requested workspace path is not readable.');
    if (error.code === 'ELOOP') return new WorkspaceError('symlink_rejected', 'Symbolic links are not followed by workspace tools.');
    return new WorkspaceError('io_error', 'The workspace operation failed.');
  }
}

module.exports = { WorkspaceAuthority, WorkspaceError, normalizeRelativePath, isSensitivePath, isWithin, EXCLUDED_DIRS, MAX_READ_BYTES, MAX_WORKSPACE_SETTINGS_BYTES, WORKSPACE_SETTINGS_VERSION };
