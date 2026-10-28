import React from 'react';
import { BOOK_CATEGORIES, CURATED_BOOKS_V01, type CuratedBook } from './curated-books';
import type { GutenbergBook, GutenbergPage } from './gutenberg-adapter';
import './book-discovery.css';

export function BookDiscovery({ onBack, onOpenShelf }: { onBack: () => void; onOpenShelf: () => void }) {
  const [query,setQuery]=React.useState(''); const [category,setCategory]=React.useState('全部'); const [onlineQuery,setOnlineQuery]=React.useState('');
  const [online,setOnline]=React.useState<GutenbergPage|null>(null); const [onlineLoading,setOnlineLoading]=React.useState(false); const [onlineError,setOnlineError]=React.useState('');
  const [selected,setSelected]=React.useState<CuratedBook|GutenbergBook|null>(null); const [detail,setDetail]=React.useState<GutenbergBook|null>(null); const [detailError,setDetailError]=React.useState('');
  const [getting,setGetting]=React.useState(false); const [message,setMessage]=React.useState('');
  const curated=CURATED_BOOKS_V01.filter(book=>(category==='全部'||book.category===category)&&(!query.trim()||[book.titleZh,book.title,...book.tags,book.category,book.author].some(value=>value.toLowerCase().includes(query.trim().toLowerCase()))));
  async function loadOnline(page=1,term=onlineQuery,topic=category==='全部'?'':category){setOnlineLoading(true);setOnlineError('');try{const result=await window.vantilo!.requestGutenberg({operation:'search',query:term,topic:topic||undefined,page});setOnline(result);}catch(error){setOnlineError(error instanceof Error?error.message:'在线书目暂不可用，请检查网络后重试。');setOnline(null);}finally{setOnlineLoading(false);}}
  async function showDetail(book:CuratedBook|GutenbergBook){setSelected(book);setDetailError('');setDetail(null);setMessage('');if('titleZh'in book){try{setDetail(await window.vantilo!.requestGutenberg({operation:'detail',id:book.id}));}catch(error){setDetailError(error instanceof Error?error.message:'暂时无法加载 Gutenberg 书目详情。');}}else setDetail(book);}
  const selectedCurated=selected&&'titleZh'in selected?selected:null;
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
    <section className="online-catalog"><div className="discovery-section-heading"><div><span>Project Gutenberg · Gutendex</span><h2>在线英文书目</h2></div><small>中文检索仅覆盖上方精选目录；这里支持英文书名和作者搜索。</small></div>
      <form onSubmit={event=>{event.preventDefault();void loadOnline(1);}}><input aria-label="在线英文书名或作者" value={onlineQuery} onChange={event=>setOnlineQuery(event.target.value)} placeholder="Search title or author in English"/><button disabled={onlineLoading}>搜索在线书目</button></form>
      {onlineError&&<div role="alert" className="discovery-error">{onlineError} <button onClick={()=>void loadOnline()}>重试</button></div>}
      {onlineLoading&&<p role="status">正在加载在线书目…</p>}
      {online&&<><div className="online-results">{online.books.map(book=><button className="online-row" key={book.id} onClick={()=>void showDetail(book)}><span className="online-placeholder">{book.title.slice(0,1)}<img src={`https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}.cover.medium.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.hidden=true;}}/></span><span><b>{book.title}</b><small>{book.authors.join('、')||'作者不详'} · {book.epubUrl?'提供 EPUB':'无可识别 EPUB'}</small></span><span>详情 →</span></button>)}</div><div className="online-pages"><button disabled={!online.previous||onlineLoading} onClick={()=>void loadOnline(online.previous!)}>上一页</button><span>约 {online.count.toLocaleString()} 条书目</span><button disabled={!online.next||onlineLoading} onClick={()=>void loadOnline(online.next!)}>下一页</button></div></>}
    </section>
    {selected&&<div className="discovery-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget){setSelected(null);setDetail(null);}}}><section className="discovery-modal" role="dialog" aria-modal="true" aria-labelledby="discovery-modal-title"><button className="discovery-modal-close" aria-label="关闭" onClick={()=>{setSelected(null);setDetail(null);}}>×</button>
      <span className="discovery-tag">{selectedCurated?.category||'Project Gutenberg'}</span><h2 id="discovery-modal-title">{selectedCurated?.titleZh||detail?.title||'书籍详情'}</h2><p className="discovery-en-title">{selectedCurated?.title||detail?.title}</p><p className="discovery-author">{selectedCurated?.author||detail?.authors.join('、')}</p>
      {selectedCurated&&<div className="discovery-detail-copy"><h3>故事介绍</h3><p>{selectedCurated.story}</p><h3>阅读看点</h3><p>{selectedCurated.highlights}</p><h3>阅读收获</h3><p>{selectedCurated.takeaway}</p><h3>英文阅读提醒</h3><p>{selectedCurated.english}</p><p className="discovery-difficulty"><b>阅读难度：</b>{selectedCurated.difficulty}（编辑相对判断，不是正式分级）</p></div>}
      {!selectedCurated&&<p>此书来自 Project Gutenberg 公共领域书目。故事内容请以原著为准。</p>}
      {detailError&&<p className="discovery-error" role="alert">{detailError} <button onClick={()=>selected&&void showDetail(selected)}>重试</button></p>}
      {detail&&<><p><b>Gutenberg ID：</b>{detail.id} · {detail.formats.join('、')||'未列出 EPUB'}</p><p><b>题材：</b>{[...detail.bookshelves,...detail.subjects].slice(0,6).join('、')||'暂无分类'}</p>{detail.downloadCount>0&&<p><b>下载量：</b>{detail.downloadCount.toLocaleString()}</p>}<p><a href={detail.sourceUrl} target="_blank" rel="noreferrer">Project Gutenberg 官方书目页面 ↗</a></p>
        {detail.epubUrl?<div className="discovery-acquire"><button disabled={getting} onClick={()=>void acquire()}>{getting?'正在获取…':'获取 EPUB 并加入书架'}</button><a href={detail.sourceUrl} target="_blank" rel="noreferrer">或打开官方下载页面</a>{message&&<p role="status">{message}</p>}</div>:<p>该书目前没有可识别的 EPUB。可在官方页面查看其他格式。</p>}</>}
    </section></div>}
  </div>;
}
