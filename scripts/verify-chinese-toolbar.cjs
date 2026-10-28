// Real Electron Reader layout check using only a synthetic EPUB and isolated profile.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs/promises');const {mkdirSync,mkdtempSync}=require('node:fs');const path=require('node:path');const {randomBytes}=require('node:crypto');
const {startPortableReader}=require('../electron/portable-reader-service.cjs');
const repo=path.resolve(__dirname,'..');mkdirSync(path.join(repo,'build'),{recursive:true});
const root=mkdtempSync(path.join(repo,'build','toolbar-check-'));mkdirSync(path.join(root,'profile'));app.setPath('userData',path.join(root,'profile'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let win,service;
const deadline=setTimeout(()=>{console.error('FAIL: toolbar check timed out');app.exit(1);},35000);
async function waitFor(fn,label){for(let i=0;i<100;i++){const v=await fn();if(v)return v;await sleep(100);}throw new Error('Timed out: '+label);}
app.whenReady().then(async()=>{
 const token=randomBytes(32).toString('hex');service=await startPortableReader({assetsDir:process.env.VANTILO_READER_TEST_ASSETS?path.resolve(process.env.VANTILO_READER_TEST_ASSETS):path.join(repo,'build/reader'),libraryRoot:path.join(root,'library'),apiPort:0,webPort:0,autoSync:false,sessionToken:token,requireSessionAuth:true,getAccountStatus:async()=>({connected:false,email:null}),listModels:async()=>({models:[]})});
 const fixture=await fs.readFile(path.join(repo,'tests/fixtures/minimal-magazine.epub'));
 const imported=await fetch(service.apiOrigin+'/api/books/import?filename=LayoutFixture.epub',{method:'POST',headers:{'content-type':'application/epub+zip',cookie:'__Host-vantilo-reader='+token},body:fixture});if(!imported.ok)throw new Error('Synthetic book import failed');
 const partition='toolbar-test-'+Date.now(),ses=session.fromPartition(partition);await ses.cookies.set({url:service.webOrigin,name:'__Host-vantilo-reader',value:token,path:'/',httpOnly:true,secure:true,sameSite:'no_restriction'});
 const html=path.join(root,'host.html');await fs.writeFile(html,`<iframe id="reader" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" src="${service.webOrigin}/" style="width:100%;height:100vh;border:0"></iframe>`);
 win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{partition,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});await win.loadFile(html);
 const frame=await waitFor(async()=>{const f=win.webContents.mainFrame.frames.find(x=>x.url.startsWith(service.webOrigin));return f&&await f.executeJavaScript('Boolean(document.querySelector(".global-nav-primary"))')?f:null;},'Reader');
 await frame.executeJavaScript(`([...document.querySelectorAll('.global-nav-primary button')].find(b=>b.textContent.trim()==='电子书')).click()`);
 await waitFor(()=>frame.executeJavaScript('Boolean(document.querySelector("[data-testid^=book-card-]"))'),'books');
 await frame.executeJavaScript('document.querySelector("[data-testid^=book-card-]").click()');
 await waitFor(()=>frame.executeJavaScript('Boolean(document.querySelector("[data-testid^=book-toc-chapter-]"))'),'chapters');
 await frame.executeJavaScript('document.querySelector("[data-testid^=book-toc-chapter-]").click()');
 await waitFor(()=>frame.executeJavaScript('Boolean(document.querySelector(".reader-chinese-button"))'),'reader toolbar');
 await frame.executeJavaScript('document.querySelector(".reader-chinese-button").click()');
 await waitFor(()=>frame.executeJavaScript('Boolean(document.querySelector(".reader-page-shell.is-chinese-mode .chinese-player"))'),'Chinese reading');
 for(const width of [1440,1024,800,480]){
   win.setContentSize(width,900);await sleep(120);
   const data=await frame.executeJavaScript(`(()=>{const rect=s=>{const e=document.querySelector(s);if(!e)throw Error('missing '+s);const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,display:getComputedStyle(e).display}};return {toolbar:rect('.reader-toolbar'),center:rect('.reader-toolbar-center'),menu:rect('.vantilo-translation-menu'),mode:rect('.reader-mode-switch'),actions:rect('.reader-toolbar-actions'),back:rect('.reader-chinese-button'),viewport:innerWidth,scroll:document.documentElement.scrollWidth};})()`);
   if(data.center.display!=='flex'||Math.abs(data.menu.y-data.mode.y)>12)throw new Error('Controls are not aligned: '+JSON.stringify(data));
   if(data.mode.x<data.menu.right-1||data.actions.x<data.center.right-1||data.back.right>data.viewport+1||data.scroll>data.viewport+1)throw new Error('Toolbar controls overlap or overflow: '+JSON.stringify(data));
   if(width>600&&Math.abs(data.center.y-data.actions.y)>18)throw new Error('Toolbar actions use different rows: '+JSON.stringify(data));
   if(process.env.VANTILO_TOOLBAR_SCREENSHOT && width===1440)await fs.writeFile(process.env.VANTILO_TOOLBAR_SCREENSHOT,(await win.webContents.capturePage()).toPNG());
 }
 console.log('PASS: actual Reader Chinese toolbar aligns model, reading mode and actions without overlap at 480/800/1024/1440px.');
}).then(async()=>{clearTimeout(deadline);win?.destroy();await service?.close();await fs.rm(root,{recursive:true,force:true});app.quit();}).catch(async e=>{console.error(e?.stack||String(e));clearTimeout(deadline);win?.destroy();await service?.close();await fs.rm(root,{recursive:true,force:true});app.exit(1);});app.on('window-all-closed',()=>{});
