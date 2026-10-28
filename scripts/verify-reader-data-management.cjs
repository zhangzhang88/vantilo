// Verify the actual Electron iframe using an isolated, synthetic profile and library.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const { mkdirSync, mkdtempSync } = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { startPortableReader } = require('../electron/portable-reader-service.cjs');
const { installReaderBackupDownloads } = require('../electron/reader-backup-download.cjs');
const repo = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
mkdirSync(path.join(repo, 'build'), { recursive: true });
let root = mkdtempSync(path.join(repo, 'build', 'data-ui-check-')), service, win;
mkdirSync(path.join(root, 'profile'), { recursive: true });
app.setPath('userData', path.join(root, 'profile'));
const timeout = setTimeout(() => { console.error('FAIL: data management UI timed out'); app.exit(1); }, 40000);
async function waitFor(fn, label) { for (let i=0;i<100;i++) { const value = await fn(); if (value) return value; await delay(100); } throw new Error('Timed out: ' + label); }
app.whenReady().then(async () => {
  const token = randomBytes(32).toString('hex');
  service = await startPortableReader({ assetsDir: process.env.VANTILO_READER_TEST_ASSETS ? path.resolve(process.env.VANTILO_READER_TEST_ASSETS) : path.join(repo, 'build/reader'), libraryRoot: path.join(root, 'library'), apiPort: 0, webPort: 0, autoSync: false, sessionToken: token, requireSessionAuth: true, getAccountStatus: async () => ({connected:false,email:null}), listModels: async () => ({models:[]}) });
  const partition = 'data-ui-' + Date.now();
  const webSession = session.fromPartition(partition);
  await webSession.cookies.set({ url: service.webOrigin, name: '__Host-vantilo-reader', value: token, path: '/', httpOnly: true, secure: true, sameSite: 'no_restriction' });
  const html = path.join(root, 'host.html');
  await fs.writeFile(html, `<iframe id="reader" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" src="${service.webOrigin}/" style="width:100%;height:100vh;border:0"></iframe>`);
  win = new BrowserWindow({ show:false, width:1440, height:900, webPreferences:{ partition, nodeIntegration:false, contextIsolation:true, sandbox:true, backgroundThrottling:false } });
  await win.loadFile(html);
  const getFrame = () => win.webContents.mainFrame.frames.find(frame => frame.url.startsWith(service.webOrigin));
  let frame = await waitFor(async () => { const f=getFrame(); return f && await f.executeJavaScript('Boolean(document.querySelector(".global-nav-primary"))') ? f : null; }, 'Reader frame');
  const storageKey = 'economist-reader-state-v1';
  const variant = 'magazine-reader-paragraph-translations-v1:vantilo-v2:custom-api:012345abcdef';
  const record = { document:{ kind:'book-chapter', bookId:'test', chapterId:'one', documentId:'reading:book:test:one' }, paragraphIndex:0, sourceText:'A simple sentence.', translationZh:'一句简单的话。', model:'test', provider:'custom-api', generatedAt:'2026-10-28T00:00:00.000Z' };
  await frame.executeJavaScript(`localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify({version:1,progress:{a:42}}));localStorage.setItem(${JSON.stringify(variant)},JSON.stringify([${JSON.stringify(record)}]));localStorage.setItem('unrelated-test','kept');`);
  const navigate = async () => { await win.webContents.executeJavaScript(`document.getElementById('reader').contentWindow.postMessage({type:'vantilo:navigate',target:'settings'},${JSON.stringify(service.webOrigin)})`); frame = await waitFor(async () => { const f=getFrame(); return f && await f.executeJavaScript('Boolean(document.querySelector(".data-management-card"))') ? f : null; }, 'data management'); };
  await navigate();
  const contents = await frame.executeJavaScript('document.querySelector(".data-management-card").innerText');
  if (/浏览器|allowlist|localStorage|AI Provider/.test(contents) || !contents.includes('API 服务与密钥')) throw new Error('Desktop data management copy is incorrect');
  if (process.env.VANTILO_DATA_UI_SCREENSHOT) {
    await frame.executeJavaScript('document.querySelector(".data-management-card").scrollIntoView({block:"start"})');
    await delay(200);
    await fs.writeFile(path.resolve(process.env.VANTILO_DATA_UI_SCREENSHOT), (await win.webContents.capturePage()).toPNG());
  }
  const destination = path.join(root, 'backup.json');
  let downloaded = false;
  installReaderBackupDownloads(webSession, () => win, root, service.webOrigin);
  webSession.on('will-download', (_event,item) => {
    const options = item.getSaveDialogOptions();
    if (options.title !== '保存阅读数据备份') { item.cancel(); return; }
    item.setSavePath(destination); item.once('done', (_e,state) => { downloaded = state === 'completed'; });
  });
  await frame.executeJavaScript(`([...document.querySelectorAll('.data-management-card button')].find(b=>b.textContent.trim()==='导出阅读备份')).click()`);
  await waitFor(() => downloaded, 'Electron backup download');
  const backupText = await fs.readFile(destination, 'utf8');
  const backup = JSON.parse(backupText);
  if (backup.data[variant]?.[0]?.translationZh !== record.translationZh || backup.data[storageKey]?.progress?.a !== 42) throw new Error('Exported backup missing reading progress or model translation');
  await frame.executeJavaScript(`localStorage.setItem(${JSON.stringify(storageKey)},JSON.stringify({version:1,progress:{a:84}}));`);
  await frame.executeJavaScript(`(()=>{const input=document.querySelector('[data-testid="data-backup-input"]');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(backupText)}],'backup.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(() => frame.executeJavaScript('Boolean(document.querySelector("[data-testid=data-backup-preview]"))'), 'backup preview');
  await frame.executeJavaScript(`([...document.querySelectorAll('.data-management-card button')].find(b=>b.textContent.trim()==='恢复这个备份')).click()`);
  if (!await frame.executeJavaScript('Boolean(document.querySelector("[role=alertdialog]"))')) throw new Error('Restore confirmation missing in sandboxed iframe');
  await frame.executeJavaScript(`([...document.querySelectorAll('[role=alertdialog] button')].find(b=>b.textContent.trim()==='确认恢复')).click()`);
  await waitFor(async () => { const f=getFrame(); try { return f && await f.executeJavaScript(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})||'{}').progress?.a===42`); } catch { return false; } }, 'restore');
  await delay(500); await navigate();
  await frame.executeJavaScript(`([...document.querySelectorAll('.data-management-card button')].find(b=>b.textContent.trim()==='清除阅读数据')).click()`);
  if (!await frame.executeJavaScript('Boolean(document.querySelector("[role=alertdialog]"))')) throw new Error('Clear confirmation missing');
  await frame.executeJavaScript(`([...document.querySelectorAll('[role=alertdialog] button')].find(b=>b.textContent.trim()==='确认清除')).click()`);
  await waitFor(async () => { const f=getFrame(); try { return f && await f.executeJavaScript(`localStorage.getItem(${JSON.stringify(storageKey)})===null && localStorage.getItem(${JSON.stringify(variant)})===null && localStorage.getItem('unrelated-test')==='kept'`); } catch { return false; } }, 'clear');
  console.log('PASS: sandboxed Electron Reader exported a real backup, previewed and restored it, and cleared managed reading records while preserving unrelated data.');
}).then(async()=>{clearTimeout(timeout);win?.destroy();await service?.close();await fs.rm(root,{recursive:true,force:true});app.quit();}).catch(async error=>{console.error(error?.stack||String(error));clearTimeout(timeout);win?.destroy();await service?.close();if(root)await fs.rm(root,{recursive:true,force:true});app.exit(1);});
app.on('window-all-closed',()=>{});
