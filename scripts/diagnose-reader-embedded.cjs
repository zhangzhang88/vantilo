// Test the real packaged Vantilo renderer embedding the already running preview Reader.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const pkg=path.resolve('out/reader-qwen-preview/Vantilo Qwen Setup Preview-darwin-arm64/Vantilo Qwen Setup Preview.app/Contents/Resources/app');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vantilo-embedded-diag-'));
app.setPath('userData',temp);
const events=[];const timer=setTimeout(()=>{console.error('EMBEDDED_DIAG_TIMEOUT',JSON.stringify(events.slice(-12)));app.exit(2)},18000);
const tick=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  ipcMain.handle('reader:setup-state',()=>({show:false}));
  ipcMain.handle('reader:setup-check',()=>({dictionary:'bilingual',hardware:{appleSilicon:true,memoryGiB:16},localAi:'not-integrated',modelSetupPreview:true}));
  ipcMain.handle('runtime:status',()=>({status:'stopped'}));
  ipcMain.handle('sessions:list',()=>({sessions:[],storage:{available:false,error:null,warning:null}}));
  ipcMain.handle('workspace:state',()=>({root:null,error:null,revision:0}));
  ipcMain.handle('projects:list',()=>[]);
  ipcMain.handle('magazine-reader:start',()=>({ready:true}));
  ipcMain.handle('magazine-reader:status',()=>({status:'ready',error:null}));
  let win=new BrowserWindow({show:false,width:1150,height:850,webPreferences:{preload:path.join(pkg,'electron/preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.webContents.on('console-message',(evt)=>events.push({event:'console',level:evt.level,message:evt.message,source:evt.sourceId}));
  win.webContents.on('did-fail-load',(_evt,code,description,url,isMain)=>events.push({event:'fail',code,description,url,isMain}));
  win.webContents.on('did-frame-finish-load',(_evt,isMain)=>events.push({event:'frame',isMain}));
  await win.loadFile(path.join(pkg,'dist/index.html'));
  for(let i=0;i<40;i++){
    if(await win.webContents.executeJavaScript("Boolean(document.querySelector('[aria-label=\"阅读\"]'))"))break;
    await tick(100);
  }
  const nav=await win.webContents.executeJavaScript("(()=>{const b=document.querySelector('[aria-label=\"阅读\"]'); if(b)b.click();return Boolean(b)})()");
  await tick(3500);
  const state=await win.webContents.executeJavaScript("({nav:document.querySelector('[aria-label=\"阅读\"]')?.outerHTML.slice(0,270),iframe:Array.from(document.querySelectorAll('iframe'),x=>({src:x.src,rect:x.getBoundingClientRect().toJSON()})),text:document.body.innerText.slice(0,400)})");
  const embedded=win.webContents.mainFrame.frames.find(frame=>frame.url==='http://127.0.0.1:5195/');
  const inner=embedded ? await embedded.executeJavaScript("({rootLength:document.querySelector('#root')?.innerHTML.length,text:document.body.innerText.slice(0,160)})") : null;
  const failures=events.filter(e=>e.event==='fail'||(e.event==='console'&&(/ERR_BLOCKED_BY_CSP|frame-src|Refused to frame|Uncaught/i).test(e.message||'')));
  console.log('EMBEDDED_DIAG_STATE',JSON.stringify({nav,iframe:state.iframe,embedded:inner,failures}));
  if(!nav||!inner||!inner.rootLength||failures.length)throw Error('Packaged Vantilo Reader iframe still blank or failed');
  win.destroy();clearTimeout(timer);app.quit();
}).catch(e=>{console.error('EMBEDDED_DIAG_FAILED',e.stack);clearTimeout(timer);app.exit(1)});
app.on('before-quit',()=>fs.rmSync(temp,{recursive:true,force:true}));
