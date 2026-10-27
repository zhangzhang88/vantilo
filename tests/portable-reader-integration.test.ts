import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { request as httpRequest } from 'node:http';
import { expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { startPortableReader } = require('../electron/portable-reader-service.cjs');
const sessionToken='a'.repeat(64), sessionCookie='__Host-vantilo-reader='+sessionToken;
function apiFetch(service:any,url:string,init:RequestInit={}) { const headers=new Headers(init.headers);headers.set('cookie',sessionCookie);return fetch(url,{...init,headers}); }

it('runs compiled Reader without source/Node dependencies, removes science APIs, and imports four latest fixture issues idempotently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vantilo-install-fixture-'));
  const epub = await readFile('tests/fixtures/minimal-magazine.epub');
  const directories = ['01_economist','02_new_yorker','04_atlantic','05_wired'];
  const prefixes = ['TheEconomist','NewYorker','TheAtlantic','Wired'];
  const fetchImpl = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.hostname === 'raw.githubusercontent.com') return new Response(epub, { headers: { 'content-type': 'application/epub+zip' } });
    expect(url.hostname).toBe('api.github.com');
    const relative = decodeURIComponent(url.pathname.split('/contents/')[1]!);
    const index = directories.indexOf(relative.split('/')[0]!);
    expect(index).toBeGreaterThanOrEqual(0);
    const issuePath = directories[index] + '/2026.10.24';
    const name = prefixes[index] + '.2026.10.24.epub';
    const entries = relative.includes('/') ? [{ type: 'file', name, path: issuePath+'/'+name, download_url: 'https://raw.githubusercontent.com/hehonghui/awesome-english-ebooks/master/'+issuePath+'/'+name }]
      : [{ type:'dir', name:'2026.10.24', path:issuePath }];
    return new Response(JSON.stringify(entries), { headers: { 'content-type':'application/json' } });
  });
  let service: any;
  try {
    service = await startPortableReader({ assetsDir:path.resolve('build/reader'), libraryRoot:root, apiPort:0, webPort:0, autoSync:false, fetchImpl,sessionToken });
    const page = await fetch(service.webOrigin+'/');
    expect(page.headers.get('content-security-policy')).toContain('frame-ancestors');
    const html = await page.text();
    expect(html).toContain('<title>Magazine Reader</title>');
    expect(await fetch(service.webOrigin+'/api/health').then(value=>value.json())).toMatchObject({ ok:true,reader:'epub' });
    // The native dictionary works even when the Reader has no ChatGPT connection or runAi provider.
    const offlineMeaning = await apiFetch(service,service.apiOrigin+'/api/dictionary?word=imposed').then(reply => reply.json());
    expect(offlineMeaning.definitionsZh).toHaveLength(2);
    expect(offlineMeaning.definitionsZh[0]).toMatchObject({source:'macos-dictionary'});
    expect(offlineMeaning.definitionsZh[1]).toMatchObject({source:'macos-dictionary-full'});
    for (const route of ['/api/science-articles','/api/content-discovery','/api/assistant/history','/api/ai-settings']) expect((await apiFetch(service,service.apiOrigin+route)).status).toBe(404);
    expect((await fetch(service.webOrigin+'/config/ai-providers.local.json')).status).toBe(404);
    await service.sync.check();
    expect(service.sync.getState()).toMatchObject({ status:'idle',importedCount:4,failedCount:0 });
    expect((await readdir(path.join(root,'issues'))).filter(name=>name.endsWith('.epub'))).toHaveLength(4);
    expect(await apiFetch(service,service.apiOrigin+'/api/issues').then(value=>value.json())).toHaveLength(4);
    const downloads = fetchImpl.mock.calls.filter(([url])=>url.startsWith('https://raw.')).length;
    await service.sync.check();
    expect(service.sync.getState()).toMatchObject({ importedCount:0,failedCount:0 });
    expect(fetchImpl.mock.calls.filter(([url])=>url.startsWith('https://raw.'))).toHaveLength(downloads);
    expect(await readdir(path.join(root,'data'))).not.toContain('codex-auth.local.json');
  } finally { await service?.close(); await rm(root,{recursive:true,force:true}); }
}, 15000);


