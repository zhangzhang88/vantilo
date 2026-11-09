// Portable, stateless CI tests. Never create profiles, temp files, or Reader data.
// The comprehensive Vitest/Electron suites remain behind the Workspace runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { proxyEnvironment, systemProxyEnvironment } = require('../electron/system-proxy.cjs');
const { createReaderAiFetch, createReaderAiClient } = require('../electron/reader-ai-gateway.cjs');

test('proxy parser preserves enabled endpoints and filters unsafe bypasses', () => {
  const source = [
    'HTTPEnable : 1',
    'HTTPProxy : 127.0.0.1',
    'HTTPPort : 7890',
    'HTTPSEnable : 1',
    'HTTPSProxy : 127.0.0.1',
    'HTTPSPort : 7890',
    'SOCKSEnable : 1',
    'SOCKSProxy : ::1',
    'SOCKSPort : 7891',
    'ExceptionsList : <array> {',
    '  0 : *.example.test',
    '  1 : bad/path',
    '}',
  ].join('\n');
  assert.deepEqual(proxyEnvironment(source), {
    HTTP_PROXY: 'http://127.0.0.1:7890',
    HTTPS_PROXY: 'http://127.0.0.1:7890',
    ALL_PROXY: 'socks5h://[::1]:7891',
    NO_PROXY: 'localhost,127.0.0.1,::1,.example.test',
  });
});

test('proxy parser rejects credentials and never calls macOS services on Linux', () => {
  assert.deepEqual(proxyEnvironment('HTTPSEnable : 1\nHTTPSProxy : user:password@example.test\nHTTPSPort : 80'), {});
  let readCalled = false;
  assert.deepEqual(systemProxyEnvironment({
    platform: 'linux',
    read: () => { readCalled = true; throw new Error('should not read scutil'); },
  }), {});
  assert.equal(readCalled, false);
});

test('Reader AI adapter forwards only bounded instructions and input', async () => {
  const calls = [];
  const fetch = createReaderAiFetch(async request => {
    calls.push(request);
    return '统一翻译结果';
  });
  const response = await fetch('https://unused-provider.invalid', {
    body: JSON.stringify({
      model: 'ignored', apiKey: 'must-not-forward',
      instructions: 'Translate this', input: 'Short text',
    }),
  });
  assert.deepEqual(calls, [{ instructions: 'Translate this', input: 'Short text' }]);
  assert.deepEqual(await response.json(), { output_text: '统一翻译结果' });
});

test('Reader AI adapter rejects missing login, invalid tasks and oversized inputs', async () => {
  await assert.rejects(createReaderAiFetch()('ignored', { body: '{}' }), /登录/);
  const fetch = createReaderAiFetch(async () => 'ok');
  await assert.rejects(fetch('ignored', { body: '{' }), /Invalid Reader AI task/);
  await assert.rejects(fetch('ignored', {
    body: JSON.stringify({ instructions: 'Translate', input: 'x'.repeat(18001) }),
  }), /过长/);
});

test('Reader AI adapter rejects invalid backend output', async () => {
  const fetch = createReaderAiFetch(async () => 'x'.repeat(20001));
  await assert.rejects(fetch('ignored', {
    body: JSON.stringify({ instructions: 'Translate', input: 'Hello' }),
  }), /格式无效/);
});

test('Reader request cancellation targets only the matching request', async () => {
  const parent = new EventEmitter();
  const sent = [];
  parent.postMessage = message => { sent.push(message); };
  const client = createReaderAiClient(parent);
  try {
    const controller = new AbortController();
    const pending = client.run({ instructions: 'Explain', input: 'First' }, false, controller.signal);
    const requestId = sent[0].requestId;
    assert.equal(sent[0].type, 'ai');
    controller.abort();
    await assert.rejects(pending, /取消/);
    assert.deepEqual(sent.at(-1), { type: 'ai-cancel', requestId });
    parent.emit('message', { data: { type: 'ai-result', requestId, ok: true, output: 'late' } });

    const next = client.run({ instructions: 'Explain', input: 'Second' });
    const nextId = sent.at(-1).requestId;
    parent.emit('message', { data: { type: 'ai-result', requestId: nextId, ok: true, output: 'done' } });
    assert.equal(await next, 'done');
  } finally {
    client.close();
  }
});
