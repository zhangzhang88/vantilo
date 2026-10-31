require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();
// Test magazine issue progress using synthetic issue records and the built Reader UI.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {createRequire}=require('node:module');
const readerRequire=createRequire(path.resolve(__dirname,'../packages/reader/package.json'));
const {chromium}=readerRequire('playwright');
const root=process.env.VANTILO_READER_WEB_ROOT?path.resolve(process.env.VANTILO_READER_WEB_ROOT):path.resolve(__dirname,'../build/reader/web');
const issueId='economist:2026-10-24';
const articles=Array.from({length:20},(_,i)=>({id:'article-'+i,issueId,publicationId:'economist',href:`a${i}.xhtml`,section:'Politics',kicker:null,title:`Synthetic article ${i}`,subtitle:null,author:null,publishedAt:null,sourceUrl:null,bodyText:'This is a synthetic article.\n\nThis is another paragraph.',wordCount:12,status:null,analysis:null}));
const issue={schemaVersion:1,id:issueId,publicationId:'economist',publicationName:'The Economist',filename:'Synthetic.epub',sourceFingerprint:'synthetic',title:'The Economist',date:'2026-10-24',label:'October 24',sections:['Politics'],articles};
const summary={...issue,articleCount:20,markedCount:0,statusCounts:{save:0,process:0,skip:0}};
const document={kind:'article',issueId,articleId:'article-0',documentId:`reading:article:${issueId}:article-0`};
const entry={document,title:'Synthetic article 0',lastOpenedAt:'2026-10-28T00:00:00Z'};
const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname==='/'?'index.html':decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);const file=path.resolve(root,name);if(!file.startsWith(root+path.sep))throw Error('invalid');const data=await fs.readFile(file);res.setHeader('content-type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.statusCode=404;res.end();}});
(async()=>{let browser;try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context=await browser.newContext({viewport:{width:1440,height:900}});const page=await context.newPage();
 await page.addInitScript(({issueId,entry})=>{localStorage.setItem('economist-reader-state-v1',JSON.stringify({version:1,progress:{[issueId+':article-0']:100},lastPosition:{issueId,articleId:'article-0'}}));localStorage.setItem('magazine-reader-reading-history-v1',JSON.stringify({version:1,items:[entry],lastRead:entry}));},{issueId,entry});
 await page.route('**/api/**',route=>{const u=new URL(route.request().url()),p=decodeURIComponent(u.pathname);if(p==='/api/issues')return route.fulfill({json:[summary]});if(p==='/api/issues/'+issueId)return route.fulfill({json:issue});if(p==='/api/books')return route.fulfill({json:[]});return route.fulfill({status:404,json:{error:'Unavailable in synthetic test'}});});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 const card=page.getByTestId('continue-reading');await card.waitFor();await page.waitForFunction(()=>document.querySelector('[data-testid="continue-reading"]')?.textContent.includes('本期 5%'));
 await page.getByRole('button',{name:'电子书',exact:true}).click();await page.getByRole('button',{name:'期刊',exact:true}).click();
 if(!(await card.innerText()).includes('本期 5%'))throw Error('Issue progress changed when switching tabs');
 await card.getByRole('button',{name:'继续阅读 →'}).click();await page.getByRole('button',{name:'返回本期目录'}).click();
 await page.waitForFunction(()=>document.querySelector('.issue-hero')?.textContent.includes('5%'));
 console.log('PASS: with one of 20 articles complete, magazine home remains at issue progress 5% after switching books/magazines and matches the issue page after returning.');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
