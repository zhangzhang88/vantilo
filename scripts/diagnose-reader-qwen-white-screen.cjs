require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();
// Diagnose the already-running isolated Reader port in a hidden Electron renderer.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'), os=require('node:os'),path=require('node:path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vantilo-reader-diagnostic-'));
app.setPath('userData',tmp);
const timer=setTimeout(()=>{console.error('DIAGNOSTIC_TIMEOUT');app.exit(2)},16000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1190,height:850,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 const errors=[];
 win.webContents.on('console-message',(_ev,details)=>errors.push({event:'console',details}));
 win.webContents.on('did-fail-load',(_ev,c,msg,url,main)=>errors.push({event:'load-failed',code:c,msg,url,main}));
 win.webContents.on('render-process-gone',(_ev,reason)=>errors.push({event:'renderer-gone',reason}));
 try {
   await win.loadURL('http://127.0.0.1:5195/');
   await new Promise(resolve=>setTimeout(resolve,2500));
   const page=await win.webContents.executeJavaScript("({href:location.href,title:document.title,htmlLength:document.querySelector('#root')?.innerHTML.length,rootExcerpt:document.querySelector('#root')?.innerHTML.slice(0,220),bodyText:document.body.innerText.slice(0,220),scripts:Array.from(document.scripts,x=>x.src)})");
   console.log('PAGE_STATE',JSON.stringify(page));
   console.log('BROWSER_ERRORS',JSON.stringify(errors.slice(-18)));
 }finally{win.destroy();clearTimeout(timer);app.quit()}
}).catch(e=>{console.error('DIAGNOSTIC_FAILED',e.stack);clearTimeout(timer);app.exit(1)});
app.on('before-quit',()=>{fs.rmSync(tmp,{recursive:true,force:true})});
