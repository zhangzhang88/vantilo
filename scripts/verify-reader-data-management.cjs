require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();
// Verify the actual Electron iframe using an isolated, synthetic profile and library.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const { mkdtempSync } = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { startPortableReader } = require('../electron/portable-reader-service.cjs');
const { installReaderBackupDownloads } = require('../electron/reader-backup-download.cjs');
const repo = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const artifactRoot = process.env.VANTILO_TEST_ARTIFACT_ROOT;
if (!artifactRoot) throw new Error('Workspace test artifact root is required.');
let root = mkdtempSync(path.join(artifactRoot, 'data-ui-check-')), service, win;
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
  const initialGrowth={days:{'2026-10-29':{seconds:1860,books:{'book:backup-fixture':1260,'book:other-fixture':600}}}};
  const hostScript=`(()=>{const token=${JSON.stringify(randomBytes(32).toString('hex'))};window.__growthToken=token;window.__growthReady=[];window.addEventListener('message',event=>{if(event.data?.type==='vantilo:growth-ready')window.__growthReady.push(event.data.token);});const readerOrigin=${JSON.stringify(service.webOrigin)},frame=document.getElementById('reader');window.__vantiloGrowth=${JSON.stringify(initialGrowth)};window.__growthRequests=[];const sendInit=()=>frame.contentWindow.postMessage({type:'vantilo:growth-init',token},'*');let initCount=0;const initTimer=setInterval(()=>{sendInit();if(++initCount>60)clearInterval(initTimer);},250);sendInit();window.addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.origin!==readerOrigin)return;const d=event.data;if(d?.type==='vantilo:growth-backup-request')window.__growthRequests.push({token:d.token,operation:d.operation,requestId:d.requestId});if(d?.type!=='vantilo:growth-backup-request'||d.token!==token||typeof d.requestId!=='string')return;let record,error=null;try{if(d.operation==='snapshot')record=window.__vantiloGrowth;else if(d.operation==='replace'){if(window.__failGrowthReplace){window.__failGrowthReplace=false;throw Error('Injected host restore failure');}if(!d.record||typeof d.record!=='object'||!d.record.days)throw Error('Invalid test growth record');window.__vantiloGrowth=d.record;record=d.record;}else if(d.operation==='clear'){window.__vantiloGrowth={days:{}};record=window.__vantiloGrowth;}else throw Error('Invalid operation');}catch(e){error=String(e.message||e);}event.source.postMessage({type:'vantilo:growth-backup-response',token,requestId:d.requestId,ok:!error,...(error?{error}:{record})},readerOrigin);});setInterval(()=>{const day=window.__vantiloGrowth.days['2026-10-29'];frame.contentWindow.postMessage({type:'vantilo:growth-summary',token,seconds:day?.seconds||0,active:false,canResume:false},'*');},500);})();`;
  await fs.writeFile(html, `<iframe id="reader" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" src="${service.webOrigin}/" style="width:100%;height:100vh;border:0"></iframe><script>${hostScript}</script>`);
  win = new BrowserWindow({ show:false, width:1440, height:900, webPreferences:{ partition, nodeIntegration:false, contextIsolation:true, sandbox:true, backgroundThrottling:false } });
  await win.loadFile(html);
  const getFrame = () => win.webContents.mainFrame.frames.find(frame => frame.url.startsWith(service.webOrigin));
  let frame = await waitFor(async () => { const f=getFrame(); return f && await f.executeJavaScript('Boolean(document.querySelector(".global-nav-primary"))') ? f : null; }, 'Reader frame');
  for(let i=0;i<30;i++){await win.webContents.executeJavaScript(`document.getElementById('reader').contentWindow.postMessage({type:'vantilo:growth-init',token:window.__growthToken},'*')`);if(await win.webContents.executeJavaScript('window.__growthReady.includes(window.__growthToken)'))break;await delay(100);}
  if(!await win.webContents.executeJavaScript('window.__growthReady.includes(window.__growthToken)'))throw new Error('Growth bridge handshake failed: '+JSON.stringify(await win.webContents.executeJavaScript('window.__growthReady')));
  const storageKey = 'economist-reader-state-v1';
  const variant = 'magazine-reader-paragraph-translations-v1:vantilo-v2:custom-api:012345abcdef';
  const record = { document:{ kind:'book-chapter', bookId:'test', chapterId:'one', documentId:'reading:book:test:one' }, paragraphIndex:0, sourceText:'A simple sentence.', translationZh:'一句简单的话。', model:'test', provider:'easycliproxy', generatedAt:'2026-10-28T00:00:00.000Z' };
  await frame.executeJavaScript(`localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify({version:1,progress:{a:42}}));localStorage.setItem(${JSON.stringify(variant)},JSON.stringify([${JSON.stringify(record)}]));localStorage.setItem('unrelated-test','kept');`);
  const navigate = async () => { await frame.executeJavaScript(`([...document.querySelectorAll('.global-nav-icon')].find(button=>button.getAttribute('aria-label')==='设置')||[...document.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')==='设置'))?.click()`); frame = await waitFor(async () => { const f=getFrame(); return f && await f.executeJavaScript('Boolean(document.querySelector(".data-management-card"))') ? f : null; }, 'data management'); };
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
  try { await waitFor(() => downloaded, 'Electron backup download'); } catch (error) { const uiError=await frame.executeJavaScript(`document.querySelector('[role="alert"]')?.innerText||document.querySelector('.data-management-error')?.innerText||''`);const requests=await win.webContents.executeJavaScript('window.__growthRequests');throw new Error(`${error.message}; UI=${uiError}; host requests=${JSON.stringify(requests)}`); }
  const backupText = await fs.readFile(destination, 'utf8');
  const backup = JSON.parse(backupText);
  if (backup.data[variant]?.[0]?.translationZh !== record.translationZh || backup.data[storageKey]?.progress?.a !== 42) throw new Error('Exported backup missing reading progress or model translation');
  if(JSON.stringify(backup.data['vantilo-reading-growth-v1'])!==JSON.stringify(initialGrowth))throw new Error('Exported backup omitted or altered host-owned reading growth');
  await win.webContents.executeJavaScript(`window.__vantiloGrowth={days:{'2026-10-28':{seconds:30,books:{'book:old':30}}}}`);
  await frame.executeJavaScript(`localStorage.setItem(${JSON.stringify(storageKey)},JSON.stringify({version:1,progress:{a:84}}));`);
  await frame.executeJavaScript(`(()=>{const input=document.querySelector('[data-testid="data-backup-input"]');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(backupText)}],'backup.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(() => frame.executeJavaScript('Boolean(document.querySelector("[data-testid=data-backup-preview]"))'), 'backup preview');
  const growthPreview=await frame.executeJavaScript(`document.querySelector('[data-testid="data-backup-preview"]')?.innerText||''`);
  if(!growthPreview.includes('阅读成长记录')||!growthPreview.includes('1 天 · 0.5 小时 · 1 个达标日'))throw new Error('Backup preview omitted growth counts');
  await win.webContents.executeJavaScript('window.__failGrowthReplace=true');
  await frame.executeJavaScript(`([...document.querySelectorAll('.data-management-card button')].find(b=>b.textContent.trim()==='恢复这个备份')).click()`);
  if (!await frame.executeJavaScript('Boolean(document.querySelector("[role=alertdialog]"))')) throw new Error('Restore confirmation missing in sandboxed iframe');
  await frame.executeJavaScript(`([...document.querySelectorAll('[role=alertdialog] button')].find(b=>b.textContent.trim()==='确认恢复')).click()`);
  await waitFor(()=>frame.executeJavaScript(`document.querySelector('[role="alert"]')?.innerText.includes('Injected host restore failure')`),'injected host failure');
  const afterFailedRestore=await win.webContents.executeJavaScript('window.__vantiloGrowth');if(JSON.stringify(afterFailedRestore.days)!==JSON.stringify({'2026-10-28':{seconds:30,books:{'book:old':30}}})||await frame.executeJavaScript(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).progress.a!==84`))throw new Error('Failed host restore changed either storage context');
  await frame.executeJavaScript(`([...document.querySelectorAll('.data-management-card button')].find(b=>b.textContent.trim()==='恢复这个备份')).click()`);
  await frame.executeJavaScript(`([...document.querySelectorAll('[role=alertdialog] button')].find(b=>b.textContent.trim()==='确认恢复')).click()`);
  await waitFor(async () => { const f=getFrame(); try { return f && await f.executeJavaScript(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})||'{}').progress?.a===42`); } catch { return false; } }, 'restore');
  const restoredGrowth=await win.webContents.executeJavaScript('window.__vantiloGrowth');if(JSON.stringify(restoredGrowth)!==JSON.stringify(initialGrowth))throw new Error('Restore failed to replace host growth with the exact backup snapshot');
  await delay(500); await navigate();
  const legacyGrowth={days:{'2026-10-28':{seconds:30,books:{'book:legacy':30}}}};await win.webContents.executeJavaScript(`window.__vantiloGrowth=${JSON.stringify(legacyGrowth)}`);
  const legacyBackup={...backup,data:{...backup.data}};delete legacyBackup.data['vantilo-reading-growth-v1'];delete legacyBackup.variantKeysIncluded;
  await frame.executeJavaScript(`(()=>{const input=document.querySelector('[data-testid="data-backup-input"]');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(legacyBackup))}],'legacy-backup.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(()=>frame.executeJavaScript('Boolean(document.querySelector("[data-testid=data-backup-preview]"))'),'legacy backup preview');
  if(!await frame.executeJavaScript(`document.querySelector('[data-testid="data-backup-preview"]')?.innerText.includes('此备份不包含阅读成长记录')`))throw new Error('Legacy backup preview did not explain preservation of growth history');
  await frame.executeJavaScript(`([...document.querySelectorAll('.data-management-card button')].find(b=>b.textContent.trim()==='恢复这个备份')).click()`);
  await frame.executeJavaScript(`([...document.querySelectorAll('[role=alertdialog] button')].find(b=>b.textContent.trim()==='确认恢复')).click()`);
  await waitFor(async()=>await win.webContents.executeJavaScript(`JSON.stringify(window.__vantiloGrowth)===${JSON.stringify(JSON.stringify(legacyGrowth))}`),'legacy growth preservation');
  await delay(500);await navigate();
  await frame.executeJavaScript(`([...document.querySelectorAll('.data-management-card button')].find(b=>b.textContent.trim()==='清除阅读数据')).click()`);
  if (!await frame.executeJavaScript('Boolean(document.querySelector("[role=alertdialog]"))')) throw new Error('Clear confirmation missing');
  await frame.executeJavaScript(`([...document.querySelectorAll('[role=alertdialog] button')].find(b=>b.textContent.trim()==='确认清除')).click()`);
  await waitFor(async () => { const f=getFrame(); try { return f && await f.executeJavaScript(`localStorage.getItem(${JSON.stringify(storageKey)})===null && localStorage.getItem(${JSON.stringify(variant)})===null && localStorage.getItem('unrelated-test')==='kept'`); } catch { return false; } }, 'clear');
  const clearedGrowth=await win.webContents.executeJavaScript('window.__vantiloGrowth');if(Object.keys(clearedGrowth.days).length!==0)throw new Error('Clear did not include host-owned growth history');
  console.log('PASS: sandboxed Electron Reader exported and restored Reader plus host-owned growth data, then cleared managed records while preserving unrelated data.');
}).then(async()=>{clearTimeout(timeout);win?.destroy();await service?.close();await fs.rm(root,{recursive:true,force:true});app.quit();}).catch(async error=>{console.error(error?.stack||String(error));clearTimeout(timeout);win?.destroy();await service?.close();if(root)await fs.rm(root,{recursive:true,force:true});app.exit(1);});
app.on('window-all-closed',()=>{});
