// Compare a file:// parent iframe to the live Reader 5195 renderer.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vantilo-iframe-probe-'));
app.setPath('userData',temp);
const html=path.join(temp,'test.html');
fs.writeFileSync(html,'<!doctype html><html><body><h1>Parent</h1><iframe sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" src="http://127.0.0.1:5195/" style="width:100vw;height:90vh"></iframe></body></html>');
const timer=setTimeout(()=>{console.error('PROBE_TIMEOUT');app.exit(3)},12000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1190,height:870,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 const errors=[];
 win.webContents.on('console-message',(event,details)=>errors.push({level:event.level,message:event.message,sourceId:event.sourceId,lineNumber:event.lineNumber,details}));
 win.webContents.on('did-fail-load',(_ev,c,msg,url,main)=>errors.push({event:'fail',c,msg,url,main}));
 win.webContents.on('did-frame-finish-load',(_ev,isMain,pid,rid)=>errors.push({event:'frame-finish',isMain,pid,rid}));
 await win.loadFile(html);
 await new Promise(r=>setTimeout(r,3500));
 const state=await win.webContents.executeJavaScript("({iframes:[...document.querySelectorAll('iframe')].map(x=>({src:x.src,rect:x.getBoundingClientRect().toJSON(),load:x.contentWindow?.location.href})),body:document.body.innerText.slice(0,100)})").catch(e=>String(e));
 const frames=win.webContents.mainFrame.frames.map(x=>({url:x.url,name:x.name}));
 console.log('FRAME_TEST',JSON.stringify({state,frames,errors}).slice(0,8000));
 win.destroy();clearTimeout(timer);app.quit();
}).catch(e=>{console.error('FRAME_TEST_FAILED',e.stack);clearTimeout(timer);app.exit(1)});
app.on('before-quit',()=>fs.rmSync(temp,{force:true,recursive:true}));
