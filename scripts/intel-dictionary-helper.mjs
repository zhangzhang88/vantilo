import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function normalizeMachOUuid(input) {
  const bytes=Buffer.from(input);
  if(bytes.length<32||bytes.readUInt32LE(0)!==0xfeedfacf)throw new Error('Expected a thin little-endian 64-bit Mach-O Dictionary helper');
  const commands=bytes.readUInt32LE(16);let cursor=32,found=-1;
  for(let index=0;index<commands;index++){
    if(cursor+8>bytes.length)throw new Error('Malformed Mach-O load-command table');
    const command=bytes.readUInt32LE(cursor),size=bytes.readUInt32LE(cursor+4);
    if(size<8||cursor+size>bytes.length)throw new Error('Malformed Mach-O load command');
    if(command===0x1b){if(size!==24||found!==-1)throw new Error('Unexpected LC_UUID load command');found=cursor+8;}
    cursor+=size;
  }
  if(found===-1)throw new Error('Mach-O Dictionary helper has no LC_UUID');
  const uuid=bytes.subarray(found,found+16).toString('hex');bytes.fill(0,found,found+16);
  return {bytes,uuid};
}

export function assertMachOEquivalentExceptUuid(prepared,fresh) {
  const left=normalizeMachOUuid(prepared),right=normalizeMachOUuid(fresh);
  if(!left.bytes.equals(right.bytes))throw new Error('Prepared Intel Dictionary helper differs from a fresh current-source build beyond Mach-O LC_UUID');
  return {preparedUuid:left.uuid,freshUuid:right.uuid};
}

export function helperBuildIdentity({sourceSha256,swiftCompiler,sdkPath,sdkVersion,target='x86_64-apple-macosx12.0',optimization='-O',compileArguments}) {
  return {sourceSha256,swiftCompiler,sdkPath,sdkVersion,target,optimization,architecture:'x86_64',compilerCommand:'/usr/bin/xcrun',compileArguments:compileArguments||['swiftc','-target',target,'-sdk',sdkPath,optimization,'<source>','-o','<output>']};
}

async function exists(filename){try{await fs.lstat(filename);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}

export async function prepareIntelDictionaryHelper({nativeRoot,buildDir,version,sourcePath,identity,compile,architectureOf}){
  const source=await fs.readFile(sourcePath),sourceSha256=sha256(source);
  if(identity.sourceSha256!==sourceSha256)throw new Error('Intel Dictionary helper source identity changed during preparation');
  const fingerprint=sha256(Buffer.from(JSON.stringify(identity))).slice(0,20);
  const directory=path.join(nativeRoot,`vantilo-dictionary-${version}-${fingerprint}`);
  const helperPath=path.join(directory,'vantilo-dictionary'),manifestPath=path.join(directory,'manifest.json');
  const freshPath=path.join(buildDir,`native-helper-current-x64-${version}-${process.pid}-${Date.now()}`);
  await fs.mkdir(buildDir,{recursive:true});
  await compile({sourcePath,outputPath:freshPath});
  const fresh=await fs.readFile(freshPath);
  if(!(await architectureOf(freshPath)).includes('x86_64'))throw new Error('Freshly compiled Intel Dictionary helper architecture verification failed');

  let reused=false,selectedHelperPath=helperPath,selectedManifestPath=manifestPath;
  if(await exists(helperPath)&&await exists(manifestPath)){
    let manifest,prepared;
    try{manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));prepared=await fs.readFile(helperPath);}catch{}
    if(manifest&&prepared&&JSON.stringify(manifest.identity)===JSON.stringify(identity)&&manifest.binarySha256===sha256(prepared)){
      // A matching identity and recorded digest means a comparator failure is
      // unexplained; propagate it and fail closed instead of auto-repairing.
      assertMachOEquivalentExceptUuid(prepared,fresh);reused=true;
    }
  }
  if(!reused){
    if(await exists(directory)){
      // Same identity with damaged/stale contents: preserve it and use a
      // unique sibling directory rather than replacing any prior input.
      const unique=`${directory}-${Date.now()}-${process.pid}`;
      const written=await writeNew(unique,freshPath,fresh,identity,architectureOf);
      selectedHelperPath=written.helperPath;selectedManifestPath=written.manifestPath;
    }else{
      const written=await writeNew(directory,freshPath,fresh,identity,architectureOf);
      selectedHelperPath=written.helperPath;selectedManifestPath=written.manifestPath;
    }
  }
  const selected=await fs.readFile(selectedHelperPath);
  const equivalence=assertMachOEquivalentExceptUuid(selected,fresh);
  return {helperPath:selectedHelperPath,manifestPath:selectedManifestPath,identity,binarySha256:sha256(selected),freshBinarySha256:sha256(fresh),...equivalence,reused};

  async function writeNew(target,from,bytes,buildIdentity,archOf){
    await fs.mkdir(target,{recursive:false});
    const destination=path.join(target,'vantilo-dictionary');
    await fs.copyFile(from,destination);await fs.chmod(destination,0o755);
    if(!(await archOf(destination)).includes('x86_64'))throw new Error('Prepared Intel Dictionary helper architecture verification failed');
    const manifest={schemaVersion:1,identity:buildIdentity,binarySha256:sha256(bytes),binaryBytes:bytes.length};
    await fs.writeFile(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    return {helperPath:destination,manifestPath:path.join(target,'manifest.json'),identity:buildIdentity,binarySha256:manifest.binarySha256,freshBinarySha256:sha256(bytes),reused:false};
  }
}

export function readSwiftCompilerVersion(){return execFileSync('/usr/bin/xcrun',['swiftc','--version'],{encoding:'utf8'}).trim();}
