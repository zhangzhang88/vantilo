// Offline, isolated resource build. Electron itself and the accepted previews
// are untouched; use only after native Swift/unit/Reader integration tests pass.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stage=path.join(repo,'build/reader-qwen-resident-stage');
const entry=path.join(repo,'electron/portable-reader-entry.cjs');
const target=path.join(stage,'portable-reader-entry.cjs');
const body=await fs.readFile(entry,'utf8');
const anchors=[
  ["seedDir: process.argv[7] === '--no-seed' ? undefined : process.argv[7] || path.join(process.argv[2], 'seed'),",
   "seedDir: process.argv[7] === '--no-seed' ? undefined : process.argv[7] || path.join(process.argv[2], 'seed'), apiPort: 5194, webPort: 5195, autoSync: true,"],
];
let patched=body;
for(const [a,b] of anchors) {
  if(patched.split(a).length!==2)throw new Error('Preview Reader entry anchor changed: '+a);
  patched=patched.replace(a,b);
}
await fs.mkdir(stage,{recursive:true});
const plugin={name:'only-preview-reader-entry',setup(b){
  b.onLoad({filter:/electron[\\/]portable-reader-entry\.cjs$/},()=>({contents:patched,loader:'js'}));
}};
await build({entryPoints:[entry],outfile:target,platform:'node',target:'node22',format:'cjs',
  bundle:true,external:['electron'],minify:true,legalComments:'eof',plugins:[plugin]});
await build({entryPoints:[path.join(repo,'electron/portable-reader-service.cjs')],
  outfile:path.join(stage,'portable-reader-service.cjs'),platform:'node',target:'node22',
  format:'cjs',bundle:true,external:['electron'],minify:true,legalComments:'eof'});
const staged=await fs.readFile(target,'utf8');
for(const needle of ['5194','5195','--serve','preview-local-qwen']) {
  if(!staged.includes(needle))throw new Error('Resident preview bundling missing: '+needle);
}
console.log('RESIDENT_ENTRY_BUNDLED',target);
console.log('PREVIEW_PORTS=5194/5195 AUTO_SYNC=true');
console.log('NO_ELECTRON_SHELL_OR_MODEL_DOWNLOAD=true');
