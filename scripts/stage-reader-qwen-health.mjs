// Stages only the independently verified, precompiled native Qwen health
// executable and SwiftPM resource bundles. Never copies model weights or EPUBs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='darwin' || process.arch!=='arm64')
  throw new Error('MLX Swift runtime stage supports Apple Silicon macOS only');
const packageDir=path.join(repo,'native/qwen-health');
const binDir=execFileSync('swift',['build','--package-path',packageDir,'-c','debug','--show-bin-path'],
  {encoding:'utf8',timeout:20000}).trim();
const target=path.resolve(process.env.VANTILO_QWEN_NATIVE_OUTPUT||path.join(repo,'build/reader/native'));
await fs.mkdir(target,{recursive:true});
const binary='vantilo-qwen-health';
const src=path.join(binDir,binary);
if(!(await fs.stat(src)).isFile())throw new Error('Native Swift health checker must be built before staging');
const copied=path.join(target,binary);
await fs.copyFile(src,copied);
await fs.chmod(copied,0o755);
const bundles=['mlx-swift_Cmlx.bundle','swift-transformers_Hub.bundle','swift-crypto_Crypto.bundle'];
for(const name of bundles){
  const dir=path.join(binDir,name);
  if(!(await fs.stat(dir)).isDirectory())throw new Error('Missing required SwiftPM resource bundle: '+name);
  await fs.cp(dir,path.join(target,name),{recursive:true,force:true});
}
console.log('STAGED_SWIFT_QWEN_HEALTH='+copied);
console.log('STAGED_SWIFT_RESOURCE_BUNDLES='+bundles.join(','));
console.log('MODEL_WEIGHTS_COPIED=0');
