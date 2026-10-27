// Offline, bounded update of the already-accepted Qwen preview. Never touches
// normal Vantilo, original Reader, private EPUB, userData or model weights.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=path.join(repo,'out/reader-qwen-preview/Vantilo Qwen Setup Preview-darwin-arm64/Vantilo Qwen Setup Preview.app');
const root=path.join(app,'Contents/Resources/app');
const stage=path.join(repo,'build/qwen-onboarding-stage');
function exact(text,find,replacement,name){
 if(text.split(find).length!==2)throw new Error('Preview-only update anchor changed: '+name);
 return text.replace(find,replacement);
}
const plist=await fs.readFile(path.join(app,'Contents/Info.plist'),'utf8');
if(!plist.includes('com.vantilo.desktop.qwen-setup-preview'))throw new Error('Refusing to update anything except Qwen preview');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
if(pkg.main!=='electron/preview-main.cjs')throw new Error('Preview main mismatch');
const mainEntry=path.join(repo,'electron/main.cjs');
const plugin={name:'preview-only-reader-ports',setup(b){
 b.onLoad({filter:/electron[\\/](magazine-reader-navigation|portable-reader-supervisor)\.cjs$/},async args=>{
   const short=path.basename(args.path);
   let code=await fs.readFile(args.path,'utf8');
   if(short==='magazine-reader-navigation.cjs'){
     code=exact(code,'http://127.0.0.1:5175/','http://127.0.0.1:5195/',short);
   }else{
     code=code.replaceAll('http://127.0.0.1:5174','http://127.0.0.1:5194')
       .replaceAll('http://127.0.0.1:5175','http://127.0.0.1:5195');
   }
   return {contents:code,loader:'js'};
 });
}};
await fs.rm(stage,{recursive:true,force:true});
await fs.mkdir(path.join(stage,'electron'),{recursive:true});
await build({entryPoints:[mainEntry],outfile:path.join(stage,'electron/main.cjs'),
  platform:'node',target:'node22',format:'cjs',bundle:true,minify:true,
  external:['electron'],legalComments:'eof',plugins:[plugin]});
await fs.cp(path.join(repo,'dist'),path.join(stage,'dist'),{recursive:true});
const htmlPath=path.join(stage,'dist/index.html');
const html=await fs.readFile(htmlPath,'utf8');
await fs.writeFile(htmlPath,exact(html,
  'frame-src http://127.0.0.1:5175;','frame-src http://127.0.0.1:5195;', 'CSP'));
let replacements=0;
for(const name of await fs.readdir(path.join(stage,'dist/assets'))){
 if(!name.endsWith('.js'))continue;
 const file=path.join(stage,'dist/assets',name),value=await fs.readFile(file,'utf8');
 const occurrences=value.split('http://127.0.0.1:5175/').length-1;
 replacements+=occurrences;
 if(occurrences)await fs.writeFile(file,value.replaceAll('http://127.0.0.1:5175/','http://127.0.0.1:5195/'));
}
if(replacements!==1)throw new Error('Unexpected preview Reader iframe URL count '+replacements);
const main=await fs.readFile(path.join(stage,'electron/main.cjs'),'utf8');
if(!main.includes('readerQwenIntegrated')||!main.includes('Vantilo Qwen Setup Preview') ||
   !main.includes('5195')||!main.includes('5194'))throw new Error('Preview main build lacks Qwen flags/ports');
const renderer=await fs.readdir(path.join(stage,'dist/assets'));
if(!renderer.some(name=>name.endsWith('.js')))throw new Error('Missing staged renderer JS');
console.log('QWEN_ONBOARDING_STAGE_PASS='+stage);
console.log('STAGED_ASSETS_ONLY=electron/main.cjs and dist/*');
console.log('NO_MODEL_OR_READER_LIBRARY_COPIED=true');
