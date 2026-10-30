// @vitest-environment jsdom
import React,{useState,useRef,useEffect} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,cleanup,fireEvent,within,waitFor} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import ReactMarkdown from 'react-markdown';

const code=ts.transpileModule(readFileSync('scripts/reader-update-settings.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
const UpdateSettings=new Function('React','useState','useRef','useEffect','VantiloReleaseMarkdown',code+'\nreturn VantiloUpdateSettings;')(React,useState,useRef,useEffect,ReactMarkdown);
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it.each([
 ['choosing','请选择下载位置',0,false],
 ['downloading','正在下载 Vantilo',25,true],
 ['verifying','正在验证 SHA-256',100,true],
 ['verified','下载完成，校验通过',100,true],
 ['download-cancelled','下载已取消',25,false],
 ['download-failed','网络连接失败',25,false],
])('shows the correct update status for %s',async(phase,message,percent,showProgress)=>{
 vi.stubGlobal('fetch',vi.fn(async (url:string)=>new Response(JSON.stringify(url.endsWith('magazines')?{enabled:false,message:'暂停'}:{phase,message,currentVersion:'0.1.11',channel:'beta',automatic:true,totalBytes:100,downloadedBytes:percent,downloadAvailable:true}))));
 render(React.createElement(UpdateSettings));
 expect(await screen.findByText(message)).toBeTruthy();
 if(showProgress)expect(screen.getByText(new RegExp(`下载：${percent}\\.0%`))).toBeTruthy();
 else expect(screen.queryByText(/下载：\d+\.\d%/)).toBeNull();
 if(phase==='verified')expect(screen.getByRole('button',{name:'在 Finder 中显示'})).toBeTruthy();
 if(phase==='download-cancelled'||phase==='download-failed')expect(screen.getByRole('button',{name:'下载并更新'})).toBeTruthy();
});

const releaseNotes="# Vantilo 0.1.13\n\n## 一、本次更新\n\n- 改进词典释义。\n- 优化阅读体验。\n- 支持复用翻译。\n\n## 三、技术变更与测试结果\n\n- 技术报告\n\n```sh\nnpm test\n```";
function display(software:Record<string,unknown>){
 vi.stubGlobal('fetch',vi.fn(async (url:string)=>new Response(JSON.stringify(url.endsWith('magazines')?{enabled:false,message:'暂停'}:{currentVersion:'0.1.12',channel:'beta',automatic:true,lastCheckedAt:null,...software}))));
 return render(React.createElement(UpdateSettings));
}
it('keeps the current version view concise without release notes or duplicate version',async()=>{
 display({phase:'current',latestVersion:'v0.1.12',releaseNotes,releaseURL:'https://example.test'});
 expect(await screen.findByText('你正在使用最新版本。')).toBeTruthy();
 expect(screen.queryByText('最新版本：')).toBeNull();expect(screen.queryByText('查看完整更新说明')).toBeNull();expect(screen.queryByText(/Tech report/)).toBeNull();
});
it('shows user highlights and folds complete rendered Markdown until requested',async()=>{
 display({phase:'available',latestVersion:'v0.1.13',releaseNotes,releaseURL:'https://example.test',assetSize:1048576,downloadAvailable:true});
 const highlights=(await screen.findByText('本次更新：')).parentElement!;
 expect(within(highlights).getByText('改进词典释义。')).toBeTruthy();expect(within(highlights).getByText('优化阅读体验。')).toBeTruthy();
 const summary=screen.getByText('查看完整更新说明');const details=summary.closest('details')!;expect(details.open).toBe(false);
 expect(screen.queryByText('技术报告')).toBeNull();
 fireEvent.click(summary);expect(details.open).toBe(true);
 await waitFor(()=>expect(within(details).getByRole('heading',{name:'三、技术变更与测试结果'})).toBeTruthy());expect(within(details).getByText('npm test').tagName).toBe('CODE');
 fireEvent.click(summary);expect(details.open).toBe(false);
});
it('does not manufacture highlights from technical notes or empty content',async()=>{
 display({phase:'available',latestVersion:'v0.1.13',releaseNotes:'## 三、技术变更与测试结果\n- 开发测试',downloadAvailable:true});
 expect(await screen.findByText('查看完整更新说明')).toBeTruthy();expect(screen.queryByText('本次更新：')).toBeNull();cleanup();
 display({phase:'available',latestVersion:'v0.1.13',releaseNotes:'',downloadAvailable:true,channel:'stable'});
 expect(await screen.findByText(/更新通道：Stable/)).toBeTruthy();expect(screen.queryByText('查看完整更新说明')).toBeNull();expect(screen.queryByText('本次更新：')).toBeNull();
});
it('limits the preview to five items and stops before the next technical heading',async()=>{
 const notes='## 本次更新\n- 功能一\n- 功能二\n- 功能三\n- 功能四\n- 功能五\n- 功能六\n### 技术细节\n- 技术记录';
 display({phase:'available',latestVersion:'v0.1.13',releaseNotes:notes,downloadAvailable:true});
 const highlights=(await screen.findByText('本次更新：')).parentElement!;
 expect(within(highlights).getAllByRole('listitem')).toHaveLength(5);
 expect(within(highlights).queryByText('功能六')).toBeNull();expect(within(highlights).queryByText('技术记录')).toBeNull();
});

it('does not display an English historical release as Chinese notes',async()=>{display({phase:'available',latestVersion:'v0.1.12',releaseNotes:"## What's new\n- Improves reader experience.",releaseURL:'https://example.test',downloadAvailable:true});expect(await screen.findByText('当前版本尚无简体中文更新说明。')).toBeTruthy();expect(screen.queryByText('Improves reader experience.')).toBeNull();expect(screen.getByRole('button',{name:'在 GitHub 查看完整发布说明'})).toBeTruthy();});