it('uses the shared Agent for translation while dictionary lookup stays offline', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(),'vantilo-ai-fixture-'));
  const runAi = vi.fn(async ({instructions,input}: {instructions:string;input:string}) => {
    if(instructions.startsWith('Translate Part')) return JSON.stringify(JSON.parse(input).titles.map((item:{id:string})=>({id:item.id,titleZh:'测试章节'})));
    return '这是统一 Agent 的翻译。';
  });
  let service:any;
  try {
    service=await startPortableReader({assetsDir:path.resolve('build/reader'),libraryRoot:root,apiPort:0,webPort:0,autoSync:false,runAi,sessionToken});
    const translated = await apiFetch(service,service.apiOrigin+'/api/translate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'A synthetic fixture paragraph.'})});
    expect(translated.status).toBe(200);
    expect(await translated.json()).toMatchObject({translation:'这是统一 Agent 的翻译。',provider:'vantilo-agent'});
    expect(runAi).toHaveBeenCalledOnce();
    const dictionary = await apiFetch(service,service.apiOrigin+'/api/dictionary?word=imposed').then(value=>value.json());
    expect(dictionary.word).toBe('imposed');
    expect(dictionary.definitionsZh).toHaveLength(2);
    expect(dictionary.definitionsZh[0].source).toBe('macos-dictionary');
    expect(dictionary.definitionsZh[1].source).toBe('macos-dictionary-full');
    expect(dictionary.definitionsZh[0].definition).toContain('强制');
    expect(runAi).toHaveBeenCalledOnce();
    for(const headers of ([{origin:'https://evil.test',cookie:sessionCookie},{'sec-fetch-site':'cross-site',cookie:sessionCookie},{'sec-fetch-site':'same-site',cookie:sessionCookie}] as Record<string,string>[])) {
      expect((await fetch(service.apiOrigin+'/api/dictionary?word=blocked',{headers})).status).toBe(403);
    }
    expect(runAi).toHaveBeenCalledOnce();
    for(const url of ['/api/ai-settings','/api/ai-settings/profile']) expect((await apiFetch(service,service.apiOrigin+url)).status).toBe(404);
    for (const [method,url] of [['PUT','/api/ai-settings/profile'],['POST','/api/ai-settings/test'],['POST','/api/ai-settings/models'],['DELETE','/api/ai-settings/profiles/fixture']]) {
      const reply = await apiFetch(service,service.apiOrigin+url,{method,headers:{'content-type':'application/json'},body:'{}'});
      expect(reply.status).toBe(404);
    }
    const fixture=await readFile('tests/fixtures/minimal-magazine.epub');
    const imported=await apiFetch(service,service.apiOrigin+'/api/books/import?filename=FixtureBook.epub',{method:'POST',headers:{'content-type':'application/epub+zip'},body:fixture}).then(value=>value.json());
    expect(imported.status).toBe('imported');
    expect(runAi).toHaveBeenCalledOnce();
    expect((await apiFetch(service,service.apiOrigin+'/api/books/'+imported.bookId+'/toc-chinese',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(200);
    await vi.waitFor(async()=>{const status=await apiFetch(service,service.apiOrigin+'/api/books/'+imported.bookId+'/toc-chinese').then(value=>value.json());expect(status.state).toBe('ready');});
    expect(runAi).toHaveBeenCalledTimes(2);
    expect(await readdir(path.join(root,'config'))).toEqual([]);
  } finally { await service?.close(); await rm(root,{recursive:true,force:true}); }
});

it('rejects DNS-rebound Host and cross-site access at the Reader web proxy before touching the API', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vantilo-reader-origin-'));
  let service: any;
  try {
    service = await startPortableReader({ assetsDir:path.resolve('build/reader'), libraryRoot:root, apiPort:0, webPort:0, autoSync:false,requireSessionAuth:true,sessionToken });
    const web = new URL(service.webOrigin);
    const status = (requestPath: string, headers: Record<string,string>) => new Promise<number>((resolve,reject) => {
      const request = httpRequest({ hostname:'127.0.0.1', port:Number(web.port), path:requestPath, headers }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode || 0));
      });
      request.on('error', reject); request.end();
    });
    const host = web.host;
    expect(await status('/', {Host:'attacker.example:5175'})).toBe(403);
    expect(await status('/api/health', {Host:'attacker.example:5175'})).toBe(403);
    expect(await status('/api/health', {Host:host, Origin:'https://attacker.example'})).toBe(403);
    expect(await status('/api/health', {Host:host, 'Sec-Fetch-Site':'cross-site'})).toBe(403);
    expect(await status('/api/health', {Host:host, 'Sec-Fetch-Site':'same-site'})).toBe(403);
    expect(await status('/api/health', {Host:host, Origin:service.webOrigin, 'Sec-Fetch-Site':'same-origin'})).toBe(200);
    expect(await status('/api/issues', {Host:host})).toBe(401);
    expect((await fetch(service.apiOrigin+'/api/books')).status).toBe(401);
    expect((await fetch(service.apiOrigin+'/api/books',{headers:{cookie:'__Host-vantilo-reader='+ 'b'.repeat(64)}})).status).toBe(401);
    expect((await fetch(service.apiOrigin+'/api/books',{headers:{cookie:sessionCookie}})).status).toBe(200);
    expect(await status('/api/issues', {Host:host,Cookie:sessionCookie})).toBe(200);
    // The first frame document may be requested from file:// and must remain loadable.
    expect(await status('/', {Host:host, 'Sec-Fetch-Site':'cross-site'})).toBe(200);
  } finally { await service?.close(); await rm(root,{recursive:true,force:true}); }
});

it('serves repeated native dictionary queries after service restart without triggering any model turns', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vantilo-dictionary-service-'));
  const lookup = vi.fn(async () => { throw new Error('Dictionary must not request an AI model'); });
  let service: any;
  try {
    service = await startPortableReader({
      assetsDir: path.resolve('build/reader'), libraryRoot: root, apiPort: 0, webPort: 0,
      autoSync: false, runAi: lookup,sessionToken,
    });
    const get = () => apiFetch(service,service.apiOrigin + '/api/dictionary?word=imposed').then(reply => reply.json());
    const [first, second] = await Promise.all([get(), get()]);
    expect(first).toMatchObject({ word: 'imposed' });
    expect(second).toEqual(first);
    expect(lookup).not.toHaveBeenCalled();
    await service.close();
    service = null;

    const afterRestart = vi.fn(async () => { throw new Error('Cache should not call Agent'); });
    service = await startPortableReader({
      assetsDir: path.resolve('build/reader'), libraryRoot: root, apiPort: 0, webPort: 0,
      autoSync: false, runAi: afterRestart,sessionToken,
    });
    const cached = await apiFetch(service,service.apiOrigin + '/api/dictionary?word=Imposed').then(reply => reply.json());
    expect(cached.definitionsZh).toEqual(first.definitionsZh);
    expect(afterRestart).not.toHaveBeenCalled();
    const another = await apiFetch(service,service.apiOrigin + '/api/dictionary?word=impose').then(reply => reply.json());
    expect(another.definitionsZh[0].source).toBe('macos-dictionary');
    expect(afterRestart).not.toHaveBeenCalled();
  } finally {
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
});
