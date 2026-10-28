// Build one Universal macOS beta app from matching arm64 and x64 Vantilo builds.
// All generated inputs and outputs remain under this repository's ignored build/out folders.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {makeUniversalApp} from '@electron/universal';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const metadata=JSON.parse(await fs.readFile(path.join(repo,'package.json'),'utf8'));
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('通用版构建需要 Apple Silicon macOS 构建机');
const readerSource=path.resolve(process.env.VANTILO_MAGAZINE_READER_ROOT||path.join(repo,'..','magazine-reader'));
const sourceCodex=JSON.parse(await fs.readFile(path.join(readerSource,'node_modules/@openai/codex-darwin-arm64/package.json'),'utf8'));
const codexVersion=/^(\d+\.\d+\.\d+)-darwin-arm64$/.exec(sourceCodex.version)?.[1];
if(!codexVersion)throw new Error('无法确认 ARM Codex 运行时版本');

const inputRoot=path.join(repo,'build/universal-inputs');
const electronRoot=path.join(inputRoot,'electron-x64');
const codexRoot=path.join(inputRoot,'codex-x64');
const nativeRoot=path.join(inputRoot,'native-x64');
await Promise.all([inputRoot,electronRoot,codexRoot,nativeRoot,path.join(inputRoot,'npm-cache')].map(folder=>fs.mkdir(folder,{recursive:true})));

// Resolve the official release checksum through GitHub's API, then use a
// bandwidth-friendly mirror for the archive and verify SHA-256 before extraction.
const electronVersion=require('electron/package.json').version;
const releaseResponse=await fetch(`https://api.github.com/repos/electron/electron/releases/tags/v${electronVersion}`,{headers:{Accept:'application/vnd.github+json','User-Agent':'Vantilo-universal-build','X-GitHub-Api-Version':'2022-11-28'}});
let release;
if(releaseResponse.ok){
  release=await releaseResponse.json();
}else if(releaseResponse.status===403||releaseResponse.status===429){
  // The public API can be rate limited; the official release checksum file is
  // an independently available source for the exact same archive digests.
  const checksums=await fetch(`https://github.com/electron/electron/releases/download/v${electronVersion}/SHASUMS256.txt`,{redirect:'follow'});
  if(!checksums.ok)throw new Error(`无法从 GitHub 获取 Electron 官方校验值（HTTP ${checksums.status}）`);
  const lines=(await checksums.text()).split(/\r?\n/);
  const assets=[];
  for(const arch of ['arm64','x64']){
    const name=`electron-v${electronVersion}-darwin-${arch}.zip`;
    const line=lines.find(item=>item.endsWith(` *${name}`)||item.endsWith(`  ${name}`));
    const digest=/^([a-f0-9]{64})\s+\*?/i.exec(line||'')?.[1];
    if(!digest)throw new Error(`GitHub 官方校验文件缺少 ${name}`);
    assets.push({name,digest:'sha256:'+digest});
  }
  release={assets};
}else throw new Error(`无法从 GitHub 验证 Electron 发布版本（HTTP ${releaseResponse.status}）`);
async function sha256File(filename){const hash=createHash('sha256');for await(const chunk of createReadStream(filename))hash.update(chunk);return hash.digest('hex');}
async function electronArchive(arch){
  const filename=`electron-v${electronVersion}-darwin-${arch}.zip`,target=path.join(inputRoot,filename);
  const asset=release.assets?.find(item=>item.name===filename);
  const expected=/^sha256:[a-f0-9]{64}$/i.test(asset?.digest||'')?asset.digest.slice(7):'';
  if(!expected)throw new Error(`GitHub 没有为 ${arch} Electron 压缩包提供 SHA-256 校验值`);
  if(await fs.stat(target).then(()=>true,()=>false)){
    if(await sha256File(target)!==expected)throw new Error(`${arch} Electron 压缩包校验失败，已保留原文件`);
    return target;
  }
  const response=await fetch(`https://mirrors.huaweicloud.com/electron/${electronVersion}/${filename}`,{redirect:'follow'});
  if(!response.ok||!response.body)throw new Error(`无法下载 ${arch} Electron（HTTP ${response.status}）`);
  const temp=target+'.download';const hash=createHash('sha256');
  try{
    await pipeline(response.body,new Transform({transform(chunk,_encoding,callback){hash.update(chunk);callback(null,chunk);}}),createWriteStream(temp,{flags:'wx'}));
    if(hash.digest('hex')!==expected)throw new Error(`${arch} Electron 压缩包 SHA-256 与 GitHub 官方发布记录不一致`);
    await fs.rename(temp,target);return target;
  }catch(error){await fs.rm(temp,{force:true});throw error;}
}
const electronZip=await electronArchive('x64');
await electronArchive('arm64');
if(!(await fs.stat(path.join(electronRoot,'Electron.app')).then(()=>true,()=>false)))execFileSync('/usr/bin/ditto',['-x','-k',electronZip,electronRoot],{stdio:'inherit'});

