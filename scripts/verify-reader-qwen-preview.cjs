// Electron smoke from the ACTUAL packaged Qwen preview's renderer and preload.
// Isolated synthetic profile; native file picker and actual 3GB download are stubbed.
// The native helper against real weights is verified separately.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const repo=path.resolve(__dirname,'..');
const pkg=path.join(repo,'out/reader-qwen-preview/Vantilo Qwen Setup Preview-darwin-arm64/Vantilo Qwen Setup Preview.app/Contents/Resources/app');
// Regression: a wrong frame-src silently creates a full-height WHITE Reader iframe.
const packagedHtml=fs.readFileSync(path.join(pkg,'dist/index.html'),'utf8');
if (!packagedHtml.includes('frame-src http://127.0.0.1:5195;') ||
    packagedHtml.includes('frame-src http://127.0.0.1:5175;')) {
  throw new Error('Qwen preview CSP blocks the embedded Reader at 127.0.0.1:5195');
}

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vantilo-qwen-preview-smoke-'));
app.setPath('userData',temp);
let win,selected=false,chooseCalls=0,installCalls=0,startReaderCalls=0,externalRequests=[];
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timer=setTimeout(()=>{console.error('QWEN_PREVIEW_SMOKE_TIMEOUT');app.exit(1)},20000);
async function waitFor(expression){
  for(let i=0;i<95;i++){
    if(await win.webContents.executeJavaScript(expression))return true;
    await tick(100);
  }
  return false;
}
app.whenReady().then(async()=>{
  ipcMain.handle('reader:setup-state',()=>({show:true}));
  ipcMain.handle('reader:setup-check',()=>({
    dictionary:'bilingual',hardware:{appleSilicon:true,memoryGiB:16},
    localAi:'not-integrated',modelSetupPreview:true,readerQwenIntegrated:true,
  }));
  ipcMain.handle('reader:setup-finish',()=>({show:false}));
  ipcMain.handle('reader:setup-model-info',()=>null);
  ipcMain.handle('reader:setup-dictionary',()=>({opened:false}));
  ipcMain.handle('reader:model-inspect',()=>({
    selected,modelName:'Qwen3.5 4B (MLX 4-bit)',modelPath:selected?'/synthetic/test/model':null,active:false,helperAvailable:true,
    health:{ready:selected,status:selected?'verified-native':'not-checked'},
    hardware:{supported:true,memoryGiB:16,warning:null},
    disk:{availableBytes:17*1024**3,freshInstallBytes:5*1024**3},
    model:{bytes:3061129077,license:'Apache-2.0'},
  }));
  ipcMain.handle('reader:model-choose',()=>{
    chooseCalls++;selected=true;
    return {canceled:false,result:{health:{ready:true,status:'verified-native'}}};
  });
  ipcMain.handle('reader:model-check',()=>({ready:selected,status:selected?'verified-native':'no-selected-model'}));
  ipcMain.handle('reader:model-install',()=>{installCalls++;throw new Error('Unexpected large model download in synthetic preview smoke')});
  ipcMain.handle('reader:model-cancel',()=>({canceled:false}));
  ipcMain.handle('runtime:status',()=>({status:'stopped'}));
  ipcMain.handle('sessions:list',()=>({sessions:[],storage:{available:false,error:null,warning:null}}));
  ipcMain.handle('workspace:state',()=>({root:null,error:null,revision:0}));
  ipcMain.handle('projects:list',()=>[]);
  ipcMain.handle('magazine-reader:start',()=>{startReaderCalls++;return {ready:true};});
  ipcMain.handle('magazine-reader:status',()=>({status:'ready',error:null}));
  win=new BrowserWindow({show:false,width:1150,height:820,
    webPreferences:{preload:path.join(pkg,'electron/preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{
    if(/^https?:/i.test(details.url)){externalRequests.push(details.url);callback({cancel:true});return}
    callback({cancel:false});
  });
  await win.loadFile(path.join(pkg,'dist/index.html'));
  const shown=await waitFor("Boolean([...document.querySelectorAll('.reader-onboarding button')].find(x=>x.textContent==='选择已有 Qwen 模型'))");
  if(!shown)throw new Error('Packaged model select UI not visible');
  if(!await win.webContents.executeJavaScript("document.body.innerText.includes('独立预览 · 已接入 Reader')"))throw new Error('Qwen Reader preview integration status missing');
  if(!await waitFor("document.body.innerText.includes('尚未选择本地模型')"))throw new Error('Missing initial model state');
  const click=await win.webContents.executeJavaScript("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='选择已有 Qwen 模型');b?.click();return Boolean(b)})()");
  if(!click || !await waitFor("document.body.innerText.includes('本机文件与 Swift 推理验证通过')"))throw new Error('Packaged model verification state not rendered');
  if(!await waitFor("document.body.innerText.includes('/synthetic/test/model')"))throw new Error('Packaged model path not visible');
  if(chooseCalls!==1)throw new Error('Model choice did not invoke packaged preload exactly once');
  if(!await win.webContents.executeJavaScript("Boolean([...document.querySelectorAll('button')].find(x=>x.textContent==='开始阅读'))"))throw new Error('Reader launch action is missing');
  await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(x=>x.textContent==='开始阅读')?.click()");
  if(!await waitFor("document.body.innerText.includes('Magazine Reader')"))throw new Error('Start Reader did not enter Reader');
  if(startReaderCalls!==1)throw new Error('Reader launch did not invoke IPC exactly once');
  if(installCalls!==0 || externalRequests.length)throw new Error('Unexpected external download/network');
  console.log('PASS QWEN_PACKAGED_UI: correct model readiness, single-click Reader launch, isolated profile, bundled preload, no 3GB download/network');
}).then(()=>{clearTimeout(timer);win?.destroy();app.quit();}).catch(err=>{console.error(err.stack||String(err));clearTimeout(timer);win?.destroy();app.exit(1)});
app.on('before-quit',()=>fs.rmSync(temp,{recursive:true,force:true}));
app.on('window-all-closed',()=>{});
