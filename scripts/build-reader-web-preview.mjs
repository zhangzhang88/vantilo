// Build only Vantilo's read-only Reader frontend adaptation.
// This never imports EPUBs, copies user libraries, or modifies magazine-reader.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import parcelMacros from 'unplugin-parcel-macros';
import {sharedReaderComposerPlugin} from './reader-assistant-adapter.mjs';
import {readerVariantPlugin} from './reader-variant.mjs';
import {readerSourceRoot} from './reader-source-path.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.env.VANTILO_QWEN_READER_PREVIEW='1'; // Never leak auto-Qwen into the normal Reader build.
const original=readerSourceRoot;
const fromReader=createRequire(path.join(original,'package.json'));
const {build}=await import(pathToFileURL(fromReader.resolve('vite')).href);
const {default:react}=await import(pathToFileURL(fromReader.resolve('@vitejs/plugin-react')).href);
await build({
  root:original,configFile:false,envFile:false,publicDir:false,
  cacheDir:path.resolve(process.env.VANTILO_QWEN_VITE_CACHE||path.join(repo,'build/reader-vite-cache')),
  resolve:{dedupe:['react','react-dom']},
  plugins:[sharedReaderComposerPlugin(),parcelMacros.vite(),readerVariantPlugin(),react()],
  base:'/',
  build:{outDir:path.resolve(process.env.VANTILO_QWEN_WEB_OUTPUT || path.join(repo,'build/reader-qwen-translation-stage/web')),emptyOutDir:true,sourcemap:false},
});
console.log('READER_WEB_REBUILT_WITH_QWEN_PREVIEW=true; EPUB_AND_SOURCE_FILES_UNCHANGED=true');
