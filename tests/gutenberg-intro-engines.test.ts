import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const { listGutenbergIntroEngines } = createRequire(import.meta.url)('../electron/gutenberg-intro-engines.cjs');

describe('Book introduction model menu uses saved custom API profiles only', () => {
  it('includes every saved custom API profile without Codex engines', async () => {
    const profile = { configured: true, id: 'saved-profile-123', name: 'Local Qwen', model: 'qwen3.5-4b' };
    const other = { id: 'other-profile', name: 'Second API', model: 'second-model', apiKey: 'synthetic-secret' };
    const result = await listGutenbergIntroEngines({ customApi: { get: async () => ({ ...profile, activeId: profile.id, profiles: [other, profile] }) } });
    const expectedCustom = 'custom-api:' + createHash('sha256').update(profile.id).digest('hex').slice(0, 12);
    const secondCustom = 'custom-api:' + createHash('sha256').update(other.id).digest('hex').slice(0, 12);
    expect(result.defaultId).toBe(expectedCustom);
    expect(result.engines).toEqual([
      { id: expectedCustom, label: 'Local Qwen · qwen3.5-4b', engine: 'custom', modelId: 'qwen3.5-4b', effort: null },
      { id: secondCustom, label: 'Second API · second-model', engine: 'custom', modelId: 'second-model', effort: null },
    ]);
  });

  it('reflects a changed selected custom API without exposing credentials', async () => {
    let chosen = { configured: true, id: 'first', name: 'Local Qwen', model: 'qwen3.5-4b', apiKey: 'secret' };
    const api = { get: async () => chosen };
    const first = await listGutenbergIntroEngines({ customApi: api });
    chosen = { configured: true, id: 'second', name: 'MiniMax', model: 'minimax-m3', apiKey: 'secret-two' };
    const second = await listGutenbergIntroEngines({ customApi: api });
    expect(first.engines[0].id).not.toBe(second.engines[0].id);
    expect(second.engines[0].label).toContain('MiniMax · minimax-m3');
    expect(JSON.stringify(second)).not.toContain('secret');
  });

  it('returns an empty engine list if custom API storage is unavailable', async () => {
    const unavailable = await listGutenbergIntroEngines({ customApi: { get: async () => { throw Error('locked'); } } });
    expect(unavailable).toEqual({ engines: [], defaultId: '' });
  });
});
