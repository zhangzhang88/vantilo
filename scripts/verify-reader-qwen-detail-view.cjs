require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();
// Isolated actual Chromium/Reader synthetic-only Qwen Word Detail smoke.
// No production profile, no personal EPUB, no network or actual model weights.
const {app,BrowserWindow,session}=require('electron');
const {randomBytes}=require('node:crypto');
const fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {startPortableReader}=require('../electron/portable-reader-service.cjs');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'vantilo-qwen-detail-chromium-'));
app.setPath('userData',profile);
let server,window;
const timer=setTimeout(()=>{console.error('DETAIL_CHROMIUM_TIMEOUT');app.exit(2)},22000);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function act(script) {return window.webContents.executeJavaScript(script);}
async function until(script){
  for(let i=0;i<65;i++){const value=await act(script);if(value)return value;await delay(120);}
  return null;
}
app.whenReady().then(async()=>{
  const sessionToken=randomBytes(32).toString('hex');
  const readOnlyPreview='out/reader-qwen-preview/Vantilo Qwen Setup Preview-darwin-arm64/Vantilo Qwen Setup Preview.app/Contents/Resources/app/reader/seed';
  server=await startPortableReader({
    assetsDir:path.resolve('build/reader'),seedDir:path.resolve(readOnlyPreview),
    libraryRoot:path.join(profile,'library'),apiPort:0,webPort:0,autoSync:false,
    enableLocalQwen:true,sessionToken,
    localQwenService:{
      inspect:async()=>({selected:true,helperAvailable:true,health:{ready:true}}),
      recheck:async()=>({ready:true}),
      gloss:async({word})=>({meaningZh:word==='synthetic'?'合成语境义':'词义',model:'test',provider:'qwen-mlx'})
    },
    fetchImpl:async()=>{throw Error('Unexpected outbound network');}
  });
  await session.defaultSession.cookies.set({url:server.webOrigin,name:'__Host-vantilo-reader',value:sessionToken,path:'/',httpOnly:true,secure:true,sameSite:'no_restriction'});
  window=new BrowserWindow({show:false,width:1120,height:880,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
  const errors=[];
  window.webContents.on('console-message',(_event,d)=>{
    if(d.level==='error')errors.push(d.message);
  });
  await window.loadURL(server.webOrigin);
  const home=await until("document.body.innerText.includes('电子书')");
  console.log('DETAIL_HOME',JSON.stringify({ok:Boolean(home),text:await act('document.body.innerText.slice(0,350)')}));
  if(!home)throw Error('Reader home not loaded');
  console.log('NAV_BUTTONS',JSON.stringify(await act("[...document.querySelectorAll('button, a')].filter(x=>x.offsetParent!==null).map(x=>({tag:x.tagName,label:x.textContent.trim().slice(0,38),aria:x.getAttribute('aria-label')})).slice(0,35)")));
  // The next test actions are determined by the actual Reader fixture markup.
  await act("document.querySelector('button[aria-label=\"电子书\"]')?.click()");
  await delay(650);
  console.log('BOOKS_PAGE',JSON.stringify({text:await act('document.body.innerText.slice(0,1000)'),buttons:await act("[...document.querySelectorAll('button, a')].filter(x=>x.offsetParent!==null).map(x=>({tag:x.tagName,label:x.textContent.trim().slice(0,45),aria:x.getAttribute('aria-label')})).slice(0,45)")}));
  await act("[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Vantilo Magazine Fixture') && !x.getAttribute('aria-label'))?.click()");
  await delay(520);
  console.log('OPEN_BOOK',JSON.stringify({text:await act('document.body.innerText.slice(0,1300)'),buttons:await act("[...document.querySelectorAll('button, a')].filter(x=>x.offsetParent!==null).map(x=>({tag:x.tagName,label:x.textContent.trim().slice(0,42),aria:x.getAttribute('aria-label')})).slice(0,42)")}));
  await act("[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Fixture article'))?.click()");
  await delay(780);
  console.log('OPEN_ARTICLE',JSON.stringify({text:await act('document.body.innerText.slice(0,1600)'),buttons:await act("[...document.querySelectorAll('button, a')].filter(x=>x.offsetParent!==null).map(x=>({tag:x.tagName,label:x.textContent.trim().slice(0,36),aria:x.getAttribute('aria-label')})).slice(0,62)")}));
  if(!await until('Boolean(document.querySelector(\'[data-word-token="synthetic"]\'))'))throw Error('Synthetic word token not rendered');
  await act('document.querySelector(\'[data-word-token="synthetic"]\').click()');
  if(!await until("Boolean(document.querySelector('.vantilo-context-primary'))"))throw Error('Automatic Qwen popup not rendered');
  if(!await until("document.querySelector('.vantilo-context-primary strong')?.textContent === '合成语境义'"))throw Error('Qwen synthetic context gloss did not resolve');
  const popup=await act("document.querySelector('.vantilo-context-primary')?.parentElement?.innerText.slice(0,290)");
  console.log('POPUP_AUTO_CONTEXT',JSON.stringify(popup));
  // Mark the word as a learner item; Reader may auto-copy dictionary meaning
  // into vocabulary. That automatic value must not be labeled a personal edit.
  await act("[...document.querySelectorAll('button[aria-label]')].find(x=>x.getAttribute('aria-label')?.includes('synthetic') && x.getAttribute('aria-label')?.includes('1 生词'))?.click()");
  await delay(100);
  await act("document.querySelector('button.word-lookup-more')?.click()");
  if(!await until("Boolean(document.querySelector('[data-testid=word-detail-view]'))"))throw Error('More did not open WordDetailContent');
  const details=await act(`(()=>{
    const root=document.querySelector('[data-testid=word-detail-view]');
    return {
      text:root.innerText.slice(0,750),
      context:root.querySelector('.vantilo-context-primary strong')?.textContent,
      sentenceVisible:Boolean(root.querySelector('.vantilo-detail-context blockquote')),
      sourceSentenceShown:root.innerText.includes('Reading tools preserve this text'),
      customMeaning:!!root.querySelector('.word-detail-user-section'),
      dictionaryVisible:!!root.querySelector('section.vantilo-detail-dictionary'),
      dictionaryHasNoToggle:!root.querySelector('.vantilo-detail-dictionary details, details.vantilo-detail-dictionary'),
      nativeArticleVisible:!!root.querySelector('.vantilo-detail-dictionary .vantilo-dict-article'),
      quickMeaningCount:root.querySelectorAll('.vantilo-detail-dictionary .word-detail-definition-list > p').length,
      phonetics:root.querySelectorAll('.word-detail-pronunciation button').length,
      emptyEnglish:root.innerText.includes('英文释义暂不可用'),
      failedContext:root.innerText.includes('语境分析暂时失败'),
      emptyExamples:root.innerText.includes('例句正在准备中'),
      footerHonest:root.innerText.includes('当前语境：本地 Qwen'),
      learnerActive:!!root.querySelector('.familiarity-option.level-1.is-active')
    };
  })()`);
  console.log('DETAIL_QWEN_UI',JSON.stringify(details));
  if(details.context!=='合成语境义'||details.sentenceVisible||details.sourceSentenceShown||details.customMeaning||!details.dictionaryVisible||!details.dictionaryHasNoToggle||
    (details.nativeArticleVisible && details.quickMeaningCount > 0)||
    details.emptyEnglish||details.failedContext||details.emptyExamples||!details.footerHonest||!details.learnerActive)throw Error('Unclean WordDetail output: '+JSON.stringify(details));
  if(errors.some(m=>/Uncaught|SyntaxError|TypeError/.test(m)))throw Error('Reader JS runtime error: '+JSON.stringify(errors));
  console.log('PACKAGED_READER_SYNTHETIC_QWEN_DETAIL_PASS');
  console.log('READER_UI_READY',server.webOrigin);
  if(errors.some(m=>/Uncaught|SyntaxError|TypeError/.test(m)))throw Error('Reader JS runtime error: '+JSON.stringify(errors));
}).then(async()=>{await server?.close();window?.destroy();clearTimeout(timer);app.quit();}).catch(async e=>{console.error('DETAIL_BROWSER_FAILED',e.stack);await server?.close();window?.destroy();clearTimeout(timer);app.exit(1)});
app.on('will-quit',()=>{fs.rmSync(profile,{force:true,recursive:true})});
