import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cleanupRealCodexE2E } = require('../scripts/real-codex-cleanup.cjs') as {
  cleanupRealCodexE2E: (runtime: unknown, tempPath: string | undefined, options?: { removePath?: (...args: any[]) => Promise<void> }) => Promise<Error[]>;
};

describe('real Codex E2E cleanup', () => {
  it('skips stop when Runtime was never constructed but still attempts temp cleanup', async () => {
    const removePath = vi.fn(async () => {});
    await expect(cleanupRealCodexE2E(undefined, '/temporary/e2e-root', { removePath })).resolves.toEqual([]);
    expect(removePath).toHaveBeenCalledWith('/temporary/e2e-root', { recursive: true, force: true });
  });

  it('records cleanup failures without replacing the original initialization exception', async () => {
    const stopError = new Error('stop failed');
    const removeError = new Error('remove failed');
    const runtime = { stop: vi.fn(async () => { throw stopError; }) };
    const removePath = vi.fn(async () => { throw removeError; });
    const originalError = new Error('original initialization failure');
    let caught: unknown;
    try {
      try { throw originalError; }
      finally {
        const cleanupErrors = await cleanupRealCodexE2E(runtime, '/temporary/e2e-root', { removePath });
        expect(cleanupErrors).toHaveLength(2);
        expect(cleanupErrors[0]?.cause).toBe(stopError);
        expect(cleanupErrors[1]?.cause).toBe(removeError);
      }
    } catch (error) { caught = error; }
    expect(caught).toBe(originalError);
    expect((caught as Error).stack).toContain('original initialization failure');
  });
});
