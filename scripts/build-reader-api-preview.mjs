import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {adaptReaderSource} from './reader-variant.mjs';
import {readerSourceRoot} from './reader-source-path.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=readerSourceRoot;
const result=await build({stdin:{contents:`export {buildServer} from ${JSON.stringify(path.join(source,'src/server/app.ts'))};export {GitHubMagazineSyncService} from ${JSON.stringify(path.join(source,'src/server/services/github-magazine-sync-service.ts'))};`,resolveDir:source,sourcefile:'preview-api.ts',loader:'ts'},
 outfile:path.resolve(process.env.VANTILO_QWEN_API_OUTPUT||path.join(repo,'build/reader-qwen-translation-stage/api.cjs')),bundle:true,platform:'node',target:'node22',format:'cjs',metafile:true,minify:true,legalComments:'eof',
 plugins:[{name:'preview-explicit-catalog-only',setup(b){b.onLoad({filter:/\.ts$/},async args=>args.path.startsWith(source+'/src/')?{contents:adaptReaderSource(await fs.readFile(args.path,'utf8'),args.path,{qwenPreview:true,translationPreview:true,catalogPreview:true}),loader:'ts'}:undefined);}}]});
const metafilePath=path.resolve(process.env.VANTILO_QWEN_API_METAFILE||path.join(repo,'build/reader-qwen-translation-stage/api-metafile.json'));
await fs.mkdir(path.dirname(metafilePath),{recursive:true});
await fs.writeFile(metafilePath,JSON.stringify(result.metafile,null,2)+'\n');
console.log('PREVIEW_API_BUILT_WITHOUT_LIBRARY_COPY_OR_SOURCE_WRITES');
