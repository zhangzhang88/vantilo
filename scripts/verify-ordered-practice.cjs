require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { DOMParser } = require('@xmldom/xmldom');
const { startPortableReader } = require('../electron/portable-reader-service.cjs');
const { AgentRuntime } = require('../electron/runtime.cjs');
const { CodexDriver } = require('../electron/codex-driver.cjs');
const { SessionStore } = require('../electron/session-store.cjs');
const { ProjectStore } = require('../electron/project-store.cjs');
const { WorkspaceAuthority } = require('../electron/workspace.cjs');
const repo = path.resolve(__dirname,'..'), mode = process.env.VANTILO_ORDERED_MODE;
const root = path.join(process.env.VANTILO_TEST_READER_ROOT,`ordered-${mode}`);
const base = path.join(process.env.VANTILO_TEST_ARTIFACT_ROOT,`ordered-${mode}`);
const token = randomBytes(32).toString('hex'), cookie = `__Host-vantilo-reader=${token}`;
const articles = {
  daily: 'Lena makes tea every morning. She carries a cup to her desk.',
  condition: 'When the rain stops, Omar walks to the library because he needs a quiet place to study. If the library is closed, he studies at home.',
  explanation: 'Urban trees reduce heat by providing shade and releasing water into the air. Their roots also absorb rainwater, which helps prevent flooding after heavy storms.',
  complex: 'When the river rises after heavy rain, the volunteers check the sensors that send warnings to nearby villages. If a sensor stops working, they repair it quickly because early warnings give families more time to leave.',
  'daily-long': 'On Saturday morning, Maya planned to visit the farmers market before it became crowded. She checked the weather, packed a reusable bag, and wrote a short list of things she needed. When she reached the bus stop, she realized that she had left her wallet on the kitchen table. She called her brother, who was still at home, and asked him to bring it to the front door. While she waited, an older neighbor told her that the next bus was running late because of road work. Maya thanked him and decided to walk to a smaller shop nearby. She bought apples, bread, and a little cheese, then stopped at the library to return a book. By the time her brother arrived, she had finished her errands and felt glad that the delay had changed her plans. They walked home together and made lunch from the food she had bought.',
  'clauses-long': 'Although the new community garden sits on a narrow piece of land beside the train tracks, residents have turned it into a place where children learn how food grows. Volunteers built raised beds so that people who cannot bend easily can still plant vegetables. Because the neighborhood receives heavy rain in spring, the group installed barrels that collect water from the greenhouse roof. When the barrels are full, extra water flows into a shallow pond, which provides a home for frogs and insects. The garden also stays open after school, allowing teenagers to help with small repairs before they go home. If a plant becomes diseased, members remove it quickly and clean the tools that touched it, so that the problem does not spread to other beds. Last year, a nearby school asked whether its science class could study the pond. The volunteers agreed, provided that students return each month to record what they observe. The project has not solved every problem, but it has helped neighbors share skills and take better care of a shared space.',
  'museum-long': 'On Friday afternoon, Lena and her cousin Mark visited the town museum to return a camera they had borrowed for a school project. The front desk was busy, so they waited beside a display of old maps. Mark wanted to leave early because he had a soccer game, but Lena asked him to help find the return box. While they searched, a guide explained how visitors could borrow audio players for the history rooms. Lena picked one up, and Mark read the instructions aloud. When they reached the exit, the return box was still missing. They told the guide, who checked the map display and found it under a chair. The cousins returned the camera, then stayed to listen to a short story about the town. Mark arrived at the field later than planned, but his team was still warming up. On the way home, he said he would visit the museum again when he had more time.',
};
const manual = mode === 'manual', real = mode === 'real' || manual;
const caseName = manual ? 'new-yorker-2026-10-26' : mode === 'real' ? process.env.VANTILO_ORDERED_CASE : 'synthetic';
if (mode === 'real' && !Object.hasOwn(articles,caseName)) throw new Error('未知的有序练习测试文章');
const wordCount = value => (value.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || []).length;
async function loadManualSource() {
  const filename='new_yorker.2026.10.26.epub', seed=path.join(repo,'build/reader/seed'), epubPath=path.join(seed,'issues',filename);
  const [manifestText,epub] = await Promise.all([fs.readFile(path.join(seed,'manifest.json'),'utf8'),fs.readFile(epubPath)]);
  const entry=JSON.parse(manifestText).entries.find(item => item.kind === 'issues' && item.filename === filename);
  if (!entry || createHash('sha256').update(epub).digest('hex') !== entry.sha256) throw new Error('人工验收文章来源与本地种子清单不匹配');
  const html=execFileSync('/usr/bin/unzip',['-p',epubPath,'index_split_013.html'],{encoding:'utf8',maxBuffer:16*1024*1024});
  const document=new DOMParser({onError(level,message){if(level==='fatalError')throw Error(message)}}).parseFromString(html,'application/xhtml+xml');
  const article=Array.from(document.getElementsByTagName('p')).map(item => String(item.textContent || '').replace(/\s+/g,' ').trim()).find(item => wordCount(item) === 180);
  if (!article || article.length > 2000) throw new Error('未能从已校验的文章中提取 180 词原文段落');
  return {filename,sha256:entry.sha256,epub,article};
}
let manualSource = null;
let article = manual ? '' : real ? articles[caseName] : 'Maya checks the soil every morning. She waters the plants when the soil is dry.';
if (mode === 'real' && caseName.endsWith('-long') && (wordCount(article) < 150 || wordCount(article) > 200)) throw new Error(`长文案例必须为 150–200 词，实际 ${wordCount(article)} 词`);
const synthetic = [{sentence:'the soil',chinese:'土壤'},{sentence:'check the soil',chinese:'检查土壤'},{sentence:'the soil',chinese:'再练土壤'}];
const workshopSynthetic = [
  {sentence:'salt & pepper',chinese:'盐和胡椒',pronunciation:'/sɔːlt ən ˈpɛpər/'},
  {sentence:'a busy market',chinese:'热闹的市场',pronunciation:'/ə ˈbɪzi ˈmɑːrkɪt/'},
  {sentence:'salt & pepper',chinese:'再次复习盐和胡椒',pronunciation:'/sɔːlt ən ˈpɛpər/'},
];
const workshopVocabularySynthetic=[{
  sentenceIndex:0,sentence:'We buy salt & pepper at the market.',word:'market',occurrence:0,
  meaningZh:'市场',sentenceMeaningZh:'我们在市场买盐和胡椒。',pronunciation:'/ˈmɑːrkɪt/',
}];
function redact(text) {
  return text.replace(/("(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|cookie)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]');
}
let service, win, runtime, calls=0, output;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>{console.error('ORDERED_TIMEOUT');app.exit(1);},manual?2*60*60*1000:480000);
async function runAi(payload) {
  if (manual && calls > 0) throw new Error('本次人工体验仅允许生成一次');
  calls++;
  if(mode==='synthetic') return JSON.stringify({exercises:synthetic});
  if(mode==='workshop') return JSON.stringify(/第一阶段|sentenceIndex|词汇准备/.test(String(payload.input||'')+' '+String(payload.instructions||''))?{titleZh:'为什么市场如此热闹？',vocabulary:workshopVocabularySynthetic}:{titleZh:'市场里发生的小故事',exercises:workshopSynthetic});
  const started=Date.now(),callNumber=calls;
  const record={caseName,callNumber,article,source:manualSource?{filename:manualSource.filename,epubEntry:'index_split_013.html',sha256:manualSource.sha256,excerptWords:wordCount(article)}:null,request:{instructions:payload.instructions ?? null,input:payload.input ?? null,modelId:payload.modelId ?? null,reasoningEffort:payload.reasoningEffort ?? null},status:'RUNNING',rawResponse:null,error:null};
  try {
    const text=await runtime.runReaderAi({...payload,requestId:randomUUID()});
    output=text;record.rawResponse=text;record.status='COMPLETED';
    await fs.writeFile(path.join(process.env.VANTILO_TEST_RESULTS_ROOT,`ordered-${caseName}-raw.txt`),text,{flag:'wx',mode:0o600});
    return text;
  } catch(error) {
    record.status='FAILED';record.error=redact(String(error.message || error)).slice(0,2000);
    throw error;
  } finally {
    record.elapsedMs=Date.now()-started;
    await fs.writeFile(path.join(process.env.VANTILO_TEST_RESULTS_ROOT,`ordered-${caseName}-call-${String(callNumber).padStart(2,'0')}.json`),redact(JSON.stringify(record,null,2)),{flag:'wx',mode:0o600});
  }
}
async function start() { return startPortableReader({assetsDir:process.env.VANTILO_READER_BUILD_OUTPUT,libraryRoot:root,apiPort:Number(process.env.VANTILO_LEARNING_API_PORT),webPort:Number(process.env.VANTILO_LEARNING_WEB_PORT),autoSync:false,sessionToken:token,requireSessionAuth:true,getAccountStatus:async()=>['synthetic','workshop'].includes(mode)?{connected:true,email:null}:runtime.driver.accountStatus(),runAi}); }
async function req(url,options={}) { const response=await fetch(service.apiOrigin+url,{...options,headers:{cookie,...options.headers}}); if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json(); }
const js=expression=>win.webContents.executeJavaScript(expression);
async function wait(expression,label,timeout=20000) { const end=Date.now()+timeout; while(Date.now()<end){try{if(await js(expression))return;}catch{}await delay(80);}throw new Error(`等待 ${label} 超时`); }
async function click(selector) { await wait(`!!document.querySelector(${JSON.stringify(selector)})`,selector); await js(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function clickText(text) { await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim().includes(${JSON.stringify(text)}))`,text); await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().includes(${JSON.stringify(text)})).click()`); }
async function fill(selector,value) { await click(selector); await delay(100); await js(`document.querySelector(${JSON.stringify(selector)}).select()`); await win.webContents.insertText(value); await wait(`document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`,`input ${selector}`); }
async function key(key,ctrlKey=false) { await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},ctrlKey:${ctrlKey},bubbles:true}))`); }
(async()=>{
  await app.whenReady(); await fs.mkdir(base,{recursive:true,mode:0o700});
  manualSource=manual?await loadManualSource():null;
  if(manualSource) article=manualSource.article;
  if(real) {
    const work=path.join(base,'workspace'), userData=path.join(base,'runtime'); await fs.mkdir(work,{recursive:true});
    const workspace=new WorkspaceAuthority({userDataPath:userData}); await workspace.setWorkspace(work);
    runtime=new AgentRuntime({driver:new CodexDriver({cwd:work,env:process.env}),workspace,store:new SessionStore({filePath:path.join(userData,'sessions.json')}),projectStore:new ProjectStore({filePath:path.join(userData,'projects.json')})});
    await runtime.start(); if(!(await runtime.driver.accountStatus()).connected) throw new Error('隔离 Codex 测试账号未登录');
  }
  service=await start();
  const epub=manualSource?manualSource.epub:await fs.readFile(path.join(repo,'tests/fixtures/minimal-magazine.epub'));
  const filename=manualSource?manualSource.filename:'SyntheticOrdered.epub';
  await req(`/api/books/import?filename=${encodeURIComponent(filename)}`,{method:'POST',headers:{'content-type':'application/epub+zip'},body:epub});
  const books=await req('/api/books'),book=await req(`/api/books/${encodeURIComponent(books[0].id)}`);
  const lesson=manual?{id:'lesson:ordered-manual',bookId:book.id,bookTitle:book.title,sourceFingerprint:book.sourceFingerprint,titleZh:'The New Yorker · Reporting & Essays 原文节选',english:article,teaserZh:'取自 2026 年 10 月 26 日刊《The New Yorker》的一段英文原文。',explanationZh:'本次练习直接使用文章原文节选。',keywords:[],evidence:[{chapterId:'chapter:new-yorker-2026-10-26-index-split-013',paragraphIndex:0}],wordCount:wordCount(article),adaptation:'原文节选',createdAt:'2026-11-08T00:00:00.000Z'}:{id:'lesson:ordered-test',bookId:book.id,bookTitle:book.title,sourceFingerprint:book.sourceFingerprint,titleZh:'合成练习',english:article,teaserZh:'合成测试。',explanationZh:'合成测试。',keywords:['soil'],evidence:[{chapterId:'chapter:synthetic',paragraphIndex:0}],wordCount:15,adaptation:'合成测试',createdAt:'2026-01-01T00:00:00.000Z'};
  await service.close();service=null;
  await fs.writeFile(path.join(root,'data','book-lessons.local.json'),JSON.stringify([lesson]),{flag:'wx'});
  service=await start();
  await session.defaultSession.cookies.set({url:service.webOrigin,name:'__Host-vantilo-reader',value:token,path:'/',httpOnly:true,secure:true,sameSite:'no_restriction'});
  win=new BrowserWindow({show:manual,width:1440,height:900,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});await win.loadURL(service.webOrigin);
  await wait('!!document.querySelector(".global-nav-primary")','Reader');
  if(manual) {
    console.log(`ORDERED_MANUAL_READY source=${manualSource.filename} words=${wordCount(article)} profile=${process.env.VANTILO_TEST_PROFILE_ROOT}`);
    void (async()=>{
      while(win&&!win.isDestroyed()) {
        try {
          if(await js('!!document.querySelector(\'textarea[aria-label="英文短文"]\')')) {
            await fill('textarea[aria-label="英文短文"]',article);
            console.log('ORDERED_MANUAL_ARTICLE_READY');
            return;
          }
        } catch {}
        await delay(250);
      }
    })().catch(error=>console.error(`ORDERED_MANUAL_PREFILL_FAIL ${error.message}`));
    void (async()=>{
      while(win&&!win.isDestroyed()) {
        try {
          if(calls>0) {
            const rows=await js('Array.from(document.querySelectorAll("[aria-label=有序练习试验] li")).map(li=>({sentence:li.querySelector("span").textContent,chinese:li.textContent.split(" — ").slice(1).join(" — ")}))');
            if(rows.length) {
              await fs.writeFile(path.join(process.env.VANTILO_TEST_RESULTS_ROOT,`ordered-${caseName}-parsed.json`),JSON.stringify({article,exercises:rows},null,2),{flag:'wx',mode:0o600});
              console.log(`ORDERED_MANUAL_LIST_SAVED count=${rows.length}`);
              return;
            }
          }
        } catch {}
        await delay(100);
      }
    })();
    await new Promise(resolve=>win.once('closed',resolve));
    clearTimeout(deadline); await service.close();service=null; await runtime?.stop();runtime=null; app.exit(0); return;
  }
  if (mode === 'workshop') {
    // This preference is scoped exclusively to the throwaway Electron profile.
    await js('localStorage.setItem("magazine-reader-preferences-v1",JSON.stringify({autoPronounceOnWordClick:true}))');
    await win.loadURL(service.webOrigin);
    await wait('!!document.querySelector(".global-nav-primary")','已启用点词发音的隔离 Reader');

    // Navigate the real curated-lesson reader before using the independent Workshop.
    // Intercept clipboard only in the hidden isolated renderer: never modify
    // the user's desktop clipboard or invoke an AI provider.
    await clickText('电子书');
    await wait('!!document.querySelector(\'[data-testid^="book-card-"]\')','实际电子书卡片');
    const nativeShelf=await js(`(()=>{
      const card=document.querySelector('[data-testid^="book-card-"]');
      const title=card.querySelector('.library-book-copy strong');
      return {radius:getComputedStyle(card).borderRadius,
        shadow:getComputedStyle(card).boxShadow,
        titleFont:getComputedStyle(title).fontFamily,
        dataId:card.getAttribute('data-testid')};
    })()`);
    if(nativeShelf.radius!=='12px'||nativeShelf.shadow!=='none'||!nativeShelf.titleFont.includes('apple-system'))
      throw new Error('电子书 macOS 卡片样式未生效: '+JSON.stringify(nativeShelf));
    console.log('READER_NATIVE_SHELF_ELECTRON=PASS radius='+nativeShelf.radius+' shadow='+nativeShelf.shadow+' existingCard=true');
    await click('[data-testid^="book-card-"]');
    await clickText('精选阅读');
    await click(`[data-testid=${JSON.stringify(`book-lesson-${lesson.id}`)}]`);
    await wait('!!document.querySelector(".reader-toolbar")','实际阅读工具栏');
    const readerNative=await js(`(()=>{
      const shell=document.querySelector('.reader-page-shell');
      const toolbar=document.querySelector('.reader-toolbar');
      const inspector=document.querySelector('.vocabulary-panel');
      const expected=document.createElement('div');expected.style.background='var(--theme-surface)';
      toolbar.appendChild(expected);
      const themeSurface=getComputedStyle(expected).backgroundColor;expected.remove();
      return {article:!shell.classList.contains('is-sentence-mode')&&!shell.classList.contains('is-chinese-mode'),
        themeSurface,
        toolbarBackground:getComputedStyle(toolbar).backgroundColor,
        toolbarRadius:getComputedStyle(toolbar).borderRadius,
        vocabFound:!!inspector,
        vocabBg:inspector?getComputedStyle(inspector).backgroundColor:null};
    })()`);
    if(!readerNative.article||readerNative.toolbarBackground!==readerNative.themeSurface)
      throw new Error('整篇阅读工具栏未正确跟随当前主题: '+JSON.stringify(readerNative));
    if(readerNative.vocabFound&&readerNative.vocabBg!==readerNative.toolbarBackground)
      throw new Error('词汇面板与阅读工具栏主题不一致: '+JSON.stringify(readerNative));
    console.log('READER_NATIVE_TOOLBAR_ELECTRON=PASS articleMode=true toolbarTheme=true vocabularyInspector='+readerNative.vocabFound);
    // The actual reading toolbar and word inspector are covered above.
    // Check vocabulary popup/list stylesheet colors under both supported
    // system appearances in an offscreen fixture, without creating user data.
    const vocabularyThemeProbe=await js(`(async()=>{
      const root=document.querySelector('.app-shell'),html=document.documentElement;
      const original=html.getAttribute('data-color-mode');
      const fixture=document.createElement('div');
      fixture.style.cssText='position:absolute;left:-10000px;top:0;pointer-events:none;width:390px';
      fixture.innerHTML='<div class="word-lookup-card"></div><div class="word-context-card"></div>'+
        '<div class="selection-assist-popover"><div class="selection-assist-toolbar"><button>复制</button></div></div>'+
        '<div class="global-vocabulary-card familiarity-2"><button class="global-vocabulary-word">word</button></div>';
      root.appendChild(fixture);
      const modes=[];
      try {
        for(const mode of ['light','dark']){
          html.setAttribute('data-color-mode',mode);
          // Global vocabulary cards intentionally animate background for 150ms.
          // Wait for that transition before comparing settled theme colors.
          await new Promise(resolve=>setTimeout(resolve,240));
          const surface=document.createElement('div');
          surface.style.background='var(--theme-surface)';fixture.appendChild(surface);
          const expected=getComputedStyle(surface).backgroundColor;surface.remove();
          const word=getComputedStyle(fixture.querySelector('.word-lookup-card'));
          const context=getComputedStyle(fixture.querySelector('.word-context-card'));
          const selection=getComputedStyle(fixture.querySelector('.selection-assist-popover'));
          const vocabulary=getComputedStyle(fixture.querySelector('.global-vocabulary-card'));
          modes.push({mode,expected,word:word.backgroundColor,context:context.backgroundColor,
            selection:selection.backgroundColor,vocabulary:vocabulary.backgroundColor,
            familiarityStripe:vocabulary.borderLeftWidth});
        }
      } finally {
        if(original===null)html.removeAttribute('data-color-mode');
        else html.setAttribute('data-color-mode',original);
        fixture.remove();
      }
      return modes;
    })()`);
    for(const item of vocabularyThemeProbe){
      if([item.word,item.context,item.selection,item.vocabulary].some(color=>color!==item.expected)||
        item.familiarityStripe!=='4px')
        throw new Error('词汇弹窗/列表样式未跟随主题或熟悉度标记丢失: '+JSON.stringify(item));
    }
    console.log('READER_NATIVE_VOCABULARY_THEME_ELECTRON=PASS lightDark=true popup=true selection=true familiarityStripe=true');


    // Real Reader word click; fake the media element so no external audio
    // or Qwen request is made by the isolated Electron verification.
    await wait('!!document.querySelector(".dictionary-word-token")','可点击英文单词');
    console.log('WORD_E2E_PHASE=setup');
    await js(`(()=>{
      window.__wordAudioCalls=[];window.__dictionaryResolved=false;
      window.__originalAudio=window.Audio;
      window.__originalFetch=window.fetch;
      const oldFetch=window.fetch.bind(window);
      window.fetch=(...args)=>{
        if(String(args[0]).includes('/api/word-context'))return Promise.reject(Error('isolated word-context fixture'));
        if(String(args[0]).includes('/api/dictionary?'))
          return new Promise(resolve=>setTimeout(resolve,1100)).then(()=>{window.__dictionaryResolved=true;return oldFetch(...args)});
        return oldFetch(...args);
      };
      window.Audio=class extends EventTarget {
        constructor(url){super();this.src=url;this.preload='auto';this.currentTime=0;}
        play(){window.__wordAudioCalls.push({url:this.src,dictionaryDone:window.__dictionaryResolved});
          queueMicrotask(()=>this.dispatchEvent(new Event('playing')));
          return Promise.resolve();}
        pause(){}load(){}removeAttribute(){}
      };
      window.__wordAudioEvents=[];
      window.addEventListener('magazine-reader:word-pronunciation',event=>window.__wordAudioEvents.push(event.detail));
    })()`);
    console.log('WORD_E2E_PHASE=click');
    await click('.dictionary-word-token');
    console.log('WORD_E2E_PHASE=wait');
    await wait('window.__wordAudioCalls?.length===1','点词时立即启动发音');
    console.log('WORD_E2E_PHASE=read');
    const launch=await js('({calls:window.__wordAudioCalls,events:window.__wordAudioEvents})');
    if(!launch.calls[0].url.startsWith('/api/word-audio?word=')||
       !launch.calls[0].url.includes('&accent=us')||launch.calls[0].dictionaryDone)
      throw new Error('点词仍然依赖词典查询或请求了错误发音路径: '+JSON.stringify(launch));
    console.log('WORD_E2E_PHASE=restore');
    await js('window.Audio=window.__originalAudio;window.fetch=window.__originalFetch;true');
    console.log('WORD_AUDIO_IMMEDIATE_ELECTRON=PASS independentOfDictionary=true cachedEndpoint=true noMacSystemTts=true realAiCalls=0');
    // Test the bundled Qwen word path with deliberately uneven NDJSON PCM
    // arrival. Unlike the first-click fixture above, we verify that the real
    // browser AudioContext receives one complete clip, not three gap-prone
    // audio buffers. No live synthesis, external network, or system TTS.
    await js(`(()=>{
      window.__smoothOriginalAudio=window.Audio;
      window.__smoothOriginalFetch=window.fetch;
      window.__smoothAudioBuffers=[];window.__smoothAudioSources=0;
      window.__smoothOriginalCreateBuffer=AudioContext.prototype.createBuffer;
      window.__smoothOriginalCreateBufferSource=AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBuffer=function(channels,samples,rate){
        window.__smoothAudioBuffers.push({samples,rate});
        return window.__smoothOriginalCreateBuffer.call(this,channels,samples,rate);
      };
      AudioContext.prototype.createBufferSource=function(){
        window.__smoothAudioSources++;
        return window.__smoothOriginalCreateBufferSource.call(this);
      };
      window.Audio=class extends EventTarget {
        constructor(url){super();this.src=url;this.preload='auto';this.currentTime=0;}
        play(){return new Promise(()=>{});} // Stall Youdao without touching the network.
        pause(){}load(){}removeAttribute(){}
      };
      window.fetch=(url,options)=>{
        if(String(url).includes('/api/prep/tts')){
          const pcm=btoa(String.fromCharCode(...new Uint8Array(4800)));
          const frame=JSON.stringify({type:'chunk',sampleRate:24000,pcm})+'\\n';
          const end=JSON.stringify({type:'end',stop:'complete'})+'\\n';
          const encoder=new TextEncoder();
          const stream=new ReadableStream({start(controller){
            controller.enqueue(encoder.encode(frame));
            setTimeout(()=>controller.enqueue(encoder.encode(frame)),210);
            setTimeout(()=>{controller.enqueue(encoder.encode(frame+end));controller.close();},560);
          }});
          return Promise.resolve(new Response(stream,{status:200,headers:{'content-type':'application/x-ndjson'}}));
        }
        return window.__smoothOriginalFetch(url,options);
      };
      return true;
    })()`);
    await click('.dictionary-word-token');
    await delay(500);
    if(await js('window.__smoothAudioSources !== 0'))throw new Error('Qwen PCM 分块尚未收齐就已经启动，可能出现断续');
    await wait('window.__smoothAudioSources===1','Qwen 单词完整 PCM 单音源',10000);
    const smoothWord=await js('({buffers:window.__smoothAudioBuffers,sources:window.__smoothAudioSources})');
    if(smoothWord.buffers.length!==1 || smoothWord.buffers[0].samples!==7200 || smoothWord.buffers[0].rate!==24000)
      throw new Error('Qwen 单词没有合成连续 7200 个 PCM 样本: '+JSON.stringify(smoothWord));
    await js(`(()=>{
      window.dispatchEvent(new Event('magazine-reader:stop-word-audio'));
      AudioContext.prototype.createBuffer=window.__smoothOriginalCreateBuffer;
      AudioContext.prototype.createBufferSource=window.__smoothOriginalCreateBufferSource;
      window.Audio=window.__smoothOriginalAudio;
      window.fetch=window.__smoothOriginalFetch;
      return true;
    })()`);
    console.log('WORD_QWEN_SMOOTH_ELECTRON=PASS delayedPcm=true oneContinuousBuffer=true noRealAi=true');
    // Synthetic selection speech: use the real selection toolbar, browser PCM
    // playback, and an in-page NDJSON Qwen fixture. No real model/API request.
    console.log('SELECTION_E2E_PHASE=setup');
    await js(`(()=>{
      const tokens=Array.from(document.querySelectorAll('.reading-body .dictionary-word-token'));
      if(tokens.length<2)throw Error('No selectable English tokens');
      const left=tokens[0].firstChild,right=tokens[1].firstChild;
      const range=document.createRange();range.setStart(left,0);range.setEnd(right,right.textContent.length);
      const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
      tokens[1].closest('.reading-body').dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      window.__selectionOriginalFetch=window.fetch;
      window.__selectionTtsRequests=[];window.__selectionSpeechEvents=[];window.__selectionPcmBuffers=[];
      window.__selectionOriginalCreateBuffer=AudioContext.prototype.createBuffer;
      AudioContext.prototype.createBuffer=function(channels,samples,rate){
        window.__selectionPcmBuffers.push({samples,rate});
        return window.__selectionOriginalCreateBuffer.call(this,channels,samples,rate);
      };
      window.addEventListener('magazine-reader:selection-speech',event=>window.__selectionSpeechEvents.push(event.detail));
      const raw=new Uint8Array(4800);
      const pcm=btoa(String.fromCharCode(...raw));
      window.fetch=(url,options)=>{
        if(String(url).includes('/api/prep/tts')){
          window.__selectionTtsRequests.push(JSON.parse(options.body));
          const frame=JSON.stringify({type:'chunk',sampleRate:24000,pcm})+'\\n';
          const end=JSON.stringify({type:'end',stop:'complete'})+'\\n';
          const encoder=new TextEncoder();
          return Promise.resolve(new Response(new ReadableStream({start(controller){
            controller.enqueue(encoder.encode(frame));
            setTimeout(()=>controller.enqueue(encoder.encode(frame)),210);
            setTimeout(()=>{controller.enqueue(encoder.encode(frame+end));controller.close();},560);
          }}),{status:200,headers:{'content-type':'application/x-ndjson'}}));
        }
        return window.__selectionOriginalFetch(url,options);
      };
      return true;
    })()`);
    await wait('!!document.querySelector(\'[aria-label="朗读选中文字"]\')','选区 Qwen 朗读按钮');
    console.log('SELECTION_E2E_PHASE=first-click');
    await click('[aria-label="朗读选中文字"]');
    await delay(160);
    if(await js('window.__selectionPcmBuffers?.length!==0'))throw new Error('选区短语在 PCM 未接收完整前就已分块播放');
    await wait('window.__selectionSpeechEvents?.some(event=>event.status==="qwen")','选区 Qwen 音频播放',10000);
    const selectionSpeech=await js('({requests:window.__selectionTtsRequests,events:window.__selectionSpeechEvents,buffers:window.__selectionPcmBuffers})');
    if(selectionSpeech.requests.length!==1 || selectionSpeech.requests[0].language!=='en-US'
      || !['aiden','ryan'].includes(selectionSpeech.requests[0].voice)
      || !selectionSpeech.requests[0].text.includes(' ')
      || !Number.isSafeInteger(selectionSpeech.requests[0].seed)
      || selectionSpeech.buffers.length!==1 || selectionSpeech.buffers[0].samples!==7200 || selectionSpeech.buffers[0].rate!==24000
      || selectionSpeech.events.some(event=>event.status==='system')) {
      throw new Error('选区朗读没有优先使用 Qwen 英文 PCM: '+JSON.stringify(selectionSpeech));
    }
    await wait('window.__selectionSpeechEvents?.some(event=>event.status==="stopped")','选区完整音频播放结束',10000);
    console.log('SELECTION_E2E_PHASE=replay-click');
    await click('[aria-label="朗读选中文字"]');
    await wait('window.__selectionSpeechEvents?.filter(event=>event.status==="qwen").length===2','缓存同一选区朗读',10000);
    const replay=await js('({requests:window.__selectionTtsRequests.length,buffers:window.__selectionPcmBuffers})');
    if(replay.requests!==1 || replay.buffers.length!==2 || replay.buffers.some(buffer=>buffer.samples!==7200))
      throw new Error('重复朗读未复用完整 PCM 缓存: '+JSON.stringify(replay));
    await wait('window.__selectionSpeechEvents?.filter(event=>event.status==="stopped").length>=2','第二次朗读结束',10000);
    console.log('SELECTION_E2E_PHASE=option-click');
    // Re-select in the real Reader before the modifier gesture, as users do
    // after the original browser selection collapses on an earlier click.
    await js(`(()=>{
      const tokens=Array.from(document.querySelectorAll('.reading-body .dictionary-word-token'));
      if(tokens.length<2)return false;
      const range=document.createRange();range.setStart(tokens[0].firstChild,0);
      range.setEnd(tokens[1].firstChild,tokens[1].firstChild.textContent.length);
      const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
      tokens[1].closest('.reading-body').dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      return true;
    })()`);
    await wait('!!document.querySelector(\'[aria-label="朗读选中文字"]\')','重新选区的朗读按钮',10000);
    const optionClicked=await js(`(()=>{
      const button=document.querySelector('[aria-label="朗读选中文字"]');
      if(!button)return false;
      button.dispatchEvent(new MouseEvent('click',{bubbles:true,altKey:true}));
      return true;
    })()`);
    if(!optionClicked)throw new Error('选区重新生成按钮不可用');
    await wait('window.__selectionTtsRequests?.length===2','Option 重新生成选区音频',10000);
    await wait('window.__selectionSpeechEvents?.filter(event=>event.status==="qwen").length===3','重新生成 PCM 已播放',10000);
    const regenerated=await js('({requests:window.__selectionTtsRequests,buffers:window.__selectionPcmBuffers})');
    if(regenerated.requests[1].seed===regenerated.requests[0].seed || regenerated.buffers.length!==3)
      throw new Error('Option 重新生成没有使用独立随机种子并替换缓存: '+JSON.stringify(regenerated));
    await js('window.dispatchEvent(new Event("magazine-reader:stop-selection-speech"));AudioContext.prototype.createBuffer=window.__selectionOriginalCreateBuffer;window.fetch=window.__selectionOriginalFetch;true');
    console.log('SELECTION_QWEN_TTS_ELECTRON=PASS nativeSelection=true delayedPcm=true oneBufferPerPlayback=true cachedReplayNoRequest=true stableSeed=true optionRegenerate=true paidAiCalls=0');
    // Real sentence-by-sentence button path: first read streams immediately,
    // subsequent reads reuse the completed PCM shared with selection speech.
    // Modifier-click explicitly regenerates. No real inference is invoked.
    await click('.reader-mode-switch button[aria-keyshortcuts="2"]');
    await wait('!!document.querySelector(\'[data-reader-mode="sentence"] [aria-label="朗读当前英文句子"]\')','真实逐句英文朗读');
    await js(`(()=>{
      window.__sentenceOldFetch=window.fetch;
      window.__sentenceOldCreateBuffer=AudioContext.prototype.createBuffer;
      window.__sentenceRequests=[];window.__sentencePcmBuffers=[];
      AudioContext.prototype.createBuffer=function(channels,samples,rate){
        window.__sentencePcmBuffers.push({samples,rate});
        return window.__sentenceOldCreateBuffer.call(this,channels,samples,rate);
      };
      window.fetch=(url,options)=>{
        if(String(url).includes('/api/prep/tts')){
          window.__sentenceRequests.push(JSON.parse(options.body));
          const pcm=btoa(String.fromCharCode(...new Uint8Array(4800)));
          const frame=JSON.stringify({type:'chunk',sampleRate:24000,pcm})+'\\n';
          const end=JSON.stringify({type:'end',stop:'complete'})+'\\n';
          const encoder=new TextEncoder();
          return Promise.resolve(new Response(new ReadableStream({start(controller){
            controller.enqueue(encoder.encode(frame));
            setTimeout(()=>controller.enqueue(encoder.encode(frame)),210);
            setTimeout(()=>{controller.enqueue(encoder.encode(frame+end));controller.close();},560);
          }}),{status:200,headers:{'content-type':'application/x-ndjson'}}));
        }
        return window.__sentenceOldFetch(url,options);
      };
      return true;
    })()`);
    await click('[aria-label="朗读当前英文句子"]');
    await wait('window.__sentencePcmBuffers.length>=1','逐句流式首块播放',10000);
    if(await js('window.__sentenceRequests.length!==1'))throw new Error('逐句首次播放没有发起一次 TTS 请求');
    await wait('!!document.querySelector(\'[aria-label="重新朗读英文句子"]\')','逐句首次播放结束',10000);
    const initialSentence=await js('({requests:window.__sentenceRequests,buffers:window.__sentencePcmBuffers})');
    if(initialSentence.requests.length!==1||!Number.isSafeInteger(initialSentence.requests[0].seed)||
      initialSentence.buffers.length!==3||initialSentence.buffers.some(frame=>frame.samples!==2400||frame.rate!==24000))
      throw new Error('逐句首次流式音频异常: '+JSON.stringify(initialSentence));
    await click('[aria-label="重新朗读英文句子"]');
    await wait('!!document.querySelector(\'[aria-label="重新朗读英文句子"]\')','逐句缓存播放结束',10000);
    const repeatedSentence=await js('({requests:window.__sentenceRequests.length,buffers:window.__sentencePcmBuffers})');
    if(repeatedSentence.requests!==1||repeatedSentence.buffers.length!==4||
      repeatedSentence.buffers[3].samples!==7200)
      throw new Error('逐句重复朗读没有复用完整 PCM 缓存: '+JSON.stringify(repeatedSentence));
    await js(`(()=>{
      const button=document.querySelector('[aria-label="重新朗读英文句子"]');
      if(!button)return false;
      button.dispatchEvent(new MouseEvent('click',{bubbles:true,altKey:true}));
      return true;
    })()`);
    await wait('window.__sentenceRequests.length===2','逐句 Option 重新生成请求',10000);
    await wait('!!document.querySelector(\'[aria-label="重新朗读英文句子"]\')','逐句新音频播放结束',10000);
    const regenSentence=await js('({requests:window.__sentenceRequests,buffers:window.__sentencePcmBuffers})');
    if(regenSentence.requests[0].seed===regenSentence.requests[1].seed||
      regenSentence.buffers.length!==7)throw new Error('逐句 Option 重新生成未使用新种子: '+JSON.stringify(regenSentence));
    await js('window.dispatchEvent(new Event("magazine-reader:stop-english-sentence-audio"));AudioContext.prototype.createBuffer=window.__sentenceOldCreateBuffer;window.fetch=window.__sentenceOldFetch;true');
    await click('.reader-mode-switch button[aria-keyshortcuts="1"]');
    await wait('!!document.querySelector(\'[data-reader-mode="article"]\')','返回整篇阅读',10000);
    console.log('ENGLISH_SENTENCE_TTS_CACHE_ELECTRON=PASS initialStreaming=true replayOneFullBuffer=true noNewRequestOnReplay=true optionRegenerateSeed=true realAiCalls=0');
    await wait('!!document.querySelector(\'button[aria-label="复制英文文章"]\')','精选文章复制按钮');
    if (await js('!!document.querySelector(\'button[aria-label="练习"]\')')) throw new Error('精选文章仍保留旧练习入口');
    await js(`(()=>{window.__copiedCuratedEnglish=null;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async function(value){window.__copiedCuratedEnglish=value;}}});})()`);
    await click('button[aria-label="复制英文文章"]');
    await wait('!!document.querySelector(\'button[aria-label="已复制英文文章"]\')','精选文章已复制反馈');
    const copied=await js('window.__copiedCuratedEnglish');
    if(copied!==lesson.english || copied.includes(lesson.teaserZh) || copied.includes(lesson.explanationZh))throw new Error('精选阅读复制内容不是完整独立英文原文');
    console.log('CURATED_ENGLISH_COPY_ELECTRON=PASS sourceExact=true chineseExcluded=true oldPracticeButtonAbsent=true clipboardIntercepted=true');
    await click('button[aria-label="返回精选阅读与备课"]');
    await wait('!!document.querySelector(\'button[aria-label="Practice Lab"]\')','从精选阅读返回主导航');

    // Verify the settings stylesheet's computed cascade in isolated
    // Electron without relying on a navigation route not supported by
    // this workshop fixture. Real settings-page visual acceptance remains
    // separate from this style-only check.
    const settingsStyleProbe=await js(`(()=>{
      const host=document.querySelector('.app-shell');
      const fixture=document.createElement('div');
      fixture.className='settings-page';
      fixture.style.cssText='position:absolute;left:-10000px;top:0;width:600px;pointer-events:none';
      fixture.innerHTML='<div class="settings-grid"><section class="settings-card"><div class="settings-card-heading"><div><span>Appearance</span><h2>外观与阅读</h2></div></div></section></div>';
      host.appendChild(fixture);
      const card=fixture.querySelector('.settings-card');
      const heading=fixture.querySelector('h2');
      const cardStyle=getComputedStyle(card),headingStyle=getComputedStyle(heading);
      const result={cardRadius:cardStyle.borderRadius,shadow:cardStyle.boxShadow,headingFamily:headingStyle.fontFamily};
      fixture.remove();return result;
    })()`);
    if(settingsStyleProbe.cardRadius!=='12px'||settingsStyleProbe.shadow!=='none'||!settingsStyleProbe.headingFamily.includes('apple-system'))throw new Error('设置页 macOS 样式未进入构建: '+JSON.stringify(settingsStyleProbe));
    console.log('SETTINGS_NATIVE_CSS_ELECTRON=PASS isolatedStyleFixture=true cardRadius='+settingsStyleProbe.cardRadius+' shadow='+settingsStyleProbe.shadow);
    await click('button[aria-label="Practice Lab"]');
    await wait('document.querySelectorAll(".practice-workshop-mode-card").length===2','练习方式双卡片');
    const visual=await js(`(()=>{
      const mode=document.querySelector('.practice-workshop-mode-card');
      const lab=document.querySelector('.practice-workshop');
      return {header:document.querySelector('.practice-workshop h1')?.textContent,
        radius:getComputedStyle(mode).borderRadius,
        family:getComputedStyle(lab).fontFamily,
        border:getComputedStyle(mode).borderColor,
        columns:getComputedStyle(document.querySelector('.practice-workshop-mode-cards')).gridTemplateColumns};
    })()`);
    if(visual.header!=='Practice Lab'||visual.radius!=='11px'||!visual.family.includes('apple-system')||!visual.border)throw new Error('Practice Lab macOS 试点样式未在隔离 Electron 生效: '+JSON.stringify(visual));
    console.log('PRACTICE_LAB_MACOS_STYLE_ELECTRON=PASS header='+visual.header+' radius='+visual.radius+' themeAware=true');

    if (!(await js('Array.from(document.querySelectorAll(".practice-workshop-mode-card")).every(b=>b.getAttribute("aria-pressed")==="false")'))) throw new Error('首次使用不应预先选择玩法');
    await click('.practice-workshop-mode-card:nth-child(2)');
    await wait('document.querySelector(".practice-workshop-mode-card:nth-child(2)")?.getAttribute("aria-pressed")==="true"','句子组装卡片选中');
    await wait('!!document.querySelector(".practice-workshop-prompt")','工坊提示词');
    await wait('document.querySelector(".practice-workshop-prompt")?.value.includes("{{ARTICLE_JSON}}")','默认提示词');
    await wait('document.querySelector(".practice-workshop-prompt")?.value.includes("titleZh")','句子组装可见中文标题生成规则');
    if (!(await js('!!document.querySelector(\'aside[aria-label="英文文章创作助手"]\')'))) {
      await click('button[aria-label="Codex 助手"]');
    }
    await wait('!!document.querySelector(\'aside[aria-label="英文文章创作助手"]\')','练习工坊英文创作助手');
    const assistantNative=await js(`(()=>{
      const panel=document.querySelector('.codex-prep-panel');
      const prompts=document.querySelector('.codex-prep-quick-prompts .text-button');
      const panelStyle=getComputedStyle(panel),promptStyle=prompts?getComputedStyle(prompts):null;
      return {panelRadius:panelStyle.borderRadius,panelShadow:panelStyle.boxShadow,buttonRadius:promptStyle?.borderRadius};
    })()`);
    if(assistantNative.panelRadius!=='12px'||assistantNative.panelShadow!=='none'||assistantNative.buttonRadius!=='8px')throw new Error('Codex 原生化面板样式未生效: '+JSON.stringify(assistantNative));
    console.log('CODEX_NATIVE_STYLE_ELECTRON=PASS cardRadius='+assistantNative.panelRadius+' shadow='+assistantNative.panelShadow+' promptRadius='+assistantNative.buttonRadius);

    await wait('document.querySelector(".assistant-context")?.textContent.includes("Practice Lab · 英文创作")','专属创作讨论范围');
    const assistantText = await js('document.querySelector(\'aside[aria-label="英文文章创作助手"]\')?.innerText || ""');
    for (const label of ['帮我确定主题','生成英文短文','指定词汇写文章','简化现有文章']) if (!assistantText.includes(label)) throw new Error('缺少英文创作建议: '+label);
    for (const label of ['全部书刊','推荐适合我的阅读','这里有哪些内容','用简单中文解释']) if (assistantText.includes(label)) throw new Error('工坊仍有旧阅读文案: '+label);
    await wait('document.querySelector(".assistant-empty")?.textContent?.includes("告诉我想练什么主题")','创作助手讨论记录已加载');
    await js(`Array.from(document.querySelectorAll('.codex-prep-quick-prompts button')).find(b=>b.textContent.trim()==='生成英文短文').click()`);
    await wait('document.querySelector(".reader-shared-composer [role=textbox]")?.textContent?.includes("只输出可以直接复制到 Practice Lab 的英文正文")','英文文章快捷提示已填入');
    await click('button[aria-label="收起 Codex 助手"]');
    console.log('WORKSHOP_CODEX_WRITING_UI_ELECTRON=PASS scope=practice prompts=4 oldReadingLabelsAbsent=true promptPrefill=true noAiCalls=true');

    await fill('.practice-workshop textarea', 'We buy salt & pepper at the market.');
    await clickText('生成句子组装练习');
    await wait('document.querySelectorAll(".practice-workshop-results li").length === 3 || !!document.querySelector("[role=alert]")','工坊生成结果',80000);
    const err = await js('document.querySelector(".practice-workshop-error")?.textContent || ""');
    if (err) throw new Error('工坊生成失败: ' + err.slice(0,200));
    const readRows = 'Array.from(document.querySelectorAll(".practice-workshop-results li")).map(li => { const inputs=Array.from(li.querySelectorAll("input")); return {sentence:inputs[0]?.value,chinese:inputs[1]?.value,pronunciation:inputs[2]?.value}; })';
    const initial = await js(readRows);
    if (calls !== 1 || JSON.stringify(initial) !== JSON.stringify(workshopSynthetic)) throw new Error('工坊初次生成的顺序或 IPA 不匹配');
    await click('button[aria-label="下移第 1 条"]');
    const rows = await js(readRows);
    const expected=[workshopSynthetic[1],workshopSynthetic[0],workshopSynthetic[2]];
    if (JSON.stringify(rows)!==JSON.stringify(expected)) throw new Error('工坊顺序移动后 IPA 未匹配');
    await wait('document.querySelector(".practice-workshop-saved li")?.textContent.includes("3 条")','生成后自动保存');
    await wait('JSON.parse(localStorage.getItem("vantilo:practice-workshop:v1") || "{}").items?.[0]?.exercises?.[0]?.sentence === "a busy market"','编辑顺序自动保存',10000);
    const stored = await js('localStorage.getItem("vantilo:practice-workshop:v1") || ""');
    if(!stored.includes('市场里发生的小故事'))throw new Error('同次生成的中文标题未自动保存');
    await click('.practice-workshop-saved-controls button[aria-label^="重命名"]');
    await fill('input[aria-label="修改中文标题"]','市场里值得重读的一天');
    await clickText('保存名称');
    await wait('document.querySelector(".practice-workshop-saved li")?.textContent.includes("市场里值得重读的一天")','改名后自动存档');

    if (!stored.includes('sɔːlt') || JSON.parse(stored).items[0].exercises.length !== 3) throw new Error('本地保存缺少音标');
    await win.loadURL(service.webOrigin);
    await wait('!!document.querySelector(".global-nav-primary")','Reader 重载');
    await click('button[aria-label="Practice Lab"]');
    await wait('!!document.querySelector(".practice-workshop-saved li")','重开已保存练习');
    await click('.practice-workshop-saved button');
    const reopened = await js(readRows);
    if (calls !== 1 || JSON.stringify(reopened)!==JSON.stringify(rows)) throw new Error('重开练习发生额外调用或 IPA 顺序丢失');
    const useOriginalAudio=true; // All Reader builds now bundle the three original MP3 files.
    if (useOriginalAudio) {
      const available=await js(`Promise.all(['typing','correct','error'].map(async name=>{const r=await fetch('/worm/'+name+'.mp3',{method:'HEAD'});return r.ok&&r.headers.get('content-type')==='audio/mpeg';})).then(values=>values.every(Boolean))`);
      if(!available)throw new Error('三种原版 MP3 没有在隔离 Reader 里通过音频资源检查');
      await js(`(()=>{const old=HTMLMediaElement.prototype.play;window.__originalSoundProbe={requested:[],started:[],rejected:[]};HTMLMediaElement.prototype.play=function(){if(!this.src.includes('/worm/'))return old.call(this);const source=new URL(this.src).pathname;window.__originalSoundProbe.requested.push(source);const result=old.call(this);void result.then(()=>window.__originalSoundProbe.started.push(source),error=>window.__originalSoundProbe.rejected.push(error?.name||'unknown'));return result;};})()`);
    } else {
      // Probe the synthesized fallback without asserting loudspeaker audibility.
      const audioAvailable=await js(`(()=>{const Original=window.AudioContext;if(!Original)return false;window.__orderedGameSoundProbe={tones:0};window.AudioContext=class extends Original{createOscillator(){window.__orderedGameSoundProbe.tones++;return super.createOscillator();}};return true;})()`);
      if(!audioAvailable) throw new Error('Electron Reader 缺少 Web AudioContext，按键音不可用');
    }
    await clickText('开始句子组装');
    await wait('!!document.querySelector(".worm-game-words")','现有打字游戏');
    for (let i=0; i<rows.length; i++) {
      const item=rows[i], tokens=item.sentence.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu);
      await wait(`document.querySelector(".worm-game-meaning")?.textContent===${JSON.stringify(item.chinese)}`, `第 ${i+1} 条回忆提示`);
      if (await js('!!document.querySelector(".worm-game-pronunciation")')) throw new Error('未作答时暴露音标');
      for (let j=0; j<tokens.length; j++) await fill(`input[data-word-index="${j}"]`,tokens[j]);
      await key('Enter');
      if(i===0) await wait(useOriginalAudio?'window.__originalSoundProbe?.requested.length >= 1':'window.__orderedGameSoundProbe?.tones >= 1',useOriginalAudio?'原版 MP3 按键音':'Web Audio 按键音');
      await wait('!!document.querySelector(".worm-game-completion")',`第 ${i+1} 条答题结束`);
      const shown=await js('document.querySelector(".worm-game-pronunciation")?.textContent');
      if (shown!==item.pronunciation) throw new Error(`第 ${i+1} 条游戏 IPA 不匹配`);
      await click('button[aria-label="下一项"]');
    }
    await wait('document.body.innerText.includes("句子组装完成")','练习完成');
    if(calls!==1) throw new Error('重开和练习期间额外调用 AI');
    let soundEvidence;
    if(useOriginalAudio) {
      await wait('window.__originalSoundProbe?.started.length >= 3 || window.__originalSoundProbe?.rejected.length>0','原版 MP3 音频播放状态',8000);
      const probe=await js('window.__originalSoundProbe');
      if(probe.rejected.length||!probe.requested.some(item=>item.endsWith('typing.mp3'))||!probe.requested.some(item=>item.endsWith('correct.mp3'))||probe.started.length<3)throw new Error('旧音效播放失败: '+JSON.stringify(probe));
      soundEvidence='originalMp3Started='+probe.started.length;
    }else{
      const audioTones=await js('window.__orderedGameSoundProbe?.tones ?? 0');
      if(audioTones<rows.length*2) throw new Error(`游戏按键/完成音效路径未触发: ${audioTones}`);
      soundEvidence='audioTones='+audioTones;
    }
    if(process.env.VANTILO_ORDERED_WORKSHOP_STAGES==='1'){
      await clickText('返回阅读');
      await wait('!!document.querySelector(".practice-workshop")','组装完成后返回工坊');
      const originalSaved=await js('localStorage.getItem("vantilo:practice-workshop:v1")');
      await click('.practice-workshop-mode-card:nth-child(1)');
      await wait('document.querySelector(".practice-workshop-mode-card:nth-child(1)")?.getAttribute("aria-pressed")==="true"','原文填词卡片选中');
      await wait('document.querySelector(".practice-workshop-prompt")?.value.includes("sentenceIndex")','独立词汇准备提示词');
      await wait('document.querySelector(".practice-workshop-prompt")?.value.includes("titleZh")','原文填词可见中文标题生成规则');
      await clickText('生成原文填词练习');
      await wait('document.querySelectorAll(".practice-workshop-results li").length === 1 || !!document.querySelector(".practice-workshop-error")','第一阶段生成',80000);
      const error=await js('document.querySelector(".practice-workshop-error")?.textContent||""');
      if(error)throw new Error('第一阶段生成失败: '+error.slice(0,200));
      const word=await js('document.querySelector(".practice-workshop-results input")?.value');
      if(word!==workshopVocabularySynthetic[0].word)throw new Error('第一阶段与原文词形不匹配');
      await wait('JSON.parse(localStorage.getItem("vantilo:practice-workshop-vocabulary:v1") || "{}").items?.[0]?.vocabulary?.[0]?.word === "market"','原文填词生成后自动保存');
      const vocabularySaved=await js('localStorage.getItem("vantilo:practice-workshop-vocabulary:v1") || ""');
      if(!vocabularySaved.includes('为什么市场如此热闹？'))throw new Error('原文填词中文标题未自动保存');
      if(JSON.parse(vocabularySaved).items[0].vocabulary[0].pronunciation!==workshopVocabularySynthetic[0].pronunciation)throw new Error('第一阶段 IPA 保存失败');
      if(originalSaved!==await js('localStorage.getItem("vantilo:practice-workshop:v1")'))throw new Error('第一阶段覆盖了第二阶段历史存档');
      await clickText('开始原文填词');
      await wait("!!document.querySelector('[aria-label=\"本课词汇选择\"]')",'第一阶段原版选词');
      await clickText('开始练习');
      await wait("!!document.querySelector('[aria-label=\"当前缺失词\"]')",'第一阶段原文填空');
      const check=await js(`({word:document.querySelector('[aria-label="当前缺失词"]')?.outerHTML||"",chinese:document.querySelector('.vocabulary-game-translation')?.innerText||"",source:document.querySelector('.vocabulary-game-sentence')?.innerText||""})`);
      if(!check.chinese.includes('市场')||!check.chinese.includes('我们在市场买盐和胡椒。')||!check.chinese.includes('/ˈmɑːrkɪt/'))throw new Error('第一阶段原版游戏缺少语境词义/整句译文/IPA');
      await js(`(()=>{
        const probe=window.__stageOneFeedback={events:[],tts:null};
        const originalPlay=HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play=function(){
          const match=this.src?.match(/\\/worm\\/(typing|correct|error)\\.mp3/);
          if(match){
            probe.events.push('play:'+match[1]);
            if(match[1]==='correct')this.addEventListener('ended',()=>probe.events.push('ended:correct'),{once:true,capture:true});
          }
          return originalPlay.call(this);
        };
        const nativeFetch=window.fetch.bind(window);
        window.fetch=async(url,init)=>{
          if(String(url)!=='/api/prep/tts')return nativeFetch(url,init);
          const payload=JSON.parse(String(init?.body||'{}'));
          probe.events.push('tts:'+payload.text);
          probe.tts=payload;
          const samples=new Int16Array(2400);
          for(let i=0;i<samples.length;i++)samples[i]=Math.round(600*Math.sin(2*Math.PI*440*i/24000));
          const pcm=btoa(String.fromCharCode(...new Uint8Array(samples.buffer)));
          const frame=JSON.stringify({type:'chunk',sampleRate:24000,pcm})+'\\n'+JSON.stringify({type:'end',stop:'complete'})+'\\n';
          return new Response(frame,{status:200,headers:{'content-type':'application/x-ndjson'}});
        };
      })()`);
      await fill('input[aria-label="当前缺失词"]','marlet');
      await key('Enter');
      await wait('document.querySelector(".vocabulary-game-feedback")?.textContent.includes("还不对")','第一阶段答错提示');
      await fill('input[aria-label="当前缺失词"]','market');
      await key('Enter');
      await wait('window.__stageOneFeedback.events.includes("ended:correct")','第一阶段原版答对 MP3 完整播完',10000);
      await wait('!!window.__stageOneFeedback.tts','第一阶段 TTS 原句请求',10000);
      await wait('document.body.innerText.includes("词汇准备完成")','第一阶段 TTS 播放完成后进入完成页',12000);
      const feedback=await js('window.__stageOneFeedback');
      const events=feedback.events;
      const correctStart=events.indexOf('play:correct'),correctEnd=events.indexOf('ended:correct'),ttsStart=events.indexOf('tts:'+workshopVocabularySynthetic[0].sentence);
      if(!events.includes('play:typing')||!events.includes('play:error')||correctStart<0||correctEnd<=correctStart||ttsStart<=correctEnd||feedback.tts.text!==workshopVocabularySynthetic[0].sentence||feedback.tts.language!=='en-US')throw new Error('第一阶段三种原版音效与整句 TTS 顺序错误: '+JSON.stringify(feedback));
      console.log('WORKSHOP_VOCABULARY_AUDIO_ELECTRON=PASS typingMp3=true errorMp3=true correctMp3EndedBeforeTts=true ttsFullOriginalSentence=true ttsLanguage=en-US ttsSyntheticPcmPlayback=true');
      await win.loadURL(service.webOrigin);
      await wait('!!document.querySelector(".global-nav-primary")','刷新后 Reader');
      await click('button[aria-label="Practice Lab"]');
      await wait('document.querySelector(".practice-workshop-mode-card:nth-child(1)")?.getAttribute("aria-pressed")==="true"','重新打开时记住上次玩法');
      await wait('!!document.querySelector(".practice-workshop-saved li")','重新打开第一阶段存档');
      await click('.practice-workshop-saved li button');
      await wait('document.querySelector(".practice-workshop-results input")?.value==="market"','恢复第一阶段内容');
      if(calls!==2)throw new Error('重新打开保存的练习重复调用了 AI');
      if(originalSaved!==await js('localStorage.getItem("vantilo:practice-workshop:v1")'))throw new Error('原第二阶段存档在刷新后被修改');
      console.log('WORKSHOP_INDEPENDENT_STAGES_ELECTRON=PASS firstVocabulary=1 secondAssembly=3 separateSaves=true standaloneStart=true sourceWordIPA=true reloadWithoutAI=true aiCalls=2');
      await js('window.confirm=()=>{throw new Error("Native confirm is forbidden for Workshop deletion")};true;');
      await click('.practice-workshop-saved-controls button:last-child');
      await wait('!!document.querySelector(".practice-workshop-delete-confirm")','嵌入式兼容的行内删除确认');
      if(JSON.parse(await js('localStorage.getItem("vantilo:practice-workshop-vocabulary:v1")')).items.length!==1)throw new Error('未确认时修改了词汇存档');
      await click('.practice-workshop-delete-confirm button:last-child');
      await wait('!document.querySelector(".practice-workshop-delete-confirm")','取消删除');
      await click('.practice-workshop-saved-controls button:last-child');
      await wait('!!document.querySelector(".practice-workshop-delete-confirm")','再次请求删除');
      await click('.practice-workshop-delete-confirm button:first-of-type');
      await wait('document.querySelectorAll(".practice-workshop-saved li").length===0','已确认删除目标词汇记录');
      const remaining=await js('JSON.parse(localStorage.getItem("vantilo:practice-workshop-vocabulary:v1")).items.length');
      if(remaining!==0||originalSaved!==await js('localStorage.getItem("vantilo:practice-workshop:v1")'))throw new Error('删除词汇时未保留独立句子组装存档');
      await win.loadURL(service.webOrigin);
      await wait('!!document.querySelector(".global-nav-primary")','删除后的 Reader 刷新');
      await click('button[aria-label="Practice Lab"]');
      await wait('document.querySelector(".practice-workshop-mode-card:nth-child(1)")?.getAttribute("aria-pressed")==="true"','恢复原文填词选择');
      await wait('document.body.innerText.includes("已保存的原文填词（0）")','删除后刷新仍为空');
      if(calls!==2)throw new Error('删除和刷新意外产生 AI 调用');
      console.log('WORKSHOP_INLINE_DELETE_ELECTRON=PASS nativeConfirmUnused=true cancelPreserves=true confirmRemoves=true survivesReload=true assemblyUnaffected=true noAiCalls=true');
    }

    console.log(`WORKSHOP_ISOLATED_ELECTRON=PASS generated=3 saved=3 reopened=3 unique_repeated=true ipa=true existing_game=true ${soundEvidence} aiCalls=1`);
    clearTimeout(deadline);win.destroy();await service.close();service=null;app.exit(0);return;
  }
  await clickText('电子书');await click('[data-testid^="book-card-"]');await clickText('精选阅读');await click(`[data-testid=${JSON.stringify(`book-lesson-${lesson.id}`)}]`);await click('button[aria-label="练习"]');
  await clickText('试验生成有序练习'); await fill('textarea[aria-label="英文短文"]',article); await clickText('生成练习');
  await wait('!!document.querySelector("[aria-label=有序练习试验] ol") || !!document.querySelector("[role=alert]")','生成结果',300000);
  const failure=await js('document.querySelector("[role=alert]")?.textContent || ""');if(failure)throw new Error(`生成失败: ${failure.slice(0,300)}`);
  const rows=await js('Array.from(document.querySelectorAll("[aria-label=有序练习试验] li")).map(li=>({sentence:li.querySelector("span").textContent,chinese:li.textContent.split(" — ").slice(1).join(" — ")}))');
  if(calls!==1 || !rows.length || (mode==='synthetic' && JSON.stringify(rows)!==JSON.stringify(synthetic)))throw new Error('调用次数或练习顺序不匹配');
  if(mode==='real') await fs.writeFile(path.join(process.env.VANTILO_TEST_RESULTS_ROOT,`ordered-${caseName}-parsed.json`),JSON.stringify({article,exercises:rows},null,2),{flag:'wx',mode:0o600});
  await clickText('开始逐词练习'); await wait('!!document.querySelector(".worm-game-words")','打字游戏');
  for(let i=0;i<rows.length;i++) {
    const item=rows[i], tokens=item.sentence.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu);
    await wait(`document.querySelector('.worm-game-meaning')?.textContent===${JSON.stringify(item.chinese)}`,`第 ${i+1} 条中文`);
    if(i===0 && mode==='synthetic') {
      await fill('input[data-word-index="0"]','z');await key('Enter');
      await wait('document.body.innerText.includes("正确的词已锁定")','错误反馈');
      await fill('input[data-word-index="0"]',tokens[0]);
    }
    for(let j=(i===0 && mode==='synthetic'?1:0);j<tokens.length;j++) await fill(`input[data-word-index="${j}"]`,tokens[j]);
    await key('Enter');await wait('!!document.querySelector(".worm-game-completion")',`第 ${i+1} 条完成`);
    await click('button[aria-label="下一项"]');
  }
  await wait('document.body.innerText.includes("句子组装完成")','练习完成');
  if(mode==='real') console.log(`ORDERED_REAL_EXERCISES=${JSON.stringify(rows)}`);
  console.log(`ORDERED_${mode.toUpperCase()}=PASS count=${rows.length} modelCalls=${calls} originalGame=true`);
  clearTimeout(deadline);win.destroy();await service.close();await runtime?.stop();app.exit(0);
})().catch(async error=>{
  const detail=redact(String(error.message||error)).slice(0,2000);
  console.error(`ORDERED_${String(mode).toUpperCase()}=FAIL ${detail.replace(/[\r\n]/g,' ')}`);
  try { await fs.writeFile(path.join(process.env.VANTILO_TEST_RESULTS_ROOT,`ordered-${caseName}-test-error.json`),JSON.stringify({caseName,article,error:detail,calls,rawResponseAvailable:Boolean(output)},null,2),{flag:'wx',mode:0o600}); } catch {}
  clearTimeout(deadline);win?.destroy();try{await service?.close();await runtime?.stop();}catch{}app.exit(1);
});
