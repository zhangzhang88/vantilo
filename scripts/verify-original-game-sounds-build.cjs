// Integration contract for ordinary desktop:dev, production Reader, and beta Reader.
const {assertWorkspaceTestEnvironment} = require('./workspace-test-environment.cjs');
const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
assertWorkspaceTestEnvironment();
const repo=path.resolve(__dirname,'..');
const artifacts=process.env.VANTILO_TEST_ARTIFACT_ROOT;
if(!artifacts)throw new Error('Missing isolated Workspace artifacts directory');
function awaitImport(){
  return import(pathToFileURL(path.join(__dirname,'original-game-sound-assets.mjs')).href);
}
async function run(script,label,extra={}) {
  const childEnv={...process.env,...extra};
  delete childEnv.VANTILO_DEV_ORIGINAL_GAME_SOUNDS; // Prove no special flag is needed.
  return await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(__dirname,script)],{cwd:repo,env:childEnv,stdio:['ignore','pipe','pipe']});
    let error='';
    child.stdout.on('data',chunk=>{process.stdout.write(chunk);});
    child.stderr.on('data',chunk=>{error=(error+chunk.toString()).slice(-6000);process.stderr.write(chunk);});
    child.on('error',reject);
    child.on('exit',code=>code===0?resolve():reject(new Error(label+' failed ('+code+'): '+error)));
  });
}
(async()=>{
  const {assertBundledOriginalGameSounds,verifyOriginalGameSoundDirectory}=await awaitImport();
  const source=path.join(repo,'packages/reader/assets/worm');
  await verifyOriginalGameSoundDirectory(source);
  const builds=[
    {label:'ordinary-desktop-dev',script:'build-reader-dev.mjs',output:path.join(artifacts,'ordinary-desktop-dev-reader')},
    {label:'official-release-reader',script:'build-reader.mjs',output:path.join(artifacts,'official-release-reader')},
  ];
  for(const item of builds){
    await run(item.script,item.label,{VANTILO_READER_BUILD_OUTPUT:item.output,VANTILO_SWIFT_MODULE_CACHE_PATH:path.join(artifacts,item.label+'-swift')});
    await assertBundledOriginalGameSounds(path.join(item.output,'web'));
    const assets=await fs.readdir(path.join(item.output,'web','assets'));
    const jsAssets=assets.filter(name=>name.endsWith('.js'));
    const contents=await Promise.all(jsAssets.map(name=>fs.readFile(path.join(item.output,'web','assets',name),'utf8')));
    if(!contents.some(js=>js.includes('/worm/')&&js.includes('.mp3')))throw new Error('Original MP3 playback path missing from '+item.label+' frontend JS');
    if(contents.some(js=>js.includes('__VANTILO_ORIGINAL_GAME_SOUNDS__')))throw new Error('Original game sound feature flag not defined in '+item.label);
    console.log('ORIGINAL_GAME_SOUNDS_BUILD=PASS mode='+item.label+' files=3 verifiedSha=true html=true');
  }
  const betaWeb=path.join(artifacts,'beta-candidate-reader-web');
  await run('build-reader-web-preview.mjs','beta-candidate-reader',{
    VANTILO_RELEASE_READER:'1', VANTILO_CATALOG_READER_PREVIEW:'1',VANTILO_TRANSLATION_READER:'1',
    VANTILO_QWEN_WEB_OUTPUT:betaWeb,VANTILO_QWEN_WEB_MODULES_OUTPUT:path.join(artifacts,'beta-web-modules.json'),
    VANTILO_QWEN_VITE_CACHE:path.join(artifacts,'beta-vite-cache'),
  });
  await assertBundledOriginalGameSounds(betaWeb);
  const stageWeb=path.join(artifacts,'installer-stage-reader','web');
  await fs.cp(path.join(builds[1].output,'web'),stageWeb,{recursive:true});
  await assertBundledOriginalGameSounds(stageWeb);
  console.log('ORIGINAL_GAME_SOUNDS_PACKAGED_STAGE=PASS beta=true releaseStage=true originalTyping=true originalCorrect=true originalError=true');
})().catch(error=>{console.error('ORIGINAL_GAME_SOUNDS_BUILD=FAIL '+error.stack);process.exitCode=1;});
