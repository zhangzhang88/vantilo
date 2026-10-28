import {readDefaultMagazines,copyDefaultMagazines} from './default-magazine-seed.mjs';
// Build an ISOLATED, clearly named Finder-launchable preview for Reader setup review.
// No private EPUB or original Reader settings may be packaged or read.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { packager } from '@electron/packager';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await import('./build-app-icon.mjs');
const require = createRequire(import.meta.url);
const isQwenPreview = process.env.VANTILO_QWEN_PREVIEW_BUILD === '1';
const previewName = isQwenPreview ? 'Vantilo Qwen Setup Preview' : 'Vantilo Reader Setup Preview';
const previewBundleId = isQwenPreview ? 'com.vantilo.desktop.qwen-setup-preview' : 'com.vantilo.desktop.reader-setup-preview';
const stage = path.resolve(process.env.VANTILO_QWEN_PACKAGE_STAGE || path.join(repo, isQwenPreview ? 'build/reader-qwen-preview-stage' : 'build/reader-setup-preview-stage'));
const out = path.resolve(process.env.VANTILO_QWEN_PACKAGE_OUTPUT || path.join(repo, isQwenPreview ? 'out/reader-qwen-preview' : 'out/reader-setup-preview'));
const translationStage = path.resolve(process.env.VANTILO_QWEN_TRANSLATION_STAGE || path.join(repo,'build/reader-qwen-translation-stage'));
const previewWebPort = isQwenPreview ? 5195 : 5185;
const previewApiPort = isQwenPreview ? 5194 : 5184;
if (process.platform !== 'darwin') throw new Error('The preview requires macOS.');
const { validateManifest } = require('../electron/reader-library-seed.cjs');
const fixturePath = path.join(repo, 'tests/fixtures/minimal-magazine.epub');
const fixture = await fs.readFile(fixturePath);
if (fixture.length > 1024 * 64 || !fixture.includes(Buffer.from('vantilo-synthetic-fixture'))) {
  throw new Error('Refusing to package an unverified non-synthetic Reader fixture.');
}
const fixtureManifest = validateManifest({
  version: 1, audience: 'redistributable',
  entries: [{
    kind: 'books', filename: 'Vantilo-Original-Synthetic-Fixture.epub',
    bytes: fixture.length, sha256: createHash('sha256').update(fixture).digest('hex'),
    rights: 'Original Vantilo-only synthetic test text; no excerpts from third-party publications',
    rightsEvidence: 'tests/fixtures/minimal-magazine.epub: OEBPS/article.xhtml and OEBPS/content.opf explicitly identify original synthetic fixture',
  }],
}, {distribution:true});
const manifest=isQwenPreview?await readDefaultMagazines():fixtureManifest;
if(isQwenPreview){
  process.env.VANTILO_QWEN_API_OUTPUT ||= path.join(translationStage,'api.cjs');
  process.env.VANTILO_QWEN_WEB_OUTPUT ||= path.join(translationStage,'web');
  process.env.VANTILO_QWEN_NATIVE_OUTPUT ||= path.join(translationStage,'native');
  await import('./build-reader-api-preview.mjs');await import('./build-reader-web-preview.mjs');await import('./stage-reader-qwen-health.mjs');
}
// Distinct stage/output path: never touch the existing Vantilo .app or personal book seed.
await fs.rm(stage, {recursive:true,force:true});
await fs.mkdir(path.join(stage,'electron'),{recursive:true});
for (const folder of ['dist','licenses']) await fs.cp(path.join(repo,folder),path.join(stage,folder),{recursive:true});
await fs.mkdir(path.join(stage,'resources'),{recursive:true});
await fs.copyFile(path.join(repo,'resources/vantilo-icon.png'),path.join(stage,'resources/vantilo-icon.png'));
const readerRoot = path.join(stage,'reader');
await fs.mkdir(readerRoot,{recursive:true});
const originalReader = path.join(repo,'build/reader');
// Explicit allowlist; NEVER copy build/reader/seed or build/reader/ai-bench.
for (const name of ['web','native']) await fs.cp(isQwenPreview?path.join(translationStage,name):path.join(originalReader,name),path.join(readerRoot,name),{recursive:true});
for (const name of ['api.cjs','codex','codex-code-mode-host','provenance.json','THIRD_PARTY_NOTICES.txt'])
  await fs.copyFile(isQwenPreview&&name==='api.cjs'?path.join(translationStage,'api.cjs'):path.join(originalReader,name),path.join(readerRoot,name));
