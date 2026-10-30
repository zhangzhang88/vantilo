// Build local, clearly labelled beta candidates in a new directory. Never
// bundle the development seed, model weights, credentials or user profiles.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {build as bundle} from 'esbuild';
import {build as viteBuild} from 'vite';
import react from '@vitejs/plugin-react';
import parcelMacros from 'unplugin-parcel-macros';
import {packager} from '@electron/packager';
import {copyCodexRuntime} from './codex-runtime-assets.mjs';
import {readerSourceRoot} from './reader-source-path.mjs';
import {assertNoEpubFiles} from './package-artifact-policy.mjs';
import {runtimeModuleInventoryPlugin} from './runtime-module-inventory.mjs';
import {collectPackageRootsFromModules,packageRecordsFromRoots,renderThirdPartyNotices} from './third-party-notices.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const legacyReaderSeed=path.join(repo,'build/reader/seed');
try { await fs.lstat(legacyReaderSeed); throw new Error('拒绝使用含旧 seed 的 Reader build 输出；请先人工检查并移出 build/reader/seed'); }
catch(error) { if(error.code!=='ENOENT') throw error; }
for(const icon of ['resources/vantilo-icon.png','resources/vantilo.icns'])await fs.access(path.join(repo,icon));
const require=createRequire(import.meta.url);
const requireReader=createRequire(path.join(readerSourceRoot,'package.json'));
const root=process.env.VANTILO_BETA_ROOT;
const inputs=process.env.VANTILO_BETA_INPUTS;
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('此候选版构建要求 Apple Silicon macOS');
if(!path.isAbsolute(root||'')||!path.isAbsolute(inputs||''))throw new Error('请指定新的绝对路径 VANTILO_BETA_ROOT 和 VANTILO_BETA_INPUTS');
const tempRoot=await fs.realpath('/private/tmp'),repoBuild=await fs.realpath(path.join(repo,'build')),parent=await fs.realpath(path.dirname(root));
if(parent!==tempRoot&&!parent.startsWith(tempRoot+path.sep)&&parent!==repoBuild&&!parent.startsWith(repoBuild+path.sep))throw new Error('候选构建目录必须位于 /private/tmp 或仓库忽略的 build 目录');
await fs.mkdir(root,{recursive:false}); // Refuse to overwrite an existing directory.
const reader=path.join(root,'reader-input'),dist=path.join(root,'dist');
const runtimeInventory=path.join(root,'runtime-inventory');
await Promise.all([fs.mkdir(reader),fs.mkdir(runtimeInventory)]);
process.env.VANTILO_QWEN_API_OUTPUT=path.join(reader,'api.cjs');
process.env.VANTILO_QWEN_API_METAFILE=path.join(runtimeInventory,'reader-api-metafile.json');
process.env.VANTILO_QWEN_WEB_MODULES_OUTPUT=path.join(runtimeInventory,'reader-web-modules.json');
process.env.VANTILO_QWEN_WEB_OUTPUT=path.join(reader,'web');
process.env.VANTILO_QWEN_NATIVE_OUTPUT=path.join(reader,'native');
process.env.VANTILO_QWEN_VITE_CACHE=path.join(root,'reader-cache');
process.env.VANTILO_RELEASE_READER='1';
process.env.VANTILO_TRANSLATION_READER='1';
process.env.VANTILO_CATALOG_READER_PREVIEW='1';
await import('./build-reader-api-preview.mjs');
await import('./build-reader-web-preview.mjs');
await viteBuild({root:repo,configFile:false,envFile:false,base:'./',cacheDir:path.join(root,'vite-cache'),
  plugins:[parcelMacros.vite(),react(),runtimeModuleInventoryPlugin(path.join(runtimeInventory,'main-renderer-modules.json'))],build:{outDir:dist,emptyOutDir:true,sourcemap:false}});

