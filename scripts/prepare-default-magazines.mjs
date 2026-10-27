import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {defaultMagazineSeed,readDefaultMagazines} from './default-magazine-seed.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const {GitHubMagazineSyncService}=require('../build/reader-qwen-translation-stage/api.cjs');
const {createMagazineFetch}=require('../electron/magazine-github-fetch.cjs');
const metadataFetch=createMagazineFetch({onProgress:console.log});
async function buildFetch(input,options){
 const raw='https://raw.githubusercontent.com/hehonghui/awesome-english-ebooks/master/';const url=String(input);
 if(!url.startsWith(raw))return metadataFetch(input,options);
 const target='https://api.github.com/repos/hehonghui/awesome-english-ebooks/contents/'+url.slice(raw.length).split('/').map(s=>encodeURIComponent(decodeURIComponent(s))).join('/')+'?ref=master';
 console.log('正在通过 GitHub Contents 下载默认杂志（最多 180 秒）');
 const response=await fetch(target,{redirect:'error',headers:{Accept:'application/vnd.github.raw+json','User-Agent':'Vantilo-default-magazines','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(180000)});
 if(!response.ok)return response;
 if(Number(response.headers.get('content-length'))>100*1024*1024)throw new Error('默认杂志超过 100 MiB');
 let length=0;const chunks=[];for await(const chunk of response.body){length+=chunk.length;if(length>100*1024*1024)throw new Error('默认杂志超过 100 MiB');chunks.push(chunk);}
 return new Response(Buffer.concat(chunks),{status:200,headers:{'content-type':'application/epub+zip','content-length':String(length)}});
}
const flag=process.argv.indexOf('--from-downloads');
const downloadRoot=flag>=0?path.resolve(process.argv[flag+1]):path.join(repo,'build/default-magazine-downloads');
const rights=JSON.parse(await fs.readFile(path.join(repo,'resources/default-magazines-rights.json'),'utf8'));
let report;
if(flag>=0)report=JSON.parse(await fs.readFile(path.join(downloadRoot,'fetch-report.json'),'utf8'));
else{
 await fs.mkdir(path.join(downloadRoot,'issues'),{recursive:true});
 const service=new GitHubMagazineSyncService({issuesDir:path.join(downloadRoot,'issues'),incomingDir:path.join(downloadRoot,'incoming'),token:'',fetchImpl:buildFetch});
 report=await service.sync();await fs.writeFile(path.join(downloadRoot,'fetch-report.json'),JSON.stringify(report,null,2));
}
if(report.failedCount||report.publications.length!==4)throw new Error('四种最新杂志尚未全部取得；保留现有默认书库，不发布半成品');
const prefixes={'economist':['theeconomist'],'new-yorker':['newyorker'],'atlantic':['theatlantic','atlantic'],'wired':['wired']};
const downloadedNames=await fs.readdir(path.join(downloadRoot,'issues'));
const entries=[];
for(const publication of report.publications){
 if(!rights.publications.includes(publication.publicationId))throw new Error('缺少该杂志的分发授权确认');
 const date=publication.remoteLatestDate;if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('最新期次无效');
 const candidates=downloadedNames.filter(name=>name.toLowerCase().endsWith('.epub')&&name.includes(date.replaceAll('-','.'))&&prefixes[publication.publicationId].some(prefix=>name.toLowerCase().replace(/[^a-z0-9]/g,'').startsWith(prefix)));
 if(candidates.length!==1)throw new Error('最新杂志文件缺失或不唯一：'+publication.publicationId);
 const filename=candidates[0];
 const file=path.join(downloadRoot,'issues',filename);const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('下载文件无效');
 const data=await fs.readFile(file);
 entries.push({kind:'issues',publicationId:publication.publicationId,issueDate:date,filename,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),sourceRepository:'https://github.com/hehonghui/awesome-english-ebooks',rights:rights.rights,rightsEvidence:rights.rightsEvidence});
}
const staged=defaultMagazineSeed+'.staging-'+Date.now();await fs.mkdir(path.join(staged,'issues'),{recursive:true});await fs.mkdir(path.join(staged,'books'));
for(const e of entries)await fs.copyFile(path.join(downloadRoot,'issues',e.filename),path.join(staged,'issues',e.filename));
const manifest={version:1,audience:'redistributable',preparedAt:new Date().toISOString(),entries};
await fs.writeFile(path.join(staged,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');await readDefaultMagazines(staged);
await fs.mkdir(path.dirname(defaultMagazineSeed),{recursive:true});
try{await fs.rename(defaultMagazineSeed,defaultMagazineSeed+'.previous-'+Date.now());}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.rename(staged,defaultMagazineSeed);
console.log('DEFAULT_MAGAZINES_READY',JSON.stringify(entries.map(e=>({publication:e.publicationId,date:e.issueDate,bytes:e.bytes}))));
