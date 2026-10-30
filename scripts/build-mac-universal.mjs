// Build one Universal macOS beta app from matching arm64 and x64 Vantilo builds.
// Inputs/intermediates remain under ignored build/; release artifacts go to repo/out/<version>.
// An external build copy must link out/ to the canonical Workspace release root.
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
import {readerSourceRoot} from './reader-source-path.mjs';
import {universalOutputDirectory} from './universal-output-path.mjs';
import {assertNoEpubEntries,assertNoEpubFiles} from './package-artifact-policy.mjs';
import {helperBuildIdentity,prepareIntelDictionaryHelper,readSwiftCompilerVersion} from './intel-dictionary-helper.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const metadata=JSON.parse(await fs.readFile(path.join(repo,'package.json'),'utf8'));
const sourceCommit=execFileSync('/usr/bin/git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const sourceStatus=execFileSync('/usr/bin/git',['status','--porcelain','--untracked-files=all'],{cwd:repo,encoding:'utf8'}).trim();
if(sourceStatus)throw new Error('Universal 发布构建要求干净的 Git 源码快照');
const readerPackage=JSON.parse(await fs.readFile(path.join(readerSourceRoot,'package.json'),'utf8'));
const packageLockHash=createHash('sha256').update(await fs.readFile(path.join(repo,'package-lock.json'))).digest('hex');
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('通用版构建需要 Apple Silicon macOS 构建机');
const requireReader=createRequire(path.join(readerSourceRoot,'package.json'));
const sourceCodexPath=requireReader.resolve('@openai/codex-darwin-arm64/package.json');
const sourceCodex=JSON.parse(await fs.readFile(sourceCodexPath,'utf8'));
const codexVersion=/^(\d+\.\d+\.\d+)-darwin-arm64$/.exec(sourceCodex.version)?.[1];
if(!codexVersion)throw new Error('无法确认 ARM Codex 运行时版本');

const stamp=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
const buildDir=await fs.realpath(path.join(repo,'build'));
const inputRoot=path.join(repo,'build/universal-inputs');
const electronRoot=path.join(inputRoot,'electron-x64');
const codexRoot=path.join(inputRoot,'codex-x64');
const nativeRoot=path.join(inputRoot,'native-x64');
await Promise.all([inputRoot,electronRoot,codexRoot,nativeRoot,path.join(inputRoot,'npm-cache')].map(folder=>fs.mkdir(folder,{recursive:true})));

// Resolve helper freshness before large downloads or candidate builds. The
// versioned input is immutable and the strict comparison is always required.
const dictionarySource=path.join(repo,'scripts/reader-system-dictionary.swift');
const verificationSdk=execFileSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'],{encoding:'utf8'}).trim();
const verificationSdkVersion=execFileSync('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-version'],{encoding:'utf8'}).trim();
const dictionaryTarget='x86_64-apple-macosx12.0',dictionaryOptimization='-O';
const dictionaryCompileArguments=['swiftc','-target',dictionaryTarget,'-sdk',verificationSdk,dictionaryOptimization,'<source>','-o','<output>'];
const dictionaryIdentity=helperBuildIdentity({sourceSha256:createHash('sha256').update(await fs.readFile(dictionarySource)).digest('hex'),
  swiftCompiler:readSwiftCompilerVersion(),sdkPath:verificationSdk,sdkVersion:verificationSdkVersion,target:dictionaryTarget,optimization:dictionaryOptimization,compileArguments:dictionaryCompileArguments});
const nativeDictionaryVerification=await prepareIntelDictionaryHelper({nativeRoot,buildDir,version:metadata.version,sourcePath:dictionarySource,identity:dictionaryIdentity,
  compile:({sourcePath,outputPath})=>execFileSync('/usr/bin/xcrun',dictionaryCompileArguments.map(argument=>argument==='<source>'?sourcePath:argument==='<output>'?outputPath:argument),{cwd:repo,stdio:'inherit',timeout:120000}),
  architectureOf:file=>execFileSync('/usr/bin/lipo',['-archs',file],{encoding:'utf8'}).trim().split(/\s+/)});
const x64Dictionary=nativeDictionaryVerification.helperPath;

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

function arches(file){return execFileSync('/usr/bin/lipo',['-archs',file],{encoding:'utf8'}).trim().split(/\s+/);}
for(const name of ['codex','codex-code-mode-host'])if(!arches(path.join(x64CodexBin,name)).includes('x86_64'))throw new Error('Intel Codex 架构验证失败: '+name);
if(!arches(x64Dictionary).includes('x86_64'))throw new Error('Intel 系统词典程序架构验证失败');
const sha256Bytes=bytes=>createHash('sha256').update(bytes).digest('hex');
nativeDictionaryVerification.sourceSha256=dictionaryIdentity.sourceSha256;
nativeDictionaryVerification.preparedIntelSha256=nativeDictionaryVerification.binarySha256;
nativeDictionaryVerification.preparedMatchesFreshExceptUuid=true;

