// Isolated Electron UI smoke check of the *real* first-run renderer and preload.
// Never uses the actual user's profile, Qwen files, EPUBs, or Codex engine.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vantilo-first-user-'));
app.setPath('userData',temp);
const {createReaderOnboarding}=require('../electron/reader-onboarding.cjs');
const setup=createReaderOnboarding({userData:temp,assetsDir:path.resolve(__dirname,'../build/reader')});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let win;
let fixtureServer,fixtureOrigin;
let dictionaryOpenAttempts=0, dictionaryChecks=0;
const blockedNetwork=[];
const timeout=setTimeout(()=>{console.error('FAIL: isolated first-run smoke timeout');app.exit(1);},20000);
async function until(expression, limit=70) {
  for(let i=0;i<limit;i++){
    if(await win.webContents.executeJavaScript(expression))return true;
    await delay(110);
  }
  return false;
}
app.whenReady().then(async()=>{
  // A synthetic Reader frame exercises the real parent navigation and the
  // message used by the settings page to reopen onboarding, without user data.
  fixtureServer=http.createServer((_request,response)=>{
    response.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    response.end(`<!doctype html><html><body><main id="content">阅读空间</main><script>
      window.addEventListener('message',event=>{if(event.data?.type==='vantilo:navigate'&&event.data.target==='settings'){
        document.getElementById('content').innerHTML='<button id="setup">阅读环境设置</button>';
        document.getElementById('setup').onclick=()=>window.parent.postMessage({type:'vantilo:open-environment-settings'},'*');
      }});
      window.parent.postMessage({type:'vantilo:reader-ready'},'*');
    </script></body></html>`);
  });
  await new Promise((resolve,reject)=>{fixtureServer.once('error',reject);fixtureServer.listen(0,'127.0.0.1',resolve);});
  fixtureOrigin='http://127.0.0.1:'+fixtureServer.address().port;
  const fixtureDist=path.join(temp,'dist');fs.cpSync(path.resolve(__dirname,'../dist'),fixtureDist,{recursive:true});
  const rewrite=file=>{const text=fs.readFileSync(file,'utf8');fs.writeFileSync(file,text.replaceAll('http://127.0.0.1:5175',fixtureOrigin));};
  rewrite(path.join(fixtureDist,'index.html'));
  for(const name of fs.readdirSync(path.join(fixtureDist,'assets')))if(name.endsWith('.js'))rewrite(path.join(fixtureDist,'assets',name));
  ipcMain.handle('reader:setup-state',()=>setup.getState());
  ipcMain.handle('reader:setup-check',()=>{dictionaryChecks++;return setup.check()});
  ipcMain.handle('reader:setup-finish',(_event,decision)=>setup.finish(decision));
  // Stub system application launches and outbound pages, not the local Dictionary Services lookup.
  ipcMain.handle('reader:setup-dictionary',()=>{dictionaryOpenAttempts++;return {opened:false,error:'测试模式不会实际打开系统词典'}});
  // A Reader host UI fixture: opening an iframe is not evidence that the Reader API is running.
  ipcMain.handle('magazine-reader:start',()=>({ready:true}));
  ipcMain.handle('magazine-reader:status',()=>({status:'ready',error:null}));
  ipcMain.handle('runtime:status',()=>({status:'stopped'}));
  ipcMain.handle('sessions:list',()=>({sessions:[],storage:{available:false,error:null,warning:null}}));
  ipcMain.handle('workspace:state',()=>({root:null,error:null,revision:0}));
  ipcMain.handle('projects:list',()=>[]);
  win=new BrowserWindow({show:false,width:1150,height:820,webPreferences:{preload:path.resolve(__dirname,'../electron/preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.webContents.session.webRequest.onBeforeRequest((details,done)=>{
    if(/^https?:/i.test(details.url)&&!details.url.startsWith(fixtureOrigin+'/')){blockedNetwork.push(details.url);done({cancel:true});return}
    done({cancel:false});
  });
  await win.loadFile(path.join(fixtureDist,'index.html'));
  if(!await until("Boolean(document.querySelector('[role=dialog][aria-labelledby=reader-setup-title]'))"))throw Error('First-run dialog did not appear');
  if(!await until("!document.querySelector('.reader-onboarding-step-title small')?.textContent?.includes('检测中')"))throw Error('Dictionary probe stayed pending');
  const detected=await win.webContents.executeJavaScript("document.querySelector('.reader-onboarding-step-title small')?.textContent");
  if(!['已检测到中文释义','只有英文释义','未检测到可用词条'].includes(detected))throw Error('No actual Dictionary Services readiness status');
  if(!await win.webContents.executeJavaScript("document.body.innerText.includes('自定义兼容 API')&&document.body.innerText.includes('已登录的 ChatGPT 模型')&&!document.body.innerText.includes('Qwen')"))throw Error('Reader translation setup guidance is missing or advertises an unavailable local model');
  // Check that the dialog is neither clipped nor loses its action footer at compact Mac window dimensions.
  win.setSize(800,600);
  await delay(150);
  const layout=await win.webContents.executeJavaScript(`(()=>{
    const dialog=document.querySelector('.reader-onboarding'), rect=dialog?.getBoundingClientRect();
    if(!dialog||!rect)return {within:false,footer:false};
    const within=rect.left>=0&&rect.top>=0&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1;
    dialog.scrollTop=dialog.scrollHeight;
    const foot=dialog.querySelector('.reader-onboarding-footer')?.getBoundingClientRect();
    return {within,footer:Boolean(foot&&foot.top>=rect.top&&foot.bottom<=rect.bottom+1)};
  })()`);
  if(!layout.within||!layout.footer)throw Error('Compact-window onboarding layout clipped: '+JSON.stringify(layout));
  win.setSize(1150,820);
  await delay(120);

  if(!await win.webContents.executeJavaScript("(()=>{const b=[...document.querySelectorAll('.reader-onboarding-actions button')].find(x=>x.textContent==='打开系统词典');b?.click();return Boolean(b)})()"))throw Error('Dictionary action missing');
  if(!await until("document.body.innerText.includes('测试模式不会实际打开系统词典')") || dictionaryOpenAttempts !== 1)throw Error('Dictionary-open failure feedback missing');
  if(!await win.webContents.executeJavaScript("(()=>{const b=[...document.querySelectorAll('.reader-onboarding-actions button')].find(x=>x.textContent==='重新检测');b?.click();return Boolean(b)})()"))throw Error('Recheck action missing');
  await delay(300);
  if(dictionaryChecks < 2)throw Error('Dictionary recheck did not call host again');
  if(!await win.webContents.executeJavaScript("(()=>{const b=[...document.querySelectorAll('.reader-onboarding-footer button')].find(x=>x.textContent==='稍后设置');b?.click();return Boolean(b);})()"))throw Error('Skip button missing');
  if(!await until("!document.querySelector('[role=dialog][aria-labelledby=reader-setup-title]')"))throw Error('Skipping did not close onboarding');
  if((await setup.getState()).show)throw Error('Skip decision was not persisted');
  await win.loadFile(path.join(fixtureDist,'index.html'));
  await delay(500);
  if(await win.webContents.executeJavaScript("Boolean(document.querySelector('[role=dialog][aria-labelledby=reader-setup-title]'))"))throw Error('Skipped onboarding unexpectedly returned');
  if(!await win.webContents.executeJavaScript("(()=>{const button=document.querySelector('[aria-label=设置]');button?.click();return Boolean(button)})()"))throw Error('Settings navigation action missing');
  let frame;
  for(let i=0;i<70;i++){
    frame=win.webContents.mainFrame.frames.find(item=>item.url.startsWith(fixtureOrigin+'/'));
    if(frame&&await frame.executeJavaScript("Boolean(document.querySelector('#setup'))"))break;
    await delay(110);
  }
  if(!frame||!await frame.executeJavaScript("Boolean(document.querySelector('#setup'))"))throw Error('Settings destination did not reach Reader frame');
  await frame.executeJavaScript("document.querySelector('#setup').click()");
  if(!await until("Boolean(document.querySelector('[role=dialog][aria-labelledby=reader-setup-title]'))"))throw Error('Reopened setup dialog did not appear');
  if(!await win.webContents.executeJavaScript("(()=>{const button=[...document.querySelectorAll('.reader-onboarding-footer button')].find(x=>x.textContent==='进入 Vantilo');button?.click();return Boolean(button)})()"))throw Error('Finish action missing');
  if(!await until("!document.querySelector('[role=dialog][aria-labelledby=reader-setup-title]')"))throw Error('Finish action did not close the setup dialog');
  if((await setup.getState()).show)throw Error('Finished state did not persist');
  await win.loadFile(path.join(fixtureDist,'index.html'));
  await delay(500);
  if(await win.webContents.executeJavaScript("Boolean(document.querySelector('[role=dialog][aria-labelledby=reader-setup-title]'))"))throw Error('Completed onboarding returned after app reload');
  if(blockedNetwork.length)throw Error('Unexpected external network attempted');
  console.log('PASS: isolated Electron profile, actual native Dictionary probe ('+detected+'), current custom-API/ChatGPT setup guidance without unavailable local-model claims, Dictionary open error feedback, recheck, skip persistence, reload, Reader settings re-entry and completion persistence. Reader API and external network not accessed; no real Codex or private user data.');
}).then(()=>{clearTimeout(timeout);win?.destroy();fixtureServer?.close();app.quit();}).catch(error=>{console.error(error.stack||String(error));clearTimeout(timeout);win?.destroy();fixtureServer?.close();app.exit(1);});
app.on('before-quit',()=>{fs.rmSync(temp,{recursive:true,force:true})});
app.on('window-all-closed',()=>{});