const nativeArm=path.join(repo,'build/reader/native/vantilo-dictionary');
const nativeIntel=process.env.VANTILO_NATIVE_X64_HELPER?path.resolve(process.env.VANTILO_NATIVE_X64_HELPER):path.join(inputs,'native-x64/vantilo-dictionary');
// Prepared separately from the pinned official b11904 archive; no model weights.
const codexArm=path.join(path.dirname(requireReader.resolve('@openai/codex-darwin-arm64/package.json')),'vendor/aarch64-apple-darwin/bin');
const codexIntel=path.join(inputs,'codex-x64/package/vendor/x86_64-apple-darwin/bin');
const electronArm=path.join(repo,'node_modules/electron/dist');
const electronIntel=path.join(inputs,'electron-x64');
function archOf(file){return execFileSync('/usr/bin/lipo',['-archs',file],{encoding:'utf8'}).trim().split(/\s+/);}
for(const [file,arch] of [[nativeArm,'arm64'],[nativeIntel,'x86_64'],[path.join(codexArm,'codex'),'arm64'],[path.join(codexArm,'codex-code-mode-host'),'arm64'],[path.join(codexIntel,'codex'),'x86_64'],[path.join(codexIntel,'codex-code-mode-host'),'x86_64'],[path.join(electronArm,'Electron.app/Contents/MacOS/Electron'),'arm64'],[path.join(electronIntel,'Electron.app/Contents/MacOS/Electron'),'x86_64']]){
  if(!archOf(file).includes(arch))throw new Error('组件架构不匹配: '+path.basename(file));
}
const metadata=JSON.parse(await fs.readFile(path.join(repo,'package.json'),'utf8'));
const electronVersion=require('electron/package.json').version;
const electronZips={arm64:path.join(inputs,`electron-v${electronVersion}-darwin-arm64.zip`),x64:path.join(inputs,`electron-v${electronVersion}-darwin-x64.zip`)};
function electronZipText(archive,entry){return execFileSync('/usr/bin/unzip',['-p',archive,entry],{encoding:'utf8',maxBuffer:16*1024*1024});}
const electronLicense=electronZipText(electronZips.arm64,'LICENSE');
const chromiumLicenses=electronZipText(electronZips.arm64,'LICENSES.chromium.html');
for(const arch of ['x64']){
  if(electronZipText(electronZips[arch],'LICENSE')!==electronLicense||electronZipText(electronZips[arch],'LICENSES.chromium.html')!==chromiumLicenses)throw new Error('Electron architecture archives have different license or Chromium notice contents');
}
const codexArmPackage=JSON.parse(await fs.readFile(requireReader.resolve('@openai/codex-darwin-arm64/package.json'),'utf8'));
const codexIntelPackage=JSON.parse(await fs.readFile(path.join(inputs,'codex-x64/package/package.json'),'utf8'));
const codexVersion=/^(\d+\.\d+\.\d+)-darwin-arm64$/.exec(codexArmPackage.version)?.[1];
if(!codexVersion||codexIntelPackage.version!==`${codexVersion}-darwin-x64`)throw new Error('Bundled Codex architecture versions do not match');
async function staticDocument(name,version,license,file,source){return{name,version,license,label:file,text:await fs.readFile(path.join(repo,file),'utf8'),source};}
const spectrumAi=JSON.parse(await fs.readFile(require.resolve('@react-spectrum/ai/package.json'),'utf8'));
const spectrumS2=JSON.parse(await fs.readFile(require.resolve('@react-spectrum/s2/package.json'),'utf8'));
const binaryDocuments=[
  {name:'Electron',version:electronVersion,license:'MIT',label:'Official Electron distribution LICENSE',text:electronLicense,source:`electron-v${electronVersion}-darwin-arm64.zip and electron-v${electronVersion}-darwin-x64.zip`},
  {name:'Electron bundled Chromium components',version:electronVersion,license:'Multiple component licenses (full upstream catalog)',label:'Official LICENSES.chromium.html',text:chromiumLicenses,source:`electron-v${electronVersion}-darwin-arm64.zip and electron-v${electronVersion}-darwin-x64.zip`},
  {name:'OpenAI Codex',version:codexVersion,license:'Apache-2.0',label:'licenses/OpenAI-Codex/LICENSE',text:await fs.readFile(path.join(repo,'licenses/OpenAI-Codex/LICENSE'),'utf8'),source:'Pinned official @openai/codex Darwin packages'},
  {name:'OpenAI Codex',version:codexVersion,license:'Apache-2.0',label:'licenses/OpenAI-Codex/NOTICE.md',text:await fs.readFile(path.join(repo,'licenses/OpenAI-Codex/NOTICE.md'),'utf8'),source:'Pinned official @openai/codex Darwin packages'},
  await staticDocument('@react-spectrum/ai',spectrumAi.version,spectrumAi.license,'licenses/Adobe-React-Spectrum/LICENSE-AI','Adobe React Spectrum upstream license'),
  await staticDocument('@react-spectrum/s2',spectrumS2.version,spectrumS2.license,'licenses/Adobe-React-Spectrum/LICENSE-S2','Adobe React Spectrum upstream license'),
  await staticDocument('Adobe React Spectrum attribution',`${spectrumAi.version}+${spectrumS2.version}`,'NOTICE','licenses/Adobe-React-Spectrum/NOTICE.md','Vantilo-preserved upstream provenance and attribution'),
];
const artifacts=[];
for(const target of [{arch:'arm64',native:nativeArm,codex:codexArm,electron:electronArm},{arch:'x64',native:nativeIntel,codex:codexIntel,electron:electronIntel}]){
  const stage=path.join(root,'stage-'+target.arch),out=path.join(root,'apps');
  await fs.mkdir(path.join(stage,'resources'),{recursive:true});
  await fs.copyFile(path.join(repo,'resources/vantilo-icon.png'),path.join(stage,'resources/vantilo-icon.png'));
  await fs.mkdir(path.join(stage,'electron'),{recursive:true});
  await fs.cp(dist,path.join(stage,'dist'),{recursive:true});
  await fs.cp(path.join(repo,'licenses'),path.join(stage,'licenses'),{recursive:true});
  await fs.writeFile(path.join(stage,'licenses/LICENSES.chromium.html'),chromiumLicenses,{flag:'wx'});
  await fs.writeFile(path.join(stage,'licenses/Electron-LICENSE.txt'),electronLicense,{flag:'wx'});
  const r=path.join(stage,'reader');await fs.mkdir(path.join(r,'native'),{recursive:true});
  await fs.cp(path.join(reader,'web'),path.join(r,'web'),{recursive:true});
  await fs.copyFile(path.join(reader,'api.cjs'),path.join(r,'api.cjs'));
  await fs.copyFile(nativeArm===target.native?nativeArm:nativeIntel,path.join(r,'native/vantilo-dictionary'));
  await copyCodexRuntime(target.codex,r);
  await fs.copyFile(path.join(repo,'build/reader/provenance.json'),path.join(r,'provenance.json'));
  const electronModuleIds=[];
  for(const entry of ['main.cjs','preload.cjs','runtime-entry.cjs','portable-reader-entry.cjs','portable-reader-service.cjs']){
    const result=await bundle({entryPoints:[path.join(repo,'electron',entry)],outfile:path.join(stage,'electron',entry),platform:'node',target:'node22',format:'cjs',bundle:true,external:['electron'],minify:true,legalComments:'eof',metafile:true,plugins:[]});
    electronModuleIds.push(...Object.keys(result.metafile.inputs));
  }
  const rootModuleIds=JSON.parse(await fs.readFile(path.join(runtimeInventory,'main-renderer-modules.json'),'utf8'));
  const readerWebModuleIds=JSON.parse(await fs.readFile(path.join(runtimeInventory,'reader-web-modules.json'),'utf8'));
  const readerApiMetafile=JSON.parse(await fs.readFile(path.join(runtimeInventory,'reader-api-metafile.json'),'utf8'));
  const mainRoots=await collectPackageRootsFromModules(repo,rootModuleIds);
  const readerRoots=await collectPackageRootsFromModules(repo,[...readerWebModuleIds,...Object.keys(readerApiMetafile.inputs)]);
  const electronRoots=await collectPackageRootsFromModules(repo,electronModuleIds);
  const mainRecords=await packageRecordsFromRoots(repo,mainRoots);
  const readerRecords=await packageRecordsFromRoots(repo,readerRoots);
  const electronRecords=await packageRecordsFromRoots(repo,electronRoots);
  const packageRoots=new Set([...mainRoots,...readerRoots,...electronRoots]);
  const packageRecords=await packageRecordsFromRoots(repo,[...packageRoots]);
  const notices=await renderThirdPartyNotices({repoRoot:repo,appVersion:metadata.version,packageRecords,binaryDocuments});
  for(const [name,records] of [['main-renderer',mainRecords],['reader-runtime',readerRecords],['electron-main',electronRecords],['all-runtime',packageRecords]])await fs.writeFile(path.join(runtimeInventory,`${name}-package-roots.json`),JSON.stringify(records,null,2)+'\n');
  await fs.writeFile(path.join(stage,'licenses/THIRD_PARTY_NOTICES.txt'),notices);
  await fs.writeFile(path.join(r,'THIRD_PARTY_NOTICES.txt'),notices);
  await fs.copyFile(path.join(repo,'electron/beta-main.cjs'),path.join(stage,'electron/beta-main.cjs'));
  await fs.writeFile(path.join(stage,'package.json'),JSON.stringify({name:'vantilo-beta',version:metadata.version,private:true,main:'electron/beta-main.cjs'}));
  await fs.copyFile(path.join(repo,'node_modules/zod/LICENSE'),path.join(stage,'licenses/Zod-LICENSE.txt'));
  const result=await packager({dir:stage,out,name:'Vantilo Beta',platform:'darwin',arch:target.arch,electronVersion,electronZipDir:inputs,appBundleId:'com.vantilo.desktop.beta',icon:path.join(repo,'resources/vantilo.icns'),overwrite:false,prune:false,asar:false});
  // electron-packager may silently keep Electron's stock icon when it does not
  // recognize an .icns path as its expected .icon format. Install the bundled
  // Vantilo icon explicitly and point the app bundle at it.
  const appPath=path.join(result[0],'Vantilo Beta.app');
  await fs.copyFile(path.join(repo,'resources/vantilo.icns'),path.join(appPath,'Contents/Resources/electron.icns'));
  execFileSync('/usr/libexec/PlistBuddy',['-c','Set :CFBundleIconFile electron.icns',path.join(appPath,'Contents/Info.plist')]);
  const app=appPath;
  await assertNoEpubFiles(app);
  execFileSync(process.execPath,[path.join(repo,'scripts/verify-third-party-notices.cjs'),app,...['all-runtime','main-renderer','reader-runtime','electron-main'].map(name=>path.join(runtimeInventory,`${name}-package-roots.json`))],{stdio:'inherit'});
  const packagedNative=path.join(app,'Contents/Resources/app/reader/native');
  if(target.arch==='x64' && await fs.stat(path.join(packagedNative,'vantilo-qwen-health')).then(()=>true,()=>false))throw new Error('Intel 包不能包含 Apple Silicon MLX helper');
  // Electron's newly created bundle may carry Finder metadata that codesign
  // rejects. Remove only this attribute from this generated bundle root.
  const attributes=execFileSync('/usr/bin/xattr',[app],{encoding:'utf8'}).split(/\s+/);
  if(attributes.includes('com.apple.FinderInfo'))execFileSync('/usr/bin/xattr',['-d','com.apple.FinderInfo',app]);
  execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
  let verified=false;
  for(let attempt=0;attempt<4&&!verified;attempt++){
    await new Promise(resolve=>setTimeout(resolve,200));
    if(execFileSync('/usr/bin/xattr',[app],{encoding:'utf8'}).split(/\s+/).includes('com.apple.FinderInfo'))execFileSync('/usr/bin/xattr',['-d','com.apple.FinderInfo',app]);
    try{execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});verified=true;}catch(error){if(attempt===3)throw error;}
  }
  const zip=path.join(root,'Vantilo-Beta-mac-'+target.arch+'.zip');
  execFileSync('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,zip],{stdio:'inherit'});
  const hash=createHash('sha256');for await(const chunk of (await import('node:fs')).createReadStream(zip))hash.update(chunk);
  const sha256=hash.digest('hex');await fs.writeFile(zip+'.sha256',sha256+'  '+path.basename(zip)+'\n');
  artifacts.push({arch:target.arch,zip,sha256,bytes:(await fs.stat(zip)).size});
}
await fs.writeFile(path.join(root,'BETA-REPORT.json'),JSON.stringify({version:metadata.version,artifacts,scope:'beta test candidates; Reader users import their own EPUBs',modelWeightsIncluded:false,defaultMagazineSeedIncluded:false,bundledEpubCount:0},null,2)+'\n');
console.log('LOCAL_BETA_CANDIDATES='+JSON.stringify(artifacts));
