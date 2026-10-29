// Actual Electron/Chromium UI acceptance against a read-only view of the existing local book library.
// Set VANTILO_READER_LIBRARY to userData/reader-library and
// VANTILO_GROWTH_SCREENSHOT_DIR to a directory outside this repository.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const { mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { startPortableReader } = require('../electron/portable-reader-service.cjs');
const { READER_SESSION_COOKIE } = require('../electron/reader-session-cookie.cjs');

const repo = path.resolve(__dirname, '..');
const libraryRoot = process.env.VANTILO_READER_LIBRARY;
const screenshotDir = process.env.VANTILO_GROWTH_SCREENSHOT_DIR;
if (!path.isAbsolute(libraryRoot || '') || !path.isAbsolute(screenshotDir || '') || screenshotDir.startsWith(repo + path.sep)) {
  throw new Error('Set absolute VANTILO_READER_LIBRARY and an external VANTILO_GROWTH_SCREENSHOT_DIR.');
}
const profile = mkdtempSync(path.join(os.tmpdir(), 'vantilo-growth-live-profile-'));
app.setPath('userData', profile);
let root, service, win;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { console.error('FAIL: live growth UI timeout'); app.exit(1); }, 45000);
app.on('will-quit', () => {
  try { if (root) rmSync(root, { recursive: true, force: true }); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  void service?.close().catch(() => {});
});

app.whenReady().then(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vantilo-growth-live-host-'));
  const token = randomBytes(32).toString('hex');
  service = await startPortableReader({
    assetsDir: path.join(repo, 'build/reader'), libraryRoot, apiPort: 0, webPort: 0,
    autoSync: false, sessionToken: token, requireSessionAuth: true,
    getAccountStatus: async () => ({ connected: false, email: null }), listModels: async () => ({ models: [] }),
  });
  const cookie = `${READER_SESSION_COOKIE}=${token}`;
  const booksResponse = await fetch(service.apiOrigin + '/api/books', { headers: { cookie } });
  if (!booksResponse.ok) throw new Error('Could not list the existing local books.');
  const books = await booksResponse.json();
  const book = books.find(item => /^(en|eng)(-|$)/i.test(item.language || ''));
  if (!book) throw new Error('No English book is available in the selected local library.');

  const partition = `vantilo-growth-live-${Date.now()}`;
  const webSession = session.fromPartition(partition);
  await webSession.cookies.set({ url: service.webOrigin, name: '__Host-vantilo-reader', value: token, path: '/', httpOnly: true, secure: true, sameSite: 'no_restriction' });
  const external = [];
  webSession.webRequest.onBeforeRequest((details, done) => {
    const local = details.url.startsWith(service.webOrigin + '/') || ['file:', 'about:', 'data:', 'devtools:'].some(prefix => details.url.startsWith(prefix));
    if (!local) external.push(details.url.slice(0, 160));
    done({ cancel: !local });
  });
  const hostFile = path.join(root, 'host.html');
  await fs.writeFile(hostFile, `<html><body style="margin:0"><iframe title="Reader" style="width:100vw;height:100vh;border:0" src="${service.webOrigin}/"></iframe><script>window.growthMessages=[];window.addEventListener('message',event=>window.growthMessages.push(event.data));</script></body></html>`);
  win = new BrowserWindow({ show: true, width: 1440, height: 900, webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  await win.loadFile(hostFile);
  const frameForReader = async () => win.webContents.mainFrame.frames.find(frame => frame.url.startsWith(service.webOrigin));
  let frame;
  for (let i = 0; i < 80; i++) {
    frame = await frameForReader();
    if (frame && await frame.executeJavaScript('Boolean(document.querySelector(".global-navigation"))')) break;
    await wait(125);
  }
  if (!frame) throw new Error('Built Reader did not load.');
  const openBooks = await frame.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='电子书');if(!b)return false;b.click();return true})()`);
  if (!openBooks) throw new Error('Bookshelf navigation is missing.');
  const bookId = JSON.stringify(book.id);
  let cardReady = false;
  for (let i = 0; i < 80; i++) {
    cardReady = await frame.executeJavaScript(`Boolean(document.querySelector('[data-testid="book-card-'+${bookId}+'"]'))`);
    if (cardReady) break;
    await wait(125);
  }
  if (!cardReady) throw new Error('The selected local English book did not appear on the bookshelf.');
  await frame.executeJavaScript(`document.querySelector('[data-testid="book-card-'+${bookId}+'"]').click()`);
  let detailReady = false;
  for (let i = 0; i < 80; i++) {
    detailReady = await frame.executeJavaScript('Boolean(document.querySelector("[data-testid=book-detail-continue],[data-testid^=book-toc-chapter-]"))');
    if (detailReady) break;
    await wait(125);
  }
  if (!detailReady) throw new Error('The selected English book could not open its chapter list.');
  await frame.executeJavaScript('(()=>{const b=document.querySelector("[data-testid=book-detail-continue]")||document.querySelector("[data-testid^=book-toc-chapter-]");if(!b)throw new Error("No chapter to open");b.click()})()');
  for (let i = 0; i < 80; i++) {
    if (await frame.executeJavaScript('Boolean(document.querySelector(".reader-page-shell"))')) break;
    await wait(125);
  }
  await frame.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('.reader-mode-switch button')].find(x=>x.textContent.trim()==='逐句');if(!b)throw new Error('逐句模式按钮缺失');b.click()})()`);
  for (let i = 0; i < 40; i++) {
    if (await frame.executeJavaScript('document.querySelector(".reader-page-shell")?.classList.contains("is-sentence-mode")')) break;
    await wait(100);
  }
  if (!await frame.executeJavaScript('document.querySelector(".reader-page-shell")?.classList.contains("is-sentence-mode")')) throw new Error('Could not enter sentence mode.');

  const growthToken = randomBytes(32).toString('hex');
  const sendHostMessage = data => win.webContents.executeJavaScript(`document.querySelector('iframe').contentWindow.postMessage(${JSON.stringify(data)},'*')`);
  for (let i = 0; i < 30; i++) {
    await sendHostMessage({ type: 'vantilo:growth-init', token: growthToken });
    if (await win.webContents.executeJavaScript(`window.growthMessages.some(m=>m?.type==='vantilo:growth-ready'&&m.token===${JSON.stringify(growthToken)})`)) break;
    await wait(100);
  }
  await sendHostMessage({ type: 'vantilo:growth-summary', token: growthToken, seconds: 285.45599999999996, active: true, canResume: false });
  for (let i = 0; i < 20; i++) {
    if (await frame.executeJavaScript('document.querySelector(".reader-growth-timer")?.textContent.includes("04:45 / 30:00")')) break;
    await wait(100);
  }
  const inspectToolbar = () => frame.executeJavaScript(`(()=>{const timer=document.querySelector('.reader-growth-timer'),bar=document.querySelector('.reader-toolbar');if(!timer||!bar)return null;const t=timer.getBoundingClientRect(),b=bar.getBoundingClientRect();return {text:timer.textContent,visible:getComputedStyle(timer).display!=='none',insideToolbar:bar.contains(timer),timerWithinViewport:t.left>=0&&t.right<=innerWidth,toolbarHeight:b.height,timerCount:document.querySelectorAll('.reader-growth-timer').length,navEntry:document.querySelector('[aria-label="我的阅读成长"]')!==null}})()`);
  win.setSize(1440, 900); await wait(200);
  const wide = await inspectToolbar();
  if (!wide?.visible || !wide.insideToolbar || !wide.timerWithinViewport || wide.timerCount !== 1 || wide.text !== '04:45 / 30:00') throw new Error('Wide sentence toolbar check failed: ' + JSON.stringify(wide));
  await fs.mkdir(screenshotDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const saveToolbar = async name => {
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: win.getBounds().width, height: 90 });
    await fs.writeFile(path.join(screenshotDir, `reader-growth-${name}-${stamp}.png`), image.toPNG(), { flag: 'wx' });
  };
  await saveToolbar('wide');
  await win.setSize(480, 800); await wait(350);
  const narrow = await inspectToolbar();
  if (!narrow?.visible || !narrow.insideToolbar || !narrow.timerWithinViewport || narrow.timerCount !== 1 || narrow.text !== '04:45 / 30:00') throw new Error('Narrow sentence toolbar check failed: ' + JSON.stringify(narrow));
  await saveToolbar('narrow');
  const hostEntries = await win.webContents.executeJavaScript('document.querySelectorAll(".growth-entry,.growth-timer").length');
  if (hostEntries !== 0) throw new Error('A duplicate floating host growth entry remains.');
  await frame.executeJavaScript('document.querySelector(".reader-growth-timer").click()');
  let openRequest = false;
  for (let i = 0; i < 20; i++) { openRequest = await win.webContents.executeJavaScript(`window.growthMessages.some(m=>m?.type==='vantilo:growth-open-request'&&m.token===${JSON.stringify(growthToken)})`); if (openRequest) break; await wait(50); }
  if (!openRequest) throw new Error('Timer click did not open the growth page; host messages: ' + JSON.stringify(await win.webContents.executeJavaScript('window.growthMessages.map(m=>m?.type)')));
  await sendHostMessage({ type: 'vantilo:growth-summary', token: growthToken, seconds: 285.45599999999996, active: false, canResume: true });
  await wait(150);
  await frame.executeJavaScript('document.querySelector(".reader-growth-timer").click()');
  let resumeRequest = false;
  for (let i = 0; i < 20; i++) { resumeRequest = await win.webContents.executeJavaScript(`window.growthMessages.some(m=>m?.type==='vantilo:growth-resume-request'&&m.token===${JSON.stringify(growthToken)})`); if (resumeRequest) break; await wait(50); }
  if (!resumeRequest) throw new Error('Paused timer did not offer resume.');
  await sendHostMessage({ type: 'vantilo:growth-summary', token: growthToken, seconds: 285.45599999999996, active: true, canResume: false });
  await frame.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('.reader-mode-switch button')].find(x=>x.textContent.trim()==='整篇');b?.click()})()`);
  await wait(300);
  const articleTimer = await inspectToolbar();
  if (!articleTimer?.visible || articleTimer.timerCount !== 1 || articleTimer.text !== '04:45 / 30:00') throw new Error('Article-mode toolbar timer check failed: ' + JSON.stringify(articleTimer));
  const nav = await frame.executeJavaScript(`(()=>{const b=document.querySelector('[aria-label="我的阅读成长"]');return Boolean(b&&getComputedStyle(b).display!=='none')})()`);
  if (!nav) throw new Error('Reader navigation does not expose 我的阅读成长 in ordinary reading mode.');
  await frame.executeJavaScript('document.querySelector("[aria-label=\\"我的阅读成长\\"]").click()');
  let navRequest = false;
  for (let i = 0; i < 20; i++) { navRequest = await win.webContents.executeJavaScript(`window.growthMessages.some(m=>m?.type==='vantilo:growth-open-request'&&m.token===${JSON.stringify(growthToken)})`); if (navRequest) break; await wait(50); }
  if (!navRequest) throw new Error('Reader navigation growth entry did not open the host growth page.');
  if (external.length) throw new Error('Unexpected external requests: ' + JSON.stringify(external.slice(0, 3)));
  console.log(JSON.stringify({ result: 'PASS', book: 'existing local English EPUB (title withheld)', wide, narrow, floatingHostEntries: hostEntries, navigationEntry: nav, externalRequests: 0, screenshots: screenshotDir }));
}).then(async () => { clearTimeout(deadline); await service?.close(); if (root) await fs.rm(root, { recursive: true, force: true }); rmSync(profile, { recursive: true, force: true }); app.quit(); }).catch(error => {
  console.error(error.stack || error); clearTimeout(deadline); app.exit(1);
});
app.on('window-all-closed', () => {});
