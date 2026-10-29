// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BookDiscovery } from '../src/reader/book-discovery';
import { CURATED_BOOKS_V01, ONLINE_CATEGORY_TOPICS } from '../src/reader/curated-books';

const testStorage = new Map<string,string>();
beforeEach(()=>{
  testStorage.clear();
  Object.defineProperty(window,'localStorage',{configurable:true,value:{
    getItem:(key:string)=>testStorage.get(key)??null,
    setItem:(key:string,value:string)=>{testStorage.set(key,String(value));},
    removeItem:(key:string)=>{testStorage.delete(key);},
    clear:()=>testStorage.clear()
  }});
});
afterEach(cleanup);

const introCatalog = {
  defaultId: 'custom-api:aaaaaaaaaaaa',
  engines: [
    {id:'custom-api:aaaaaaaaaaaa',label:'自定义 API · Local Qwen / qwen3.5-4b',engine:'custom',modelId:'qwen3.5-4b',effort:null},
    {id:'codex:gpt-7-test',label:'Codex / ChatGPT · GPT-7 Test',engine:'codex',modelId:'gpt-7-test',effort:'high'},
    {id:'codex:gpt-8-next',label:'Codex / ChatGPT · GPT-8 Next',engine:'codex',modelId:'gpt-8-next',effort:'medium'}
  ]
};


it('shows the first three requested real Gutenberg books and Chinese title/tag filters', () => {
  const api = { requestGutenberg: vi.fn().mockRejectedValue(new Error('offline')) };
  Object.defineProperty(window, 'vantilo', { value: api, configurable: true });
  render(<BookDiscovery onBack={() => {}} onOpenShelf={() => {}} />);
  for (const title of ['野性的呼唤', '时间机器', '金银岛']) expect(screen.getByText(title)).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/中文书名/), { target: { value: '荒野' } });
  expect(screen.getByText('野性的呼唤')).toBeTruthy();
  expect(screen.queryByText('金银岛')).toBeNull();
  fireEvent.change(screen.getByLabelText(/中文书名/), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '科幻' }));
  expect(screen.getByText('时间机器')).toBeTruthy();
  expect(CURATED_BOOKS_V01).toHaveLength(19);
});

