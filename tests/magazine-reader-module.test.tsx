// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isReaderAppearance, MagazineReaderModule } from '../src/ui/magazine-reader-module';

afterEach(cleanup);

it('accepts global font sizes down to 12px and rejects values below the supported range', () => {
  const base = { theme: 'paper', fontSize: 12, fontFamily: 'serif' };
  expect(isReaderAppearance(base)).toBe(true);
  expect(isReaderAppearance({ ...base, fontSize: 11 })).toBe(false);
});

describe('MagazineReaderModule', () => {
  it('loads only the fixed local Reader origin after startup succeeds', () => {
    const props = { error: null, onRetry: vi.fn(), onBack: vi.fn() };
    const { rerender } = render(<MagazineReaderModule status="starting" {...props} />);
    expect(screen.queryByTitle('Magazine Reader')).toBeNull();

    rerender(<MagazineReaderModule status="ready" {...props} />);
    const frame = screen.getByTitle('Magazine Reader') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('http://127.0.0.1:5175/');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation');
    // Only the fixed localhost Reader source may play game audio or copy user-requested text.
    expect(frame.getAttribute('allow')).toBe("autoplay 'src'; clipboard-write 'src'");
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('offers retry without obsolete toolbar actions', () => {
    const onRetry=vi.fn();
    render(<MagazineReaderModule status="error" error="端口 5175 被占用" onRetry={onRetry} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button',{name:'重试'}));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button',{name:'返回 Agent'})).toBeNull();
  });});
it('preserves the mounted Reader iframe when returning to the Agent',()=>{
  const props={status:'ready' as const,error:null,onRetry:vi.fn(),onBack:vi.fn()};
  const {rerender}=render(<MagazineReaderModule {...props} visible={true}/>);
  const frame=screen.getByTitle('Magazine Reader');
  rerender(<MagazineReaderModule {...props} visible={false}/>);
  expect(screen.getByTitle('Magazine Reader')).toBe(frame);
  expect(frame.closest('.magazine-reader-module')?.hasAttribute('hidden')).toBe(true);
  rerender(<MagazineReaderModule {...props} visible={true}/>);
  expect(screen.getByTitle('Magazine Reader')).toBe(frame);
  expect(frame.closest('.magazine-reader-module')?.hasAttribute('hidden')).toBe(false);
});

it('accepts environment setup only from its fixed Reader frame',()=>{
 const onSetup=vi.fn();render(<MagazineReaderModule status="ready" error={null} onRetry={vi.fn()} onBack={vi.fn()} onSetup={onSetup} navigationRequest={{target:'settings',sequence:1}}/>);
 const frame=screen.getByTitle('Magazine Reader') as HTMLIFrameElement;
 const post=vi.spyOn(frame.contentWindow!,'postMessage');fireEvent.load(frame);
 expect(post).toHaveBeenCalledWith({type:'vantilo:navigate',target:'settings'},'http://127.0.0.1:5175');
 for(const [origin,source]of [['https://evil.test',frame.contentWindow],['http://127.0.0.1:5175',window]] as const)window.dispatchEvent(new MessageEvent('message',{origin,source,data:{type:'vantilo:open-environment-settings'}}));
 expect(onSetup).not.toHaveBeenCalled();
 window.dispatchEvent(new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow,data:{type:'vantilo:open-environment-settings'}}));expect(onSetup).toHaveBeenCalledOnce();
 expect(screen.queryByRole('button',{name:'检查更新'})).toBeNull();
});

it('synchronizes only valid appearance settings from the Reader frame',()=>{
 const onAppearanceChange=vi.fn();
 render(<MagazineReaderModule status="ready" error={null} onRetry={vi.fn()} onBack={vi.fn()} onAppearanceChange={onAppearanceChange}/>);
 const frame=screen.getByTitle('Magazine Reader') as HTMLIFrameElement;
 const data={type:'vantilo:reader-appearance',theme:'blue',fontSize:20,fontFamily:'sans'};
 window.dispatchEvent(new MessageEvent('message',{origin:'https://evil.test',source:frame.contentWindow,data}));
 window.dispatchEvent(new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:window,data}));
 window.dispatchEvent(new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow,data:{...data,fontSize:999}}));
 expect(onAppearanceChange).not.toHaveBeenCalled();
 window.dispatchEvent(new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow,data}));
 expect(onAppearanceChange).toHaveBeenCalledExactlyOnceWith({theme:'blue',fontSize:20,fontFamily:'sans'});
});

