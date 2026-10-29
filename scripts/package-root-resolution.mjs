import fs from 'node:fs/promises';
import path from 'node:path';

export async function findPackageRoot(filename) {
  let directory = path.dirname(filename);
  while (directory.includes('node_modules')) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
      if (typeof manifest.name === 'string' && typeof manifest.version === 'string') return directory;
    } catch { /* Keep looking for the enclosing package manifest. */ }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}