it('renders online catalog failures as retryable UI without losing curated books', async () => {
  Object.defineProperty(window, 'vantilo', {
    value: { requestGutenberg: vi.fn().mockRejectedValue(new Error('network down')) }, configurable: true
  });
  render(<BookDiscovery onBack={() => {}} onOpenShelf={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '搜索在线书目' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('野性的呼唤')).toBeTruthy();
  expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
});

it('provides distinct, complete editorial copy for every curated title', () => {
  expect(CURATED_BOOKS_V01).toHaveLength(19);
  for (const book of CURATED_BOOKS_V01) {
    expect(book.card.length, book.titleZh + ' card').toBeGreaterThanOrEqual(100);
    expect(book.card.length, book.titleZh + ' card').toBeLessThanOrEqual(160);
    const full = [book.story, book.highlights, book.takeaway, book.english].join('');
    expect(full.length, book.titleZh + ' detail').toBeGreaterThanOrEqual(250);
    expect(full.length, book.titleZh + ' detail').toBeLessThanOrEqual(400);
    expect(book.card).not.toBe(book.story);
    for (const part of [book.story, book.highlights, book.takeaway, book.english]) expect(part.trim().length).toBeGreaterThan(20);
  }
});

it('maps Chinese categories to English terms for online catalog search', async () => {
  expect(ONLINE_CATEGORY_TOPICS['科幻']).toBe('science fiction');
  const api = { requestGutenberg: vi.fn().mockResolvedValue({ count: 0, next: null, previous: null, books: [] }) };
  Object.defineProperty(window, 'vantilo', { value: api, configurable: true });
  render(<BookDiscovery onBack={() => {}} onOpenShelf={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '科幻' }));
  fireEvent.change(screen.getByLabelText('在线英文书名或作者'), { target: { value: 'time' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索在线书目' }));
  await waitFor(() => expect(api.requestGutenberg).toHaveBeenCalledWith({
    operation: 'search', query: 'time', topic: 'science fiction', page: 1
  }));
});

it('loads the official detail when an online search result is selected', async () => {
  const searchBook = {
    id: 215, title: 'The Call of the Wild', authors: ['Jack London'], subjects: [], bookshelves: [],
    languages: ['en'], downloadCount: 0, formats: [], epubUrl: null, coverUrl: null,
    sourceUrl: 'https://www.gutenberg.org/ebooks/215'
  };
  const detail = {
    ...searchBook, authors: ['London, Jack'], subjects: ['Adventure stories'],
    formats: ['application/epub+zip'], epubUrl: 'https://www.gutenberg.org/ebooks/215.epub3.images'
  };
  const api = {
    requestGutenberg: vi.fn(async (request: any) => request.operation === 'search'
      ? { count: 1, next: null, previous: null, books: [searchBook] }
      : request.operation === 'detail' ? detail : { status: 'imported', title: detail.title })
  };
  Object.defineProperty(window, 'vantilo', { value: api, configurable: true });
  render(<BookDiscovery onBack={() => {}} onOpenShelf={() => {}} />);
  fireEvent.change(screen.getByLabelText('在线英文书名或作者'), { target: { value: 'wild' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索在线书目' }));
  fireEvent.click(await screen.findByRole('button', { name: /The Call of the Wild/ }));
  expect(await screen.findByRole('button', { name: '获取 EPUB 并加入书架' })).toBeTruthy();
  expect(screen.getByText(/Adventure stories/)).toBeTruthy();
  expect(api.requestGutenberg).toHaveBeenCalledWith({ operation: 'detail', id: 215 });
});

it('shows curated Chinese category and tags even if official metadata has no subjects', async () => {
  const detail = {
    id: 215, title: 'The call of the wild', authors: ['London, Jack'], subjects: [], bookshelves: [],
    languages: ['en'], downloadCount: 0, formats: ['application/epub+zip'],
    epubUrl: 'https://www.gutenberg.org/ebooks/215.epub3.images', coverUrl: null,
    sourceUrl: 'https://www.gutenberg.org/ebooks/215'
  };
  Object.defineProperty(window, 'vantilo', {
    value: { requestGutenberg: vi.fn().mockResolvedValue(detail) }, configurable: true
  });
  render(<BookDiscovery onBack={() => {}} onOpenShelf={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '查看《野性的呼唤》详情' }));
  await waitFor(() => expect(document.querySelector('.discovery-modal')?.textContent).toContain('题材：冒险与生存、荒野、动物、生存'));
});
it('generates an on-demand Chinese recommendation from the existing API without touching curated copy', async () => {
  const onlineBook = { id: 174, title: 'The Picture of Dorian Gray', authors: ['Oscar Wilde'],
    subjects: ['Fiction'], bookshelves: [], languages: ['en'], downloadCount: 0,
    formats: ['application/epub+zip'], epubUrl: 'https://www.gutenberg.org/ebooks/174.epub3.images',
    coverUrl: null, sourceUrl: 'https://www.gutenberg.org/ebooks/174' };
  const generated = { id: 174, titleZh: '道林·格雷的画像',
    introZh: '一名年轻人发现画像牵动了自己的命运，故事从一场有关青春与美的交谈展开。',
    highlightsZh: '通过人物对话制造不安', questionZh: '为什么人会执着于青春？',
    readingNoteZh: '留意旧式文学表达', evidenceQuote: 'sample original passage',
    sourceUrl: 'https://www.gutenberg.org/cache/epub/174/pg174.txt',
    sourceScope: '原著开头节选', model: 'qwen3.5-4b', cached: false };
  const api = { requestGutenberg: vi.fn(async (request: any) =>
    request.operation === 'introEngines' ? introCatalog
      : request.operation === 'search' ? { count: 1, next: null, previous: null, books: [onlineBook] }
      : request.operation === 'detail' ? onlineBook
      : request.operation === 'introCached' ? null
      : request.operation === 'intro' ? generated : null) };
  Object.defineProperty(window, 'vantilo', { value: api, configurable: true });
  render(<BookDiscovery onBack={() => {}} onOpenShelf={() => {}} />);
  fireEvent.change(screen.getByLabelText('在线英文书名或作者'), { target: { value: 'dorian' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索在线书目' }));
  fireEvent.click(await screen.findByRole('button', { name: /The Picture of Dorian Gray/ }));
  expect(await screen.findByRole('button', { name: '生成中文介绍' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '生成中文介绍' }));
  expect(await screen.findByText('道林·格雷的画像')).toBeTruthy();
  expect(screen.getByText(/基于原著开头/)).toBeTruthy();
  expect(document.querySelector('.discovery-generated small')?.textContent).toContain('qwen3.5-4b');
  expect(api.requestGutenberg).toHaveBeenCalledWith({ operation: 'intro', id: 174, engine: 'custom', force: false });
});

it('loads a cached Chinese introduction without regenerating', async () => {
  const onlineBook = { id: 174, title: 'The Picture of Dorian Gray', authors: ['Oscar Wilde'],
    subjects: [], bookshelves: [], languages: ['en'], downloadCount: 0, formats: [],
    epubUrl: null, coverUrl: null, sourceUrl: 'https://www.gutenberg.org/ebooks/174' };
  const cached = { id: 174, titleZh: '道林·格雷的画像', introZh: '这是已经缓存的中文介绍。',
    highlightsZh: '已有看点', questionZh: '已有问题', readingNoteZh: '已有提醒',
    sourceUrl: 'https://www.gutenberg.org/cache/epub/174/pg174.txt',
    sourceScope: '原著开头节选', model: 'qwen3.5-4b', cached: true };
  const api = { requestGutenberg: vi.fn(async (request: any) => request.operation === 'introEngines' ? introCatalog
    : request.operation === 'search'
    ? { count: 1, next: null, previous: null, books: [onlineBook] }
    : request.operation === 'detail' ? onlineBook : request.operation === 'introCached' ? cached : null) };
  Object.defineProperty(window, 'vantilo', { value: api, configurable: true });
  render(<BookDiscovery onBack={() => {}} onOpenShelf={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '搜索在线书目' }));
  fireEvent.click(await screen.findByRole('button', { name: /The Picture of Dorian Gray/ }));
  expect(await screen.findByText('道林·格雷的画像')).toBeTruthy();
  expect(screen.getByText(/已缓存/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '生成中文介绍' })).toBeNull();
  expect(api.requestGutenberg).not.toHaveBeenCalledWith({ operation: 'intro', id: 174 });
});

it('selects any Codex catalog model independently, remembers the selection, and isolates both engines', async () => {
  const book = { id:174, title:'The Picture of Dorian Gray', authors:['Oscar Wilde'], subjects:[], bookshelves:[], languages:['en'], downloadCount:0, formats:[], epubUrl:null, coverUrl:null, sourceUrl:'https://www.gutenberg.org/ebooks/174' };
  const qwen = { id:174, titleZh:'道林·格雷的画像', introZh:'Qwen 的旧介绍', highlightsZh:'Qwen 看点', questionZh:'Qwen 问题', readingNoteZh:'Qwen 提醒', sourceUrl:'https://www.gutenberg.org/cache/epub/174/pg174.txt', sourceScope:'原著开头节选', model:'qwen3.5-4b', cached:true };
  const codex = (modelId:string) => ({...qwen,introZh:'Codex '+modelId+' 的新介绍',model:modelId,engine:'codex',cached:false});
  const api = { requestGutenberg:vi.fn(async (request:any) => request.operation==='introEngines'?introCatalog:request.operation==='search'?{count:1,next:null,previous:null,books:[book]}:request.operation==='detail'?book:request.operation==='introCached'?(request.engine==='codex'?null:qwen):request.operation==='intro'?codex(request.modelId):null) };
  Object.defineProperty(window, 'vantilo', { value: api, configurable:true });
  render(<BookDiscovery onBack={()=>{}} onOpenShelf={()=>{}} />);
  fireEvent.click(screen.getByRole('button',{name:'搜索在线书目'}));
  fireEvent.click(await screen.findByRole('button',{name:/The Picture of Dorian Gray/}));
  expect(await screen.findByText('Qwen 的旧介绍')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox',{name:'中文介绍模型'}),{target:{value:'codex:gpt-7-test'}});
  expect(await screen.findByRole('button',{name:'生成中文介绍'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'生成中文介绍'}));
  expect(await screen.findByText('Codex gpt-7-test 的新介绍')).toBeTruthy();
  expect(api.requestGutenberg).toHaveBeenCalledWith({ operation:'intro', id:174, engine:'codex', force:false, modelId:'gpt-7-test', reasoningEffort:'high' });
  fireEvent.click(screen.getByRole('button',{name:'用当前模型重新生成'}));
  await waitFor(()=>expect(api.requestGutenberg).toHaveBeenCalledWith({operation:'intro',id:174,engine:'codex',force:true,modelId:'gpt-7-test',reasoningEffort:'high'}));
  fireEvent.change(screen.getByRole('combobox',{name:'中文介绍模型'}),{target:{value:'codex:gpt-8-next'}});
  expect(await screen.findByRole('button',{name:'生成中文介绍'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'生成中文介绍'}));
  expect(await screen.findByText('Codex gpt-8-next 的新介绍')).toBeTruthy();
  expect(api.requestGutenberg).toHaveBeenCalledWith({operation:'intro',id:174,engine:'codex',force:false,modelId:'gpt-8-next',reasoningEffort:'medium'});
  expect(window.localStorage.getItem('vantilo-book-intro-model-v1')).toBe('codex:gpt-8-next');
  fireEvent.change(screen.getByRole('combobox',{name:'中文介绍模型'}),{target:{value:'custom-api:aaaaaaaaaaaa'}});
  expect(await screen.findByText('Qwen 的旧介绍')).toBeTruthy();
});