const seed = path.join(readerRoot,'seed');
await fs.mkdir(path.join(seed,'issues'),{recursive:true});
await fs.mkdir(path.join(seed,'books'),{recursive:true});
if(isQwenPreview)await copyDefaultMagazines(seed);
else {await fs.writeFile(path.join(seed,'books',manifest.entries[0].filename),fixture,{mode:0o600});await fs.writeFile(path.join(seed,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');}

// The preview's local Reader port is distinct from production (5174/5175).
// Patch ONLY the staged bundle. Never rewrite src/ or the production build.
let changedWebUrls=0;
const distAssets=path.join(stage,'dist/assets');
for(const file of await fs.readdir(distAssets)){
  if(!file.endsWith('.js'))continue;
  const full=path.join(distAssets,file);
  const source=await fs.readFile(full,'utf8');
  const matched=source.split('http://127.0.0.1:5175/').length-1;
  if(matched){changedWebUrls+=matched;await fs.writeFile(full,source.replaceAll('http://127.0.0.1:5175/','http://127.0.0.1:'+previewWebPort+'/'));}
}
if(changedWebUrls!==1)throw new Error('Reader URL was not found exactly once in the staged renderer: '+changedWebUrls);
// Keep the packaged renderer's frame-src CSP restricted to THIS preview's
// loopback Reader origin. Otherwise Electron blocks the iframe as a white page.
const previewHtml = path.join(stage, 'dist/index.html');
const html = await fs.readFile(previewHtml, 'utf8');
const cspAnchor = 'frame-src http://127.0.0.1:5175;';
if (html.split(cspAnchor).length !== 2) {
  throw new Error('Packaged renderer CSP seam changed; refusing unsafe preview port substitution');
}
await fs.writeFile(previewHtml,
  html.replace(cspAnchor, 'frame-src http://127.0.0.1:' + previewWebPort + ';'));


function previewOnlyOverrides(source,file) {
  const short=path.basename(file);
  function exact(a,b) {
    if(!source.includes(a))throw new Error('Preview-only edit anchor missing: '+short+' / '+a);
    return source.replace(a,b);
  }
  if(short==='magazine-reader-navigation.cjs') {
    return exact('http://127.0.0.1:5175/','http://127.0.0.1:'+previewWebPort+'/');
  }
  if(short==='portable-reader-supervisor.cjs') {
    source=source.replaceAll('http://127.0.0.1:5174','http://127.0.0.1:'+previewApiPort)
      .replaceAll('http://127.0.0.1:5175','http://127.0.0.1:'+previewWebPort);
    if(!isQwenPreview){
    source=exact("this.sync = { enabled: true, status:", "this.sync = { enabled: false, status:");
    source=exact("this.sync = { ...message.state };", "this.sync = { ...message.state, enabled: false };");
    source=exact("this.sync = { ...message.sync };", "this.sync = { ...message.sync, enabled: false };");
    source=exact("  synchronize() {\n", "  synchronize() {\n    throw new Error('预览版为保护测试环境已禁用杂志联网更新。');\n");
    }
    return source;
  }
  if(short==='portable-reader-entry.cjs') {
    source=exact("seedDir: path.join(process.argv[2], 'seed'),",
      "seedDir: path.join(process.argv[2], 'seed'), apiPort: "+previewApiPort+", webPort: "+previewWebPort+", autoSync: "+isQwenPreview+",");
    if(!isQwenPreview)source=exact("if (data?.type === 'sync' && service && !closing) void service.sync.check();",
      "// Preview deliberately disables manual and automatic network magazine synchronization.");
    return source;
  }
  return source;
}
const modifier = {name:'preview-only-ports-and-no-sync',setup(build){
  build.onLoad({filter:/electron[\\/](magazine-reader-navigation|portable-reader-supervisor|portable-reader-entry|main)\.cjs$/},async args => ({
    contents:previewOnlyOverrides(await fs.readFile(args.path,'utf8'),args.path),loader:'js'
  }));
}};
const entries=['main.cjs','preload.cjs','runtime-entry.cjs','portable-reader-entry.cjs','portable-reader-service.cjs'];
for(const entry of entries){
  await build({entryPoints:[path.join(repo,'electron',entry)],outfile:path.join(stage,'electron',entry),
    platform:'node',target:'node22',format:'cjs',bundle:true,external:['electron'],minify:true,
    legalComments:'eof',plugins:[modifier]});
}

// app.getPath('userData') in the production main is preserved before app.setName('Vantilo').
// Force an explicit, separate profile as defense in depth even if metadata changes.
await fs.writeFile(path.join(stage,'electron/preview-main.cjs'),`'use strict';
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const profile = path.join(app.getPath('appData'), ${JSON.stringify(previewName)});
fs.mkdirSync(profile, {recursive:true,mode:0o700});
app.setPath('userData', profile);
process.env.VANTILO_READER_PREVIEW = '1';
require('./main.cjs');\n`);
const metadata=JSON.parse(await fs.readFile(path.join(repo,'package.json'),'utf8'));
await fs.writeFile(path.join(stage,'package.json'),JSON.stringify({
  name:'vantilo-reader-setup-preview',version:metadata.version,
  main:'electron/preview-main.cjs',private:true
}));
await fs.copyFile(path.join(repo,'node_modules/zod/LICENSE'),path.join(stage,'licenses/Zod-LICENSE.txt'));
if(isQwenPreview && process.env.VANTILO_QWEN_STAGE_ONLY==='1') {
  console.log('VANTILO_QWEN_PREVIEW_STAGE='+stage);
  process.exit(0);
}
const electron=require('electron/package.json');
const result=await packager({dir:stage,out,name:previewName,platform:'darwin',arch:process.arch,
  electronVersion:electron.version,electronDist:path.join(repo,'node_modules/electron/dist'),
  appBundleId:previewBundleId,icon:path.join(repo,'resources/vantilo.icns'),overwrite:true,prune:false,asar:false});
const appDir=path.join(result[0],previewName+'.app');
if(!(await fs.stat(appDir)).isDirectory())throw new Error('Packager did not output preview .app');
// Prove the product's actual preexisting development seed is NOT in the distribution.
const copied=JSON.parse(await fs.readFile(path.join(appDir,'Contents/Resources/app/reader/seed/manifest.json'),'utf8'));
if(isQwenPreview)await readDefaultMagazines(path.join(appDir,'Contents/Resources/app/reader/seed'));
else if(copied.entries.length!==1 || copied.entries[0].filename!=='Vantilo-Original-Synthetic-Fixture.epub')
  throw new Error('Preview accidentally bundled personal EPUBs.');
console.log('VANTILO_PREVIEW_APP='+appDir);
console.log('VANTILO_PREVIEW_PROFILE='+path.join(process.env.HOME,'Library/Application Support',previewName));
console.log('PREVIEW_DISTINCT_PORTS='+previewApiPort+'/'+previewWebPort);
console.log(isQwenPreview?'PREVIEW_SEED=four explicitly authorized latest magazine issues; no personal books':'PREVIEW_SEED=one original synthetic EPUB only, automatic/manual magazine sync disabled');
