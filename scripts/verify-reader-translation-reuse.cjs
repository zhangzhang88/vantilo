require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();
// Isolated real Reader/Chromium translation-reuse test. The only fake boundary is the server translationProvider.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const { mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { startPortableReader } = require('../electron/portable-reader-service.cjs');
const profile = mkdtempSync(path.join(os.tmpdir(), 'vantilo-translation-profile-'));
app.setPath('userData', profile);
app.on('will-quit', () => rmSync(profile, { recursive: true, force: true }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let service, window, temp, stage = 'startup';
const calls = [];
const apiRequestEvents = [];
let activeProfileId = 'fixture-profile-a';
let activeModel = 'fixture-model-a';
const translationProvider = { async translate(input) {
  const hash = createHash('sha256').update(input.text).digest('hex').slice(0, 16);
  calls.push({ paragraphHash: hash, textLength: input.text.length, profileId: activeProfileId, model: activeModel, contextBefore: Boolean(input.contextBefore), contextAfter: Boolean(input.contextAfter) });
  return { translation: `合成译文 ${hash} ${activeModel}`, model: activeModel, provider: 'easycliproxy', profileId: activeProfileId };
} };
async function main() {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vantilo-translation-library-'));
  const token = randomBytes(32).toString('hex'), cookie = `__Host-vantilo-reader=${token}`;
  const libraryRoot = path.join(temp, 'library');
  const assetsDir = process.env.VANTILO_READER_TEST_ASSETS ? path.resolve(process.env.VANTILO_READER_TEST_ASSETS) : path.resolve(__dirname, '../build/reader');
  await fs.access(path.join(assetsDir, 'web/index.html'));
  await fs.access(path.join(assetsDir, 'api.cjs'));
  service = await startPortableReader({ assetsDir, libraryRoot, apiPort: 0, webPort: 0, autoSync: false, requireSessionAuth: true, sessionToken: token, translationProvider, getTranslationCacheIdentity: () => ({ profileId: activeProfileId, model: activeModel }), getAccountStatus: async () => ({ connected: false, email: null }), listModels: async () => ({ models: [] }) });
  const fixtureEpubPath = path.resolve(__dirname, '../tests/fixtures/minimal-magazine.epub');
  const fixtureRoot = path.join(temp, 'initial-epub');
  const initialEpubPath = path.join(temp, 'initial.epub');
  await fs.mkdir(fixtureRoot);
  execFileSync('unzip', ['-q', fixtureEpubPath, '-d', fixtureRoot]);
  const initialArticlePath = path.join(fixtureRoot, 'OEBPS/article.xhtml');
  const initialArticleMarkup = await fs.readFile(initialArticlePath, 'utf8');
  const unchangedSource = 'This independent synthetic paragraph remains unchanged to verify selective translation reuse after a neighboring paragraph is edited. It is original test content and contains enough words for the article parser.';
  const farUnchangedSource = 'This distant synthetic paragraph also remains unchanged and verifies that content outside the changed paragraph context continues to reuse its stored translation. Every word here is original test material.';
  if (!initialArticleMarkup.includes('</p></body>')) throw Error('Synthetic EPUB article body insertion point was not found');
  await fs.writeFile(initialArticlePath, initialArticleMarkup.replace('</p></body>', `</p><p>${unchangedSource}</p><p>${farUnchangedSource}</p></body>`));
  execFileSync('zip', ['-q', '-X', '-0', initialEpubPath, 'mimetype'], { cwd: fixtureRoot });
  execFileSync('zip', ['-q', '-X', '-r', initialEpubPath, 'META-INF', 'OEBPS'], { cwd: fixtureRoot });
  const epub = await fs.readFile(initialEpubPath);
  const imported = await fetch(`${service.apiOrigin}/api/import/epub?filename=TheEconomist.2099.10.29.epub`, { method: 'POST', headers: { cookie, 'content-type': 'application/epub+zip' }, body: epub });
  if (imported.status !== 201) throw Error(`Synthetic EPUB import failed: ${imported.status} ${await imported.text()}`);
  const importedIssue = await imported.json();
  const partitionId = `vantilo-translation-${Date.now()}`;
  const isolatedSession = session.fromPartition(partitionId);
  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.method === 'POST' && new URL(details.url).pathname === '/api/translate') {
      const bytes = details.uploadData?.flatMap(item => item.bytes ? [Buffer.from(item.bytes)] : []) ?? [];
      let parsed;
      try { parsed = JSON.parse(Buffer.concat(bytes).toString('utf8')); } catch {}
      apiRequestEvents.push({ length: typeof parsed?.text === 'string' ? parsed.text.length : 0, paragraphHash: typeof parsed?.text === 'string' ? createHash('sha256').update(parsed.text).digest('hex').slice(0, 16) : null, profileId: parsed?.expectedProfileId, model: parsed?.expectedModel });
    }
    callback({});
  });
  await isolatedSession.cookies.set({ url: service.webOrigin, name: '__Host-vantilo-reader', value: token, path: '/', httpOnly: true, secure: true, sameSite: 'no_restriction' });
  window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: partitionId, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const consoleErrors = [], failedRequests = [];
  window.webContents.on('console-message', (_event, level, message, line, source) => { if (level >= 2) consoleErrors.push({ level, message, line, source }); });
  window.webContents.on('did-fail-load', (_event, code, description, url) => failedRequests.push({ code, description, url }));
  const hostFile = path.join(temp, 'host.html');
  await fs.writeFile(hostFile, `<html><body style="margin:0"><iframe style="width:100vw;height:100vh;border:0" src="${service.webOrigin}/"></iframe></body></html>`);
  await window.loadFile(hostFile);
  const frameAt = async predicate => {
    for (let i = 0; i < 100; i++) {
      const frame = window.webContents.mainFrame.frames.find(item => item.url.startsWith(service.webOrigin));
      try {
        if (frame && await Promise.race([frame.executeJavaScript(predicate), delay(750).then(() => { throw new Error('frame evaluation timed out'); })])) return frame;
      } catch {}
      await delay(100);
    }
    const diagnostic = await window.webContents.executeJavaScript(`({url:location.href,title:document.title,body:document.body?.innerText?.slice(0,1500),frames:[...document.querySelectorAll('iframe')].map(f=>({src:f.src,loaded:f.contentDocument?.readyState})),frameUrls:[]})`).catch(error => ({ inspectionError: String(error) }));
    diagnostic.frameUrls = window.webContents.mainFrame.frames.map(item => item.url);
    diagnostic.childFrames = await Promise.all(window.webContents.mainFrame.frames.map(async item => ({ url: item.url, state: await item.executeJavaScript(`({title:document.title,state:document.readyState,text:document.body?.innerText?.slice(0,1000),root:Boolean(document.querySelector('#root'))})`).catch(error => ({ error: String(error) })) })));
    throw Error(`UI wait timed out: ${predicate}; page=${JSON.stringify(diagnostic)}; console=${JSON.stringify(consoleErrors)}; failed=${JSON.stringify(failedRequests)}; api=${JSON.stringify(apiRequestEvents)}; provider=${JSON.stringify(calls)}`);
  };
  const frame = await frameAt(`Boolean(document.querySelector('.global-nav-primary'))`);
  stage = 'navigation-to-article';
  // Navigate through the actual Reader UI to the imported synthetic issue/article.
  await frame.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('.global-nav-primary button')].find(x=>x.textContent.trim()==='期刊');if(!b)throw Error('期刊 navigation missing');b.click()})()`);
  await frameAt(`Boolean(document.querySelector('[data-testid^="publication-card-"]'))`);
  if (process.env.VANTILO_TRANSLATION_INIT_ONLY === '1') {
    const page = await frame.executeJavaScript(`({url:location.href,publicationCards:document.querySelectorAll('[data-testid^="publication-card-"]').length,body:document.body.innerText.slice(0,500)})`);
    console.log(JSON.stringify({ result: 'PASS', phase: 'isolated Reader initialization', assetsDir, page, importedIssue }, null, 2));
    return;
  }
  await frame.executeJavaScript(`document.querySelector('[data-testid^="publication-card-"]').click()`);
  await frameAt(`Boolean(document.querySelector('[data-testid="issue-card-${importedIssue.issueId}"]'))`);
  await frame.executeJavaScript(`document.querySelector('[data-testid="issue-card-${importedIssue.issueId}"]').click()`);
  await frameAt(`Boolean(document.querySelector('[data-testid^="toc-article-"]'))`);
  await frame.executeJavaScript(`document.querySelector('[data-testid^="toc-article-"] .toc-article-main').click()`);
  await frameAt(`Boolean(document.querySelector('.reader-full-translation-button'))`);
  const target = await frame.executeJavaScript(`({documentId:document.querySelector('.reader-page-shell')?.dataset.documentId||null,source:document.querySelector('.reader-page-shell')?.innerText?.slice(0,1000)})`);
  const apiBeforeFull = apiRequestEvents.length;
  await frame.executeJavaScript(`document.querySelector('.reader-full-translation-button').click()`);
  await frameAt(`(()=>{const r=JSON.parse(localStorage.getItem('magazine-reader-paragraph-translations-v1')||'[]');return (r.some(x=>x.targetKind==='title')&&r.some(x=>x.sourceText.includes('This original synthetic paragraph')))||document.body.innerText.includes('翻译失败')})()`);
  stage = 'waiting-full-translation-records';
  const afterFull = await frame.executeJavaScript(`({records:JSON.parse(localStorage.getItem('magazine-reader-paragraph-translations-v1')||'[]')})`);
  const fullApiRequestCount = apiRequestEvents.length - apiBeforeFull;
  if (!afterFull.records.length) throw Error(`Full translation produced no records; api=${JSON.stringify(apiRequestEvents.slice(apiBeforeFull))}; provider=${JSON.stringify(calls)}; activeConfig=${JSON.stringify(await fetch(`${service.apiOrigin}/api/translation-cache-identity`, {headers:{cookie}}).then(response=>response.json()))}; ui=${JSON.stringify(await frame.executeJavaScript('document.body.innerText.slice(-1200)'))}`);
  const paragraphRecord = afterFull.records.find(record => record.sourceText.includes('This original synthetic paragraph'));
  const unchangedParagraphRecord = afterFull.records.find(record => record.sourceText === unchangedSource);
  const farUnchangedParagraphRecord = afterFull.records.find(record => record.sourceText === farUnchangedSource);
  const titleRecord = afterFull.records.find(record => record.targetKind === 'title' && record.sourceText === 'Fixture article');
  if (!paragraphRecord || !unchangedParagraphRecord || !farUnchangedParagraphRecord || !titleRecord) throw Error('Full translation did not persist the fixture title and both body paragraphs');
  const titleHash = createHash('sha256').update(titleRecord.sourceText).digest('hex').slice(0, 16);
  const fullTitleApiRequests = apiRequestEvents.slice(apiBeforeFull).filter(request => request.paragraphHash === titleHash).length;
  const providerAfterFull = calls.length;
  const bodyPersistedBeforeSwitch = afterFull.records.some(record => record.key === paragraphRecord.key);
  await frame.executeJavaScript(`document.querySelector('.reader-chinese-button').click()`);
  await frameAt(`document.querySelector('.reader-page-shell')?.dataset.readerLanguage==='chinese'`);
  await delay(400);
  stage = 'first-listening-switch';
  const afterChinese = await frame.executeJavaScript(`({records:JSON.parse(localStorage.getItem('magazine-reader-paragraph-translations-v1')||'[]'),title:document.querySelector('.chinese-reading-heading h1')?.textContent,body:document.querySelector('.chinese-reading-paragraph p')?.textContent})`);
  const displayedTitleAndBody = afterChinese.title === `合成译文 ${createHash('sha256').update(titleRecord.sourceText).digest('hex').slice(0, 16)} fixture-model-a` && afterChinese.body === `合成译文 ${createHash('sha256').update(paragraphRecord.sourceText).digest('hex').slice(0, 16)} fixture-model-a`;
  const bodyHash = createHash('sha256').update(paragraphRecord.sourceText).digest('hex').slice(0, 16);
  const newApiRequests = apiRequestEvents.length - apiBeforeFull - fullApiRequestCount;
  const newApiForBody = apiRequestEvents.slice(apiBeforeFull + fullApiRequestCount).filter(request => request.paragraphHash === bodyHash).length;
  const newApiForTitle = apiRequestEvents.slice(apiBeforeFull + fullApiRequestCount).filter(request => request.paragraphHash === titleHash).length;
  const newProviderCalls = calls.length - providerAfterFull;
  const newProviderForBody = calls.slice(providerAfterFull).filter(item => item.paragraphHash === bodyHash).length;
  const newApiBodies = apiRequestEvents.slice(apiBeforeFull + fullApiRequestCount);
  const afterFirstSwitchProviderCount = calls.length;
  await frame.executeJavaScript(`document.querySelector('.reader-chinese-button').click()`);
  await frameAt(`document.querySelector('.reader-page-shell')?.dataset.readerLanguage!=='chinese'`);
  await frame.executeJavaScript(`document.querySelector('.reader-chinese-button').click()`);
  await frameAt(`document.querySelector('.reader-page-shell')?.dataset.readerLanguage==='chinese'`);
  const repeatedSwitch = apiRequestEvents.length;
  const repeatedSwitchProviderCalls = calls.length - afterFirstSwitchProviderCount;
  stage = 'repeated-switches-complete';
  const afterRepeatProviderCount = calls.length;
  const refreshApiStart = apiRequestEvents.length;
  await frame.executeJavaScript(`location.reload()`);
  const refreshedFrame = await frameAt(`document.querySelector('.reader-page-shell')?.dataset.readerLanguage==='chinese'`);
  stage = 'refresh-complete';
  const refreshApiRequests = apiRequestEvents.length - refreshApiStart;
  const refreshProviderCalls = calls.length - afterRepeatProviderCount;

  stage = 'original-change-test';
  let sourceChangeFrame = await frameAt(`document.querySelector('.reader-page-shell')?.dataset.readerLanguage==='chinese'`);
  await sourceChangeFrame.executeJavaScript(`setTimeout(()=>document.querySelector('.reader-chinese-button')?.click(),0);true`);
  sourceChangeFrame = await frameAt(`document.querySelector('.reader-page-shell')?.dataset.readerLanguage!=='chinese'`);
  const changedText = 'This replacement synthetic paragraph exists only to verify original text invalidation in isolated magazine reading tests. It remains entirely synthetic content, is not copied from any article, and supports reliable per paragraph translation checks.';
  const oldSource = paragraphRecord.sourceText;
  const sourceEpubPath = initialEpubPath;
  const unpackedEpub = path.join(temp, 'changed-epub');
  const changedEpubPath = path.join(temp, 'changed.epub');
  await fs.mkdir(unpackedEpub);
  execFileSync('unzip', ['-q', sourceEpubPath, '-d', unpackedEpub]);
  const articlePath = path.join(unpackedEpub, 'OEBPS/article.xhtml');
  const articleMarkup = await fs.readFile(articlePath, 'utf8');
  if (!articleMarkup.includes(oldSource)) throw Error('Synthetic EPUB source paragraph was not found for replacement');
  await fs.writeFile(articlePath, articleMarkup.replace(oldSource, changedText));
  execFileSync('zip', ['-q', '-X', '-0', changedEpubPath, 'mimetype'], { cwd: unpackedEpub });
  execFileSync('zip', ['-q', '-X', '-r', changedEpubPath, 'META-INF', 'OEBPS'], { cwd: unpackedEpub });
  const changedEpub = await fs.readFile(changedEpubPath);
  const beforeSourceChangeApi = apiRequestEvents.length, beforeSourceChangeProvider = calls.length;
  const replaceResponse = await fetch(`${service.apiOrigin}/api/issues/${encodeURIComponent(importedIssue.issueId)}/replace?filename=TheEconomist.2099.10.29.epub`, { method: 'POST', headers: { cookie, 'content-type': 'application/epub+zip' }, body: changedEpub });
  const replacementResult = await replaceResponse.json();
  if (!replaceResponse.ok || replacementResult.status !== 'replaced') throw Error(`Synthetic EPUB replacement failed: ${replaceResponse.status} ${JSON.stringify(replacementResult)}`);
  stage = 'source-change-reload';
  window.destroy();
  window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: partitionId, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.webContents.on('console-message', (_event, level, message, line, source) => { if (level >= 2) consoleErrors.push({ level, message, line, source }); });
  window.webContents.on('did-fail-load', (_event, code, description, url) => failedRequests.push({ code, description, url }));
  await window.loadFile(hostFile);
  let changedFrame = await frameAt(`Boolean(document.querySelector('[data-testid^="publication-card-"]'))`);
  await changedFrame.executeJavaScript(`document.querySelector('[data-testid^="publication-card-"]').click()`);
  changedFrame = await frameAt(`Boolean(document.querySelector('[data-testid="issue-card-${importedIssue.issueId}"]'))`);
  await changedFrame.executeJavaScript(`document.querySelector('[data-testid="issue-card-${importedIssue.issueId}"]').click()`);
  changedFrame = await frameAt(`Boolean(document.querySelector('[data-testid^="toc-article-"]'))`);
  await changedFrame.executeJavaScript(`document.querySelector('[data-testid^="toc-article-"] .toc-article-main').click()`);
  changedFrame = await frameAt(`document.body.innerText.includes(${JSON.stringify(changedText)})&&Boolean(document.querySelector('.reader-full-translation-button'))`);
  stage = 'source-changed-page-loaded';
  if (await changedFrame.executeJavaScript(`document.querySelector('.reader-page-shell')?.dataset.readerLanguage==='chinese'`)) {
    await changedFrame.executeJavaScript(`document.querySelector('.reader-chinese-button').click()`);
    changedFrame = await frameAt(`document.querySelector('.reader-page-shell')?.dataset.readerLanguage!=='chinese'`);
  }
  changedFrame = await frameAt(`Boolean(document.querySelector('.reader-full-translation-button')&&!document.querySelector('.reader-full-translation-button').disabled)`);
  await changedFrame.executeJavaScript(`document.querySelector('.reader-full-translation-button').click()`);
  stage = 'waiting-changed-text-translation';
  const changedHash = createHash('sha256').update(changedText).digest('hex').slice(0, 16);
  const unchangedHash = createHash('sha256').update(unchangedSource).digest('hex').slice(0, 16);
  for (let attempt = 0; attempt < 100 && (!calls.some(call => call.paragraphHash === changedHash) || calls.filter(call => call.paragraphHash === unchangedHash).length < 2); attempt++) await delay(100);
  if (!calls.some(call => call.paragraphHash === changedHash) || calls.filter(call => call.paragraphHash === unchangedHash).length < 2) throw Error('Full translation did not regenerate changed content and the context-invalidated neighbor');
  changedFrame = await frameAt(`JSON.parse(localStorage.getItem('magazine-reader-paragraph-translations-v1')||'[]').some(x=>x.sourceText===${JSON.stringify(changedText)}&&x.profileId==='fixture-profile-a')`);
  const changedApiEvents = apiRequestEvents.slice(beforeSourceChangeApi), changedProviderEvents = calls.slice(beforeSourceChangeProvider);
  const farUnchangedHash = createHash('sha256').update(farUnchangedSource).digest('hex').slice(0, 16);
  const sourceChangeApiRequests = changedApiEvents.length;
  const sourceChangeApiForBody = changedApiEvents.filter(event => event.paragraphHash === changedHash).length;
  const sourceChangeApiForTitle = changedApiEvents.filter(event => event.paragraphHash === titleHash).length;
  const sourceChangeApiForUnchangedBody = changedApiEvents.filter(event => event.paragraphHash === unchangedHash).length;
  const sourceChangeApiForFarUnchangedBody = changedApiEvents.filter(event => event.paragraphHash === farUnchangedHash).length;
  const sourceChangeProviderCalls = changedProviderEvents.length;
  const sourceChangeProviderForBody = changedProviderEvents.filter(event => event.paragraphHash === changedHash).length;
  const sourceChangeProviderForTitle = changedProviderEvents.filter(event => event.paragraphHash === titleHash).length;
  const sourceChangeProviderForUnchangedBody = changedProviderEvents.filter(event => event.paragraphHash === unchangedHash).length;
  const sourceChangeProviderForFarUnchangedBody = changedProviderEvents.filter(event => event.paragraphHash === farUnchangedHash).length;
  const recordStateAfterChange = await changedFrame.executeJavaScript(`JSON.parse(localStorage.getItem('magazine-reader-paragraph-translations-v1')||'[]')`);
  const titleStillCachedAfterChange = recordStateAfterChange.some(record => record.key === titleRecord.key && record.sourceText === titleRecord.sourceText && record.profileId === 'fixture-profile-a');
  const unchangedBodyStillCachedAfterChange = recordStateAfterChange.some(record => record.key === farUnchangedParagraphRecord.key && record.sourceText === farUnchangedSource && record.profileId === 'fixture-profile-a');
  const changedBodyCachedAfterChange = recordStateAfterChange.some(record => record.sourceText === changedText && record.profileId === 'fixture-profile-a');
  const beforeChangedListeningApi = apiRequestEvents.length, beforeChangedListeningProvider = calls.length;
  await changedFrame.executeJavaScript(`document.querySelector('.reader-chinese-button').click()`);
  changedFrame = await frameAt(`document.querySelector('.reader-page-shell')?.dataset.readerLanguage==='chinese'`);
  const changedListeningApiRequests = apiRequestEvents.length - beforeChangedListeningApi;
  const changedListeningProviderCalls = calls.length - beforeChangedListeningProvider;

  stage = 'model-switch-a-b-a';
  const apiBeforeModelSwitch = apiRequestEvents.length, providerBeforeModelSwitch = calls.length;
  activeProfileId = 'fixture-profile-b'; activeModel = 'fixture-model-b';
  await changedFrame.executeJavaScript(`setTimeout(()=>document.querySelector('.reader-chinese-button')?.click(),0);true`);
  let modelFrame = await frameAt(`document.querySelector('.reader-page-shell')?.dataset.readerLanguage!=='chinese'`);
  modelFrame = await frameAt(`Boolean(document.querySelector('.reader-full-translation-button')&&!document.querySelector('.reader-full-translation-button').disabled)`);
  if (await modelFrame.executeJavaScript(`document.querySelector('.reader-full-translation-button').getAttribute('aria-pressed')==='true'`)) {
    await modelFrame.executeJavaScript(`setTimeout(()=>document.querySelector('.reader-full-translation-button')?.click(),0);true`);
    modelFrame = await frameAt(`document.querySelector('.reader-full-translation-button')?.getAttribute('aria-pressed')==='false'`);
  }
  await modelFrame.executeJavaScript(`setTimeout(()=>document.querySelector('.reader-full-translation-button')?.click(),0);true`);
  modelFrame = await frameAt(`(()=>{const r=JSON.parse(localStorage.getItem('magazine-reader-paragraph-translations-v1')||'[]');return r.some(x=>x.targetKind==='title'&&x.profileId==='fixture-profile-b')&&r.some(x=>x.sourceText===${JSON.stringify(changedText)}&&x.profileId==='fixture-profile-b')&&r.some(x=>x.sourceText===${JSON.stringify(unchangedSource)}&&x.profileId==='fixture-profile-b')&&r.some(x=>x.sourceText===${JSON.stringify(farUnchangedSource)}&&x.profileId==='fixture-profile-b')})()`);
  const modelBApiEvents = apiRequestEvents.slice(apiBeforeModelSwitch), modelBProviderEvents = calls.slice(providerBeforeModelSwitch);
  const modelBTitleHash = titleHash, modelBBodyHash = changedHash;
  const modelBTranslationApiRequests = modelBApiEvents.length, modelBTranslationProviderCalls = modelBProviderEvents.length;
  const modelBIndependentTitleAndBody = modelBApiEvents.some(event => event.paragraphHash === modelBTitleHash) && modelBApiEvents.some(event => event.paragraphHash === modelBBodyHash) && modelBApiEvents.some(event => event.paragraphHash === unchangedHash) && modelBApiEvents.some(event => event.paragraphHash === farUnchangedHash);
  const beforeModelBListeningApi = apiRequestEvents.length, beforeModelBListeningProvider = calls.length;
  await modelFrame.executeJavaScript(`setTimeout(()=>document.querySelector('.reader-chinese-button')?.click(),0);true`);
  modelFrame = await frameAt(`document.querySelector('.reader-page-shell')?.dataset.readerLanguage==='chinese'`);
  modelFrame = await frameAt(`document.querySelector('.chinese-reading-heading h1')?.textContent===${JSON.stringify(`合成译文 ${titleHash} fixture-model-b`)}&&document.querySelector('.chinese-reading-paragraph p')?.textContent===${JSON.stringify(`合成译文 ${changedHash} fixture-model-b`)}`);
  const modelBListeningApiRequests = apiRequestEvents.length - beforeModelBListeningApi;
  const modelBListeningProviderCalls = calls.length - beforeModelBListeningProvider;
  const modelBListeningText = await modelFrame.executeJavaScript(`({title:document.querySelector('.chinese-reading-heading h1')?.textContent,bodies:[...document.querySelectorAll('.chinese-reading-paragraph p')].map(node=>node.textContent)})`);
  const modelBListeningShowsTranslation = modelBListeningText.title === `合成译文 ${modelBTitleHash} fixture-model-b` && modelBListeningText.bodies.includes(`合成译文 ${modelBBodyHash} fixture-model-b`) && modelBListeningText.bodies.includes(`合成译文 ${unchangedHash} fixture-model-b`) && modelBListeningText.bodies.includes(`合成译文 ${farUnchangedHash} fixture-model-b`);
  const beforeRestoreAApi = apiRequestEvents.length, beforeRestoreAProvider = calls.length;
  activeProfileId = 'fixture-profile-a'; activeModel = 'fixture-model-a';
  await modelFrame.executeJavaScript(`setTimeout(()=>document.querySelector('.reader-chinese-button')?.click(),0);true`);
  modelFrame = await frameAt(`document.querySelector('.reader-page-shell')?.dataset.readerLanguage!=='chinese'`);
  if (await modelFrame.executeJavaScript(`document.querySelector('.reader-full-translation-button').getAttribute('aria-pressed')==='true'`)) {
    await modelFrame.executeJavaScript(`setTimeout(()=>document.querySelector('.reader-full-translation-button')?.click(),0);true`);
    modelFrame = await frameAt(`document.querySelector('.reader-full-translation-button')?.getAttribute('aria-pressed')==='false'`);
  }
  await modelFrame.executeJavaScript(`setTimeout(()=>document.querySelector('.reader-full-translation-button')?.click(),0);true`);
  modelFrame = await frameAt(`document.querySelector('.reader-full-translation-button')?.getAttribute('aria-pressed')==='true'&&document.querySelector('.reading-title-zh')?.textContent===${JSON.stringify(`合成译文 ${titleHash} fixture-model-a`)}&&[...document.querySelectorAll('.translation-panel p')].some(node=>node.textContent===${JSON.stringify(`合成译文 ${changedHash} fixture-model-a`)})`);
  const modelARestoredText = await modelFrame.executeJavaScript(`({title:document.querySelector('.reading-title-zh')?.textContent,panels:[...document.querySelectorAll('.translation-panel p')].map(node=>node.textContent)})`);
  const modelARestoredFromCache = modelARestoredText.title === `合成译文 ${titleHash} fixture-model-a` && modelARestoredText.panels.includes(`合成译文 ${changedHash} fixture-model-a`);
  const modelARestoreApiRequests = apiRequestEvents.length - beforeRestoreAApi;
  const modelARestoreProviderCalls = calls.length - beforeRestoreAProvider;
  const modelAApiRequestsTotal = apiRequestEvents.filter(event => event.profileId === 'fixture-profile-a').length;
  const modelAProviderCallsTotal = calls.filter(event => event.profileId === 'fixture-profile-a').length;
  const modelBApiRequestsTotal = apiRequestEvents.filter(event => event.profileId === 'fixture-profile-b').length;
  const modelBProviderCallsTotal = calls.filter(event => event.profileId === 'fixture-profile-b').length;

  const result = { result: displayedTitleAndBody && bodyPersistedBeforeSwitch && newApiForBody === 0 && newProviderForBody === 0 && repeatedSwitch === apiBeforeFull + fullApiRequestCount + newApiRequests && repeatedSwitchProviderCalls === 0 && refreshApiRequests === 0 && refreshProviderCalls === 0 && sourceChangeApiRequests === 2 && sourceChangeApiForBody === 1 && sourceChangeApiForTitle === 0 && sourceChangeProviderCalls === 2 && sourceChangeProviderForBody === 1 && sourceChangeProviderForTitle === 0 && sourceChangeApiForUnchangedBody === 1 && sourceChangeProviderForUnchangedBody === 1 && sourceChangeApiForFarUnchangedBody === 0 && sourceChangeProviderForFarUnchangedBody === 0 && titleStillCachedAfterChange && unchangedBodyStillCachedAfterChange && changedBodyCachedAfterChange && changedListeningApiRequests === 0 && changedListeningProviderCalls === 0 && modelBTranslationApiRequests === 4 && modelBTranslationProviderCalls === 4 && modelBIndependentTitleAndBody && modelBListeningApiRequests === 0 && modelBListeningProviderCalls === 0 && modelBListeningShowsTranslation && modelARestoredFromCache && modelARestoreApiRequests === 0 && modelARestoreProviderCalls === 0 ? 'PASS' : 'FAIL', isolatedUserData: profile, isolatedLibrary: path.join(temp, 'library'), issueId: importedIssue.issueId, bodyParagraphKey: paragraphRecord.key, bodyHash, bodyPersistedBeforeSwitch, fullTranslationApiRequests: fullApiRequestCount, fullTranslationProviderCalls: providerAfterFull, modelAInitialFullApiRequests: fullApiRequestCount, modelAInitialFullProviderCalls: providerAfterFull, listeningAdditionalApiRequests: newApiRequests, listeningAdditionalApiRequestsForBody: newApiForBody, listeningAdditionalProviderCalls: newProviderCalls, listeningAdditionalProviderCallsForBody: newProviderForBody, listeningAdditionalApiBodies: newApiBodies, allProviderCalls: calls, titlePersistedAfterFull: afterFull.records.some(record => record.key === titleRecord.key), displayedTitleAndBody, titleParagraphKey: titleRecord.key, fullTitleApiRequests, listeningAdditionalApiRequestsForTitle: newApiForTitle, fullTitleApiRequests, repeatedModeSwitchApiRequests: repeatedSwitch - (apiBeforeFull + fullApiRequestCount + newApiRequests), repeatedModeSwitchProviderCalls: repeatedSwitchProviderCalls, refreshApiRequests, refreshProviderCalls, sourceChangeApiRequests, sourceChangeApiForBody, sourceChangeApiForTitle, sourceChangeProviderCalls, sourceChangeProviderForBody, sourceChangeProviderForTitle, sourceChangeApiForUnchangedBody, sourceChangeProviderForUnchangedBody, sourceChangeApiForFarUnchangedBody, sourceChangeProviderForFarUnchangedBody, cachedRecordsBeforeSourceChange: afterFull.records.length, cachedRecordsAfterSourceChange: recordStateAfterChange.length, sourceChangeContextNeighborRecomputed: sourceChangeApiForUnchangedBody === 1, titleStillCachedAfterChange, unchangedBodyStillCachedAfterChange, changedBodyCachedAfterChange, changedListeningApiRequests, changedListeningProviderCalls, modelBTranslationApiRequests, modelBTranslationProviderCalls, modelBIndependentTitleAndBody, modelBListeningApiRequests, modelBListeningProviderCalls, modelBListeningText, modelBListeningShowsTranslation, modelARestoredText, modelARestoredFromCache, modelARestoreApiRequests, modelARestoreProviderCalls, modelAApiRequestsTotal, modelAProviderCallsTotal, modelBApiRequestsTotal, modelBProviderCallsTotal, recordCountAfterFull: afterFull.records.length, recordCountAfterListening: afterChinese.records.length, storageSameOrigin: true, titleAndHeadingProviderCalls: calls.slice(providerAfterFull).filter(item => item.paragraphHash !== bodyHash).length, titleAndHeadingCallsIncludedSeparately: calls.filter(item => item.paragraphHash !== bodyHash).length, document: target };
  console.log(JSON.stringify(result, null, 2));
  if (result.result !== 'PASS') process.exitCode = 1;
}
const timeout = setTimeout(() => { console.error(`FAIL: translation reuse test timeout at stage=${stage}; api=${apiRequestEvents.length}; providers=${calls.length}`); app.exit(1); }, 60000);
app.whenReady().then(main).catch(error => { console.error(error?.stack || String(error)); process.exitCode = 1; }).finally(async () => {
  clearTimeout(timeout);
  const boundedCleanup = async (label, task) => {
    const started = Date.now();
    console.log(`[cleanup] ${label}: start`);
    let timer;
    try {
      await Promise.race([Promise.resolve().then(task), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cleanup timeout after 8000ms')), 8000); })]);
      console.log(`[cleanup] ${label}: done in ${Date.now() - started}ms`);
      return true;
    } catch (error) {
      console.error(`[cleanup] ${label}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally { clearTimeout(timer); }
  };
  if (!await boundedCleanup('window-destroy', () => { window?.destroy(); })) return app.exit(1);
  if (!await boundedCleanup('reader-service-close', async () => { await service?.close(); })) return app.exit(1);
  if (temp && !await boundedCleanup('temporary-data-removal', () => fs.rm(temp, { recursive: true, force: true }))) return app.exit(1);
  await boundedCleanup('electron-quit', () => app.quit());
});
app.on('window-all-closed', () => {});