// The codex platform package is an official npm alias published alongside the
// ARM package used by Reader. Keep the tarball, extraction, and npm cache local.
const codexPackage=path.join(codexRoot,'package');
const x64CodexBin=path.join(codexPackage,'vendor/x86_64-apple-darwin/bin');
if(!(await fs.stat(path.join(x64CodexBin,'codex')).then(()=>true,()=>false))){
  const packDir=path.join(codexRoot,'download');await fs.mkdir(packDir,{recursive:true});
  const packed=execFileSync('npm',['pack',`@openai/codex@${codexVersion}-darwin-x64`,'--json','--pack-destination',packDir,'--cache',path.join(inputRoot,'npm-cache'),'--ignore-scripts'],{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','inherit']});
  const archiveName=JSON.parse(packed)[0]?.filename;
  if(typeof archiveName!=='string'||!archiveName.endsWith('.tgz'))throw new Error('未能下载官方 Intel Codex 运行时');
  await fs.mkdir(codexPackage,{recursive:true});
  execFileSync('/usr/bin/tar',['-xzf',path.join(packDir,archiveName),'-C',codexPackage,'--strip-components=1'],{stdio:'inherit'});
}
for(const name of ['codex','codex-code-mode-host'])await fs.access(path.join(x64CodexBin,name));

// Build Vantilo's small macOS Dictionary Services bridge for Intel. No dictionary
// data is bundled; macOS continues to provide the user's enabled dictionaries.
const x64Dictionary=path.join(nativeRoot,'vantilo-dictionary');
if(!(await fs.stat(x64Dictionary).then(()=>true,()=>false))){
  const sdk=execFileSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{encoding:'utf8'}).trim();
  execFileSync('/usr/bin/xcrun',['swiftc','-target','x86_64-apple-macosx12.0','-sdk',sdk,'-O',path.join(repo,'scripts/reader-system-dictionary.swift'),'-o',x64Dictionary],{cwd:repo,stdio:'inherit',timeout:120000});
  await fs.chmod(x64Dictionary,0o755);
}
function arches(file){return execFileSync('/usr/bin/lipo',['-archs',file],{encoding:'utf8'}).trim().split(/\s+/);}
for(const name of ['codex','codex-code-mode-host'])if(!arches(path.join(x64CodexBin,name)).includes('x86_64'))throw new Error('Intel Codex 架构验证失败: '+name);
if(!arches(x64Dictionary).includes('x86_64'))throw new Error('Intel 系统词典程序架构验证失败');

const stamp=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
const buildDir=await fs.realpath(path.join(repo,'build'));
const candidates=process.env.VANTILO_UNIVERSAL_CANDIDATES?path.resolve(process.env.VANTILO_UNIVERSAL_CANDIDATES):path.join(buildDir,`universal-candidates-${metadata.version}-${stamp}`);
const candidateReal=await fs.realpath(candidates).catch(()=>null);
if(process.env.VANTILO_UNIVERSAL_CANDIDATES){
  if(!candidateReal||!(candidateReal===buildDir||candidateReal.startsWith(buildDir+path.sep)))throw new Error('复用的候选目录必须位于仓库忽略的 build 目录');
}else{
  const env={...process.env,VANTILO_BETA_ROOT:candidates,VANTILO_BETA_INPUTS:inputRoot};
  execFileSync(process.execPath,[path.join(repo,'scripts/build-mac-beta-candidates.mjs')],{cwd:repo,env,stdio:'inherit'});
}

const appsRoot=path.join(candidates,'apps');
async function candidateApp(arch){
  const entries=await fs.readdir(appsRoot,{withFileTypes:true});
  const folder=entries.find(entry=>entry.isDirectory()&&entry.name.endsWith(`-darwin-${arch}`));
  if(!folder)throw new Error(`缺少 ${arch} 候选应用`);
  return path.join(appsRoot,folder.name,'Vantilo Beta.app');
}
const armApp=await candidateApp('arm64');
const x64App=await candidateApp('x64');
async function stripSignatures(app){
  async function visit(folder){
    for(const entry of await fs.readdir(folder,{withFileTypes:true})){
      const filename=path.join(folder,entry.name);
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory()){
        if(entry.name==='_CodeSignature'){await fs.rm(filename,{recursive:true,force:true});continue;}
        await visit(filename);continue;
      }
      if(entry.isFile()&&/Mach-O/.test(execFileSync('/usr/bin/file',['-b',filename],{encoding:'utf8'}))){
        try{execFileSync('/usr/bin/codesign',['--remove-signature',filename],{stdio:'ignore'});}catch{}
      }
    }
  }
  await visit(path.join(app,'Contents'));
}
// Universal merging must happen before code signing: per-architecture Electron
// frameworks carry different CodeResources signatures. The final merged app is
// signed and verified below.
await stripSignatures(x64App);
await stripSignatures(armApp);