it('accepts audiobook state only from the connected Reader and scopes controls to its session', () => {
  const target = document.createElement('div');
  document.body.append(target);
  const onShowReader = vi.fn();
  const view = render(<MagazineReaderModule status="ready" error={null} onRetry={vi.fn()} onBack={vi.fn()}
    audiobookTarget={target} onShowReader={onShowReader} />);
  try {
    const frame = screen.getByTitle('Magazine Reader') as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
    fireEvent.load(frame);
    const { token } = post.mock.calls.find(([data]) => data.type === 'vantilo:audiobook-connect')![0];
    const snapshot = { sessionId: 7, mode: 'original', sourceId: 'book:sample', title: '听书测试', chapterId: 'one',
      chapters: [{ id: 'one', title: '第一章' }], phase: 'paused', paragraphIndex: 1,
      paragraphCount: 5, paragraphNumber: 2, progressPercent: 18, progressScope: 'book' as const,
      error: '', rate: 1, voice: 'serena', sleepMinutes: 0 };
    function receive(origin: string, activeToken: string, mode = snapshot.mode, extra: Record<string, unknown> = {}) {
      act(() => window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow, origin, data: { type: 'vantilo:audiobook-state', token: activeToken, snapshot: { ...snapshot, mode, ...extra } },
      })));
    }

    receive('https://evil.test', token);
    receive('http://127.0.0.1:5175', 'stale-frame');
    receive('http://127.0.0.1:5175', token, 'original', { progressPercent: 101 });
    expect(screen.queryByRole('region', { name: '听书播放器' })).toBeNull();
    receive('http://127.0.0.1:5175', token);
    expect(screen.getByText('全书 18%')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '回到译文' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '回到当前位置' }));
    expect(onShowReader).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith({
      type: 'vantilo:audiobook-control', token, sessionId: 7, action: { type: 'return-original' },
    }, 'http://127.0.0.1:5175');
    receive('http://127.0.0.1:5175', token, 'translation');
    fireEvent.click(screen.getByRole('button', { name: '回到译文' }));
    fireEvent.click(screen.getByRole('button', { name: '回到原文' }));
    expect(onShowReader).toHaveBeenCalledTimes(3);
    expect(post).toHaveBeenCalledWith({
      type: 'vantilo:audiobook-control', token, sessionId: 7, action: { type: 'return' },
    }, 'http://127.0.0.1:5175');

    // Floating background book translation pill persists across host overlay pages (e.g. growth page).
    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'http://127.0.0.1:5175',
      data: {
        type: 'vantilo:bg-translation-state',
        state: { id: 'book:messy', bookId: 'book:messy', bookTitle: 'Messy Jobs', statusText: '后台翻译全书中 · 4/20 章 · 167/972 项' },
      },
    })));
    // Hidden while iframe is visible (iframe renders its own floating pill).
    expect(screen.queryByRole('complementary', { name: '后台全书翻译' })).toBeNull();
    // Shown when switching to host overlay page (e.g. Reading Growth).
    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'http://127.0.0.1:5175',
      data: { type: 'vantilo:growth-open-request', token },
    })));
    expect(screen.getByText('后台翻译全书中 · 4/20 章 · 167/972 项')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '暂停全书翻译' }));
    expect(post).toHaveBeenCalledWith({
      type: 'vantilo:bg-translation-action',
      action: 'pause',
      jobId: 'book:messy',
    }, 'http://127.0.0.1:5175');
    fireEvent.click(screen.getByRole('button', { name: '查看《Messy Jobs》' }));
    expect(post).toHaveBeenCalledWith({
      type: 'vantilo:bg-translation-action',
      action: 'open',
      bookId: 'book:messy',
    }, 'http://127.0.0.1:5175');
  } finally {
    view.unmount();
    target.remove();
  }
});
