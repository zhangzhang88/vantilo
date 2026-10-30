// Real isolated Electron/Chromium regression test for durable sentence-mode positions.
// Each worker is a fresh Electron process sharing only a temporary profile/library and synthetic EPUBs.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { startPortableReader } = require('../electron/portable-reader-service.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// Electron may retain Chromium flags in argv, so don't assume a fixed offset.
const workerArg = process.argv.indexOf('worker');
const role = workerArg >= 0 ? 'worker' : undefined;
const args = workerArg >= 0 ? process.argv.slice(workerArg + 1) : [];

function fail(message) { throw new Error(message); }
async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function makeSyntheticEpub(basePath, outputPath, insertion = '') {
  const root = outputPath + '.dir';
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.mkdir(root, { recursive: true });
  execFileSync('unzip', ['-q', basePath, '-d', root]);
  const articlePath = path.join(root, 'OEBPS/article.xhtml');
  let markup = await fsp.readFile(articlePath, 'utf8');
  const body = Array.from({ length: 90 }, (_, index) => `<p>Durable position fixture sentence ${String(index + 1).padStart(2, '0')} is original synthetic test content.</p>`).join('');
  const insertionMarkup = insertion ? `<p>${insertion} one.</p><p>${insertion} two.</p>` : '';
  if (!markup.includes('</p></body>')) fail('Synthetic EPUB article insertion point was not found');
  markup = markup.replace('</p></body>', `</p>${insertionMarkup}${body}</body>`);
  await fsp.writeFile(articlePath, markup);
  await fsp.rm(outputPath, { force: true });
  execFileSync('zip', ['-q', '-X', '-0', outputPath, 'mimetype'], { cwd: root });
  execFileSync('zip', ['-q', '-X', '-r', outputPath, 'META-INF', 'OEBPS'], { cwd: root });
  await fsp.rm(root, { recursive: true, force: true });
}

