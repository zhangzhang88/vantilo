// End-to-end ordinary Reader session authentication in a disposable Electron
// profile. Uses the real supervisor, utility entry and Chromium iframe with a
// synthetic EPUB. It never loads personal libraries or real Codex.
const {app,BrowserWindow,session,utilityProcess}=require('electron');
const fs=require('node:fs/promises');
const {mkdtempSync}=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {PortableReaderSupervisor}=require('../electron/portable-reader-supervisor.cjs');
const {readerSessionCookies,READER_SESSION_COOKIE}=require('../electron/reader-session-cookie.cjs');
const root=mkdtempSync(path.join(os.tmpdir(),'vantilo-reader-auth-e2e-'));
app.setPath('userData',path.join(root,'profile'));
const assets=path.join(root,'reader'),library=path.join(root,'library');
const origin='http://127.0.0.1:5175';
let supervisor,win;
const deadline=setTimeout(()=>{console.error('FAIL: isolated Reader authentication timeout');app.exit(1);},30000);
async function prepare(){
  await fs.mkdir(path.join(assets,'seed','books'),{recursive:true});
  await fs.mkdir(path.join(assets,'native'),{recursive:true});
  await fs.mkdir(path.join(library,'data'),{recursive:true});
  await fs.writeFile(path.join(library,'data','vantilo-magazine-sync.json.preferences.json'),JSON.stringify({version:1,automatic:false}));
  await fs.cp(path.resolve(__dirname,'../build/reader/web'),path.join(assets,'web'),{recursive:true});
  await fs.copyFile(path.resolve(__dirname,'../build/reader/api.cjs'),path.join(assets,'api.cjs'));
  await fs.copyFile(path.resolve(__dirname,'../build/reader/native/vantilo-dictionary'),path.join(assets,'native','vantilo-dictionary'));
  const epub=await fs.readFile(path.resolve(__dirname,'../tests/fixtures/minimal-magazine.epub'));
  await fs.writeFile(path.join(assets,'seed','books','Fixture.epub'),epub);
  await fs.writeFile(path.join(assets,'seed','manifest.json'),JSON.stringify({version:1,audience:'personal-development',entries:[{kind:'books',filename:'Fixture.epub',bytes:epub.length,sha256:createHash('sha256').update(epub).digest('hex')}]}));
}
async function check(){
  await prepare();
  supervisor=new PortableReaderSupervisor({utilityProcess,assetsDir:assets,libraryRoot:library,
    ...(process.env.VANTILO_AUTH_TEST_ENTRY?{entryPath:path.resolve(process.env.VANTILO_AUTH_TEST_ENTRY)}:{}),
    ...readerSessionCookies(()=>session.defaultSession),
    getAccountStatus:async()=>({connected:false,email:null}),listModels:async()=>({models:[]})});
  await supervisor.start();
  if((await fetch(origin+'/api/books')).status!==401)throw new Error('Unauthenticated proxy request was not rejected');
  if((await fetch('http://127.0.0.1:5174/api/books')).status!==401)throw new Error('Unauthenticated direct request was not rejected');
  if((await fetch(origin+'/api/books',{headers:{origin:'https://foreign.example'}})).status!==403)throw new Error('Foreign origin was not rejected');
  const saved=(await session.defaultSession.cookies.get({url:origin,name:READER_SESSION_COOKIE}))[0];
  if(!saved?.httpOnly||!saved.secure||!saved.value)throw new Error('Protected session cookie missing');
  const parent=path.join(root,'host.html');
  await fs.writeFile(parent,`<!doctype html><iframe src="${origin}/" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"></iframe>`);
  win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  await win.loadFile(parent);
  let frame;
  for(let i=0;i<60;i++){
    frame=win.webContents.mainFrame.frames.find(item=>item.url.startsWith(origin+'/'));
    if(frame&&await frame.executeJavaScript('Boolean(document.querySelector(".global-nav-primary"))'))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!frame)throw new Error('Reader iframe did not load');
  const result=await frame.executeJavaScript(`(async()=>({status:(await fetch('/api/books')).status,exposed:document.cookie.includes('${READER_SESSION_COOKIE}'),page:document.body.innerText.includes('阅读空间')}))()`);
  if(result.status!==200||result.exposed||!result.page)throw new Error('Authenticated Reader iframe failed: '+JSON.stringify(result));
  await supervisor.stop();
  if((await session.defaultSession.cookies.get({url:origin,name:READER_SESSION_COOKIE})).length)throw new Error('Session cookie survived stop');
  await supervisor.start();
  const rotated=(await session.defaultSession.cookies.get({url:origin,name:READER_SESSION_COOKIE}))[0];
  if(!rotated||rotated.value===saved.value)throw new Error('Session token did not rotate');
  if((await fetch(origin+'/api/books',{headers:{cookie:READER_SESSION_COOKIE+'='+saved.value}})).status!==401)throw new Error('Old session token remains valid');
  console.log('PASS: ordinary Reader utility, Electron session cookie and Chromium iframe; no-token and foreign-origin requests rejected; token rotated after restart; synthetic EPUB only.');
}
app.whenReady().then(check).then(async()=>{clearTimeout(deadline);win?.destroy();await supervisor?.stop();await fs.rm(root,{recursive:true,force:true});app.quit();},async error=>{console.error(error.stack||String(error));clearTimeout(deadline);win?.destroy();await supervisor?.stop().catch(()=>{});await fs.rm(root,{recursive:true,force:true});app.exit(1);});
app.on('window-all-closed',()=>{});
