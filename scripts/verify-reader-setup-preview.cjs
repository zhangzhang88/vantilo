// Validate the packaged Reader Setup Preview itself, with no developer profile,
// network download, Codex login, or personal library access.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const previewDir = path.resolve(__dirname,'../out/reader-setup-preview/Vantilo Reader Setup Preview-darwin-'+process.arch+'/Vantilo Reader Setup Preview.app');
const resources = path.join(previewDir,'Contents/Resources/app');
if(process.parentPort) {
  (async()=>{
    const root = process.argv[2];
    const {startPortableReader} = require(path.join(resources,'electron/portable-reader-service.cjs'));
    let outbound=0;
    const service = await startPortableReader({
      assetsDir:path.join(resources,'reader'),
      libraryRoot:path.join(root,'library'),
      seedDir:path.join(resources,'reader/seed'),
      apiPort:0,webPort:0,autoSync:false,
      fetchImpl:async()=>{outbound++;throw Error('Packaged preview attempted a network fetch');},
    });
    try {
      const health=await fetch(service.apiOrigin+'/api/health').then(response=>response.json());
      if(health.ok!==true||health.reader!=='epub')throw Error('Packaged Reader API health failed');
      const html=await fetch(service.webOrigin+'/').then(response=>response.text());
      if(!html.includes('<title>Magazine Reader</title>'))throw Error('Packaged Reader UI failed');
      const seed=JSON.parse(await fs.readFile(path.join(resources,'reader/seed/manifest.json'),'utf8'));
      if(seed.audience!=='redistributable'||seed.entries.length!==1||
        seed.entries[0].filename!=='Vantilo-Original-Synthetic-Fixture.epub')
        throw Error('Unexpected book in preview package');
      const books=await fs.readdir(path.join(root,'library/books'));
      const issues=await fs.readdir(path.join(root,'library/issues'));
      if(books.length!==1||books[0]!==seed.entries[0].filename||issues.length!==0)
        throw Error('Seeded user library is not isolated synthetic-only');
      if(service.sync.getState().importedCount!==0 || outbound!==0) throw Error('Preview started online magazine import');
      if(!(await fs.stat(path.join(resources,'reader/native/vantilo-dictionary'))).isFile())
        throw Error('Missing bundled Dictionary Services executable');
      process.parentPort.postMessage({ok:true,message:'Real packaged Reader UI/API started with synthetic-only EPUB, zero network requests and installed native dictionary helper.'});
    } finally {await service.close();}
  })().then(()=>process.exit(0),error=>{process.parentPort.postMessage({ok:false,message:String(error.stack||error)});process.exit(1)});
} else {
  const {app,utilityProcess} = require('electron');
  app.whenReady().then(async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'vantilo-preview-package-test-'));
    const child=utilityProcess.fork(__filename,[root],{cwd:root,stdio:'ignore',
      env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},serviceName:'Vantilo isolated preview package test'});
    let passed=false,received=false;
    const timeout=setTimeout(()=>{console.error('FAIL: preview package test timeout');child.kill();},14000);
    child.on('message',message=>{received=true;passed=message?.ok===true;console.log((passed?'PASS: ':'FAIL: ')+message.message);});
    child.on('error',error=>console.error('FAIL: '+error.message));
    child.on('exit',async code=>{
      clearTimeout(timeout);await fs.rm(root,{recursive:true,force:true});
      if(!received)console.error('FAIL: no verification response from utility process');
      app.exit(received&&passed&&code===0?0:1);
    });
  }).catch(error=>{console.error(error);app.exit(1);});
}
