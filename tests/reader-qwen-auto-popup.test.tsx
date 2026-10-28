// @vitest-environment jsdom
import * as React from 'react';
import {render,screen,waitFor,cleanup} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

// Exercise the exact TSX fragment injected into Vantilo's Reader, not a copy.
const source=readFileSync('scripts/reader-qwen-gloss.tsx','utf8');
const compiled=ts.transpileModule('const {useState,useEffect}=React;\n'+source,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React},
}).outputText;
const Gloss=(new Function('React',compiled+'\nreturn VantiloLocalGloss;'))(React) as
  React.ComponentType<{word:string;sentence:string;cachedMeaning?:string;preserveCached?:boolean;onResolved:(meaning:string,provider?:string,model?:string)=>void}>;
const engineId='codex:gpt-6-luna';
const status={enabled:true,selected:true,helperAvailable:true,label:'Codex / ChatGPT · GPT-6-Luna'};
const ok=(data:unknown)=>({ok:true,json:async()=>data});
beforeEach(()=>localStorage.setItem('vantilo-translation-engine-v1',engineId));
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});
describe('automatic contextual Qwen popup',()=>{
  it('automatically requests a sentence-bound gloss and does not show a Qwen button',async()=>{
    const fetch=vi.fn(async(input:string,options?:{body?:string})=>
      input.includes('/status')?ok(status):ok({meaningZh:'河岸',provider:'vantilo-agent',model:'gpt-6-luna'}));
    vi.stubGlobal('fetch',fetch);
    const resolved=vi.fn();
    render(<Gloss word="bank" sentence="The bank of the river is muddy." onResolved={resolved}/>);
    expect(screen.getByText('正在理解当前句子…')).toBeTruthy();
    await waitFor(()=>expect(screen.getByTestId('vantilo-qwen-context-meaning').textContent).toBe('河岸'));
    expect(resolved).toHaveBeenCalledOnce();
    expect(resolved).toHaveBeenCalledWith('河岸','vantilo-agent','gpt-6-luna');
    expect(fetch).toHaveBeenCalledWith(`/api/vantilo-context-gloss/status?engineId=${encodeURIComponent(engineId)}`,expect.objectContaining({cache:'no-store'}));
    expect(fetch).toHaveBeenCalledWith('/api/vantilo-context-gloss',expect.objectContaining({
      method:'POST',body:JSON.stringify({word:'bank',sentence:'The bank of the river is muddy.',engineId})
    }));
    expect(screen.getByLabelText('当前语境释义').textContent).toContain('Codex / ChatGPT · GPT-6-Luna');
    expect(screen.queryByText('用 Qwen 解释')).toBeNull();
  });
  it('rapid word switching cancels stale inference and displays the latest meaning',async()=>{
    let firstSignal:AbortSignal|undefined;
    let glossCount=0;
    const fetch=vi.fn(async(input:string,options?:{signal?:AbortSignal})=>{
      if(input.includes('/status'))return ok(status);
      glossCount++;
      if(glossCount===1)return await new Promise((_resolve,reject)=>{
        firstSignal=options?.signal;
        firstSignal?.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});
      });
      return ok({meaningZh:'段落'});
    });
    vi.stubGlobal('fetch',fetch);
    const resolved=vi.fn();
    const view=render(<Gloss word="bank" sentence="The river bank." onResolved={resolved}/>);
    await waitFor(()=>expect(glossCount).toBe(1));
    view.rerender(<Gloss word="paragraph" sentence="This paragraph is short." onResolved={resolved}/>);
    expect(screen.queryByText('河岸')).toBeNull();
    expect(firstSignal?.aborted).toBe(true);
    await waitFor(()=>expect(screen.getByTestId('vantilo-qwen-context-meaning').textContent).toBe('段落'));
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(resolved).toHaveBeenCalledWith('段落',undefined,undefined);
    expect(glossCount).toBe(2);
  });
  it('an existing contextual user meaning skips the network, while failure shows non-fake fallback',async()=>{
    const fetch=vi.fn(async(_input:string)=>({ok:false,json:async()=>({})}));
    vi.stubGlobal('fetch',fetch);
    const resolved=vi.fn();
    const view=render(<Gloss word="bark" sentence="A tree's bark." cachedMeaning="树皮" preserveCached onResolved={resolved}/>);
    expect(screen.getByText('树皮')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    view.rerender(<Gloss word="bank" sentence="The bank." onResolved={resolved}/>);
    await waitFor(()=>expect(screen.getByText(/请登录 ChatGPT 后重试/)).toBeTruthy());
    expect(screen.queryByText('树皮')).toBeNull();
    expect(resolved).not.toHaveBeenCalled();
  });
});
