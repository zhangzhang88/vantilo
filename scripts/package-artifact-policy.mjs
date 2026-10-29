import fs from 'node:fs/promises';
import path from 'node:path';

export function epubEntries(entries) {
  return entries.filter(entry => typeof entry === 'string' && /\.epub$/i.test(entry));
}

export function assertNoEpubEntries(entries) {
  const found = epubEntries(entries);
  if (found.length) throw new Error(`Release ZIP must not contain EPUB files (found ${found.length})`);
  return 0;
}

export async function assertNoEpubFiles(root) {
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isFile() && /\.epub$/i.test(entry.name)) {
        throw new Error(`Release app must not contain EPUB files: ${path.relative(root, filename)}`);
      }
      if (entry.isDirectory()) await visit(filename);
    }
  }
  await visit(root);
}