if (role !== 'worker') {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vantilo-sentence-restart-'));
  const controllerProfile = path.join(temp, 'controller-profile');
  app.setPath('userData', controllerProfile);
  app.setPath('sessionData', controllerProfile);
  let apiPort, webPort;
  const profile = path.join(temp, 'isolated-reader-profile');
  const libraryRoot = path.join(temp, 'synthetic-library');
  const fixture = path.resolve(__dirname, '../tests/fixtures/minimal-magazine.epub');
  const seedEpub = path.join(temp, 'synthetic.epub');
  const changedEpub = path.join(temp, 'synthetic-changed.epub');
  const idsPath = path.join(temp, 'issue-ids.json');
  const targetPath = path.join(temp, 'saved-target.json');
  const assetsDir = process.env.VANTILO_READER_TEST_ASSETS
    ? path.resolve(process.env.VANTILO_READER_TEST_ASSETS)
    : path.resolve(__dirname, '../build/reader');
  const partition = `persist:vantilo-sentence-${randomBytes(6).toString('hex')}`;
  const timeout = setTimeout(() => { console.error('FAIL: sentence-position restart test timed out'); app.exit(1); }, 180000);
  const childEnv = { ...process.env, VANTILO_SENTENCE_TEST_ROOT: temp, VANTILO_SENTENCE_TEST_PROFILE: profile,
    VANTILO_SENTENCE_TEST_LIBRARY: libraryRoot, VANTILO_SENTENCE_TEST_ASSETS: assetsDir,
    VANTILO_SENTENCE_TEST_PARTITION: partition, VANTILO_SENTENCE_TEST_API_PORT: String(apiPort),
    VANTILO_SENTENCE_TEST_WEB_PORT: String(webPort), VANTILO_SENTENCE_TEST_IDS: idsPath,
    VANTILO_SENTENCE_TEST_TARGET: targetPath, VANTILO_SENTENCE_TEST_SEED: seedEpub,
    VANTILO_SENTENCE_TEST_CHANGED: changedEpub };
  async function runWorker(phase) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--no-sandbox', __filename, 'worker', phase], { env: childEnv, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Electron worker ${phase} exited ${code ?? signal}`)));
    });
  }
  app.whenReady().then(async () => {
    apiPort = await reservePort();
    do { webPort = await reservePort(); } while (webPort === apiPort);
    childEnv.VANTILO_SENTENCE_TEST_API_PORT = String(apiPort);
    childEnv.VANTILO_SENTENCE_TEST_WEB_PORT = String(webPort);
    await makeSyntheticEpub(fixture, seedEpub);
    await makeSyntheticEpub(fixture, changedEpub, 'Inserted only for source-structure change validation');
    for (const phase of ['seed', 'restart-a-b-and-advance', 'restart-refresh-and-no-history', 'replace-source', 'restart-changed-source']) {
      await runWorker(phase);
      console.log(`PASS: isolated Electron process completed phase ${phase}`);
    }
    const summary = JSON.parse(await fsp.readFile(targetPath, 'utf8'));
    console.log('PASS: actual Electron process restart restored A at sentence 38, kept B independently at sentence 12, persisted rapid navigation through sentence 44, survived Reader refresh, started a new document at sentence 1, and resolved the same sentence after two synthetic source-structure insertions. No TTS auto-play or upstream AI request was made.');
    console.log(JSON.stringify({ result: 'PASS', applicationRestarts: 4, isolatedProfile: true, syntheticContentOnly: true, restoredA: summary.savedText, changedSourceExpectedOrdinal: summary.changedOrdinal, ttsAutoplay: 'NOT OBSERVED', realAi: 'NOT RUN' }, null, 2));
  }).then(() => { clearTimeout(timeout); fs.rmSync(temp, { recursive: true, force: true }); app.quit(); }).catch(error => {
    console.error(error.stack || String(error)); clearTimeout(timeout); fs.rmSync(temp, { recursive: true, force: true }); app.exit(1);
  });
} else {
  const [phase] = args;
  const temp = process.env.VANTILO_SENTENCE_TEST_ROOT;
  const profile = process.env.VANTILO_SENTENCE_TEST_PROFILE;
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  let service, window;
  const mediaStarts = [];
  const audioRequests = [];
  const consoleErrors = [];
  const token = randomBytes(32).toString('hex');
  const cookie = `__Host-vantilo-reader=${token}`;
  const timeout = setTimeout(() => { console.error(`FAIL: worker ${phase} timed out`); app.exit(1); }, 90000);

  async function workerMain() {
    await fsp.access(path.join(process.env.VANTILO_SENTENCE_TEST_ASSETS, 'web/index.html'));
    service = await startPortableReader({
      assetsDir: process.env.VANTILO_SENTENCE_TEST_ASSETS,
      libraryRoot: process.env.VANTILO_SENTENCE_TEST_LIBRARY,
      apiPort: Number(process.env.VANTILO_SENTENCE_TEST_API_PORT),
      webPort: Number(process.env.VANTILO_SENTENCE_TEST_WEB_PORT),
      autoSync: false, requireSessionAuth: true, sessionToken: token,
      getAccountStatus: async () => ({ connected: false, email: null }),
      listModels: async () => ({ models: [] }),
    });
    const idsPath = process.env.VANTILO_SENTENCE_TEST_IDS;
    let issueIds = fs.existsSync(idsPath) ? JSON.parse(await fsp.readFile(idsPath, 'utf8')) : null;
    if (phase === 'seed') {
      const epub = await fsp.readFile(process.env.VANTILO_SENTENCE_TEST_SEED);
      issueIds = {};
      for (const [label, date] of [['a', '2099.10.29'], ['b', '2099.10.30'], ['c', '2099.10.31']]) {
        const response = await fetch(`${service.apiOrigin}/api/import/epub?filename=TheEconomist.${date}.epub`, {
          method: 'POST', headers: { cookie, 'content-type': 'application/epub+zip' }, body: epub,
        });
        if (response.status !== 201) fail(`Synthetic ${label.toUpperCase()} EPUB import failed: ${response.status} ${await response.text()}`);
        issueIds[label] = (await response.json()).issueId;
      }
      await fsp.writeFile(idsPath, JSON.stringify(issueIds));
    }
    const isolatedSession = session.fromPartition(process.env.VANTILO_SENTENCE_TEST_PARTITION);
    isolatedSession.webRequest.onBeforeRequest((details, callback) => {
      const parsed = new URL(details.url);
      if (parsed.pathname.toLowerCase().includes('audio') || parsed.pathname.toLowerCase().includes('tts')) audioRequests.push(details.url);
      if (/^https?:/i.test(details.url) && !details.url.startsWith(service.webOrigin) && !details.url.startsWith(service.apiOrigin)) {
        callback({ cancel: true });
        return;
      }
      callback({});
    });
    await isolatedSession.cookies.set({ url: service.webOrigin, name: '__Host-vantilo-reader', value: token, path: '/', httpOnly: true, secure: true, sameSite: 'no_restriction' });
    window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: process.env.VANTILO_SENTENCE_TEST_PARTITION, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, level, message, line, source) => { if (level >= 2) consoleErrors.push({ message, line, source }); });
    window.webContents.on('media-started-playing', () => mediaStarts.push(Date.now()));
    const hostFile = path.join(temp, `host-${phase}.html`);
    await fsp.writeFile(hostFile, `<html><body style="margin:0"><iframe style="width:100vw;height:100vh;border:0" src="${service.webOrigin}/"></iframe></body></html>`);
    await window.loadFile(hostFile);
    const frameAt = async (predicate, limit = 120) => {
      for (let attempt = 0; attempt < limit; attempt += 1) {
        const frame = window.webContents.mainFrame.frames.find(item => item.url.startsWith(service.webOrigin));
        try { if (frame && await frame.executeJavaScript(predicate)) return frame; } catch {}
        await delay(100);
      }
      const details = await window.webContents.executeJavaScript('({text:document.body?.innerText?.slice(0,800),frames:[...document.querySelectorAll("iframe")].map(x=>x.src)})').catch(error => ({ error: String(error) }));
      fail(`UI wait timed out in ${phase}: ${predicate}; ${JSON.stringify(details)}; console=${JSON.stringify(consoleErrors)}`);
    };
    const click = async (frame, expression) => frame.executeJavaScript(`(()=>{const node=${expression};if(!node)throw Error('Reader control missing: '+${JSON.stringify(expression)});node.click();return true})()`);
    const openIssue = async issueId => {
      const existingFrame = window.webContents.mainFrame.frames.find(item => item.url.startsWith(service.webOrigin));
      if (existingFrame && await existingFrame.executeJavaScript(`Boolean(document.querySelector('.reader-page-shell'))`)) {
        await click(existingFrame, `document.querySelector('[aria-label="返回本期目录"]')`);
      }
      let frame = await frameAt(`Boolean(document.querySelector('.global-nav-primary'))`);
      await frame.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('.global-nav-primary button')].find(x=>x.textContent.trim()==='期刊');if(!b)throw Error('期刊 navigation missing');b.click()})()`);
      frame = await frameAt(`Boolean(document.querySelector('[data-testid^="publication-card-"]'))`);
      await click(frame, `document.querySelector('[data-testid^="publication-card-"]')`);
      frame = await frameAt(`Boolean(document.querySelector('[data-testid="issue-card-${issueId}"]'))`);
      await click(frame, `document.querySelector('[data-testid="issue-card-${issueId}"]')`);
      frame = await frameAt(`Boolean(document.querySelector('[data-testid^="toc-article-"]'))`);
      await frame.executeJavaScript(`(()=>{const button=document.querySelector('[data-testid^="toc-article-"] .toc-article-main');if(!button)throw Error('Article entry missing');button.click()})()`);
      return frameAt(`Boolean(document.querySelector('.reader-page-shell'))`);
    };
    const ensureSentenceMode = async frame => {
      await frame.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('.reader-mode-switch button')].find(x=>x.textContent.trim()==='逐句');if(!button)throw Error('Sentence mode control missing');if(button.getAttribute('aria-pressed')!=='true')button.click()})()`);
      return frameAt(`document.querySelector('.reader-page-shell')?.dataset.readerMode==='sentence'&&Boolean(document.querySelector('[data-testid="sentence-reading-source"]'))`);
    };
    const progressExpression = `Number(document.querySelector('.sentence-reading-meta span:last-child')?.textContent?.match(/\\d+/)?.[0]||0)`;
    const progress = frame => frame.executeJavaScript(progressExpression);
    const positionForIssue = async issueId => window.webContents.mainFrame.frames.find(item => item.url.startsWith(service.webOrigin)).executeJavaScript(`(()=>{const state=JSON.parse(localStorage.getItem('economist-reader-state-v1')||'{}');return Object.values(state.sentencePositions||{}).find(value=>value.documentId.includes(${JSON.stringify(issueId)}) )||null})()`);
    const waitForPosition = async (issueId, ordinal) => {
      for (let attempt = 0; attempt < 70; attempt += 1) {
        const saved = await positionForIssue(issueId);
        if (saved && saved.sentenceIndex + 1 === ordinal) return saved;
        await delay(50);
      }
      fail(`Sentence position ${ordinal} for ${issueId} was not persisted immediately`);
    };
    const setOrdinal = async (frame, issueId, ordinal) => {
      let current = await progress(frame);
      if (!current) fail('Sentence progress indicator is missing');
      while (current !== ordinal) {
        const next = current + (current < ordinal ? 1 : -1);
        await frame.executeJavaScript(`(()=>{const button=document.querySelector(${JSON.stringify(current < ordinal ? '[aria-label="下一句"]' : '[aria-label="上一句"]')});if(!button||button.disabled)throw Error('Sentence navigation unavailable');button.click()})()`);
        await frameAt(`${progressExpression}===${next}`);
        current = next;
        await waitForPosition(issueId, current);
      }
      return frame;
    };
    const verifyOrdinal = async (frame, issueId, ordinal) => {
      frame = await ensureSentenceMode(frame);
      const current = await progress(frame);
      if (current !== ordinal) fail(`Expected ${issueId} at sentence ${ordinal}, got ${current}`);
      const position = await positionForIssue(issueId);
      if (!position || position.sentenceIndex + 1 !== ordinal) fail(`Persisted ${issueId} sentence position did not match ${ordinal}`);
      return frame;
    };

    if (phase === 'seed') {
      let frame = await openIssue(issueIds.a);
      frame = await ensureSentenceMode(frame);
      await setOrdinal(frame, issueIds.a, 38);
      frame = await openIssue(issueIds.b);
      frame = await ensureSentenceMode(frame);
      await setOrdinal(frame, issueIds.b, 12);
    } else if (phase === 'restart-a-b-and-advance') {
      let frame = await openIssue(issueIds.a);
      frame = await verifyOrdinal(frame, issueIds.a, 38);
      frame = await openIssue(issueIds.b);
      frame = await verifyOrdinal(frame, issueIds.b, 12);
      frame = await openIssue(issueIds.a);
      frame = await setOrdinal(await ensureSentenceMode(frame), issueIds.a, 44);
      const savedText = await frame.executeJavaScript(`document.querySelector('[data-testid="sentence-reading-source"]')?.innerText||''`);
      await fsp.writeFile(process.env.VANTILO_SENTENCE_TEST_TARGET, JSON.stringify({ savedText, savedOrdinal: 44, changedOrdinal: 46 }));
    } else if (phase === 'restart-refresh-and-no-history') {
      let frame = await openIssue(issueIds.a);
      frame = await verifyOrdinal(frame, issueIds.a, 44);
      await frame.executeJavaScript('setTimeout(() => location.reload(), 0); true');
      await delay(500);
      frame = await frameAt(`Boolean(document.querySelector('.global-nav-primary, .reader-page-shell'))`);
      frame = await openIssue(issueIds.a);
      frame = await verifyOrdinal(frame, issueIds.a, 44);
      frame = await openIssue(issueIds.b);
      frame = await verifyOrdinal(frame, issueIds.b, 12);
      frame = await openIssue(issueIds.c);
      const before = await positionForIssue(issueIds.c);
      if (before) fail('A new document unexpectedly inherited another document’s sentence position');
      frame = await ensureSentenceMode(frame);
      if (await progress(frame) !== 1) fail('A new document without history did not start at sentence 1');
    } else if (phase === 'replace-source') {
      const epub = await fsp.readFile(process.env.VANTILO_SENTENCE_TEST_CHANGED);
      const response = await fetch(`${service.apiOrigin}/api/issues/${encodeURIComponent(issueIds.a)}/replace?filename=TheEconomist.2099.10.29.epub`, { method: 'POST', headers: { cookie, 'content-type': 'application/epub+zip' }, body: epub });
      const result = await response.json();
      if (!response.ok || result.status !== 'replaced') fail(`Synthetic source replacement failed: ${response.status} ${JSON.stringify(result)}`);
    } else if (phase === 'restart-changed-source') {
      const target = JSON.parse(await fsp.readFile(process.env.VANTILO_SENTENCE_TEST_TARGET, 'utf8'));
      let frame = await openIssue(issueIds.a);
      frame = await ensureSentenceMode(frame);
      const ordinal = await progress(frame);
      const restoredText = await frame.executeJavaScript(`document.querySelector('[data-testid="sentence-reading-source"]')?.innerText||''`);
      if (restoredText !== target.savedText || ordinal !== target.changedOrdinal) fail(`Changed source restored the wrong sentence: expected ${JSON.stringify(target)}, got ordinal ${ordinal} text ${JSON.stringify(restoredText)}`);
    }

    if (audioRequests.length || mediaStarts.length) fail(`Unexpected audio/TTS playback: requests=${audioRequests.length}, mediaStarts=${mediaStarts.length}`);
    await service.close();
    service = null;
    window.destroy();
    window = null;
    console.log(`PASS worker ${phase}: no auto-play (media=${mediaStarts.length}, audioRequests=${audioRequests.length}); realAi=NOT RUN`);
  }
  app.whenReady().then(workerMain).then(() => { clearTimeout(timeout); app.exit(0); }).catch(async error => {
    console.error(error.stack || String(error));
    clearTimeout(timeout);
    try { await service?.close(); } catch {}
    window?.destroy();
    app.exit(1);
  });
}
