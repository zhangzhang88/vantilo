import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { packagedReaderSeedDir } = require('../electron/reader-seed-path.cjs');

describe('packaged Reader seed selection', () => {
  it('does not enable a seed in development', () => {
    const existsSync = vi.fn(() => true);
    expect(packagedReaderSeedDir({ isPackaged: false, assetsDir: '/app/reader', existsSync })).toBeUndefined();
    expect(existsSync).not.toHaveBeenCalled();
  });

  it('starts without a packaged seed when no manifest is present', () => {
    expect(packagedReaderSeedDir({ isPackaged: true, assetsDir: '/app/reader', existsSync: () => false })).toBeUndefined();
  });

  it('selects only a packaged seed with a manifest', () => {
    const existsSync = vi.fn((filename: string) => filename === '/app/reader/seed/manifest.json');
    expect(packagedReaderSeedDir({ isPackaged: true, assetsDir: '/app/reader', existsSync })).toBe('/app/reader/seed');
    expect(existsSync).toHaveBeenCalledWith('/app/reader/seed/manifest.json');
  });

  it('rejects a relative asset directory', () => {
    expect(packagedReaderSeedDir({ isPackaged: true, assetsDir: 'reader', existsSync: vi.fn() })).toBeUndefined();
  });
});
