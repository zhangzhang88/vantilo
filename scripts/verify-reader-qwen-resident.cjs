require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();
// True packaged Electron utilityProcess integration test for the resident MLX
// Reader helper. Uses only a synthetic Reader seed + an ephemeral model reference.
const {app,utilityProcess}=require('electron');
const fs=require('node:fs'), fsp=require('node:fs/promises'), os=require('node:os'),path=require('node:path');
const {randomBytes}=require('node:crypto');
const pkg=path.resolve(__dirname,'..','out/reader-qwen-preview/Vantilo Qwen Setup Preview-darwin-arm64/Vantilo Qwen Setup Preview.app/Contents/Resources/app');
const assets=path.join(pkg,'reader');
const modelPath=process.env.VANTILO_QWEN_TEST_MODEL;
if(!modelPath||!path.isAbsolute(modelPath))throw new Error('Set VANTILO_QWEN_TEST_MODEL to an absolute model directory before this optional real-model test.');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vantilo-b3-resident-packaged-'));
const revision='32f3e8ecf65426fc3306969496342d504bfa13f3';
app.setPath('userData',temp);
const timeout=setTimeout(()=>{console.error('PACKAGED_RESIDENT_TIMEOUT');app.exit(2)},90000);
async function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
const stamp=()=>Number(process.hrtime.bigint())/1e6;
app.whenReady().then(async()=>{
  let child;
  try {
    const marker=path.join(temp,'local-models');
    await fsp.mkdir(marker,{recursive:true});
    await fsp.writeFile(path.join(marker,'.adopted-qwen3.5-4b-mlx-4bit.json'),
      JSON.stringify({version:1,id:'qwen3.5-4b-mlx-4bit',revision,path:modelPath}));
    const before=await fetch('http://127.0.0.1:5195/',{signal:AbortSignal.timeout(1000)}).then(()=>true,()=>false);
    if(before)throw new Error('Preview port 5195 is occupied; cannot safely run isolated test');
    child=utilityProcess.fork(path.join(pkg,'electron/portable-reader-entry.cjs'),
      [assets,path.join(temp,'reader-library'),'preview-local-qwen'],{
        serviceName:'Vantilo Qwen Resident Test',stdio:'ignore',
        env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},
      });
    const sessionToken=randomBytes(32).toString('hex');
    child.postMessage({type:'reader-session',token:sessionToken});
    await new Promise((resolve,reject)=>{
      const wait=setTimeout(()=>reject(new Error('Reader utility did not start')),15000);
      child.on('message',m=>{
        if(m?.type==='ready'){clearTimeout(wait);resolve();}
        if(m?.type==='error'){clearTimeout(wait);reject(new Error(m.message||'Reader start failed'));}
      });
      child.on('exit',code=>{clearTimeout(wait);reject(new Error('Reader utility exited early '+code));});
    });
    for(const [word,sentence] of [
      ['paragraph','Each paragraph develops one idea.'],
      ['bank','The bank of the river was muddy.'],
      ['bark',"The tree's bark is rough."],
    ]){
      const started=stamp();
      const response=await fetch('http://127.0.0.1:5195/api/vantilo-qwen/gloss',{
        method:'POST',headers:{'content-type':'application/json','cookie':'__Host-vantilo-reader='+sessionToken},
        body:JSON.stringify({word,sentence}),
        signal:AbortSignal.timeout(30000),
      });
      const value=await response.json();
      const ms=Math.round(stamp()-started);
      console.log('PACKAGED_QWEN_RESIDENT',JSON.stringify({word,http:response.status,meaning:value.meaningZh,elapsedMs:ms}));
      if(response.status!==200 || !value.meaningZh || ms>30000)throw new Error('Packaged resident inference failed');
    }
    console.log('PACKAGED_QWEN_RESIDENT_PASS');
  } finally {
    if(child){
      const exited=new Promise(resolve=>child.once('exit',resolve));
      child.postMessage({type:'shutdown'});
      await Promise.race([exited,sleep(3000).then(()=>child.kill())]);
    }
    await fsp.rm(temp,{recursive:true,force:true});
    clearTimeout(timeout);app.quit();
  }
}).catch(err=>{console.error('PACKAGED_QWEN_RESIDENT_FAIL',err.stack);clearTimeout(timeout);app.exit(1)});
