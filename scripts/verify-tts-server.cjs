require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();
// Exercise the built Reader TTS route with synthetic data and a cancellable mock provider.
const fs=require('node:fs/promises');const path=require('node:path');
const {buildServer}=require(process.env.VANTILO_READER_API_PATH ? path.resolve(process.env.VANTILO_READER_API_PATH) : '../build/reader/api.cjs');
const artifactRoot=process.env.VANTILO_TEST_ARTIFACT_ROOT;if(!artifactRoot)throw new Error('Workspace test artifact root is required.');
(async()=>{
 const dir=await fs.mkdtemp(path.join(artifactRoot,'tts-server-check-'));let api;let mode='success';let notifyStart,notifyAbort;
 let started=new Promise(resolve=>notifyStart=resolve),aborted=new Promise(resolve=>notifyAbort=resolve);
 try{
  process.env.VANTILO_EDGE_TTS_EXECUTABLE='/nonexistent-edge-tts';
  api=await buildServer({projectRoot:dir,serveFrontend:false,aiProviderEnv:{},cialloTtsFetchImpl:async(url,options)=>{
   if(url!=='https://tts.ztr8.uk/api/tts'||JSON.parse(options.body).voice!=='zh-CN-XiaochenMultilingualNeural')throw Error('wrong TTS service or voice');
   if(mode==='success')return new Response(Uint8Array.from([0xff,0xfb,0x90,0x64,1,2,3,4]),{status:200,headers:{'content-type':'audio/mpeg'}});
   if(mode==='empty')return new Response(new Uint8Array(),{status:200,headers:{'content-type':'audio/mpeg'}});
   notifyStart();return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>{notifyAbort();reject(new Error('cancelled'));},{once:true});});
  }});
  await api.listen({host:'127.0.0.1',port:0});const url=`http://127.0.0.1:${api.server.address().port}/api/prep/tts`;
  const body=JSON.stringify({text:'这是合成测试。',language:'zh-CN'});const headers={'content-type':'application/json'};
  const ok=await fetch(url,{method:'POST',headers,body});if(ok.status!==200||!(ok.headers.get('content-type')||'').includes('audio/mpeg'))throw Error('valid audio rejected');await ok.arrayBuffer();
  mode='empty';const invalid=await fetch(url,{method:'POST',headers,body});const error=await invalid.json();if(invalid.status!==502||!error.error.includes('0 字节'))throw Error('empty Ciallo audio was not reported');
  mode='cancel';const controller=new AbortController();const request=fetch(url,{method:'POST',headers,body,signal:controller.signal}).catch(()=>null);
  await started;controller.abort();await request;
  await Promise.race([aborted,new Promise((_,reject)=>setTimeout(()=>reject(Error('provider was not cancelled')),3000))]);
  console.log('PASS: built TTS route uses Ciallo Xiaochen Multilingual, rejects empty audio and cancels an in-flight provider request when the client leaves.');
 }finally{await api?.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
