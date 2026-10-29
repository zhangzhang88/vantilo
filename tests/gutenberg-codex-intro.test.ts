import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const { createCodexIntroApi } = createRequire(import.meta.url)('../electron/gutenberg-codex-intro.cjs');

class FakeDriver extends EventEmitter {
  turnActive = false;
  constructor(readonly records: any[]) { super(); }
  accountStatus = vi.fn(async () => ({ connected: true }));
  listModels = vi.fn(async () => [
    { id: 'future-gpt-8', isDefault: true, defaultEffort: 'high', efforts: [{ id: 'high' }, { id: 'medium' }] },
    { id: 'gpt-6-luna', isDefault: false, defaultEffort: 'medium', efforts: [{ id: 'medium' }] }
  ]);
  startTurn = vi.fn(async (_prompt: string, _thread: string|null, config: any) => {
    this.records.push(config);
    queueMicrotask(() => {
      this.emit('delta', { delta: JSON.stringify({ titleZh:'书名', introZh:'内容' }) });
      this.emit('turn', { status:'completed', turnId:'turn-1' });
    });
    return { threadId:'ephemeral-thread', turnId:'turn-1' };
  });
  deleteThread = vi.fn(async () => {});
  close = vi.fn(async () => {});
  cancelTurn = vi.fn(async () => {});
}

describe('Codex book introduction uses the current live Vantilo model', () => {
  it('follows the live Codex default without a hardcoded model version', async () => {
    const records: any[] = [];
    const driverFactory = () => new FakeDriver(records);
    const api = createCodexIntroApi({ driverFactory, workspaceRoot:'/tmp' });
    expect((await api.get()).model).toBe('future-gpt-8');
    expect((await api.get()).reasoningEffort).toBe('high');
    const text = await api.complete({ instruction:'Return JSON', input:'A book paragraph' });
    expect(text).toContain('书名');
    expect(records[0]).toMatchObject({ model:'future-gpt-8', effort:'high', dynamicTools:[] });
  });

  it('follows the selected conversation model instead of the default and validates effort', async () => {
    const records: any[] = [];
    const api = createCodexIntroApi({ driverFactory:() => new FakeDriver(records), workspaceRoot:'/tmp' });
    expect((await api.get({ modelId:'gpt-6-luna', reasoningEffort:'medium' })).model).toBe('gpt-6-luna');
    await api.complete({ instruction:'Return JSON', input:'A book paragraph', modelId:'gpt-6-luna', reasoningEffort:'medium' });
    expect(records[0]).toMatchObject({ model:'gpt-6-luna', effort:'medium' });
    await expect(api.get({ modelId:'nonexistent-gpt-9' })).rejects.toThrow(/模型未在 Codex 实时目录/);
    await expect(api.get({ modelId:'gpt-6-luna', reasoningEffort:'ultra' })).rejects.toThrow(/不支持当前思考强度/);
  });
});
