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
import {copyDefaultMagazines,readDefaultMagazines} from './default-magazine-seed.mjs';
import {copyCodexRuntime} from './codex-runtime-assets.mjs';
import {readerSourceRoot} from './reader-source-path.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const icon of ['resources/vantilo-icon.png','resources/vantilo.icns'])await fs.access(path.join(repo,icon));
const require=createRequire(import.meta.url);
const root=process.env.VANTILO_BETA_ROOT;
const inputs=process.env.VANTILO_BETA_INPUTS;
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('此候选版构建要求 Apple Silicon macOS');
if(!path.isAbsolute(root||'')||!path.isAbsolute(inputs||''))throw new Error('请指定新的绝对路径 VANTILO_BETA_ROOT 和 VANTILO_BETA_INPUTS');
const tempRoot=await fs.realpath('/private/tmp'),repoBuild=await fs.realpath(path.join(repo,'build')),parent=await fs.realpath(path.dirname(root));
if(parent!==tempRoot&&!parent.startsWith(tempRoot+path.sep)&&parent!==repoBuild&&!parent.startsWith(repoBuild+path.sep))throw new Error('候选构建目录必须位于 /private/tmp 或仓库忽略的 build 目录');
await fs.mkdir(root,{recursive:false}); // Refuse to overwrite an existing directory.
await readDefaultMagazines();
const reader=path.join(root,'reader-input'),dist=path.join(root,'dist');
await fs.mkdir(reader);
process.env.VANTILO_QWEN_API_OUTPUT=path.join(reader,'api.cjs');
process.env.VANTILO_QWEN_WEB_OUTPUT=path.join(reader,'web');
process.env.VANTILO_QWEN_NATIVE_OUTPUT=path.join(reader,'native');
process.env.VANTILO_QWEN_VITE_CACHE=path.join(root,'reader-cache');
process.env.VANTILO_TRANSLATION_READER='1';
process.env.VANTILO_CATALOG_READER_PREVIEW='1';
await import('./build-reader-api-preview.mjs');
await import('./build-reader-web-preview.mjs');
await import('./stage-reader-qwen-health.mjs');
await viteBuild({root:repo,configFile:false,envFile:false,base:'./',cacheDir:path.join(root,'vite-cache'),
  plugins:[parcelMacros.vite(),react()],build:{outDir:dist,emptyOutDir:true,sourcemap:false}});

