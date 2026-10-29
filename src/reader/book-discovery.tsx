import React from 'react';
import { BOOK_CATEGORIES, CURATED_BOOKS_V01, ONLINE_CATEGORY_TOPICS, type CuratedBook } from './curated-books';
import type { GutenbergBook, GutenbergPage } from './gutenberg-adapter';
import './book-discovery.css';

type GeneratedIntro = {
  id: number; engine?:'custom'|'codex'; titleZh: string; introZh: string; highlightsZh: string;
  questionZh: string; readingNoteZh: string; evidenceQuote: string;
  sourceUrl: string; sourceScope: string; model: string; cached: boolean;
};

type IntroEngineChoice = {
  id:string; label:string; engine:'custom'|'codex'; modelId:string; effort:string|null;
};
const BOOK_INTRO_MODEL_KEY = 'vantilo-book-intro-model-v1';

export function BookDiscovery({ onBack, onOpenShelf }: { onBack: () => void; onOpenShelf: () => void }) {
  const [query,setQuery]=React.useState(''); const [category,setCategory]=React.useState('全部'); const [onlineQuery,setOnlineQuery]=React.useState('');
  const [online,setOnline]=React.useState<GutenbergPage|null>(null); const [onlineLoading,setOnlineLoading]=React.useState(false); const [onlineError,setOnlineError]=React.useState('');
  const [selected,setSelected]=React.useState<CuratedBook|GutenbergBook|null>(null); const [detail,setDetail]=React.useState<GutenbergBook|null>(null); const [detailError,setDetailError]=React.useState('');
  const [getting,setGetting]=React.useState(false); const [message,setMessage]=React.useState('');
  const [intro,setIntro]=React.useState<GeneratedIntro|null>(null);
  const [introBusy,setIntroBusy]=React.useState(false); const [introError,setIntroError]=React.useState('');
  const [introOptions,setIntroOptions]=React.useState<IntroEngineChoice[]>([]);
  const [introEngineId,setIntroEngineId]=React.useState('');
  const [introModelsBusy,setIntroModelsBusy]=React.useState(false);
  const [introModelsError,setIntroModelsError]=React.useState('');
  const currentIntroOption=React.useRef<IntroEngineChoice|null>(null);
  const activeBookId=React.useRef<number|null>(null);
  const cacheRevision=React.useRef(0);
  const modelsRevision=React.useRef(0);
  const generationRevision=React.useRef(0);

  React.useEffect(()=>{
    void refreshIntroOptions(null);
    return ()=>{++modelsRevision.current;++cacheRevision.current;++generationRevision.current;};
  },[]);

  async function refreshIntroOptions(bookId=activeBookId.current){
    const revision=++modelsRevision.current;
    setIntroModelsBusy(true);setIntroModelsError('');
    try{
      const response:{engines:IntroEngineChoice[];defaultId:string}=await window.vantilo!.requestGutenberg({operation:'introEngines'});
      if(revision!==modelsRevision.current)return;
      const choices=(Array.isArray(response.engines)?response.engines:[]).filter(
        item=>item&&typeof item.id==='string'&&typeof item.label==='string'&&
          (item.engine==='custom'||item.engine==='codex')&&typeof item.modelId==='string'
      );
      const previous=currentIntroOption.current?.id;
      let saved='';try{saved=window.localStorage.getItem(BOOK_INTRO_MODEL_KEY)||'';}catch{}
      const candidate=[previous,saved,response.defaultId,choices[0]?.id].find(id=>choices.some(item=>item.id===id));
      const option=choices.find(item=>item.id===candidate)||null;
      setIntroOptions(choices);currentIntroOption.current=option;setIntroEngineId(option?.id||'');
      if(previous!==option?.id){++cacheRevision.current;setIntro(null);}
      if(bookId!==null&&option)void loadIntroCache(bookId,option);
    }catch(error){
      if(revision===modelsRevision.current)setIntroModelsError(error instanceof Error?error.message:'读取模型列表失败');
    }finally{if(revision===modelsRevision.current)setIntroModelsBusy(false);}
  }
  async function loadIntroCache(id:number,option:IntroEngineChoice){
    const revision=++cacheRevision.current;
    const model=option.engine==='codex'?{modelId:option.modelId,reasoningEffort:option.effort}:{};
    try{
      const cached:GeneratedIntro|null=await window.vantilo!.requestGutenberg({operation:'introCached',id,engine:option.engine,...model});
      if(activeBookId.current===id&&currentIntroOption.current?.id===option.id&&revision===cacheRevision.current)setIntro(cached);
    }catch(error){
      if(activeBookId.current===id&&currentIntroOption.current?.id===option.id&&revision===cacheRevision.current)
        setIntroError(error instanceof Error?error.message:'读取介绍缓存失败');
    }
  }
  function changeIntroEngine(id:string){
    if(introBusy)return;
    const option=introOptions.find(item=>item.id===id);
    if(!option)return;
    currentIntroOption.current=option;setIntroEngineId(id);++cacheRevision.current;setIntro(null);setIntroError('');
    try{window.localStorage.setItem(BOOK_INTRO_MODEL_KEY,id);}catch{}
    if(activeBookId.current!==null)void loadIntroCache(activeBookId.current,option);
  }
  const curated=CURATED_BOOKS_V01.filter(book=>(category==='全部'||book.category===category)&&(!query.trim()||[book.titleZh,book.title,...book.tags,book.category,book.author].some(value=>value.toLowerCase().includes(query.trim().toLowerCase()))));
  async function loadOnline(page=1,term=onlineQuery,topic=ONLINE_CATEGORY_TOPICS[category]||''){setOnlineLoading(true);setOnlineError('');try{const result=await window.vantilo!.requestGutenberg({operation:'search',query:term,topic:topic||undefined,page});setOnline(result);}catch(error){setOnlineError(error instanceof Error?error.message:'在线书目暂不可用，请检查网络后重试。');setOnline(null);}finally{setOnlineLoading(false);}}
  async function showDetail(book:CuratedBook|GutenbergBook){
    if(activeBookId.current!==null&&introBusy)void window.vantilo!.requestGutenberg({operation:'introCancel',id:activeBookId.current}).catch(()=>{});
    ++generationRevision.current;++cacheRevision.current;
    activeBookId.current=book.id;
    setSelected(book);setDetailError('');setDetail(null);setMessage('');setIntro(null);setIntroError('');setIntroBusy(false);
    if(!('titleZh' in book))void refreshIntroOptions(book.id);
    try{const result=await window.vantilo!.requestGutenberg({operation:'detail',id:book.id});if(activeBookId.current===book.id)setDetail(result);}
    catch(error){if(activeBookId.current===book.id)setDetailError(error instanceof Error?error.message:'暂时无法加载 Gutenberg 书目详情。');}
  }
  function closeDetail(){
    ++modelsRevision.current;++cacheRevision.current;++generationRevision.current;
    const id=activeBookId.current;activeBookId.current=null;
    if(id!==null&&introBusy)void window.vantilo!.requestGutenberg({operation:'introCancel',id}).catch(()=>{});
    setSelected(null);setDetail(null);setIntro(null);setIntroBusy(false);setIntroError('');
  }
  async function generateIntro(force=false){
    if(!selected||'titleZh'in selected||introBusy)return;
    const option=currentIntroOption.current;
    if(!option){setIntroError('请先选择可用的中文介绍模型');return;}
    const id=selected.id;const revision=++generationRevision.current;++cacheRevision.current;
    setIntroBusy(true);setIntroError('');
    const model=option.engine==='codex'?{modelId:option.modelId,reasoningEffort:option.effort}:{};
    try{
      const result=await window.vantilo!.requestGutenberg({operation:'intro',id,engine:option.engine,force,...model});
      if(activeBookId.current===id&&currentIntroOption.current?.id===option.id&&revision===generationRevision.current)setIntro(result);
    }catch(error){
      if(activeBookId.current===id&&currentIntroOption.current?.id===option.id&&revision===generationRevision.current)
        setIntroError(error instanceof Error?error.message:'中文介绍生成失败，请检查所选模型');
    }finally{
      if(activeBookId.current===id&&currentIntroOption.current?.id===option.id&&revision===generationRevision.current)setIntroBusy(false);
    }
  }
  function cancelIntro(){
    ++generationRevision.current;
    if(activeBookId.current!==null)void window.vantilo!.requestGutenberg({operation:'introCancel',id:activeBookId.current}).catch(()=>{});
    setIntroBusy(false);setIntroError('已取消本次生成');
  }
  const selectedCurated=selected&&'titleZh'in selected?selected:null;
  const selectedOnline=selected&&!('titleZh'in selected)?selected:null;
  async function acquire(){if(!detail?.epubUrl)return;setGetting(true);setMessage('正在从 Project Gutenberg 获取 EPUB 并校验…');try{const result=await window.vantilo!.requestGutenberg({operation:'acquire',id:detail.id,filename:detail.title,categoryId:'uncategorized'});setMessage(result.status==='duplicate'?'这本书已在书架中。':`已加入书架：《${result.title}》`);}catch(error){setMessage(error instanceof Error?error.message:'获取失败；你可以打开官方页面后通过书架导入。');}finally{setGetting(false);}}
  return <div className="book-discovery">
    <header className="discovery-top"><button onClick={onBack}>← 返回书架</button><div><span>VANTILO · READER</span><h1>发现好书</h1><p>中文发现兴趣，英文阅读原著，AI 辅助理解</p></div><button onClick={onOpenShelf}>我的书架</button></header>
    <section className="discovery-search"><label htmlFor="curated-search">中文书名、英文书名或兴趣标签</label><div><input id="curated-search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="试试：荒野、侦探、友谊……"/><span>{curated.length} 本精选</span></div></section>
    <nav className="discovery-categories" aria-label="中文题材分类">{BOOK_CATEGORIES.map(item=><button key={item} className={item===category?'selected':''} onClick={()=>setCategory(item)}>{item}</button>)}</nav>
    <section className="discovery-section"><div className="discovery-section-heading"><div><span>编辑精选 · 青少年阅读</span><h2>从一段好故事开始</h2></div><small>中文简介与难度为 Vantilo 编辑指引</small></div>
      <div className="discovery-grid">{curated.map(book=><article className="discovery-card" key={book.id}>
        <button className="discovery-cover" onClick={()=>void showDetail(book)} aria-label={`查看《${book.titleZh}》详情`}><img src={`https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}.cover.medium.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.hidden=true;}}/><b>{book.titleZh.slice(0,1)}</b><small>PROJECT GUTENBERG</small></button>
        <div className="discovery-card-copy"><span className="discovery-tag">{book.category}</span><h3>{book.titleZh}</h3><p className="discovery-en-title">{book.title}</p><p className="discovery-author">{book.author}</p><p className="discovery-intro">{book.card}</p><div className="discovery-tags">{book.tags.map(tag=><span key={tag}>{tag}</span>)}</div><div className="discovery-meta"><span>{book.difficulty} · 编辑相对判断</span><button onClick={()=>void showDetail(book)}>查看详情 →</button></div></div>
      </article>)}{!curated.length&&<p className="discovery-empty">没有匹配的精选书籍，试试其他关键词或题材。</p>}</div>
    </section>
    <section className="online-catalog"><div className="discovery-section-heading"><div><span>Project Gutenberg · 官方 OPDS（Gutendex 备用）</span><h2>在线英文书目</h2></div><small>支持英文书名、作者搜索；选择上方题材时会追加对应英文关键词，按相关性匹配。</small></div>
      <form onSubmit={event=>{event.preventDefault();void loadOnline(1);}}><input aria-label="在线英文书名或作者" value={onlineQuery} onChange={event=>setOnlineQuery(event.target.value)} placeholder="Search title or author in English"/><button disabled={onlineLoading}>搜索在线书目</button></form>
      {onlineError&&<div role="alert" className="discovery-error">{onlineError} <button onClick={()=>void loadOnline()}>重试</button></div>}
      {onlineLoading&&<p role="status">正在加载在线书目…</p>}
      {online&&<><div className="online-results">{online.books.map(book=><button className="online-row" key={book.id} onClick={()=>void showDetail(book)}><span className="online-placeholder">{book.title.slice(0,1)}<img src={`https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}.cover.medium.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.hidden=true;}}/></span><span><b>{book.title}</b><small>{book.authors.join('、')||'作者不详'} · {book.epubUrl?'提供 EPUB':'点详情查看格式'}</small></span><span>详情 →</span></button>)}</div><div className="online-pages"><button disabled={!online.previous||onlineLoading} onClick={()=>void loadOnline(online.previous!)}>上一页</button><span>本页 {online.books.length} 本</span><button disabled={!online.next||onlineLoading} onClick={()=>void loadOnline(online.next!)}>下一页</button></div></>}
    </section>
    {selected&&<div className="discovery-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)closeDetail();}}><section className="discovery-modal" role="dialog" aria-modal="true" aria-labelledby="discovery-modal-title"><button className="discovery-modal-close" aria-label="关闭" onClick={closeDetail}>×</button>
      <span className="discovery-tag">{selectedCurated?.category||'Project Gutenberg'}</span><h2 id="discovery-modal-title">{selectedCurated?.titleZh||intro?.titleZh||detail?.title||selectedOnline?.title||'书籍详情'}</h2>{(selectedCurated||intro?.titleZh)&&<p className="discovery-en-title">{selectedCurated?.title||detail?.title||selectedOnline?.title}</p>}<p className="discovery-author">{selectedCurated?.author||detail?.authors.join('、')||selectedOnline?.authors.join('、')}</p>
      {selectedCurated&&<div className="discovery-detail-copy"><h3>故事介绍</h3><p>{selectedCurated.story}</p><h3>阅读看点</h3><p>{selectedCurated.highlights}</p><h3>阅读收获</h3><p>{selectedCurated.takeaway}</p><h3>英文阅读提醒</h3><p>{selectedCurated.english}</p><p className="discovery-difficulty"><b>阅读难度：</b>{selectedCurated.difficulty}（编辑相对判断，不是正式分级）</p></div>}
      {!selectedCurated&&<div className="discovery-generated">
        <div className="discovery-model-row">
          <label className="discovery-model-select"><span>中文介绍模型</span>
            <select aria-label="中文介绍模型" value={introEngineId} disabled={introBusy||introModelsBusy||!introOptions.length} onChange={event=>changeIntroEngine(event.target.value)}>
              {!introOptions.length&&<option value="">{introModelsBusy?'正在加载模型…':'暂无可用模型，请在设置中配置 API 或登录 ChatGPT'}</option>}
              {introOptions.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <button type="button" className="discovery-model-refresh" onClick={()=>void refreshIntroOptions()} disabled={introBusy||introModelsBusy}>刷新模型</button>
        </div>
        {introModelsError&&<p role="status" className="discovery-error">加载中文介绍模型失败：{introModelsError}</p>}
        {intro?<><h3>故事介绍（基于原著开头）</h3><p>{intro.introZh}</p><h3>阅读看点</h3><p>{intro.highlightsZh}</p><h3>值得思考</h3><p>{intro.questionZh}</p><h3>英文阅读提醒</h3><p>{intro.readingNoteZh}</p><small>来源：<a href={intro.sourceUrl} target="_blank" rel="noreferrer">Project Gutenberg 原著 TXT</a> · {intro.sourceScope} · {intro.model} · {intro.cached?'已缓存':'本次生成'}。AI 内容可能有误，请以原著为准。</small><div className="discovery-generate-actions"><button type="button" disabled={introBusy||!introEngineId} onClick={()=>void generateIntro(true)}>{introBusy?'正在重新生成…':'用当前模型重新生成'}</button>{introBusy&&<button type="button" onClick={cancelIntro}>取消生成</button>}</div>{introError&&<p role="alert" className="discovery-error">{introError}</p>}</>:<><p>可根据 Gutenberg 原著开头节选生成中文介绍；未读取到可靠原文时不会编造剧情。</p><div className="discovery-generate-actions"><button type="button" disabled={introBusy||!introEngineId} onClick={()=>void generateIntro()}>{introBusy?'正在读取原文并生成…':'生成中文介绍'}</button>{introBusy&&<button type="button" onClick={cancelIntro}>取消生成</button>}</div>{introError&&<p role="alert" className="discovery-error">{introError}</p>}</>}
      </div>}
      {detailError&&<p className="discovery-error" role="alert">{detailError} <button onClick={()=>selected&&void showDetail(selected)}>重试</button></p>}
      {detail&&<><p><b>Gutenberg ID：</b>{detail.id} · {detail.formats.join('、')||'未列出 EPUB'}</p><p><b>题材：</b>{(selectedCurated?[selectedCurated.category,...selectedCurated.tags]:[...detail.bookshelves,...detail.subjects]).filter((value,index,values)=>values.indexOf(value)===index).slice(0,6).join('、')||'暂无分类'}</p>{detail.downloadCount>0&&<p><b>下载量：</b>{detail.downloadCount.toLocaleString()}</p>}<p><a href={detail.sourceUrl} target="_blank" rel="noreferrer">Project Gutenberg 官方书目页面 ↗</a></p>
        {detail.epubUrl?<div className="discovery-acquire"><button disabled={getting} onClick={()=>void acquire()}>{getting?'正在获取…':'获取 EPUB 并加入书架'}</button><a href={detail.sourceUrl} target="_blank" rel="noreferrer">或打开官方下载页面</a>{message&&<p role="status">{message}</p>}</div>:<p>该书目前没有可识别的 EPUB。可在官方页面查看其他格式。</p>}</>}
    </section></div>}
  </div>;
}
