// Isolated Electron end-to-end check of the built Reader, navigation bridge and actual growth-session functions.
// Uses only the synthetic minimal-magazine fixture in a disposable profile/library.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const ts = require('typescript');
const { startPortableReader } = require('../electron/portable-reader-service.cjs');

require.extensions['.ts'] = (module, filename) => {
  const source = require('node:fs').readFileSync(filename, 'utf8');
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
};
const { emptyGrowthRecord } = require('../src/reader/growth.ts');
const { acceptReaderState, createReadingSession, leaveReadingSession, pauseSession, readerActivity, tickSession } = require('../src/reader/growth-session.ts');
const repo = path.resolve(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const totalSeconds = record => Object.values(record.days || {}).reduce((sum, day) => sum + day.seconds, 0);

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vantilo-growth-navigation-e2e-'));
  app.setPath('userData', path.join(temp, 'profile'));
  await fs.mkdir(path.join(temp, 'profile'));
  let service, win;
  let state = createReadingSession(emptyGrowthRecord());
  let currentToken = null;
  let messageCursor = 0;
  const tickTimer = setInterval(() => { state = tickSession(state, Date.now()); }, 1000);
  try {
    await app.whenReady();
    const token = randomBytes(32).toString('hex');
    service = await startPortableReader({
      assetsDir: process.env.VANTILO_READER_TEST_ASSETS ? path.resolve(process.env.VANTILO_READER_TEST_ASSETS) : path.join(repo, 'build/reader'),
      libraryRoot: path.join(temp, 'reader-library'), apiPort: 0, webPort: 0, autoSync: false,
      sessionToken: token, requireSessionAuth: true,
      getAccountStatus: async () => ({ connected: false, email: null }), listModels: async () => ({ models: [] }),
    });
    const synthetic = await fs.readFile(path.join(repo, 'tests/fixtures/minimal-magazine.epub'));
    const filename = 'TheEconomist.2099.10.29.epub';
    const imported = await fetch(`${service.apiOrigin}/api/import/epub?filename=${encodeURIComponent(filename)}`, {
      method: 'POST', headers: { 'content-type': 'application/epub+zip', cookie: `__Host-vantilo-reader=${token}` }, body: synthetic,
    });
    if (imported.status !== 201) throw new Error(`Synthetic issue import failed (${imported.status}): ${await imported.text()}`);
    const issue = await imported.json();

    const partition = `vantilo-growth-navigation-${Date.now()}`;
    const readerSession = session.fromPartition(partition);
    await readerSession.cookies.set({ url: service.webOrigin, name: '__Host-vantilo-reader', value: token, path: '/', httpOnly: true, secure: true, sameSite: 'no_restriction' });
    const externalRequests = [];
    readerSession.webRequest.onBeforeRequest((details, done) => {
      const allowed = details.url.startsWith(service.webOrigin + '/') || ['file:', 'about:', 'data:', 'devtools:'].some(prefix => details.url.startsWith(prefix));
      if (!allowed) externalRequests.push(details.url.slice(0, 160));
      done({ cancel: !allowed });
    });
    const hostFile = path.join(temp, 'host.html');
    await fs.writeFile(hostFile, `<!doctype html><html><body style="margin:0"><div id="state">Reader</div><iframe title="Reader" style="width:100vw;height:100vh;border:0" src="${service.webOrigin}/"></iframe><script>
      window.readerMessages=[];window.readerToken=null;
      const frame=()=>document.querySelector('iframe');
      function arm(){const token=crypto.randomUUID();window.readerToken=token;let attempts=0;const send=()=>{if(!frame()?.contentWindow)return;frame().contentWindow.postMessage({type:'vantilo:growth-init',token},'*');if(++attempts<30)setTimeout(send,100);};send();}
      window.addEventListener('message',event=>window.readerMessages.push({data:event.data,origin:event.origin,fromReader:event.source===frame()?.contentWindow}));
      frame().addEventListener('load',()=>{if(frame().src!=='about:blank')arm();});
      window.leaveForDiscovery=()=>{document.getElementById('state').textContent='发现好书';frame().src='about:blank';};
      window.returnToReader=url=>{document.getElementById('state').textContent='Reader';frame().src=url;};
    </script></body></html>`);
    win = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    await win.loadFile(hostFile);
    const readerFrame = async () => win.webContents.mainFrame.frames.find(frame => frame.url.startsWith(service.webOrigin + '/'));
    const processMessages = async () => {
      const messages = await win.webContents.executeJavaScript(`window.readerMessages.slice(${messageCursor})`);
      messageCursor += messages.length;
      for (const { data, origin, fromReader } of messages) {
        if (!fromReader || origin !== service.webOrigin || !data || typeof data !== 'object') continue;
        if (data.type === 'vantilo:growth-ready' && data.token === await win.webContents.executeJavaScript('window.readerToken')) currentToken = data.token;
        if (!currentToken || data.token !== currentToken) continue;
        if (data.type === 'vantilo:growth-state' && typeof data.bookId === 'string' && typeof data.documentId === 'string' && typeof data.pageId === 'string' && (data.mode === 'sentence' || data.mode === 'article') && typeof data.english === 'boolean') {
          const next = acceptReaderState(state, data, Date.now());
          state = next;
        } else if (data.type === 'vantilo:growth-activity' && data.documentId === state.documentId && data.pageId === state.pageId) {
          state = readerActivity(state, Date.now());
        } else if (data.type === 'vantilo:growth-leave' && data.bookId === state.bookId && data.documentId === state.documentId && data.pageId === state.pageId) {
          state = leaveReadingSession(state, data.documentId, data.pageId);
        } else if (data.type === 'vantilo:open-discovery' && data.documentId === state.documentId && data.bookId === state.bookId && data.pageId === state.pageId) {
          state = leaveReadingSession(state, data.documentId, data.pageId);
          await win.webContents.executeJavaScript('window.leaveForDiscovery()');
        }
      }
      return messages;
    };
    const waitFor = async (predicate, label, limit = 120) => {
      for (let i = 0; i < limit; i++) { await processMessages(); if (await predicate()) return; await wait(100); }
      throw new Error(`Timed out waiting for ${label}`);
    };
    const click = async (frame, selector, label) => {
      const ok = await frame.executeJavaScript(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.click();return true})()`);
      if (!ok) throw new Error(`Missing ${label}: ${selector}`);
    };
    const openArticle = async () => {
      let frame = await readerFrame();
      if (frame && await frame.executeJavaScript('Boolean(document.querySelector(".reader-page-shell"))')) return frame;
      await waitFor(async () => Boolean(await readerFrame() && await (await readerFrame()).executeJavaScript('document.querySelector("[data-testid^=publication-card-]")')), 'publication directory');
      frame = await readerFrame();
      const pubs = await frame.executeJavaScript(`[...document.querySelectorAll('[data-testid^="publication-card-"]')].map(x=>({id:x.dataset.testid,text:x.innerText}))`);
      const publication = pubs.find(item => item.id.endsWith('economist')) || pubs[0];
      if (!publication) throw new Error('Synthetic publication missing: ' + JSON.stringify(pubs));
      await click(frame, `[data-testid="${publication.id}"]`, 'publication');
      await waitFor(async () => Boolean(await readerFrame() && await (await readerFrame()).executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(`[data-testid="issue-card-${issue.issueId}"]`)}))`)), 'issue directory');
      frame = await readerFrame(); await click(frame, `[data-testid="issue-card-${issue.issueId}"]`, 'issue');
      await waitFor(async () => Boolean(await readerFrame() && await (await readerFrame()).executeJavaScript('Boolean(document.querySelector("[data-testid^=toc-article-] .toc-article-main"))')), 'article directory');
      frame = await readerFrame(); await click(frame, '[data-testid^="toc-article-"] .toc-article-main', 'English article');
      await waitFor(async () => Boolean(await readerFrame() && await (await readerFrame()).executeJavaScript('Boolean(document.querySelector(".reader-page-shell"))')), 'English article page');
      return readerFrame();
    };
    const runIssueDirectoryAndReturn = async (dwellMs = 0, expectActive = true) => {
      let frame = await readerFrame();
      await click(frame, 'button[aria-label="返回本期目录"]', 'article return-to-issue-directory action');
      await waitFor(async () => Boolean(await readerFrame() && await (await readerFrame()).executeJavaScript('Boolean(document.querySelector(".toc-article-list"))')), 'issue directory');
      await processMessages();
      const afterExit = totalSeconds(state.record);
      if (state.active || !state.pauseReasons.includes('navigation')) throw new Error('ReaderPage unmount did not pause the session on issue-directory navigation: '+JSON.stringify({active:state.active,pauseReasons:state.pauseReasons}));
      await wait(dwellMs); await processMessages();
      const afterDwell = totalSeconds(state.record);
      frame = await readerFrame();
      await click(frame, '[data-testid^="toc-article-"] .toc-article-main', 'reopen same English article');
      await waitFor(async () => Boolean(await readerFrame() && await (await readerFrame()).executeJavaScript('Boolean(document.querySelector(".reader-page-shell"))')), 'same article page remount');
      frame = await readerFrame();
      await waitFor(async () => { await processMessages(); return Boolean(state.documentId && state.pageId && (expectActive ? state.active : !state.active && state.pauseReasons.includes('user'))) && Boolean(await frame.executeJavaScript('Boolean(document.querySelector(".reader-page-shell"))')); }, expectActive ? 'automatic timer recovery' : 'retained user pause');
      return { afterExit, afterDwell, frame };
    };

    let frame = await openArticle();
    await waitFor(async () => { await processMessages(); return state.active && state.documentId && state.mode === 'article'; }, 'active English article state');
    if (!state.documentId || !state.pageId || !currentToken) throw new Error('Reader did not send document identity and valid instance token.');
    await waitFor(async () => totalSeconds(state.record) >= 2, 'initial reading accumulation');
    const beforeDiscovery = totalSeconds(state.record);
    const first = await runIssueDirectoryAndReturn(4200, true);
    const directoryAtExit = first.afterExit;
    const afterDirectory = first.afterDwell;
    if (afterDirectory !== directoryAtExit) throw new Error(`Directory dwell accumulated time: ${directoryAtExit}->${afterDirectory}`);
    await waitFor(async () => state.active, 'same-article auto-resume');
    await wait(2200); await processMessages();
    const afterReopen = totalSeconds(state.record);
    if (afterReopen <= afterDirectory) throw new Error('Same article did not resume accruing without timer interaction.');
    const resumedMode = state.mode;

    frame = first.frame;
    await frame.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('.reader-mode-switch button')].find(x=>x.textContent.trim()==='逐句');if(!b)throw new Error('逐句 button missing');b.click()})()`);
    await waitFor(async () => { await processMessages(); return state.mode === 'sentence'; }, 'sentence-mode state');
    if (!state.active) throw new Error('Switching to sentence mode stopped an active reading session.');
    state = pauseSession(state, 'user');
    const pausedSeconds = totalSeconds(state.record);
    const pausedFlow = await runIssueDirectoryAndReturn(2200, false);
    if (state.active || totalSeconds(state.record) !== pausedSeconds || state.pauseReasons.includes('user') === false) throw new Error('User pause was auto-cleared during return from discovery.');
    const userPausedMode = state.mode;

    if (externalRequests.length) throw new Error('External requests attempted: ' + JSON.stringify(externalRequests.slice(0, 3)));
    console.log(JSON.stringify({
      result: 'PASS', environment: 'real Electron/Chromium, built Reader article→issue-directory→same-article UI; isolated synthetic issue; actual growth-session source functions apply captured Reader messages',
      issue: issue.issueId, articleIdentity: { documentId: state.documentId, pageId: state.pageId },
      firstArticleSeconds: beforeDiscovery,
      directory: { secondsAtExit: directoryAtExit, secondsAfter4200ms: afterDirectory, added: afterDirectory - directoryAtExit },
      sameArticleReturn: { secondsAfterReturn: afterReopen, added: afterReopen - afterDirectory, mode: resumedMode, timerClicked: false },
      sentenceModeUserPause: { mode: userPausedMode, pauseAppliedBy: 'actual pauseSession(state, "user") in the isolated host harness', activeAfterReturn: state.active, pauseReasons: state.pauseReasons },
      userPausedReturn: { secondsAtExit: pausedFlow.afterExit, secondsAfter2200ms: totalSeconds(state.record), active: state.active },
      externalRequests: 0,
    }, null, 2));
  } finally {
    clearInterval(tickTimer);
    win?.destroy();
    await service?.close().catch(() => {});
    await fs.rm(temp, { recursive: true, force: true });
  }
}

app.on('window-all-closed',()=>{});
const deadline=setTimeout(()=>{console.error('E2E TIMEOUT');app.exit(1);},30000);
main().then(()=>{clearTimeout(deadline);app.quit();}).catch(error => { console.error('E2E FAILED',error.stack || error); clearTimeout(deadline); app.exit(1); });
