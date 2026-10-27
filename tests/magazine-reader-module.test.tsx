// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MagazineReaderModule } from '../src/ui/magazine-reader-module';

afterEach(cleanup);

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
