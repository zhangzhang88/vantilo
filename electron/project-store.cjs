const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { z } = require('zod');

const VERSION = 1;
const MAX_BYTES = 1024 * 1024;
const ProjectSchema = z.object({ root: z.string().min(1).max(4096), pinned: z.boolean(), removed: z.boolean() }).strict();
const DocumentSchema = z.object({ version: z.literal(VERSION), projects: z.array(ProjectSchema).max(500) }).strict();

class ProjectStore {
  constructor({ filePath }) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('ProjectStore requires an absolute storage path.');
    this.filePath = filePath;
    this.data = { version: VERSION, projects: [] };
    this.loaded = false;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    try {
      const info = await fs.lstat(this.filePath);
      if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Project settings are not a regular file or exceed the size limit.');
      this.data = DocumentSchema.parse(JSON.parse(await fs.readFile(this.filePath, 'utf8')));
      await fs.chmod(this.filePath, 0o600).catch(() => {});
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Cannot load Vantilo project settings: ${error.message}`);
      await this.#persist(this.data);
    }
    this.loaded = true;
  }

  list() { this.#assertLoaded(); return structuredClone(this.data.projects); }
  get(root) { this.#assertLoaded(); const entry = this.data.projects.find(project => project.root === root); return entry ? structuredClone(entry) : null; }

  ensure(root) {
    this.#validateRoot(root);
    return this.#mutate(projects => {
      let entry = projects.find(project => project.root === root);
      if (!entry) { entry = { root, pinned: false, removed: false }; projects.push(entry); }
      return entry;
    });
  }

  register(root) {
    this.#validateRoot(root);
    return this.#mutate(projects => {
      let entry = projects.find(project => project.root === root);
      if (!entry) { entry = { root, pinned: false, removed: false }; projects.push(entry); }
      else entry.removed = false;
      return entry;
    });
  }

  setPinned(root, pinned) {
    this.#validateRoot(root);
    return this.#mutate(projects => {
      const entry = projects.find(project => project.root === root && !project.removed);
      if (!entry) throw new Error('Project is not registered in Vantilo.');
      entry.pinned = Boolean(pinned);
      return entry;
    });
  }

  remove(root) {
    this.#validateRoot(root);
    return this.#mutate(projects => {
      const entry = projects.find(project => project.root === root && !project.removed);
      if (!entry) throw new Error('Project is not registered in Vantilo.');
      entry.pinned = false;
      entry.removed = true;
      return entry;
    });
  }

  #validateRoot(root) {
    if (typeof root !== 'string' || !path.isAbsolute(root) || root.length > 4096) throw new Error('A valid absolute project path is required.');
  }
  #assertLoaded() { if (!this.loaded) throw new Error('Project settings have not been loaded.'); }

  #mutate(mutator) {
    this.#assertLoaded();
    const operation = this.writeQueue.then(async () => {
      const next = structuredClone(this.data);
      const result = mutator(next.projects);
      await this.#persist(next);
      this.data = next;
      return structuredClone(result);
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async #persist(document) {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    try { await fs.chmod(directory, 0o700); } catch { /* best effort */ }
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(document), 'utf8');
      await handle.sync(); await handle.close(); handle = null;
      await fs.rename(temporary, this.filePath);
      try { await fs.chmod(this.filePath, 0o600); } catch { /* best effort */ }
    } catch (error) {
      try { await handle?.close(); } catch { /* best effort */ }
      try { await fs.unlink(temporary); } catch { /* best effort */ }
      throw new Error(`Cannot save Vantilo project settings: ${error.message}`);
    }
  }
}

module.exports = { ProjectStore, MAX_BYTES };
