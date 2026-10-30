import {afterEach,describe,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {helperBuildIdentity,prepareIntelDictionaryHelper} from '../scripts/intel-dictionary-helper.mjs';

const roots=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})))});
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'vantilo-intel-helper-'));roots.push(root);
  const nativeRoot=path.join(root,'native-x64'),buildDir=path.join(root,'build'),sourcePath=path.join(root,'reader-system-dictionary.swift');
  await fs.mkdir(nativeRoot,{recursive:true});await fs.mkdir(buildDir,{recursive:true});await fs.writeFile(sourcePath,'// synthetic test source\n');
  let compileCount=0,compiler='Swift version test 1',sdk='SDK-1',optimization='-O',mutate=false;
  const compile=async({outputPath})=>{compileCount++;const bin=Buffer.alloc(64);bin.writeUInt32LE(0xfeedfacf,0);bin.writeUInt32LE(1,16);bin.writeUInt32LE(0x1b,32);bin.writeUInt32LE(24,36);bin.fill(compileCount&255,40,56);if(mutate)bin[60]=0x7f;await fs.writeFile(outputPath,bin)};
  const architectureOf=async()=>['x86_64'];
  const identity=async()=>helperBuildIdentity({sourceSha256:(await import('node:crypto')).createHash('sha256').update(await fs.readFile(sourcePath)).digest('hex'),swiftCompiler:compiler,sdkPath:'/Synthetic/'+sdk,sdkVersion:sdk,optimization});
  const run=async()=>prepareIntelDictionaryHelper({nativeRoot,buildDir,version:'0.1.99',sourcePath,identity:await identity(),compile,architectureOf});
  return {root,nativeRoot,sourcePath,run,setCompiler:value=>compiler=value,setSdk:value=>sdk=value,setOptimization:value=>optimization=value,setMutate:value=>mutate=value,getCompileCount:()=>compileCount};
}

describe('versioned Intel dictionary helper preparation',()=>{
  it('reuses an effective current helper after strict UUID-only comparison',async()=>{
    const f=await fixture();const first=await f.run(),second=await f.run();
    expect(first.reused).toBe(false);expect(second.reused).toBe(true);expect(second.helperPath).toBe(first.helperPath);
  });
  it('generates an input automatically when none exists',async()=>{
    const f=await fixture();const result=await f.run();
    expect(result.helperPath).toContain('vantilo-dictionary-0.1.99-');
    expect(JSON.parse(await fs.readFile(result.manifestPath,'utf8'))).toMatchObject({schemaVersion:1,identity:{architecture:'x86_64',target:'x86_64-apple-macosx12.0',sdkVersion:'SDK-1'},binaryBytes:64});
  });
  it('keeps old inputs and generates a new version when source identity changes',async()=>{
    const f=await fixture(),old=await f.run();await fs.writeFile(f.sourcePath,'// changed source\n');const next=await f.run();
    expect(next.helperPath).not.toBe(old.helperPath);await expect(fs.access(old.helperPath)).resolves.toBeUndefined();
  });
  it('regenerates for compiler, SDK and compile-argument changes',async()=>{
    const f=await fixture(),initial=await f.run();f.setCompiler('Swift version test 2');const compiler=await f.run();
    f.setSdk('SDK-2');const sdk=await f.run();f.setOptimization('-Onone');const flags=await f.run();
    expect(new Set([initial.helperPath,compiler.helperPath,sdk.helperPath,flags.helperPath]).size).toBe(4);
    expect(JSON.parse(await fs.readFile(sdk.manifestPath,'utf8')).identity).toMatchObject({swiftCompiler:'Swift version test 2',sdkPath:'/Synthetic/SDK-2',sdkVersion:'SDK-2'});
    expect(JSON.parse(await fs.readFile(flags.manifestPath,'utf8')).identity.compileArguments).toContain('-Onone');
  });
  it('rejects a real binary difference outside LC_UUID',async()=>{
    const f=await fixture();await f.run();f.setMutate(true);
    await expect(f.run()).rejects.toThrow('beyond Mach-O LC_UUID');
  });
});
