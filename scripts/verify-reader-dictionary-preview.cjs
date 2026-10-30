// Real compiled Reader in an isolated Electron profile with synthetic EPUB and dictionary data.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { startPortableReader } = require('../electron/portable-reader-service.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vantilo-dictionary-preview-'));
app.setPath('userData', path.join(temp, 'profile'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let service, win;
const timer = setTimeout(() => { console.error('FAIL: Reader dictionary UI timed out'); app.exit(1); }, 60000);
async function main() {
  const assetsDir = process.env.VANTILO_READER_TEST_ASSETS || path.resolve('build/reader-dev');
  const api = require(path.join(assetsDir, 'api.cjs'));
  const token = randomBytes(32).toString('hex');
  const examples = {
    three: ['A. noun\n① 三\n② 点钟\n③ 点\n④ 岁\nB. adjective\n① 三的', 'A. noun ① 三 ▸ three words; 三个词 ② 点钟 ③ 点 ④ 岁 B. adjective ① 三的'],
    one: ['A. noun\n① 一\n② 一个\n③ 一岁\n④ 一点\nB. adjective\n① 唯一的', 'A. noun ① 一 ▸ one example; 一个例子 ② 一个 ③ 一岁 ④ 一点 B. adjective ① 唯一的'],
    scarce: ['A. adjective\n① 稀少的', 'A. adjective ① 稀少的 ▸ scarce resources; 稀少的资源'],
  };
  const dictionaryProvider = { lookup: async word => {
    const [short, full] = examples[word] || ['', ''];
    return { word, phonetic: '/test/', usPhonetic: '/us/', ukPhonetic: '/uk/', usAudioUrl: '', ukAudioUrl: '', definitionsZh: [
      { definition: short, source: 'macos-dictionary', partOfSpeech: null, example: null },
      { definition: full, source: 'macos-dictionary-full', partOfSpeech: null, example: null },
    ], definitionsEn: [], englishDefinitionSource: 'unavailable', englishLookupWord: word, youdaoAvailable: false, dictionaryApiAvailable: false };
  } };
  service = await startPortableReader({ assetsDir, libraryRoot: path.join(temp, 'library'), apiPort: 0, webPort: 0, autoSync: false, sessionToken: token,
    apiModule: { ...api, buildServer: options => api.buildServer({ ...options, dictionaryProvider }) },
    getAccountStatus: async () => ({ connected: false, email: null }), listModels: async () => ({ models: [] }) });
  const root = path.join(temp, 'epub'); await fsp.mkdir(root);
  execFileSync('unzip', ['-q', path.resolve('tests/fixtures/minimal-magazine.epub'), '-d', root]);
  const article = path.join(root, 'OEBPS/article.xhtml');
  const markup = await fsp.readFile(article, 'utf8');
  await fsp.writeFile(article, markup.replace('This original synthetic paragraph', 'This three one scarce original synthetic paragraph'));
  const epubPath = path.join(temp, 'test.epub');
  execFileSync('zip', ['-q', '-X', '-0', epubPath, 'mimetype'], { cwd: root });
  execFileSync('zip', ['-q', '-X', '-r', epubPath, 'META-INF', 'OEBPS'], { cwd: root });
  const response = await fetch(`${service.apiOrigin}/api/import/epub?filename=TheEconomist.2099.10.29.epub`, { method: 'POST', headers: { cookie: `__Host-vantilo-reader=${token}`, 'content-type': 'application/epub+zip' }, body: await fsp.readFile(epubPath) });
  if (response.status !== 201) throw Error(`import failed: ${response.status}`);
  const issue = await response.json();
  const partition = 'dictionary-' + randomBytes(8).toString('hex');
  const isolated = session.fromPartition(partition);
  isolated.webRequest.onBeforeRequest((request, callback) => callback({ cancel: /^https?:/.test(request.url) && !request.url.startsWith(service.webOrigin) && !request.url.startsWith(service.apiOrigin) }));
  await isolated.cookies.set({ url: service.webOrigin, name: '__Host-vantilo-reader', value: token, path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction' });
  win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  await win.loadURL(service.webOrigin);
  const run = script => win.webContents.executeJavaScript(script);
  const until = async script => { for (let i = 0; i < 120; i++) { if (await run(script)) return; await delay(100); } throw Error('UI timeout: ' + script + ' ' + await run('document.body.innerText.slice(-1200)')); };
  await until("Boolean(document.querySelector('.global-nav-primary'))");
  await run("[...document.querySelectorAll('.global-nav-primary button')].find(x=>x.textContent.trim()==='期刊').click()");
  await until("Boolean(document.querySelector('[data-testid^=publication-card-]'))");
  await run("document.querySelector('[data-testid^=publication-card-]').click()");
  await until(`Boolean(document.querySelector('[data-testid="issue-card-${issue.issueId}"]'))`);
  await run(`document.querySelector('[data-testid="issue-card-${issue.issueId}"]').click()`);
  await until("Boolean(document.querySelector('[data-testid^=toc-article-] .toc-article-main'))");
  await run("document.querySelector('[data-testid^=toc-article-] .toc-article-main').click()");
  await until("Boolean(document.querySelector('[data-word-token=three]'))");
  await run(`(()=>{const original=window.fetch; window.fetch=(input,options)=>{
    const url=typeof input==='string'?input:input.url;
    if(url.includes('/api/vantilo-word-context')) {
      const request=JSON.parse(options.body);
      if(request.text==='three' && request.stage==='primary') return new Promise(resolve=>{window.__resolveFixtureMeaning=()=>resolve(new Response(JSON.stringify({engineId:request.engineId,meaningZh:'三个',explanationZh:'合成语境释义',partOfSpeech:'number',model:'fixture',provider:'easycliproxy'}),{status:200,headers:{'content-type':'application/json'}}))});
      return Promise.resolve(new Response('{}',{status:503}));
    }
    return original(input,options);
  }})()`);
  for (const [word, expected] of [['three', ['三','点钟','点']], ['one', ['一','一个','一岁']], ['scarce', ['稀少的']]]) {
    await run(`document.querySelector('[data-word-token="${word}"]').click()`);
    await until(`document.querySelectorAll('.vantilo-dictionary-preview-sense').length===${expected.length}`);
    const preview = await run(`(()=>{let card=document.querySelector('.word-lookup-card');return {meanings:[...card.querySelectorAll('.vantilo-dictionary-preview-sense')].map(x=>x.lastElementChild.textContent), labels:[...card.querySelectorAll('.vantilo-dictionary-preview-pos')].map(x=>x.textContent), nested:[...card.querySelectorAll('.word-lookup-dictionary-summary,.vantilo-dictionary-full,.vantilo-dictionary-full-body')].filter(x=>['auto','scroll'].includes(getComputedStyle(x).overflowY)&&x.scrollHeight>x.clientHeight).length}})()`);
    if (JSON.stringify(preview.meanings)!==JSON.stringify(expected) || preview.nested) throw Error(`${word} incorrect preview ${JSON.stringify(preview)}`);
    await run("document.querySelector('.vantilo-dictionary-full summary').click()");
    await until("Boolean(document.querySelector('.vantilo-dictionary-full[open] .vantilo-dict-article'))");
    const expanded = await run(`(()=>{const card=document.querySelector('.word-lookup-card'), detail=card.querySelector('.vantilo-dictionary-full'); return {text:detail.innerText, label:detail.querySelector('summary').innerText, nested:[...card.querySelectorAll('.word-lookup-dictionary-summary,.vantilo-dictionary-full,.vantilo-dictionary-full-body')].filter(x=>['auto','scroll'].includes(getComputedStyle(x).overflowY)&&x.scrollHeight>x.clientHeight).length}})()`);
    if (!expanded.label.includes('收起完整词条') || expanded.nested || !expanded.text.includes(word === 'scarce' ? '资源' : word === 'one' ? '唯一的' : '三的')) throw Error(`${word} incorrect full entry ${JSON.stringify(expanded)}`);
    await run("document.querySelector('.vantilo-dictionary-full summary').click()");
    if (!await run("!document.querySelector('.vantilo-dictionary-full').open && document.querySelector('.vantilo-dictionary-full summary').innerText.includes('查看完整词条与例句')")) throw Error('collapse failed');
    if (word === 'three') {
      await until("typeof window.__resolveFixtureMeaning==='function'");
      await run("document.querySelector('.word-lookup-card .familiarity-option.level-1').click()");
      await until("[...document.querySelectorAll('.saved-selection-inline-meaning')].some(x=>x.textContent==='三')");
      await run('window.__resolveFixtureMeaning()');
      await until("[...document.querySelectorAll('.saved-selection-inline-meaning')].some(x=>x.textContent==='三个')");
      console.log('PASS actual inline gloss: dictionary 三 while AI pending, then synthetic AI 三个');
    }
    await run("document.querySelector('.word-lookup-close').click()");
    console.log(`PASS ${word}: ${preview.meanings.join(' / ')}; full entry, collapse, no nested scrolling`);
  }
}
app.whenReady().then(main).then(async () => { await service.close(); win.destroy(); clearTimeout(timer); fs.rmSync(temp, { recursive: true, force: true }); app.exit(0); }).catch(async error => { console.error(error.stack); try { await service?.close(); } catch {} win?.destroy(); clearTimeout(timer); fs.rmSync(temp, { recursive: true, force: true }); app.exit(1); });
