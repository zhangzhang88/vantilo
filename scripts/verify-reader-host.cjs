require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();
// Automated real Chromium check of the built Reader frontend. No Codex, sync or real user data.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs/promises');const {mkdtempSync,rmSync}=require('node:fs');const path=require('node:path');const os=require('node:os');const {randomBytes}=require('node:crypto');
const {startPortableReader}=require('../electron/portable-reader-service.cjs');
const isolatedProfile=mkdtempSync(path.join(os.tmpdir(),'vantilo-reader-host-profile-'));
app.setPath('userData', isolatedProfile);
app.on('will-quit',()=>{rmSync(isolatedProfile,{recursive:true,force:true});});
let root,service,win;const deadline=setTimeout(()=>{console.error('FAIL: Reader host timeout');app.exit(1);},20000);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 root=await fs.mkdtemp(path.join(os.tmpdir(),'vantilo-reader-ui-'));
 const partition='vantilo-reader-check-'+Date.now();
 const sessionToken=randomBytes(32).toString('hex'),sessionCookie='__Host-vantilo-reader='+sessionToken;
 service=await startPortableReader({assetsDir:process.env.VANTILO_READER_TEST_ASSETS ? path.resolve(process.env.VANTILO_READER_TEST_ASSETS) : path.resolve(__dirname,'../build/reader'),libraryRoot:path.join(root,'library'),apiPort:0,webPort:0,autoSync:false,getAccountStatus:async()=>({connected:true,email:null}),listModels:async()=>({models:[
  {id:'fixture-a',catalogId:'fixture-a',displayName:'Fixture A',description:'Synthetic default model',isDefault:true,defaultEffort:'low',efforts:[{id:'low',description:'Quick'},{id:'high',description:'Deep'}]},
  {id:'fixture-b',catalogId:'fixture-b',displayName:'Fixture B',description:'Synthetic second model',isDefault:false,defaultEffort:'medium',efforts:[{id:'medium',description:'Balanced'}]}
 ]}),sessionToken,requireSessionAuth:true});
 const fixture=await fs.readFile(path.resolve(__dirname,'../tests/fixtures/minimal-magazine.epub'));
 if((await fetch(service.apiOrigin+'/api/books')).status!==401)throw new Error('Direct local Reader API request was not authenticated');
 await fetch(service.apiOrigin+'/api/books/import?filename=AssistantFixture.epub',{method:'POST',headers:{'content-type':'application/epub+zip',cookie:sessionCookie},body:fixture});
 const issueImport=await fetch(service.apiOrigin+'/api/import/epub?filename='+encodeURIComponent('TheEconomist.2099.10.29.epub'),{method:'POST',headers:{'content-type':'application/epub+zip',cookie:sessionCookie},body:fixture});if(issueImport.status!==201)throw new Error('Synthetic magazine issue import failed: '+issueImport.status+' '+await issueImport.text());
 const webSession=session.fromPartition(partition);
 await webSession.cookies.set({url:service.webOrigin,name:'__Host-vantilo-reader',value:sessionToken,path:'/',httpOnly:true,secure:true,sameSite:'no_restriction'});
 let outbound=0;const outboundOrigins=new Set();
 webSession.webRequest.onBeforeRequest((details,done)=>{
  const local=details.url.startsWith(service.webOrigin+'/')||details.url.startsWith('file:')||details.url.startsWith('about:')||details.url.startsWith('data:')||details.url.startsWith('devtools:');
  if(!local){outbound++;outboundOrigins.add(details.url.slice(0,180));}done({cancel:!local});
 });
 const file=path.join(root,'host.html');
 await fs.writeFile(file,`<html><body style="margin:0"><iframe style="width:100vw;height:100vh;border:0" src="${service.webOrigin}/"></iframe><script>window.messages=[];window.addEventListener('message',event=>window.messages.push({origin:event.origin,data:event.data}));</script></body></html>`);
 win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{partition,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 await win.loadFile(file);
 let frame;
 for(let i=0;i<50;i++){
  frame=win.webContents.mainFrame.frames.find(item=>item.url.startsWith(service.webOrigin));
  if(frame&&await frame.executeJavaScript('Boolean(document.querySelector(".global-nav-assistant"))'))break;
  await delay(100);
 }
 if(!frame)throw new Error('Reader iframe did not load below a file-based Electron parent');
 const getCardLayout=()=>frame.executeJavaScript(`(()=>{const c=document.querySelector('.vantilo-growth-home-card'),b=c.querySelector('button'),content=c.firstElementChild;const r=c.getBoundingClientRect(),br=b.getBoundingClientRect(),cr=content.getBoundingClientRect();return {width:innerWidth,height:innerHeight,card:{left:r.left,right:r.right,width:r.width,scrollWidth:c.scrollWidth,clientWidth:c.clientWidth},button:{left:br.left,right:br.right},content:{left:cr.left,right:cr.right},progressWidth:c.querySelector('i').style.width,bodyScrollWidth:document.documentElement.scrollWidth,bodyClientWidth:document.documentElement.clientWidth,overlap:br.left<cr.right-1}})()`);
 const growthToken=randomBytes(32).toString('hex');
 for(let i=0;i<30;i++){await win.webContents.executeJavaScript(`document.querySelector('iframe').contentWindow.postMessage({type:'vantilo:growth-init',token:${JSON.stringify(growthToken)}},'*')`);const ready=await win.webContents.executeJavaScript(`window.messages.some(item=>item.data?.type==='vantilo:growth-ready'&&item.data.token===${JSON.stringify(growthToken)})`);if(ready)break;await delay(100);}
 if(!await win.webContents.executeJavaScript(`window.messages.some(item=>item.data?.type==='vantilo:growth-ready'&&item.data.token===${JSON.stringify(growthToken)})`))throw new Error('Growth bridge handshake failed from the actual Reader iframe to file-based host: '+JSON.stringify(await win.webContents.executeJavaScript('window.messages.slice(-10)')));
 if(await frame.executeJavaScript(`document.cookie.includes('__Host-vantilo-reader')`))throw new Error('Reader session credential leaked to browser JavaScript');
 const home=await frame.executeJavaScript('document.body.innerText');
 if(!home.includes('阅读空间')||home.includes('科普文章'))throw new Error('Science removal or original Reader rendering failed');
 const clicked=await frame.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='设置'||item.getAttribute('aria-label')==='设置');if(!button)return false;button.click();return true;})()`);
 // The integrated preview deliberately moved Settings to the native Vantilo sidebar.
 if(!clicked && !process.env.VANTILO_READER_TEST_ASSETS)throw new Error('Settings entry missing');
 await delay(150);
 const settings=await frame.executeJavaScript('document.body.innerText');
 if((clicked&&!settings.includes('设置'))||/AI 服务|Responses URL|API Key|EasyCLIProxy/.test(settings))throw new Error('Old AI service settings remain visible');
 await frame.executeJavaScript(`if(!document.querySelector('[data-testid="codex-prep-panel"]'))document.querySelector('.global-nav-assistant').click()`);
 await delay(100);
 const panel=await frame.executeJavaScript(`Boolean(document.querySelector('[data-testid="codex-prep-panel"]'))`);
 if(!panel)throw new Error('Original scoped Reader assistant did not open');
 if(await frame.executeJavaScript(`Boolean(document.querySelector('.codex-prep-panel .readonly-badge'))`))throw new Error('Reader context badge must be removed');
 const assistant=await frame.executeJavaScript('document.body.innerText');
 for(const label of ['推荐适合我的阅读','这里有哪些内容','用简单中文解释'])if(!assistant.includes(label))throw new Error('Original quick prompt missing: '+label);
 if(!await frame.executeJavaScript('Boolean(document.querySelector(".codex-prep-panel .composer-field"))'))throw new Error('Shared Agent composer is missing in the original Reader panel');
 await frame.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('.codex-prep-panel button')].find(b=>b.textContent.trim()==='这里有哪些内容');button.click();})()`);
 await delay(100);
 const prompt=await frame.executeJavaScript(`document.querySelector('.codex-prep-panel .composer-field [contenteditable="true"]')?.textContent`);
 if(!prompt?.includes('请用简单中文介绍当前范围'))throw new Error('Quick prompt did not fill the shared composer');
 await frame.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('.global-nav-primary button')].find(b=>b.textContent.trim()==='电子书');if(!button)throw new Error('Books navigation missing');button.click();})()`);
 for(let i=0;i<30;i++){if(await frame.executeJavaScript(`Boolean(document.querySelector('[data-testid^="book-card-"]'))`))break;await delay(100);}
 if(!await frame.executeJavaScript(`document.querySelector('.codex-prep-panel .composer-field')?.outerHTML.includes('想找什么样的书？')`))throw new Error('Book shelf placeholder does not match scope');
 await frame.executeJavaScript(`document.querySelector('[data-testid^="book-card-"]').click()`);
 for(let i=0;i<30;i++){if(await frame.executeJavaScript(`document.body.innerText.includes('推荐两个选题')`))break;await delay(100);}
 if(!await frame.executeJavaScript(`document.querySelector('.codex-prep-panel .composer-field')?.outerHTML.includes('想了解这本书的哪些内容？')`))throw new Error('Book preparation placeholder does not match scope');
 const bookPanel=await frame.executeJavaScript(`document.querySelector('[data-testid="codex-prep-panel"]')?.innerText || ''`);
 for(const label of ['推荐两个选题','讲清选中的观点','用两句试读定难度','把难句再简化','生成精选阅读候选'])if(!bookPanel.includes(label))throw new Error('Book preparation quick prompt missing: '+label);
 await frame.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('.codex-prep-panel button')].find(b=>b.textContent.trim()==='用两句试读定难度');button.click();})()`);
 await delay(100);
 const bookDraft=await frame.executeJavaScript(`document.querySelector('.codex-prep-panel .composer-field [contenteditable="true"]')?.textContent`);
 if(!bookDraft?.includes('两句英文试读'))throw new Error('Book prompt did not fill independent composer');
 await frame.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='设置'||b.textContent.trim()==='设置')||document.querySelector('[aria-label="Magazine Reader 首页"]');if(!button)throw new Error('Reader home navigation missing');button.click();})()`);
 await delay(150);
 const restoredDraft=await frame.executeJavaScript(`document.querySelector('.codex-prep-panel .composer-field [contenteditable="true"]')?.textContent`);
 if(restoredDraft!==prompt)throw new Error('Scope-specific draft was overwritten by a book draft');
 async function pick(label){
  for(let i=0;i<40;i++){if(await frame.executeJavaScript(`Boolean(document.querySelector('.codex-prep-panel .codex-picker-trigger:not(:disabled)'))`))break;await delay(50);}
  await frame.executeJavaScript(`document.querySelector('.codex-prep-panel .codex-picker-trigger').click()`);
  await delay(80);
  await frame.executeJavaScript(`(()=>{const option=[...document.querySelectorAll('.codex-picker-menu .picker-option')].find(b=>b.querySelector('strong')?.textContent===${JSON.stringify(label)});if(!option)throw new Error('Picker option missing: '+${JSON.stringify(label)}+'; available: '+[...document.querySelectorAll('.codex-picker-menu strong')].map(x=>x.textContent).join(','));option.click();})()`);
 }
 async function preferencesMatch(expected){
  for(let i=0;i<30;i++){
   const actual=await fetch(service.apiOrigin+'/api/prep/model-preferences',{headers:{cookie:sessionCookie}}).then(r=>r.json());
   if(Object.entries(expected).every(([key,value])=>actual[key]===value) && await frame.executeJavaScript(`Boolean(document.querySelector('.codex-prep-panel .codex-picker-trigger:not(:disabled)'))`))return;
   await delay(50);
  }
  throw new Error('Composer model preferences were not persisted: '+JSON.stringify(expected));
 }
 await pick('Fixture A');await preferencesMatch({modelMode:'manual',model:'fixture-a'});
 await pick('high');await preferencesMatch({reasoningMode:'manual',reasoningEffort:'high'});
 await pick('Fixture B');await preferencesMatch({model:'fixture-b',reasoningMode:'manual',reasoningEffort:'medium'});
 await pick('Fixture A');await preferencesMatch({modelMode:'manual',model:'fixture-a',reasoningMode:'manual',reasoningEffort:'low'});
 await frame.executeJavaScript(`document.querySelector('.codex-prep-panel .codex-picker-trigger').click()`);
 await delay(100);
 const pickerText=await frame.executeJavaScript(`document.querySelector('.codex-picker-menu').innerText`);if(/模型目录默认|默认强度/.test(pickerText))throw new Error('Ambiguous default options must be absent');
 const pickerBox=await frame.executeJavaScript(`(()=>{const box=document.querySelector('.codex-picker-menu').getBoundingClientRect();if(document.querySelector('.reader-shared-composer .codex-picker-menu'))throw new Error('Model menu must escape the scrolling composer');return {x:box.x,y:box.y,right:box.right,bottom:box.bottom,width:innerWidth,height:innerHeight};})()`);
 if(pickerBox.x<0||pickerBox.y<0||pickerBox.right>pickerBox.width+1||pickerBox.bottom>pickerBox.height+1)throw new Error('Reader model menu clipped outside viewport');
 if(process.env.VANTILO_READER_SCREENSHOT_PATH)await fs.writeFile(process.env.VANTILO_READER_SCREENSHOT_PATH,(await win.webContents.capturePage()).toPNG());
 await frame.executeJavaScript(`document.querySelector('[aria-label="收起 Codex 助手"]').click()`);
 await delay(80);
 if(await frame.executeJavaScript(`Boolean(document.querySelector('.codex-picker-menu'))`))throw new Error('Reader model portal survived assistant close');
 await frame.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('.global-nav-primary button')].find(x=>x.textContent.trim()==='电子书');b?.click();})()`);
 for(let i=0;i<30;i++){if(await frame.executeJavaScript(`Boolean(document.querySelector('[data-testid^="book-card-"]'))`))break;await delay(100);}
 await win.webContents.executeJavaScript(`document.querySelector('iframe').contentWindow.postMessage({type:'vantilo:growth-summary',token:${JSON.stringify(growthToken)},seconds:1080,active:false,canResume:false},'*')`);await delay(100);
 if(!await frame.executeJavaScript(`document.querySelector('.vantilo-growth-home-card')?.innerText.includes('18:00 / 30:00')`))throw new Error('Bookshelf home did not render the actual host growth summary');
 const bookGrowthCard=await frame.executeJavaScript(`document.querySelector('.vantilo-growth-home-card')?.innerText||''`);if(!bookGrowthCard.includes('还差 12 分钟达到30分钟'))throw new Error('Book page did not show remaining time for the 30-minute target');
 const wideBookCardLayout=await getCardLayout();if(wideBookCardLayout.card.left<0||wideBookCardLayout.card.right>wideBookCardLayout.width+1||wideBookCardLayout.overlap||wideBookCardLayout.card.scrollWidth>wideBookCardLayout.card.clientWidth+1||wideBookCardLayout.bodyScrollWidth>wideBookCardLayout.bodyClientWidth+1)throw new Error('Wide book growth card layout failed: '+JSON.stringify(wideBookCardLayout));
 win.setSize(480,900);await delay(250);const narrowBookCardLayout=await getCardLayout();if(narrowBookCardLayout.card.left<0||narrowBookCardLayout.card.right>narrowBookCardLayout.width+1||narrowBookCardLayout.overlap||narrowBookCardLayout.card.scrollWidth>narrowBookCardLayout.card.clientWidth+1||narrowBookCardLayout.bodyScrollWidth>narrowBookCardLayout.bodyClientWidth+1)throw new Error('Narrow book growth card layout failed: '+JSON.stringify(narrowBookCardLayout));win.setSize(1440,900);await delay(200);
 await frame.executeJavaScript(`document.querySelector('.vantilo-growth-home-card button').click()`);await delay(100);if(!await win.webContents.executeJavaScript(`window.messages.some(item=>item.data?.type==='vantilo:growth-open-request'&&item.data.token===${JSON.stringify(growthToken)})`))throw new Error('Book page growth entry did not open the shared growth route request');
 await frame.executeJavaScript(`document.querySelector('[data-testid^="book-card-"]').click()`);
 for(let i=0;i<30;i++){if(await frame.executeJavaScript(`Boolean(document.querySelector('.book-toc-list button'))`))break;await delay(100);}
 if(!await frame.executeJavaScript(`Boolean(document.querySelector('.book-toc-list button'))`))throw new Error('Synthetic EPUB did not expose a readable chapter');
 await frame.executeJavaScript(`document.querySelector('.book-toc-list button').click()`);
 for(let i=0;i<40;i++){if(await frame.executeJavaScript(`Boolean(document.querySelector('.reader-page-shell'))`))break;await delay(100);}
 if(!await frame.executeJavaScript(`Boolean(document.querySelector('.reader-page-shell'))`))throw new Error('Synthetic EPUB ReaderPage did not open');
 await frame.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('.reader-mode-switch button')].find(x=>x.textContent.trim()==='逐句');b?.click();})()`);
 await win.webContents.executeJavaScript(`document.querySelector('iframe').contentWindow.postMessage({type:'vantilo:growth-summary',token:${JSON.stringify(growthToken)},seconds:755,active:true,canResume:false},'*')`);await delay(100);
 if(!await frame.executeJavaScript(`document.querySelector('.reader-growth-timer')?.textContent.includes('12:35 / 30:00')`))throw new Error('Sentence toolbar did not render the current host timer');
 await frame.executeJavaScript(`document.querySelector('.reader-growth-timer')?.click()`);await delay(100);
 if(!await win.webContents.executeJavaScript(`window.messages.some(item=>item.data?.type==='vantilo:growth-open-request'&&item.data.token===${JSON.stringify(growthToken)})`))throw new Error('Sentence timer did not route to the host growth page');
 for(let i=0;i<30;i++){if(await win.webContents.executeJavaScript(`window.messages.some(item=>item.data?.type==='vantilo:growth-state'&&item.data.token===${JSON.stringify(growthToken)})`))break;await delay(100);}
 if(!await win.webContents.executeJavaScript(`window.messages.some(item=>item.data?.type==='vantilo:growth-state'&&item.data.token===${JSON.stringify(growthToken)}&&item.data.mode==='sentence'&&item.data.english===true&&typeof item.data.bookId==='string')`))throw new Error('Real ReaderPage did not send validated English sentence-mode state');
 await frame.executeJavaScript(`document.querySelector('.sentence-translation-toggle')?.click()`);
 await delay(250);
 if(!await win.webContents.executeJavaScript(`window.messages.some(item=>item.data?.type==='vantilo:growth-activity'&&item.data.token===${JSON.stringify(growthToken)}&&item.data.action==='translation')`))throw new Error('Real Reader translation action did not reach the host growth bridge');
 await frame.executeJavaScript(`(()=>{const b=document.querySelector('button[aria-label="返回本书目录"]');if(!b)throw new Error('Book Reader back-to-TOC missing');b.click()})()`);
 for(let i=0;i<30;i++){if(await frame.executeJavaScript(`Boolean(document.querySelector('.book-detail-page'))`))break;await delay(100);}
 await frame.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('.book-detail-page button')].find(x=>x.textContent.includes('返回电子书'));if(!b)throw new Error('Book detail back-to-shelf missing');b.click()})()`);
 for(let i=0;i<40;i++){if(await frame.executeJavaScript(`Boolean(document.querySelector('[data-testid="book-library-grid"]'))`))break;await delay(100);}
 await frame.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('.global-nav-primary button')].find(x=>x.textContent.trim()==='期刊');if(!b)throw new Error('期刊 navigation missing');b.click()})()`);
 for(let i=0;i<40;i++){if(await frame.executeJavaScript(`Boolean(document.querySelector('[data-testid="library-publication-grid"]'))`))break;await delay(100);}
 await win.webContents.executeJavaScript(`document.querySelector('iframe').contentWindow.postMessage({type:'vantilo:growth-summary',token:${JSON.stringify(growthToken)},seconds:1080,active:false,canResume:false},'*')`);await delay(150);
 const magazineGrowthCard=await frame.executeJavaScript(`document.querySelector('.vantilo-growth-home-card')?.innerText||''`);
 if(magazineGrowthCard!==bookGrowthCard)throw new Error(`Magazine and book pages do not show the same shared growth summary: ${JSON.stringify({bookGrowthCard,magazineGrowthCard})}`);
 if(!await frame.executeJavaScript(`document.querySelector('.vantilo-growth-home-card p')?.textContent==='还差 12 分钟达到30分钟'&&document.querySelector('.vantilo-growth-home-progress i')?.style.width==='60%'`))throw new Error('Magazine progress card has incorrect remaining time or progress width');
 await frame.executeJavaScript(`document.querySelector('.vantilo-growth-home-card button').click()`);await delay(100);
 if(!await win.webContents.executeJavaScript(`window.messages.filter(item=>item.data?.type==='vantilo:growth-open-request'&&item.data.token===${JSON.stringify(growthToken)}).length>=2`))throw new Error('Magazine growth entry did not request the same shared growth page');
 const wideCardLayout=await getCardLayout();if(wideCardLayout.card.left<0||wideCardLayout.card.right>wideCardLayout.width+1||wideCardLayout.overlap||wideCardLayout.card.scrollWidth>wideCardLayout.card.clientWidth+1||wideCardLayout.bodyScrollWidth>wideCardLayout.bodyClientWidth+1)throw new Error('Wide magazine growth card layout failed: '+JSON.stringify(wideCardLayout));
 const growthScreenshotDir=process.env.VANTILO_READER_GROWTH_SCREENSHOT_DIR?path.resolve(process.env.VANTILO_READER_GROWTH_SCREENSHOT_DIR):null;if(growthScreenshotDir){await fs.mkdir(growthScreenshotDir,{recursive:true});await fs.writeFile(path.join(growthScreenshotDir,'magazine-growth-wide.png'),(await win.webContents.capturePage()).toPNG());}
 win.setSize(480,900);await delay(250);const narrowCardLayout=await getCardLayout();if(narrowCardLayout.card.left<0||narrowCardLayout.card.right>narrowCardLayout.width+1||narrowCardLayout.overlap||narrowCardLayout.card.scrollWidth>narrowCardLayout.card.clientWidth+1||narrowCardLayout.bodyScrollWidth>narrowCardLayout.bodyClientWidth+1)throw new Error('Narrow magazine growth card layout failed: '+JSON.stringify(narrowCardLayout));
 if(growthScreenshotDir)await fs.writeFile(path.join(growthScreenshotDir,'magazine-growth-narrow.png'),(await win.webContents.capturePage()).toPNG());
 win.setSize(1440,900);
 const messages=await win.webContents.executeJavaScript('window.messages');
 if(messages.some(item=>item.data?.type==='vantilo:open-agent'))throw new Error('Reader must never select a project session');
 if(outbound!==0)throw new Error('Unexpected external network request was blocked: '+[...outboundOrigins].join(', '));
 console.log(JSON.stringify({result:'PASS',environment:'actual built Reader in isolated Electron/Chromium with synthetic book and issue',sharedGrowthSummary:bookGrowthCard,magazineGrowthSummary:magazineGrowthCard,wideBookCardLayout,narrowBookCardLayout,wideCardLayout,narrowCardLayout,screenshots:growthScreenshotDir||null,bookAndMagazineGrowthRoutes:'both emitted the same growth-open-request',externalRequests:outbound},null,2));
}).then(async()=>{clearTimeout(deadline);win?.destroy();await service?.close();if(root)await fs.rm(root,{recursive:true,force:true});app.quit();}).catch(async error=>{console.error(error?.stack || String(error));clearTimeout(deadline);win?.destroy();await service?.close();if(root)await fs.rm(root,{recursive:true,force:true});app.exit(1);});
app.on('window-all-closed',()=>{});