const candidates=process.env.VANTILO_UNIVERSAL_CANDIDATES?path.resolve(process.env.VANTILO_UNIVERSAL_CANDIDATES):path.join(buildDir,`universal-candidates-${metadata.version}-${stamp}`);
const candidateReal=await fs.realpath(candidates).catch(()=>null);
if(process.env.VANTILO_UNIVERSAL_CANDIDATES){
  if(!candidateReal||!(candidateReal===buildDir||candidateReal.startsWith(buildDir+path.sep)))throw new Error('复用的候选目录必须位于仓库忽略的 build 目录');
}else{
  const env={...process.env,VANTILO_BETA_ROOT:candidates,VANTILO_BETA_INPUTS:inputRoot};
  env.VANTILO_NATIVE_X64_HELPER=x64Dictionary;
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
const candidateIntelDictionary=path.join(x64App,'Contents/Resources/app/reader/native/vantilo-dictionary');
nativeDictionaryVerification.candidateIntelSha256=createHash('sha256').update(await fs.readFile(candidateIntelDictionary)).digest('hex');
// Candidate reuse must still contain the helper that passed this build's gate.
const candidateIntelBytes=await fs.readFile(candidateIntelDictionary);
if(!candidateIntelBytes.equals(await fs.readFile(x64Dictionary)))throw new Error('Reused Intel candidate does not contain the currently verified dictionary helper');

const mergeDir=path.join(candidates,'universal');await fs.mkdir(mergeDir,{recursive:true});
const universalApp=path.join(mergeDir,'Vantilo Beta.app');
await makeUniversalApp({x64AppPath:x64App,arm64AppPath:armApp,outAppPath:universalApp});
const runtimeInventory=path.join(candidates,'runtime-inventory');
const noticeInventoryNames=['all-runtime','main-renderer','reader-runtime','electron-main'];
const noticeInventoryPaths=noticeInventoryNames.map(name=>path.join(runtimeInventory,`${name}-package-roots.json`));
execFileSync(process.execPath,[path.join(repo,'scripts/verify-third-party-notices.cjs'),universalApp,...noticeInventoryPaths],{stdio:'inherit'});
const thirdPartyNoticeText=await fs.readFile(path.join(universalApp,'Contents/Resources/app/licenses/THIRD_PARTY_NOTICES.txt'),'utf8');
const thirdPartyNotices={sha256:createHash('sha256').update(thirdPartyNoticeText).digest('hex'),bytes:Buffer.byteLength(thirdPartyNoticeText),
  packageCount:JSON.parse(await fs.readFile(noticeInventoryPaths[0],'utf8')).length,
  mainRendererPackages:JSON.parse(await fs.readFile(noticeInventoryPaths[1],'utf8')).length,
  readerRuntimePackages:JSON.parse(await fs.readFile(noticeInventoryPaths[2],'utf8')).length,
  electronMainPackages:JSON.parse(await fs.readFile(noticeInventoryPaths[3],'utf8')).length};

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
nativeDictionaryVerification.universalAppSha256=createHash('sha256').update(await fs.readFile(path.join(universalApp,'Contents/Resources/app/reader/native/vantilo-dictionary'))).digest('hex');

const configuredOutputRoot=process.env.VANTILO_UNIVERSAL_OUTPUT_ROOT;
if(configuredOutputRoot&&!path.isAbsolute(configuredOutputRoot))throw new Error('VANTILO_UNIVERSAL_OUTPUT_ROOT 必须是绝对路径');
const outDir=universalOutputDirectory(repo,metadata.version,configuredOutputRoot||path.join(repo,'out'));
await fs.mkdir(path.dirname(outDir),{recursive:true});
await fs.mkdir(outDir); // A version directory is single-use; never reuse an old release directory.
const zip=path.join(outDir,`Vantilo-Beta-${metadata.version}-universal.zip`);
const checksumPath=zip+'.sha256';
const reportPath=path.join(outDir,`Vantilo-Beta-${metadata.version}-universal.report.json`);
for(const target of [zip,checksumPath,reportPath]){
  try { await fs.lstat(target); throw new Error(`为保护已有文件，拒绝覆盖: ${target}`); }
  catch(error) { if(error.code!=='ENOENT') throw error; }
}
await assertNoEpubFiles(universalApp);
execFileSync('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',universalApp,zip],{stdio:'inherit'});
const zipEntries=execFileSync('/usr/bin/unzip',['-Z1',zip],{encoding:'utf8',maxBuffer:64*1024*1024}).split(/\r?\n/).filter(Boolean);
const bundledEpubCount=assertNoEpubEntries(zipEntries);
const noticeEntry='Vantilo Beta.app/Contents/Resources/app/licenses/THIRD_PARTY_NOTICES.txt';
if(!zipEntries.includes(noticeEntry))throw new Error('Universal ZIP is missing the merged third-party notices');
const zipNoticeText=execFileSync('/usr/bin/unzip',['-p',zip,noticeEntry],{encoding:'utf8',maxBuffer:16*1024*1024});
if(createHash('sha256').update(zipNoticeText).digest('hex')!==thirdPartyNotices.sha256)throw new Error('Universal ZIP third-party notices differ from the verified app bundle');
const hash=createHash('sha256');for await(const chunk of (await import('node:fs')).createReadStream(zip))hash.update(chunk);
const sha256=hash.digest('hex');await fs.writeFile(checksumPath,sha256+'  '+path.basename(zip)+'\n',{flag:'wx'});
const report={version:metadata.version,architecture:'arm64+x86_64',artifact:path.basename(zip),sha256,bytes:(await fs.stat(zip)).size,
  sourceCommit,sourceTreeClean:true,packageLockSha256:packageLockHash,readerSourceCommit:readerPackage.sourceCommit,
  nativeDictionary:nativeDictionaryVerification,defaultMagazineSeedIncluded:false,bundledEpubCount,thirdPartyNotices,
  modelProviders:'configured cloud or LAN APIs',signature:'ad-hoc; not notarized',intelHardwareTest:'NOT RUN'};
await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log('UNIVERSAL_APP='+universalApp);
console.log('UNIVERSAL_ZIP='+zip);
console.log('SHA256='+sha256);
