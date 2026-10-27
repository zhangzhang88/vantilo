import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const {proxyEnvironment, systemProxyEnvironment} = require('../electron/system-proxy.cjs');

describe('macOS Codex proxy configuration', () => {
  it('passes enabled HTTP, HTTPS and SOCKS proxies and safe bypasses', () => {
    const env=proxyEnvironment(`<dictionary> {
      HTTPEnable : 1
      HTTPProxy : 127.0.0.1
      HTTPPort : 7890
      HTTPSEnable : 1
      HTTPSProxy : 127.0.0.1
      HTTPSPort : 7890
      SOCKSEnable : 1
      SOCKSProxy : ::1
      SOCKSPort : 7891
      ExceptionsList : <array> {
        0 : *.example.test
        1 : bad/path
      }
    }`);
    expect(env).toEqual({HTTP_PROXY:'http://127.0.0.1:7890',HTTPS_PROXY:'http://127.0.0.1:7890',ALL_PROXY:'socks5h://[::1]:7891',NO_PROXY:'localhost,127.0.0.1,::1,.example.test'});
  });
  it('uses SOCKS for HTTPS when no HTTPS proxy is configured', () => {
    expect(proxyEnvironment('SOCKSEnable : 1\nSOCKSProxy : 127.0.0.1\nSOCKSPort : 1080').HTTPS_PROXY).toBe('socks5h://127.0.0.1:1080');
  });
  it('rejects disabled or malformed settings, and tolerates unavailable system configuration', () => {
    expect(proxyEnvironment('HTTPSEnable : 0\nHTTPSProxy : example.test\nHTTPSPort : 80')).toEqual({});
    expect(proxyEnvironment('HTTPSEnable : 1\nHTTPSProxy : user:password@example.test\nHTTPSPort : 80')).toEqual({});
    expect(systemProxyEnvironment({platform:'darwin',read:()=>{throw new Error('unavailable');}})).toEqual({});
    expect(systemProxyEnvironment({platform:'linux',read:()=>{throw new Error('must not read');}})).toEqual({});
  });
});
