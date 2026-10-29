import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const { listGutenbergIntroEngines } = createRequire(import.meta.url)('../electron/gutenberg-intro-engines.cjs');

describe('Book introduction model menu follows Reader translation catalog', () => {
  it('uses the currently configured custom API plus all models from live Codex catalog', async () => {
    const profile = {configured:true,id:'saved-profile-123',name:'Local Qwen',model:'qwen3.5-4b'};
    const listModels = vi.fn(async()=>({models:[
      {id:'gpt-6-luna',displayName:'GPT-6-Luna',defaultEffort:'high'},
      {id:'gpt-7-future',displayName:'GPT-7-Future',defaultEffort:'medium'}
    ]}));
    const result=await listGutenbergIntroEngines({customApi:{get:async()=>profile},listModels});
    const expectedCustom='custom-api:'+createHash('sha256').update(profile.id).digest('hex').slice(0,12);
    expect(result.defaultId).toBe(expectedCustom);
    expect(result.engines).toEqual([
      {id:expectedCustom,label:'自定义 API · Local Qwen / qwen3.5-4b',engine:'custom',modelId:'qwen3.5-4b',effort:null},
      {id:'codex:gpt-6-luna',label:'Codex / ChatGPT · GPT-6-Luna',engine:'codex',modelId:'gpt-6-luna',effort:'high'},
      {id:'codex:gpt-7-future',label:'Codex / ChatGPT · GPT-7-Future',engine:'codex',modelId:'gpt-7-future',effort:'medium'}
    ]);
    expect(listModels).toHaveBeenCalledOnce();
  });

  it('reflects a changed selected custom API without exposing credentials', async () => {
    let chosen={configured:true,id:'first',name:'Local Qwen',model:'qwen3.5-4b',apiKey:'secret'};
    const api={get:async()=>chosen};
    const listModels=async()=>({models:[]});
    const first=await listGutenbergIntroEngines({customApi:api,listModels});
    chosen={configured:true,id:'second',name:'MiniMax',model:'minimax-m3',apiKey:'secret-two'};
    const second=await listGutenbergIntroEngines({customApi:api,listModels});
    expect(first.engines[0].id).not.toBe(second.engines[0].id);
    expect(second.engines[0].label).toContain('MiniMax / minimax-m3');
    expect(JSON.stringify(second)).not.toContain('secret');
  });

  it('keeps the remaining provider available if either provider is unavailable', async () => {
    const codexOnly=await listGutenbergIntroEngines({
      customApi:{get:async()=>{throw Error('locked')}},
      listModels:async()=>({models:[{id:'gpt-next',displayName:'GPT Next',defaultEffort:'low'}]})
    });
    expect(codexOnly.engines.map((item:any)=>item.id)).toEqual(['codex:gpt-next']);
    const customOnly=await listGutenbergIntroEngines({
      customApi:{get:async()=>({configured:true,id:'custom',model:'my-model',name:'My API'})},
      listModels:async()=>{throw Error('offline')}
    });
    expect(customOnly.engines).toHaveLength(1);
    expect(customOnly.engines[0].engine).toBe('custom');
  });
});
