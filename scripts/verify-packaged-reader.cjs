// Real Electron utility-process check of packaged assets; no model calls or upstream downloads.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
if (process.parentPort) {
  (async () => {
    const [artifact, root, fixture] = process.argv.slice(2);
    const { startPortableReader } = require(path.join(artifact, 'electron/portable-reader-service.cjs'));
    const epub = await fs.readFile(fixture);
    let downloads = 0;
    const fetchImpl = async input => {
      const url = new URL(input);
      if (url.hostname === 'raw.githubusercontent.com') { downloads++; return new Response(epub); }
      if (url.hostname !== 'api.github.com') throw new Error('Unexpected outbound request');
      const relative = decodeURIComponent(url.pathname.split('/contents/')[1]);
      const names = { '01_economist':'TheEconomist', '02_new_yorker':'NewYorker', '04_atlantic':'TheAtlantic', '05_wired':'Wired' };
      const folder = relative.split('/')[0];
      if (!names[folder]) throw new Error('Unexpected source');
      const issue = folder+'/2026.10.24'; const name = names[folder]+'.2026.10.24.epub';
      return new Response(JSON.stringify(relative.includes('/') ? [{ type:'file',name,path:issue+'/'+name,download_url:'https://raw.githubusercontent.com/hehonghui/awesome-english-ebooks/master/'+issue+'/'+name }]
        : [{type:'dir',name:'2026.10.24',path:issue}]), {headers:{'content-type':'application/json'}});
    };
    const token = require('node:crypto').randomBytes(32).toString('hex');
    const {READER_SESSION_COOKIE} = require('../electron/reader-session-cookie.cjs');
    const headers = {cookie:READER_SESSION_COOKIE+'='+token};
    const service = await startPortableReader({ assetsDir:path.join(artifact,'reader'),libraryRoot:root,apiPort:0,webPort:0,autoSync:false,fetchImpl,sessionToken:token });
    try {
      const html = await fetch(service.webOrigin+'/').then(response=>response.text());
      if (!html.includes('<title>Magazine Reader</title>')) throw new Error('Missing original Reader frontend');
      const health = await fetch(service.webOrigin+'/api/health').then(response=>response.json());
      if (health.reader !== 'epub') throw new Error('API proxy failed');
      if ((await fetch(service.apiOrigin+'/api/books')).status !== 401) throw new Error('Unauthenticated Reader request was not rejected');
      for (const route of ['/api/science-articles','/api/content-discovery','/api/assistant/history']) { const status=(await fetch(service.apiOrigin+route,{headers})).status; if (status !== 404) throw new Error('Removed route returned '+status+': '+route); }
      const accountResponse=await fetch(service.apiOrigin+'/api/prep/auth',{headers});
      const account=await accountResponse.json();
      if(accountResponse.status!==200||account.connected!==false||account.pending!==false)throw new Error('Reader account status does not reflect the unified disconnected account');
      for(const route of ['/api/prep/auth/start','/api/prep/auth/disconnect']) {
        const response=await fetch(service.apiOrigin+route,{method:'POST',headers});
        if(response.status!==404)throw new Error('Legacy Reader login route remains available: '+route);
      }
      await service.sync.check();
      if (service.sync.getState().importedCount !== 4 || downloads !== 4) throw new Error('First-install fixture sync failed');
      await service.sync.check();
      if (downloads !== 4) throw new Error('Existing issues downloaded again');
      process.parentPort.postMessage({ok:true,message:'Packaged Reader HTML → API proxy → four synthetic EPUB imports → idempotent recheck passed in Electron utilityProcess without external Node/npm or original Reader source.'});
    } finally { await service.close(); }
  })().then(()=>process.exit(0),error=>{process.parentPort.postMessage({ok:false,message:error.message});process.exit(1);});
} else {
  const {app,utilityProcess} = require('electron');
  let root;
  app.whenReady().then(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(),'vantilo-package-check-'));
    const repo = path.resolve(__dirname,'..');
    const artifact = process.argv[2] || path.join(repo,'out','Vantilo-darwin-'+process.arch,'Vantilo.app/Contents/Resources/app');
    const child = utilityProcess.fork(__filename,[artifact,root,path.join(repo,'tests/fixtures/minimal-magazine.epub')],{
      cwd:root,stdio:'ignore',env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},serviceName:'Vantilo packaged Reader check',
    });
    let success = false;
    const timer = setTimeout(()=>{child.kill();console.error('FAIL: packaged Reader timeout');app.exit(1);},15000);
    child.on('message',message=>{success=message.ok===true; console.log((success?'PASS: ':'FAIL: ')+message.message);});
    child.on('exit',async code=>{clearTimeout(timer);await fs.rm(root,{recursive:true,force:true});app.exit(success&&code===0?0:1);});
  }).catch(error=>{console.error(error);app.exit(1);});
}
