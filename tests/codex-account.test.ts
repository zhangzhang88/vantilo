import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { CodexDriver } = require('../electron/codex-driver.cjs');
const { Results, Payloads } = require('../electron/runtime-protocol.cjs');
function driver(value: unknown) {
  const instance = new CodexDriver({ command: 'fixture' });
  instance.start = vi.fn(async () => {});
  instance.request = vi.fn(async () => value);
  return instance;
}
describe('one native Agent ChatGPT account', () => {
  it('only exposes public account state, never Codex credentials', async () => {
    const instance = driver({ account: { type: 'chatgpt', email: 'user@example.com', accessToken: 'private' } });
    expect(await instance.accountStatus()).toEqual({ connected: true, email: 'user@example.com' });
    expect(instance.request).toHaveBeenCalledWith('account/read', { refreshToken: false });
    expect(await driver({ account: null }).accountStatus()).toEqual({ connected: false, email: null });
    expect(Payloads['account:login'].safeParse({ token: 'private' }).success).toBe(false);
  });
  it('uses the official account login RPC and rejects arbitrary browser URLs', async () => {
    const instance = driver({ type: 'chatgpt', authUrl: 'https://auth.openai.com/oauth/authorize?state=fixture' });
    expect(await instance.startAccountLogin()).toEqual({ url: 'https://auth.openai.com/oauth/authorize?state=fixture' });
    expect(instance.request).toHaveBeenCalledWith('account/login/start', { type: 'chatgpt' });
    for (const authUrl of ['https://evil.test/', 'http://auth.openai.com/', 'https://user@auth.openai.com/']) {
      await expect(driver({type:'chatgpt',authUrl}).startAccountLogin()).rejects.toThrow();
      expect(Results['account:login'].safeParse({url:authUrl}).success).toBe(false);
    }
  });
  it('logs out through the same driver', async () => {
    const instance = driver({});
    expect(await instance.logoutAccount()).toEqual({ connected: false, email: null });
    expect(instance.request).toHaveBeenCalledWith('account/logout', {});
  });
});
