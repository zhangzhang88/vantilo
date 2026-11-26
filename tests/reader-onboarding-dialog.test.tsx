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
    expect(screen.getByText(/AI 模型服务/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'打开系统词典'}));await waitFor(()=>expect(api.openDictionaryApp).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button',{name:'重新检测'}));await waitFor(()=>expect(api.checkReaderSetup).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button',{name:'稍后设置'}));expect(onDismiss).toHaveBeenCalledWith('skipped');
  });
  it.each([true,false])('offers API guidance and no built-in model controls on either architecture (%s)',async appleSilicon=>{
    const inspectLocalModel=vi.fn();
    const api={checkReaderSetup:vi.fn(async()=>({dictionary:'bilingual' as const,hardware:{appleSilicon,memoryGiB:16},localAi:'not-integrated' as const,modelSetupPreview:true,readerQwenIntegrated:true})),openDictionaryApp:vi.fn(async()=>({opened:true})),inspectLocalModel};
    const onDismiss=vi.fn(async()=>{});render(<ReaderOnboarding api={api} onDismiss={onDismiss}/>);
    await waitFor(()=>expect(screen.getByText('已检测到中文释义')).toBeTruthy());
    expect(screen.getByText(/DeepSeek、Gemini 或局域网模型服务/)).toBeTruthy();
    expect(screen.queryByRole('button',{name:/Qwen|下载|模型详情/})).toBeNull();expect(inspectLocalModel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'完成'}));expect(onDismiss).toHaveBeenCalledWith('finished');
  });
  it('reports dictionary launch errors and permits Escape',async()=>{
    const api={checkReaderSetup:vi.fn(async()=>({dictionary:'unavailable' as const,hardware:{appleSilicon:true,memoryGiB:16},localAi:'not-integrated' as const})),openDictionaryApp:vi.fn(async()=>({opened:false}))};
    const onDismiss=vi.fn(async()=>{});render(<ReaderOnboarding api={api} onDismiss={onDismiss}/>);
    fireEvent.click(screen.getByRole('button',{name:'打开系统词典'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toMatch(/未能打开/));
    fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(onDismiss).toHaveBeenCalledWith('skipped');
  });
  it('shows local Qwen3-TTS one-click installer in onboarding when TTS APIs are available',async()=>{
    const baseTts={
      state:'not-installed' as const,
      hardware:{supported:true,appleSilicon:true,memoryGiB:16,reason:null},
      mirror:false,
      model:{id:'qwen3-tts-0.6b-q8-metal',displayName:'Qwen3-TTS 0.6B',totalDownloadBytes:1219622221,installedDiskBytes:1225123176,runtimeVersion:'v0.10.1',modelLicense:'Apache-2.0'},
      disk:{availableBytes:50*1024**3,requiredBytes:1.7*1024**3,sufficient:true},
      progress:{downloadedBytes:0,totalBytes:1219622221,percent:0,bytesPerSecond:0,phaseLabel:''},
      paths:null,
      error:null,
    };
    const installTtsModel=vi.fn(async()=>({...baseTts,state:'downloading' as const,progress:{...baseTts.progress,downloadedBytes:500*1024**2,percent:41,bytesPerSecond:15*1024**2,phaseLabel:'正在下载 Qwen3-TTS 语音模型…'}}));
    const cancelTtsInstall=vi.fn(async()=>baseTts);
    const api={
      checkReaderSetup:vi.fn(async()=>({dictionary:'bilingual' as const,hardware:{appleSilicon:true,memoryGiB:16},localAi:'not-integrated' as const})),
      openDictionaryApp:vi.fn(async()=>({opened:true})),
      getTtsInstallStatus:vi.fn(async()=>baseTts),
      installTtsModel,
      cancelTtsInstall,
      removeTtsModel:vi.fn(async()=>baseTts),
    };
    render(<ReaderOnboarding api={api} onDismiss={vi.fn(async()=>{})}/>);
    await waitFor(()=>expect(screen.getByTestId('onboarding-tts-step')).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button',{name:'一键下载并启用'}));
    await waitFor(()=>expect(installTtsModel).toHaveBeenCalledWith({consent:true,mirror:true}));
    await waitFor(()=>expect(screen.getByRole('progressbar',{name:'离线语音模型下载进度'})).toBeTruthy());
    fireEvent.click(screen.getByRole('button',{name:'暂停取消'}));
    await waitFor(()=>expect(cancelTtsInstall).toHaveBeenCalledOnce());
  });
  it('lets a new user expand and configure Gemini or DeepSeek custom API directly inside onboarding',async()=>{
    const getCustomApiSettings=vi.fn(async()=>({configured:false,id:'',name:'',baseUrl:'',model:'',hasApiKey:false,profiles:[],activeId:''}));
    const testCustomApiSettings=vi.fn(async()=>({ok:true,message:'连接成功'}));
    const listCustomApiModels=vi.fn(async()=>({models:['gemini-2.5-flash','gemini-3-flash-preview','gemini-3.5-flash']}));
    const saveCustomApiSettings=vi.fn(async(draft)=>({
      configured:true,id:'11111111-1111-4111-8111-111111111111',name:draft.name,baseUrl:draft.baseUrl,model:draft.model,hasApiKey:true,
      profiles:[{id:'11111111-1111-4111-8111-111111111111',name:draft.name,baseUrl:draft.baseUrl,model:draft.model,hasApiKey:true}],
      activeId:'11111111-1111-4111-8111-111111111111',
    }));
    const api={
      checkReaderSetup:vi.fn(async()=>({dictionary:'bilingual' as const,hardware:{appleSilicon:true,memoryGiB:16},localAi:'not-integrated' as const})),
      openDictionaryApp:vi.fn(async()=>({opened:true})),
      getCustomApiSettings,
      testCustomApiSettings,
      listCustomApiModels,
      saveCustomApiSettings,
    };
    render(<ReaderOnboarding api={api} onDismiss={vi.fn(async()=>{})}/>);
    await waitFor(()=>expect(screen.getByRole('button',{name:'配置 AI 模型服务'})).toBeTruthy());
    fireEvent.click(screen.getByRole('button',{name:'配置 AI 模型服务'}));
    expect(screen.getByTestId('onboarding-custom-api-form')).toBeTruthy();
    // Defaults to DeepSeek with built-in endpoint and model already selected.
    expect(screen.getByRole('tab',{name:/DeepSeek/}).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('自定义 API 模型选择') as HTMLSelectElement).value).toBe('deepseek-chat');

    // Switch to Gemini tab, paste key, fetch live models, pick newly fetched model, test and save.
    fireEvent.click(screen.getByRole('tab',{name:'Gemini'}));
    expect((screen.getByLabelText('自定义 API 模型选择') as HTMLSelectElement).value).toBe('gemini-3.8-flash');
    fireEvent.change(screen.getByLabelText('自定义 API Key'),{target:{value:'synthetic-gemini-key'}});
    fireEvent.click(screen.getByRole('button',{name:'拉取模型列表'}));
    await waitFor(()=>expect(listCustomApiModels).toHaveBeenCalledWith({
      baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',apiKey:'synthetic-gemini-key',
    }));
    fireEvent.change(screen.getByLabelText('自定义 API 模型选择'),{target:{value:'gemini-3.5-flash'}});
    fireEvent.click(screen.getByRole('button',{name:'测试连接'}));
    await waitFor(()=>expect(testCustomApiSettings).toHaveBeenCalledWith({
      name:'Gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',model:'gemini-3.5-flash',apiKey:'synthetic-gemini-key',
    }));
    fireEvent.click(screen.getByRole('button',{name:'保存并使用'}));
    await waitFor(()=>expect(screen.getByText('已配置（Gemini）')).toBeTruthy());
    expect((screen.getByLabelText('自定义 API Key') as HTMLInputElement).value).toBe('');

    // Switching to DeepSeek after Gemini is saved creates a new profile (id: '') instead of overwriting Gemini.
    fireEvent.click(screen.getByRole('tab',{name:/DeepSeek/}));
    expect((screen.getByLabelText('自定义 API 模型选择') as HTMLSelectElement).value).toBe('deepseek-chat');
    fireEvent.change(screen.getByLabelText('自定义 API Key'),{target:{value:'synthetic-deepseek-key'}});
    fireEvent.click(screen.getByRole('button',{name:'保存并使用'}));
    await waitFor(()=>expect(saveCustomApiSettings).toHaveBeenLastCalledWith({
      id:'',name:'DeepSeek',baseUrl:'https://api.deepseek.com/v1',model:'deepseek-chat',apiKey:'synthetic-deepseek-key',
    }));
  });
});
