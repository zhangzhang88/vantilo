import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPackageRoot } from '../scripts/package-root-resolution.mjs';

describe('third-party notice package-root resolution', () => {
  it('skips nested manifests without package identity and finds the enclosing package', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vantilo-notice-root-'));
    try {
      const packageRoot = path.join(root, 'node_modules', 'sample-package');
      const nested = path.join(packageRoot, 'dist', 'chunk');
      await mkdir(nested, { recursive: true });
      await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'sample-package', version: '1.2.3' }));
      await writeFile(path.join(nested, 'package.json'), JSON.stringify({ exports: {} }));
      const entry = path.join(nested, 'index.js');
      expect(await findPackageRoot(entry)).toBe(packageRoot);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns null rather than inventing an undefined package identity', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vantilo-notice-no-root-'));
    try {
      const nested = path.join(root, 'node_modules', 'sample-package', 'dist');
      await mkdir(nested, { recursive: true });
      await writeFile(path.join(nested, 'package.json'), JSON.stringify({ exports: {} }));
      expect(await findPackageRoot(path.join(nested, 'index.js'))).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
