// @vitest-environment jsdom
import React from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ReaderOnboarding} from '../src/ui/reader-onboarding';
afterEach(cleanup);
describe('Reader onboarding dialog',()=>{
  it('performs actual setup checks, opens the dictionary and allows an explicit skip',async()=>{
    const api={checkReaderSetup:vi.fn(async()=>({dictionary:'english-only' as const,hardware:{appleSilicon:true,memoryGiB:16},localAi:'not-integrated' as const})),
      openDictionaryApp:vi.fn(async()=>({opened:true})),viewLocalModelInfo:vi.fn(async()=>{})};
    const onDismiss=vi.fn(async()=>{});
    render(<ReaderOnboarding api={api} onDismiss={onDismiss}/>);
    expect(screen.getByRole('dialog',{name:'准备你的阅读环境'})).toBeTruthy();
    await waitFor(()=>expect(screen.getByText('只有英文释义')).toBeTruthy());
    expect(screen.getByText(/应用内安装尚未开放/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'打开系统词典'}));
    await waitFor(()=>expect(api.openDictionaryApp).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button',{name:'重新检测'}));
    await waitFor(()=>expect(api.checkReaderSetup).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button',{name:'稍后设置'}));
    expect(onDismiss).toHaveBeenCalledWith('skipped');
  });
  it('shows original isolated setup preview as native health only, without falsely claiming Reader integration',async()=>{
    let selected=false;
    const inspectLocalModel=vi.fn(async()=>({
      selected,modelName:'Qwen3.5 4B (MLX 4-bit)',modelPath:selected?'/test/Models/Qwen3.5-4B-4bit':null,active:false,helperAvailable:true,
      health:{ready:selected,status:selected?'verified-native':'not-checked'},
      hardware:{supported:true,memoryGiB:16,warning:null},
      disk:{availableBytes:17*1024**3,freshInstallBytes:5*1024**3},
      model:{bytes:3_061_129_077,license:'Apache-2.0'}
    }));
    const chooseLocalModel=vi.fn(async()=>{selected=true;return {canceled:false,result:{health:{ready:true,status:'verified-native'}}};});
    const api={checkReaderSetup:vi.fn(async()=>({dictionary:'bilingual' as const,hardware:{appleSilicon:true,memoryGiB:16},localAi:'not-integrated' as const,modelSetupPreview:true})),
      openDictionaryApp:vi.fn(async()=>({opened:true})),viewLocalModelInfo:vi.fn(async()=>{}),
      inspectLocalModel,chooseLocalModel,recheckLocalModel:vi.fn(async()=>({ready:true,status:'verified-native'})),
      installLocalModel:vi.fn(async()=>({canceled:true})),
      cancelLocalModel:vi.fn(async()=>({canceled:true})),
      onLocalModelProgress:vi.fn(()=>()=>{})};
    render(<ReaderOnboarding api={api} onDismiss={vi.fn(async()=>{})}/>);
    await waitFor(()=>expect(screen.getByRole('button',{name:'选择已有 Qwen 模型'})).toBeTruthy());
    expect(screen.getByText(/独立预览 · 原生验证/)).toBeTruthy();
    expect(screen.getByText(/尚未选择本地模型/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'选择已有 Qwen 模型'}));
    await waitFor(()=>expect(chooseLocalModel).toHaveBeenCalledOnce());
    await waitFor(()=>expect(screen.getByText(/本机 Swift 推理健康检查已通过/)).toBeTruthy());
    expect(screen.getByText('Qwen3.5 4B (MLX 4-bit)')).toBeTruthy();
    expect(screen.getByText('/test/Models/Qwen3.5-4B-4bit')).toBeTruthy();
    expect(api.installLocalModel).not.toHaveBeenCalled();
  });
  it('lets the Qwen preview user adopt a model and go directly to Reader',async()=>{
    let selected=false;
    const inspectLocalModel=vi.fn(async()=>({
      selected,modelName:'Qwen3.5 4B (MLX 4-bit)',modelPath:selected?'/test/models/qwen':null,active:false,helperAvailable:true,
      health:{ready:selected,status:selected?'verified-native':'not-checked'},
      hardware:{supported:true,memoryGiB:16,warning:null},
      disk:{availableBytes:10*1024**3,freshInstallBytes:5*1024**3},
      model:{bytes:3_061_129_077,license:'Apache-2.0'}
    }));
    const chooseLocalModel=vi.fn(async()=>{selected=true;return {canceled:false,result:{health:{ready:true,status:'verified-native'}}};});
    const onDismiss=vi.fn(async()=>{});
    const onStartReader=vi.fn(async()=>{});
    const api={checkReaderSetup:vi.fn(async()=>({dictionary:'bilingual' as const,hardware:{appleSilicon:true,memoryGiB:16},localAi:'not-integrated' as const,modelSetupPreview:true,readerQwenIntegrated:true})),
      openDictionaryApp:vi.fn(async()=>({opened:true})),viewLocalModelInfo:vi.fn(async()=>{}),
      inspectLocalModel,chooseLocalModel,recheckLocalModel:vi.fn(async()=>({ready:true,status:'verified-native'})),
      installLocalModel:vi.fn(async()=>({canceled:true})),cancelLocalModel:vi.fn(async()=>({canceled:true}))};
    render(<ReaderOnboarding api={api} onDismiss={onDismiss} onStartReader={onStartReader}/>);
    await waitFor(()=>expect(screen.getByText('本地模型已接入 Reader')).toBeTruthy());
    expect(screen.getByText(/已接入本地 Qwen 点词语境释义/)).toBeTruthy();
    expect(screen.getByRole('button',{name:'开始阅读'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'选择已有 Qwen 模型'}));
    await waitFor(()=>expect(screen.getByText(/本机文件与 Swift 推理验证通过/)).toBeTruthy());
    expect(screen.getByText('/test/models/qwen')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'开始阅读'}));
    expect(onStartReader).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(api.installLocalModel).not.toHaveBeenCalled();
  });
  it('shows adopted-but-not-rechecked model honestly, and disables downloading if disk is low',async()=>{
    const api={checkReaderSetup:vi.fn(async()=>({dictionary:'english-only' as const,hardware:{appleSilicon:true,memoryGiB:16},localAi:'not-integrated' as const,modelSetupPreview:true,readerQwenIntegrated:true})),
      openDictionaryApp:vi.fn(async()=>({opened:true})),viewLocalModelInfo:vi.fn(async()=>{}),
      inspectLocalModel:vi.fn(async()=>({
        selected:true,modelName:'Qwen3.5 4B',modelPath:'/test/model',active:false,helperAvailable:true,
        health:{ready:false,status:'not-checked'},
        hardware:{supported:true,memoryGiB:16,warning:null},
        disk:{availableBytes:2*1024**3,freshInstallBytes:5*1024**3},
        model:{bytes:3_061_129_077,license:'Apache-2.0'}
      }))};
    render(<ReaderOnboarding api={api} onDismiss={vi.fn(async()=>{})} onStartReader={vi.fn(async()=>{})}/>);
    await waitFor(()=>expect(screen.getByText(/进入 Reader 后首次点词会自动校验/)).toBeTruthy());
    expect(screen.getByRole<HTMLButtonElement>('button',{name:'确认后下载约 3GB'}).disabled).toBe(true);
    expect(screen.getByRole('button',{name:'开始阅读'})).toBeTruthy();
  });
  it('does not offer local model actions on Intel',async()=>{
    const api={checkReaderSetup:vi.fn(async()=>({dictionary:'unavailable' as const,hardware:{appleSilicon:false,memoryGiB:8},localAi:'not-integrated' as const})),
      openDictionaryApp:vi.fn(async()=>({opened:false})),viewLocalModelInfo:vi.fn(async()=>{})};
    render(<ReaderOnboarding api={api} onDismiss={vi.fn(async()=>{})}/>);
    await waitFor(()=>expect(screen.getByText(/Intel 版本通过自定义云端或局域网 API 使用模型/)).toBeTruthy());
    expect(screen.queryByRole('button',{name:/下载并安装/})).toBeNull();
    expect(screen.queryByRole('button',{name:/Qwen 模型/})).toBeNull();
  });
  it('routes Intel readers to the configured API instead of local Qwen',async()=>{
    const api={checkReaderSetup:vi.fn(async()=>({dictionary:'bilingual' as const,hardware:{appleSilicon:false,memoryGiB:16},localAi:'not-integrated' as const,modelSetupPreview:true,readerQwenIntegrated:true})),
      openDictionaryApp:vi.fn(async()=>({opened:true})),viewLocalModelInfo:vi.fn(async()=>{}),
      inspectLocalModel:vi.fn(async()=>({selected:false,modelName:'Qwen3.5 4B',modelPath:null,active:false,helperAvailable:false,health:{ready:false,status:'not-checked'},hardware:{supported:false,memoryGiB:16,warning:'只支持 Apple Silicon Mac'},disk:{availableBytes:10e9,freshInstallBytes:5e9},model:{bytes:3e9,license:'Apache-2.0'}}))};
    render(<ReaderOnboarding api={api} onDismiss={vi.fn(async()=>{})}/>);
    await waitFor(()=>expect(screen.getAllByText(/Intel 版本通过自定义云端或局域网 API 使用模型/).length).toBeGreaterThan(0));
    expect(screen.queryByRole('button',{name:'选择已有 Qwen 模型'})).toBeNull();
    expect(screen.queryByRole('button',{name:'确认后下载约 3GB'})).toBeNull();
  });
});