const nativeArm=path.join(repo,'build/reader/native/vantilo-dictionary');
const nativeIntel=path.join(inputs,'native-x64/vantilo-dictionary');
// Prepared separately from the pinned official b11904 archive; no model weights.
const codexArm=path.join(readerSourceRoot,'node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin');
const codexIntel=path.join(inputs,'codex-x64/package/vendor/x86_64-apple-darwin/bin');
const electronArm=path.join(repo,'node_modules/electron/dist');
const electronIntel=path.join(inputs,'electron-x64');
function archOf(file){return execFileSync('/usr/bin/lipo',['-archs',file],{encoding:'utf8'}).trim().split(/\s+/);}
for(const [file,arch] of [[nativeArm,'arm64'],[nativeIntel,'x86_64'],[path.join(codexArm,'codex'),'arm64'],[path.join(codexArm,'codex-code-mode-host'),'arm64'],[path.join(codexIntel,'codex'),'x86_64'],[path.join(codexIntel,'codex-code-mode-host'),'x86_64'],[path.join(electronArm,'Electron.app/Contents/MacOS/Electron'),'arm64'],[path.join(electronIntel,'Electron.app/Contents/MacOS/Electron'),'x86_64']]){
  if(!archOf(file).includes(arch))throw new Error('组件架构不匹配: '+path.basename(file));
}
const mainPlugin={name:'beta-release-gate',setup(b){b.onLoad({filter:/electron[\\/]main\.cjs$/},async args=>{
  let code=await fs.readFile(args.path,'utf8');
  const substitutions=[
    ["const modelSetupPreview = app.isPackaged && process.env.VANTILO_READER_PREVIEW === '1';","const modelSetupPreview = app.isPackaged && process.env.VANTILO_BETA_BUILD === '1';"],
    ["const readerQwenIntegrated = modelSetupPreview && process.arch === 'arm64' && path.basename(app.getPath('userData')) === 'Vantilo Qwen Setup Preview';","const readerQwenIntegrated = modelSetupPreview && process.arch === 'arm64';"],
  ];
  for(const [before,after] of substitutions){if(code.split(before).length!==2)throw new Error('候选版集成位置已改变');code=code.replace(before,after);}
  return {contents:code,loader:'js'};
});}};
const metadata=JSON.parse(await fs.readFile(path.join(repo,'package.json'),'utf8'));
const electronVersion=require('electron/package.json').version;
const artifacts=[];
for(const target of [{arch:'arm64',native:nativeArm,codex:codexArm,electron:electronArm},{arch:'x64',native:nativeIntel,codex:codexIntel,electron:electronIntel}]){
  const stage=path.join(root,'stage-'+target.arch),out=path.join(root,'apps');
  await fs.mkdir(path.join(stage,'resources'),{recursive:true});
  await fs.copyFile(path.join(repo,'resources/vantilo-icon.png'),path.join(stage,'resources/vantilo-icon.png'));
  await fs.mkdir(path.join(stage,'electron'),{recursive:true});
  await fs.cp(dist,path.join(stage,'dist'),{recursive:true});
  await fs.cp(path.join(repo,'licenses'),path.join(stage,'licenses'),{recursive:true});
  const r=path.join(stage,'reader');await fs.mkdir(path.join(r,'native'),{recursive:true});
  await fs.cp(path.join(reader,'web'),path.join(r,'web'),{recursive:true});
  await fs.copyFile(path.join(reader,'api.cjs'),path.join(r,'api.cjs'));
  await fs.copyFile(nativeArm===target.native?nativeArm:nativeIntel,path.join(r,'native/vantilo-dictionary'));
  if(target.arch==='arm64')for(const name of ['vantilo-qwen-health','mlx-swift_Cmlx.bundle','swift-transformers_Hub.bundle','swift-crypto_Crypto.bundle'])await fs.cp(path.join(reader,'native',name),path.join(r,'native',name),{recursive:true});
  await copyCodexRuntime(target.codex,r);
  for(const name of ['provenance.json','THIRD_PARTY_NOTICES.txt'])await fs.copyFile(path.join(repo,'build/reader',name),path.join(r,name));
  await copyDefaultMagazines(path.join(r,'seed'));
  for(const entry of ['main.cjs','preload.cjs','runtime-entry.cjs','portable-reader-entry.cjs','portable-reader-service.cjs'])await bundle({entryPoints:[path.join(repo,'electron',entry)],outfile:path.join(stage,'electron',entry),platform:'node',target:'node22',format:'cjs',bundle:true,external:['electron'],minify:true,legalComments:'eof',plugins:[mainPlugin]});
  await fs.writeFile(path.join(stage,'electron/beta-main.cjs'),`'use strict';\nconst {app}=require('electron');\nconst path=require('node:path');\nconst override=app.commandLine.getSwitchValue('user-data-dir');\napp.setPath('userData',override&&path.isAbsolute(override)?override:path.join(app.getPath('appData'),'Vantilo Beta'));\nprocess.env.VANTILO_BETA_BUILD='1';\nrequire('./main.cjs');\n`);
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
  await readDefaultMagazines(path.join(app,'Contents/Resources/app/reader/seed'));
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
await fs.writeFile(path.join(root,'BETA-REPORT.json'),JSON.stringify({version:metadata.version,artifacts,scope:'local beta candidates; Intel devices use configured cloud or LAN APIs; public distribution rights review pending',modelWeightsIncluded:false},null,2)+'\n');
console.log('LOCAL_BETA_CANDIDATES='+JSON.stringify(artifacts));
