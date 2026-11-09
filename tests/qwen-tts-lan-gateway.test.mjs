import { afterEach, expect, it, vi } from 'vitest';
import { createTtsLanGateway, isTtsLanClientAllowed } from '../scripts/qwen-tts-lan-gateway.mjs';

const apiKey = 'a'.repeat(64);
const servers = [];

async function serve(options = {}) {
  const upstreamCalls = [];
  const fake = options.fetchImpl ?? (async (url, init) => {
    upstreamCalls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/v1/audio/speech')) {
      return new Response(new Uint8Array([0, 128, 255, 127]), {
        headers: { 'content-type': 'audio/pcm; rate=24000; channels=1' },
      });
    }
    return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'content-type': 'application/json' } });
  });
  const gateway = createTtsLanGateway({ apiKey, fetchImpl: fake, ...options });
  servers.push(gateway);
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  return { address: `http://127.0.0.1:${gateway.address().port}`, upstreamCalls };
}

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve));
});

it('rejects unauthenticated API calls, including health, and fails closed on unrelated routes', async () => {
  const { address, upstreamCalls } = await serve();
  const noKey = await fetch(address + '/v1/models');
  expect(noKey.status).toBe(401);
  expect(noKey.headers.get('www-authenticate')).toBe('Bearer');
  const wrongKey = await fetch(address + '/health', { headers: { authorization: 'Bearer ' + 'b'.repeat(64) } });
  expect(wrongKey.status).toBe(401);
  const notFound = await fetch(address + '/not-tts', { headers: { authorization: 'Bearer ' + apiKey } });
  expect(notFound.status).toBe(404);
  expect(upstreamCalls).toHaveLength(0);
});

it('accepts authenticated PCM TTS, maps language and speaker, and streams bytes unchanged', async () => {
  const { address, upstreamCalls } = await serve();
  const result = await fetch(address + '/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'qwen3-tts-0.6b', input: 'Hello, world!', voice: 'aiden', language: 'en-US', response_format: 'pcm' }),
  });
  expect(result.status).toBe(200);
  expect(result.headers.get('content-type')).toContain('audio/pcm');
  expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([0, 128, 255, 127]);
  expect(upstreamCalls).toHaveLength(1);
  expect(upstreamCalls[0].url).toBe('http://127.0.0.1:18440/v1/audio/speech');
  expect(upstreamCalls[0].body).toEqual({
    input: 'Hello, world!', voice: 'aiden', language: 'en', response_format: 'pcm',
  });
});

it('forwards a validated optional fixed seed to speech.cpp', async () => {
  const { address, upstreamCalls } = await serve();
  const response = await fetch(address + '/v1/audio/speech', {
    method: 'POST', headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ input: 'Alexander Dobrindt', voice: 'aiden', language: 'en', seed: 1234567 }),
  });
  expect(response.status).toBe(200);
  expect(upstreamCalls).toHaveLength(1);
  expect(upstreamCalls[0].body).toMatchObject({ input: 'Alexander Dobrindt', voice: 'aiden', language: 'en', seed: 1234567 });
});

it('rejects unsupported voices, unknown fields and oversized text before inference', async () => {
  const { address, upstreamCalls } = await serve();
  for (const body of [
    { input: 'Hello!', voice: '../../arbitrary' },
    { input: 'Hello!', secret: 'should never be accepted' },
    { input: 'x'.repeat(501), voice: 'ryan' },
    { input: 'Hello!', response_format: 'mp3' },
    { input: 'Hello!', seed: -1 },
    { input: 'Hello!', seed: '123' },
    { input: 'Hello!', seed: 1.25 },
    { input: 'Hello!', seed: 2_147_483_648 },
  ]) {
    const response = await fetch(address + '/v1/audio/speech', {
      method: 'POST', headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
  }
  expect(upstreamCalls).toHaveLength(0);
});

it('fails safely when the model server is offline without passing through private input', async () => {
  const { address } = await serve({
    fetchImpl: vi.fn(async () => { throw new Error('Private exception: internal user text'); }),
  });
  const response = await fetch(address + '/v1/audio/speech', {
    method: 'POST', headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ input: 'Private user text' }),
  });
  expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/Private|internal/);
});

it('never permits a remote unauthenticated upstream or a short API key', () => {
  expect(() => createTtsLanGateway({ apiKey, upstream: 'http://0.0.0.0:18440' })).toThrow('localhost only');
  expect(() => createTtsLanGateway({ apiKey, upstream: 'http://192.168.3.54:18440' })).toThrow('localhost only');
  expect(() => createTtsLanGateway({ apiKey: 'short' })).toThrow('random API key');
});

it('supports a consciously opted-in 4-digit key, without weakening the default requirement', async () => {
  expect(() => createTtsLanGateway({ apiKey: '1234' })).toThrow('at least 32');
  const { address } = await serve({ apiKey: '1234', allowShortKey: true });
  const unauthenticated = await fetch(address + '/health');
  expect(unauthenticated.status).toBe(401);
  const authenticated = await fetch(address + '/health', { headers: { authorization: 'Bearer 1234' } });
  expect(authenticated.status).toBe(200);
});

it('restricts remote clients to the configured LAN subnet and local loopback', () => {
  expect(isTtsLanClientAllowed('127.0.0.1')).toBe(true);
  expect(isTtsLanClientAllowed('::1')).toBe(true);
  expect(isTtsLanClientAllowed('::ffff:127.0.0.1')).toBe(true);
  expect(isTtsLanClientAllowed('192.168.3.54')).toBe(true);
  expect(isTtsLanClientAllowed('192.168.3.250')).toBe(true);
  expect(isTtsLanClientAllowed('192.168.4.54')).toBe(false);
  expect(isTtsLanClientAllowed('10.0.0.4')).toBe(false);
  expect(isTtsLanClientAllowed('8.8.8.8')).toBe(false);
  expect(isTtsLanClientAllowed('192.168.3.999')).toBe(false);
});

it('rate limits repeated wrong API keys even when using a short key', async () => {
  const { address } = await serve({ apiKey: '1234', allowShortKey: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(address + '/health', { headers: { authorization: 'Bearer 9999' } });
    expect(response.status).toBe(401);
  }
  const blocked = await fetch(address + '/health', { headers: { authorization: 'Bearer 1234' } });
  expect(blocked.status).toBe(429);
});