const mergeDir=path.join(candidates,'universal');await fs.mkdir(mergeDir,{recursive:true});
const universalApp=path.join(mergeDir,'Vantilo Beta.app');
await makeUniversalApp({x64AppPath:x64App,arm64AppPath:armApp,outAppPath:universalApp});

// Sign every Mach-O leaf explicitly before signing its containing bundles.
// codesign --deep alone does not sign loose framework dylibs such as Electron's
// libffmpeg.dylib, which macOS then refuses to load at app startup.
async function signMergedApp(app){
  const bundles=[],machOs=[];
  async function visit(folder){
    for(const entry of await fs.readdir(folder,{withFileTypes:true})){
      const filename=path.join(folder,entry.name);
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory()){
        if(/\.(?:app|framework|xpc|appex|plugin|bundle)$/.test(entry.name))bundles.push(filename);
        await visit(filename);continue;
      }
      if(entry.isFile()&&/Mach-O/.test(execFileSync('/usr/bin/file',['-b',filename],{encoding:'utf8'})))machOs.push(filename);
    }
  }
  await visit(path.join(app,'Contents'));
  // Sign embedded helpers and dylibs before bundle executables. Some framework
  // executables are also their bundle's main code and codesign checks children.
  machOs.sort((a,b)=>b.split(path.sep).length-a.split(path.sep).length);
  for(const file of machOs)execFileSync('/usr/bin/codesign',['--force','--sign','-','--timestamp=none',file],{stdio:'inherit'});
  bundles.sort((a,b)=>b.split(path.sep).length-a.split(path.sep).length);
  for(const bundle of bundles)execFileSync('/usr/bin/codesign',['--force','--sign','-','--timestamp=none',bundle],{stdio:'inherit'});
  execFileSync('/usr/bin/codesign',['--force','--sign','-','--timestamp=none',app],{stdio:'inherit'});
}
// Re-sign the merged app ad-hoc, matching the local beta candidate policy.
const rootXattrs=execFileSync('/usr/bin/xattr',[universalApp],{encoding:'utf8'}).split(/\s+/);
if(rootXattrs.includes('com.apple.FinderInfo'))execFileSync('/usr/bin/xattr',['-d','com.apple.FinderInfo',universalApp]);
await signMergedApp(universalApp);
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',universalApp],{stdio:'inherit'});
execFileSync('/usr/bin/codesign',['--verify','--strict',path.join(universalApp,'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib')],{stdio:'inherit'});
const appExecutable=path.join(universalApp,'Contents/MacOS/Vantilo Beta');
for(const file of [appExecutable,path.join(universalApp,'Contents/Resources/app/reader/codex'),path.join(universalApp,'Contents/Resources/app/reader/codex-code-mode-host'),path.join(universalApp,'Contents/Resources/app/reader/native/vantilo-dictionary')]){
  const found=arches(file);if(!found.includes('arm64')||!found.includes('x86_64'))throw new Error(`通用架构验证失败: ${path.basename(file)} (${found.join(',')})`);
}

const outDir=path.join(repo,'out');await fs.mkdir(outDir,{recursive:true});
const zip=path.join(outDir,`Vantilo-Beta-${metadata.version}-universal.zip`);
const checksumPath=zip+'.sha256';
for(const target of [zip,checksumPath])if(await fs.stat(target).then(()=>true,()=>false))throw new Error(`为保护已有文件，拒绝覆盖: ${target}`);
execFileSync('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',universalApp,zip],{stdio:'inherit'});
const hash=createHash('sha256');for await(const chunk of (await import('node:fs')).createReadStream(zip))hash.update(chunk);
const sha256=hash.digest('hex');await fs.writeFile(checksumPath,sha256+'  '+path.basename(zip)+'\n',{flag:'wx'});
const report={version:metadata.version,architecture:'arm64+x86_64',artifact:path.relative(repo,zip),sha256,bytes:(await fs.stat(zip)).size,
  modelProviders:'configured cloud or LAN APIs',signature:'ad-hoc; not notarized',intelHardwareTest:'NOT RUN'};
const reportPath=path.join(outDir,`Vantilo-Beta-${metadata.version}-universal.report.json`);
if(await fs.stat(reportPath).then(()=>true,()=>false))throw new Error(`为保护已有文件，拒绝覆盖: ${reportPath}`);
await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log('UNIVERSAL_APP='+universalApp);
console.log('UNIVERSAL_ZIP='+zip);
console.log('SHA256='+sha256);
