/**
 * Standalone LAN TTS API gateway for speech.cpp. Keep its upstream on 127.0.0.1;
 * expose ONLY this authenticated gateway to other LAN devices.
 *
 * All request content is ephemeral and deliberately excluded from logs.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const VOICES = new Set(['serena', 'vivian', 'uncle_fu', 'dylan', 'eric', 'ryan', 'aiden', 'ono_anna', 'sohee']);
const MAX_BODY_BYTES = 8192;
const checksum = (value) => createHash('sha256').update(value).digest();
const replyJson = (response, code, content) => {
  if (response.destroyed) return;
  response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(content));
};
const reject = (response, code, error) => replyJson(response, code, { error });

export function isTtsLanClientAllowed(address, subnetPrefix = '192.168.3.') {
  const ip = typeof address === 'string' ? address.replace(/^::ffff:/, '') : '';
  if (ip === '::1' || ip.startsWith('127.')) return true;
  // The only permitted remote clients are on the owner's configured /24 LAN.
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.$/.test(subnetPrefix)) return false;
  const octets = ip.split('.').map(Number);
  return octets.every(n => n <= 255) && ip.startsWith(subnetPrefix);
}

export function createTtsLanGateway({ apiKey, upstream = 'http://127.0.0.1:18440', fetchImpl = fetch, maxActive = 2, allowShortKey = false, lanSubnetPrefix = '192.168.3.' }) {
  const minLength = allowShortKey ? 4 : 32;
  if (typeof apiKey !== 'string' || apiKey.length < minLength || !/^[A-Za-z0-9_-]{4,256}$/.test(apiKey)) {
    throw new Error(allowShortKey ? 'A valid API key of at least four characters is required' : 'A random API key with at least 32 characters is required');
  }
  const target = new URL(upstream);
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
      target.username || target.password || target.search || target.hash ||
      target.pathname !== '/') throw new Error('Unprotected speech.cpp upstream must be localhost only');
  const expectedDigest = checksum(apiKey);
  let active = 0;
  const failedAuthentications = new Map();

  return createServer(async (request, response) => {
    if (!isTtsLanClientAllowed(request.socket.remoteAddress, lanSubnetPrefix)) {
      return reject(response, 403, 'LAN client not allowed');
    }
    const client = request.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempts = failedAuthentications.get(client);
    if (attempts && attempts.blockUntil > now) return reject(response, 429, 'Too many authentication failures');
    if (attempts && attempts.blockUntil <= now && attempts.windowUntil <= now) failedAuthentications.delete(client);
    let pathname;
    try {
      const location = new URL(request.url || '/', 'http://gateway.invalid');
      if (location.search || location.hash) return reject(response, 400, 'Unexpected query parameters');
      pathname = location.pathname;
    } catch { return reject(response, 400, 'Invalid request'); }

    const authorization = request.headers.authorization;
    const matched = typeof authorization === 'string' && /^Bearer ([A-Za-z0-9_-]{4,256})$/.exec(authorization);
    const actualDigest = checksum(matched ? matched[1] : '');
    if (!matched || !timingSafeEqual(actualDigest, expectedDigest)) {
      const entry = failedAuthentications.get(client);
      const count = entry && entry.windowUntil > now ? entry.count + 1 : 1;
      failedAuthentications.set(client, {
        count, windowUntil: now + 60_000, blockUntil: count >= 5 ? now + 300_000 : 0,
      });
      response.setHeader('www-authenticate', 'Bearer');
      return reject(response, 401, 'Unauthorized');
    }
    failedAuthentications.delete(client);

    const isHealth = request.method === 'GET' && pathname === '/health';
    const isModels = request.method === 'GET' && pathname === '/v1/models';
    const isSpeech = request.method === 'POST' && pathname === '/v1/audio/speech';
    if (!isHealth && !isModels && !isSpeech) return reject(response, 404, 'Not found');
    if (isSpeech && active >= maxActive) return reject(response, 429, 'TTS server is busy');

    let body;
    if (isSpeech) {
      const ct = String(request.headers['content-type'] || '');
      if (!/^application\/json(?:;|$)/i.test(ct)) return reject(response, 415, 'Expected application/json');
      const lengthHeader = request.headers['content-length'];
      if (lengthHeader !== undefined && (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) > MAX_BODY_BYTES)) {
        return reject(response, 413, 'Speech request too large');
      }
      try {
        const parts = [];
        let bytes = 0;
        for await (const part of request) {
          bytes += part.length;
          if (bytes > MAX_BODY_BYTES) return reject(response, 413, 'Speech request too large');
          parts.push(part);
        }
        body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      } catch { return reject(response, 400, 'Invalid request JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some(k => !['model', 'input', 'voice', 'language', 'response_format', 'seed'].includes(k)) ||
          typeof body.input !== 'string' || !body.input.trim() || body.input.length > 500 ||
          (body.model !== undefined && body.model !== 'qwen3-tts-0.6b') ||
          (body.voice !== undefined && !VOICES.has(body.voice)) ||
          (body.language !== undefined && !['zh', 'en', 'zh-CN', 'en-US'].includes(body.language)) ||
          (body.seed !== undefined && (!Number.isSafeInteger(body.seed) || body.seed < 0 || body.seed > 2_147_483_647)) ||
          !['pcm', 'wav'].includes(body.response_format ?? 'pcm')) {
        return reject(response, 400, 'Invalid speech request');
      }
      body = JSON.stringify({
        input: body.input, voice: body.voice ?? 'serena',
        language: String(body.language || 'zh').startsWith('en') ? 'en' : 'zh',
        response_format: body.response_format ?? 'pcm',
        ...(body.seed === undefined ? {} : { seed: body.seed }),
      });
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, 180_000);
    request.on('aborted', abort);
    response.on('close', () => { if (!response.writableEnded) abort(); });
    if (isSpeech) active++;
    try {
      const endpoint = isSpeech ? '/v1/audio/speech' : isHealth ? '/health' : '/v1/models';
      const upstreamResponse = await fetchImpl(new URL(endpoint, target), {
        method: request.method,
        headers: isSpeech ? { 'content-type': 'application/json' } : undefined,
        body: isSpeech ? body : undefined,
        signal: controller.signal,
      });
      const contentType = upstreamResponse.headers.get('content-type') || (isSpeech ? 'application/octet-stream' : 'application/json');
      response.writeHead(upstreamResponse.status, {
        'content-type': contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      });
      if (upstreamResponse.body) {
        for await (const chunk of upstreamResponse.body) {
          if (controller.signal.aborted || response.destroyed) break;
          if (!response.write(chunk)) {
            await Promise.race([
              new Promise(resolve => response.once('drain', resolve)),
              new Promise(resolve => response.once('close', resolve)),
            ]);
          }
        }
      }
      if (!response.destroyed) response.end();
    } catch {
      if (!response.headersSent) reject(response, 503, 'Local TTS engine unavailable');
      else response.destroy();
    } finally {
      clearTimeout(timer);
      request.off('aborted', abort);
      if (isSpeech) active--;
    }
  });
}

export async function startGateway({ env = process.env } = {}) {
  const keyFile = env.QWEN_TTS_API_KEY_FILE;
  if (!keyFile) throw new Error('QWEN_TTS_API_KEY_FILE is required');
  const info = await stat(keyFile);
  if ((info.mode & 0o077) !== 0 || !info.isFile()) throw new Error('API key file must be a private regular file (0600)');
  const apiKey = (await readFile(keyFile, 'utf8')).trim();
  const port = Number(env.QWEN_TTS_PORT ?? '18439');
  const host = env.QWEN_TTS_HOST ?? '0.0.0.0';
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid gateway port');
  if (host !== '0.0.0.0' && host !== '127.0.0.1') throw new Error('Only explicit IPv4 LAN or loopback host is supported');
  const upstream = env.QWEN_TTS_UPSTREAM ?? 'http://127.0.0.1:18440';
  const allowShortKey = env.QWEN_TTS_ALLOW_SHORT_KEY === '1';
  const lanSubnetPrefix = env.QWEN_TTS_ALLOWED_SUBNET_PREFIX ?? '192.168.3.';
  const server = createTtsLanGateway({ apiKey, upstream, allowShortKey, lanSubnetPrefix });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  console.log(`Qwen3-TTS gateway listening on ${host}:${port}; upstream remains loopback`);
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startGateway().catch(error => {
    console.error('Qwen3-TTS gateway failed:', error.message);
    process.exitCode = 1;
  });
}
