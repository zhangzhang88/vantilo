import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EnvHttpProxyAgent } from "undici";

const execFileAsync = promisify(execFile);

export function parseSystemHttpsProxy(settings: string): string | undefined {
  const value = (key: string) => settings.match(new RegExp(`^\\s*${key}\\s*:\\s*(\\S+)\\s*$`, "m"))?.[1];
  if (value("HTTPSEnable") !== "1") return undefined;
  const host = value("HTTPSProxy");
  const port = Number(value("HTTPSPort"));
  if (!host || !/^[a-zA-Z0-9.\-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return `http://${host}:${port}`;
}

interface ProxyOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  readSystemProxy?: () => Promise<string>;
}

export async function resolveCodexProxySettings(options: ProxyOptions = {}) {
  const env = options.env ?? process.env;
  let systemProxy: string | undefined;
  if (!(env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy)
    && (options.platform ?? process.platform) === "darwin") {
    const read = options.readSystemProxy ?? (async () => (await execFileAsync("/usr/sbin/scutil", ["--proxy"], { timeout: 3000, maxBuffer: 64 * 1024 })).stdout);
    try { systemProxy = parseSystemHttpsProxy(await read()); } catch { /* Use a direct connection if system settings are unavailable. */ }
  }
  return {
    httpProxy: env.http_proxy || env.HTTP_PROXY || systemProxy,
    httpsProxy: env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY || systemProxy,
    noProxy: env.no_proxy || env.NO_PROXY || "",
  };
}

export function createCodexAuthTransport(options: ProxyOptions & { fetchImpl?: typeof fetch } = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  let agent: Promise<EnvHttpProxyAgent> | undefined;
  const getAgent = () => agent ??= resolveCodexProxySettings(options).then((settings) => new EnvHttpProxyAgent(settings));
  const request: typeof fetch = async (input, init) => {
    const timeout = AbortSignal.timeout(30_000);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    // Node's bundled Undici and the explicit proxy dependency expose different dispatcher types.
    const settings: RequestInit = { ...init, signal };
    Object.assign(settings, { dispatcher: await getAgent() });
    return fetchImpl(input, settings);
  };
  return { fetch: request, close: async () => { if (agent) await (await agent).close(); } };
}
