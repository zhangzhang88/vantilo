// @vitest-environment jsdom
import React from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ReaderOnboarding} from '../src/ui/reader-onboarding';
afterEach(cleanup);
describe('Reader onboarding dialog',()=>{
  it('checks the dictionary, opens it and allows a user to skip',async()=>{
    const api={checkReaderSetup:vi.fn(async()=>({dictionary:'english-only' as const,hardware:{appleSilicon:true,memoryGiB:16},localAi:'not-integrated' as const})),openDictionaryApp:vi.fn(async()=>({opened:true}))};
    const onDismiss=vi.fn(async()=>{});render(<ReaderOnboarding api={api} onDismiss={onDismiss}/>);
    expect(screen.getByRole('dialog',{name:'阅读环境设置'})).toBeTruthy();
    await waitFor(()=>expect(screen.getByText('只有英文释义')).toBeTruthy());
    expect(screen.getByText(/自定义兼容 API/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'打开系统词典'}));await waitFor(()=>expect(api.openDictionaryApp).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button',{name:'重新检测'}));await waitFor(()=>expect(api.checkReaderSetup).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button',{name:'稍后设置'}));expect(onDismiss).toHaveBeenCalledWith('skipped');
  });
  it.each([true,false])('offers API guidance and no built-in model controls on either architecture (%s)',async appleSilicon=>{
    const inspectLocalModel=vi.fn();
    const api={checkReaderSetup:vi.fn(async()=>({dictionary:'bilingual' as const,hardware:{appleSilicon,memoryGiB:16},localAi:'not-integrated' as const,modelSetupPreview:true,readerQwenIntegrated:true})),openDictionaryApp:vi.fn(async()=>({opened:true})),inspectLocalModel};
    const onDismiss=vi.fn(async()=>{});render(<ReaderOnboarding api={api} onDismiss={onDismiss}/>);
    await waitFor(()=>expect(screen.getByText('已检测到中文释义')).toBeTruthy());
    expect(screen.getByText(/DeepSeek、MiniMax 或局域网模型服务/)).toBeTruthy();
    expect(screen.queryByRole('button',{name:/Qwen|下载|模型详情/})).toBeNull();expect(inspectLocalModel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'完成'}));expect(onDismiss).toHaveBeenCalledWith('finished');
  });
  it('reports dictionary launch errors and permits Escape',async()=>{
    const api={checkReaderSetup:vi.fn(async()=>({dictionary:'unavailable' as const,hardware:{appleSilicon:true,memoryGiB:16},localAi:'not-integrated' as const})),openDictionaryApp:vi.fn(async()=>({opened:false}))};
    const onDismiss=vi.fn(async()=>{});render(<ReaderOnboarding api={api} onDismiss={onDismiss}/>);
    fireEvent.click(screen.getByRole('button',{name:'打开系统词典'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toMatch(/未能打开/));
    fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(onDismiss).toHaveBeenCalledWith('skipped');
  });
});
