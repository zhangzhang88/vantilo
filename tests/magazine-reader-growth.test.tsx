// @vitest-environment jsdom
import React from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {MagazineReaderModule} from '../src/ui/magazine-reader-module';
import {readGrowthRecord} from '../src/reader/growth';

describe('Reader growth UI bridge',()=>{
 afterEach(()=>{cleanup();vi.useRealTimers();localStorage.clear();});
 it('accepts only its loaded iframe instance, persists active reading, pauses on blur and offers idle recovery',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,29,10));Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});
  render(<MagazineReaderModule status="ready" error={null} onRetry={()=>{}} onBack={()=>{}} visible/>);
  const frame=screen.getByTitle('Magazine Reader') as HTMLIFrameElement;
  let sent:any[]=[];vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation((...args:any[])=>{sent.push(args);});
  fireEvent.load(frame);const token=sent.find(item=>item[0]?.type==='vantilo:growth-init')?.[0]?.token as string;expect(token).toBeTruthy();
  const send=(data:unknown)=>window.dispatchEvent(new MessageEvent('message',{data,origin:'http://127.0.0.1:5175',source:frame.contentWindow}));
  act(()=>send({type:'vantilo:growth-state',token,bookId:'book:actual',documentId:'document:actual',pageId:'page:actual',mode:'sentence',english:true}));
  act(()=>vi.advanceTimersByTime(5000));
  expect(readGrowthRecord().days['2026-10-29'].seconds).toBeGreaterThanOrEqual(4);
  expect(document.querySelector('.growth-entry')).toBeNull();expect(document.querySelector('.growth-timer')).toBeNull();
  const before=readGrowthRecord().days['2026-10-29'].seconds;
  act(()=>window.dispatchEvent(new Event('blur')));act(()=>vi.advanceTimersByTime(10000));
  expect(readGrowthRecord().days['2026-10-29'].seconds).toBe(before);
 });
 it('stops on matching navigation leave, ignores stale/duplicate leaves, and auto-resumes the same article',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,29,10));Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});
  render(<MagazineReaderModule status="ready" error={null} onRetry={()=>{}} onBack={()=>{}} visible/>);
  const frame=screen.getByTitle('Magazine Reader') as HTMLIFrameElement;const sent:any[]=[];vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation((...args:any[])=>{sent.push(args);});fireEvent.load(frame);const token=sent.find(item=>item[0]?.type==='vantilo:growth-init')?.[0]?.token as string;
  const send=(data:unknown)=>act(()=>window.dispatchEvent(new MessageEvent('message',{data,origin:'http://127.0.0.1:5175',source:frame.contentWindow})));
  const total=()=>Object.values(readGrowthRecord().days).reduce((sum,day)=>sum+day.seconds,0);
  send({type:'vantilo:growth-state',token,bookId:'book:actual',documentId:'document:actual',pageId:'page:one',mode:'article',english:true});act(()=>vi.advanceTimersByTime(3500));const beforeLeave=total();expect(beforeLeave).toBeGreaterThanOrEqual(2);
  send({type:'vantilo:growth-leave',token,bookId:'book:actual',documentId:'document:actual',pageId:'stale-page'});act(()=>vi.advanceTimersByTime(2000));expect(total()).toBeGreaterThan(beforeLeave);
  send({type:'vantilo:growth-leave',token,bookId:'book:actual',documentId:'document:actual',pageId:'page:one'});const afterLeave=total();act(()=>vi.advanceTimersByTime(5000));expect(total()).toBe(afterLeave);
  send({type:'vantilo:growth-leave',token,bookId:'book:actual',documentId:'document:actual',pageId:'page:one'});send({type:'vantilo:growth-state',token,bookId:'book:actual',documentId:'document:actual',pageId:'page:one',mode:'article',english:true});act(()=>vi.advanceTimersByTime(3000));expect(total()).toBe(afterLeave);
  send({type:'vantilo:growth-state',token,bookId:'book:actual',documentId:'document:actual',pageId:'page:two',mode:'article',english:true});act(()=>vi.advanceTimersByTime(3000));expect(total()).toBeGreaterThan(afterLeave);
 });
 it('preserves a user pause across navigation and ignores state from an expired iframe token',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,29,10));Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});
  render(<MagazineReaderModule status="ready" error={null} onRetry={()=>{}} onBack={()=>{}} visible/>);
  const frame=screen.getByTitle('Magazine Reader') as HTMLIFrameElement;const sent:any[]=[];vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation((...args:any[])=>{sent.push(args);});fireEvent.load(frame);const oldToken=sent.find(item=>item[0]?.type==='vantilo:growth-init')?.[0]?.token as string;
  const send=(data:unknown)=>act(()=>window.dispatchEvent(new MessageEvent('message',{data,origin:'http://127.0.0.1:5175',source:frame.contentWindow})));const total=()=>Object.values(readGrowthRecord().days).reduce((sum,day)=>sum+day.seconds,0);
  send({type:'vantilo:growth-state',token:oldToken,bookId:'book:actual',documentId:'document:actual',pageId:'page:one',mode:'sentence',english:true});act(()=>vi.advanceTimersByTime(120000));expect(screen.getByText('还在阅读吗？')).toBeTruthy();fireEvent.click(screen.getByText('先暂停'));const pausedAt=total();
  send({type:'vantilo:growth-leave',token:oldToken,bookId:'book:actual',documentId:'document:actual',pageId:'page:one'});send({type:'vantilo:growth-state',token:oldToken,bookId:'book:actual',documentId:'document:actual',pageId:'page:two',mode:'sentence',english:true});act(()=>vi.advanceTimersByTime(4000));expect(total()).toBe(pausedAt);
  fireEvent.load(frame);const newToken=sent.filter(item=>item[0]?.type==='vantilo:growth-init').at(-1)?.[0]?.token as string;expect(newToken).not.toBe(oldToken);
  send({type:'vantilo:growth-state',token:oldToken,bookId:'book:actual',documentId:'document:actual',pageId:'page:old',mode:'sentence',english:true});act(()=>vi.advanceTimersByTime(3000));expect(total()).toBe(pausedAt);
  send({type:'vantilo:growth-state',token:newToken,bookId:'book:actual',documentId:'document:actual',pageId:'page:new',mode:'sentence',english:true});act(()=>vi.advanceTimersByTime(3000));expect(total()).toBe(pausedAt);
  send({type:'vantilo:growth-resume-request',token:newToken});act(()=>vi.advanceTimersByTime(3000));expect(total()).toBeGreaterThan(pausedAt);
 });
 it('routes a growth-card request to the one shared record and growth page',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,29,10));Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});
  localStorage.setItem('vantilo-reading-growth-v1',JSON.stringify({days:{'2026-10-29':{seconds:1800,books:{'book:ebook':600,'book:magazine':1200}}}}));
  render(<MagazineReaderModule status="ready" error={null} onRetry={()=>{}} onBack={()=>{}} visible/>);const frame=screen.getByTitle('Magazine Reader') as HTMLIFrameElement;let token='';vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation((message:any)=>{if(message?.type==='vantilo:growth-init')token=message.token;});fireEvent.load(frame);
  act(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'vantilo:growth-open-request',token},origin:'http://127.0.0.1:5175',source:frame.contentWindow})));
  expect(screen.getByText('我的阅读成长')).toBeTruthy();expect(document.querySelector('.reading-growth-today strong')?.textContent).toContain('30:00 / 30:00');expect(readGrowthRecord().days['2026-10-29'].books).toEqual({'book:ebook':600,'book:magazine':1200});expect(readGrowthRecord().days['2026-10-29'].seconds).toBe(1800);
 });
 it('pauses rather than overwriting malformed existing growth storage',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,29,10));Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});const malformed='{broken-growth';localStorage.setItem('vantilo-reading-growth-v1',malformed);
  render(<MagazineReaderModule status="ready" error={null} onRetry={()=>{}} onBack={()=>{}} visible/>);const frame=screen.getByTitle('Magazine Reader') as HTMLIFrameElement;let sent:any[]=[];vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation((...args:any[])=>{sent.push(args);});fireEvent.load(frame);const token=sent.find(item=>item[0]?.type==='vantilo:growth-init')?.[0]?.token;
  act(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'vantilo:growth-state',token,bookId:'book:actual',documentId:'document:actual',pageId:'page:actual',mode:'sentence',english:true},origin:'http://127.0.0.1:5175',source:frame.contentWindow})));act(()=>vi.advanceTimersByTime(5000));expect(localStorage.getItem('vantilo-reading-growth-v1')).toBe(malformed);
  act(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'vantilo:growth-open-request',token},origin:'http://127.0.0.1:5175',source:frame.contentWindow})));expect(screen.getByRole('alert').textContent).toContain('计时已暂停');expect(localStorage.getItem('vantilo-reading-growth-v1')).toBe(malformed);
 });
 it('serves backup snapshots and applies validated replace/clear only for its trusted iframe instance',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,29,10));Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});
  render(<MagazineReaderModule status="ready" error={null} onRetry={()=>{}} onBack={()=>{}} visible/>);
  const frame=screen.getByTitle('Magazine Reader') as HTMLIFrameElement;let sent:any[]=[];vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation((...args:any[])=>{sent.push(args);});fireEvent.load(frame);
  const token=sent.find(item=>item[0]?.type==='vantilo:growth-init')?.[0]?.token as string;const requestId='12345678-1234-4123-8123-123456789abc';
  const send=(origin:string,source:MessageEventSource|null,operation:string,record?:unknown)=>act(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'vantilo:growth-backup-request',token,requestId,operation,record},origin,source})));
  localStorage.setItem('vantilo-reading-growth-v1',JSON.stringify({days:{'2026-10-29':{seconds:60,books:{'book:existing':60}}}}));
  send('https://attacker.test',frame.contentWindow,'clear');expect(sent.some(item=>item[0]?.type==='vantilo:growth-backup-response')).toBe(false);
  send('http://127.0.0.1:5175',frame.contentWindow,'snapshot');expect(sent.at(-1)[0]).toMatchObject({type:'vantilo:growth-backup-response',ok:true,record:{days:{'2026-10-29':{seconds:60}}}});
  send('http://127.0.0.1:5175',frame.contentWindow,'replace',{days:{'2026-10-30':{seconds:1800,books:{'book:restored':1800}}}});expect(JSON.parse(localStorage.getItem('vantilo-reading-growth-v1')!).days['2026-10-30'].seconds).toBe(1800);
  send('http://127.0.0.1:5175',frame.contentWindow,'replace',{days:{'bad-date':{seconds:2,books:{x:2}}}});expect(sent.at(-1)[0]).toMatchObject({ok:false});expect(JSON.parse(localStorage.getItem('vantilo-reading-growth-v1')!).days['2026-10-30'].seconds).toBe(1800);
  send('http://127.0.0.1:5175',frame.contentWindow,'clear');expect(localStorage.getItem('vantilo-reading-growth-v1')).toBeNull();
 });
 it('shows a gentle idle reminder and keeps the session paused after the reminder expires',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,29,10));Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});
  render(<MagazineReaderModule status="ready" error={null} onRetry={()=>{}} onBack={()=>{}} visible/>);
  const frame=screen.getByTitle('Magazine Reader') as HTMLIFrameElement;let token='';vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation((message:any)=>{if(message?.type==='vantilo:growth-init')token=message.token;});fireEvent.load(frame);
  act(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'vantilo:growth-state',token,bookId:'book:actual',documentId:'document:actual',pageId:'page:actual',mode:'sentence',english:true},origin:'http://127.0.0.1:5175',source:frame.contentWindow})));
  act(()=>vi.advanceTimersByTime(120000));expect(screen.getByText('还在阅读吗？')).toBeTruthy();
  act(()=>vi.advanceTimersByTime(30000));expect(screen.queryByText('还在阅读吗？')).toBeNull();expect(screen.queryByText('继续阅读计时')).toBeNull();
  const before=readGrowthRecord().days['2026-10-29'].seconds;act(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'vantilo:growth-resume-request',token},origin:'http://127.0.0.1:5175',source:frame.contentWindow})));act(()=>vi.advanceTimersByTime(2000));expect(readGrowthRecord().days['2026-10-29'].seconds).toBeGreaterThan(before);
 });
});
