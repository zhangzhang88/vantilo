import React from 'react';
import './magazine-reader-module.css';
import { BookDiscovery } from '../reader/book-discovery';
import { ReadingGrowthPage } from '../reader/growth-page';
import { readGrowthRecord, saveGrowthRecord, growthStats, emptyGrowthRecord, isValidGrowthRecord, READING_GROWTH_STORAGE_KEY } from '../reader/growth';
import { acceptReaderState, createReadingSession, leaveReadingSession, pauseSession, readerActivity, resumeSession, tickSession, type ReadingPauseReason, type SessionState } from '../reader/growth-session';

export type MagazineSyncState = { enabled: boolean; status: 'idle' | 'checking' | 'error'; message: string; importedCount: number; failedCount: number; lastAttemptAt?: string | null; lastSuccessAt?: string | null };
export type MagazineReaderStatus = 'idle' | 'starting' | 'ready' | 'error';
export type ReaderAppearance = { theme: 'paper'|'sepia'|'green'|'blue'|'night'; fontSize: number; fontFamily: 'serif'|'sans' };
export function isReaderAppearance(value: unknown): value is ReaderAppearance {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.theme === 'string' && ['paper','sepia','green','blue','night'].includes(item.theme) && typeof item.fontSize === 'number' && Number.isInteger(item.fontSize) && item.fontSize >= 12 && item.fontSize <= 24 && (item.fontFamily === 'serif' || item.fontFamily === 'sans');
}
const MAGAZINE_READER_URL = 'http://127.0.0.1:5175/';
type BridgeMessage = {type:string;token?:string;bookId?:string;documentId?:string;pageId?:string;mode?:'sentence'|'article';english?:boolean;action?:'sentence'|'lookup'|'translation'|'scroll';requestId?:string;operation?:'snapshot'|'replace'|'clear';record?:unknown;snapshot?:unknown;message?:unknown;terminal?:boolean};
type VocabularyBackupEvent = {type:'freeze'|'resume'|'status';requestId:string;phase?:string;progress?:number;message?:string;result?:{name:string;size:number;sha256:string;vocabularyCount:number}};
type HostBridge = {onSystemSuspended?:(callback:()=>void)=>()=>void;onVocabularyBackupEvent?:(callback:(event:VocabularyBackupEvent)=>void)=>()=>void;startVocabularyBackup?:(requestId:string)=>Promise<{canceled?:boolean}>;submitVocabularyBackupSnapshot?:(requestId:string,snapshot:unknown)=>Promise<{accepted:boolean}>;cancelVocabularyBackup?:(requestId:string)=>Promise<{canceled:boolean}>;revealVocabularyBackup?:()=>Promise<{shown:boolean}>;getVocabularyBackupStatus?:()=>Promise<{lastBackup:{createdAt:string;name:string;path:string;size:number;sha256:string;vocabularyCount:number}|null}>};

export function MagazineReaderModule({navigationRequest,status,error,onRetry,onBack,syncState,onSync,onSetup,onAppearanceChange,visible=true}: {
  navigationRequest?:{target:'settings'|'library';sequence:number};status:MagazineReaderStatus;error:string|null;onRetry:()=>void;onBack:()=>void;syncState?:MagazineSyncState|null;onSync?:()=>void;onSetup?:()=>void;onAppearanceChange?:(appearance:ReaderAppearance)=>void;visible?:boolean;
}) {
  const frameRef=React.useRef<HTMLIFrameElement>(null);
  const [discoveryOpen,setDiscoveryOpen]=React.useState(false),[growthOpen,setGrowthOpen]=React.useState(false);
  const [instanceToken,setInstanceToken]=React.useState<string|null>(null);
  const lastActivityAt=React.useRef(0);
  const initRetryRef=React.useRef<number|null>(null);
  const [session,setSession]=React.useState<SessionState>(()=>createReadingSession(readGrowthRecord()));
  const sessionRef=React.useRef(session);sessionRef.current=session;
  const vocabularyBackupRequestRef=React.useRef<string|null>(null);
  const [growthStorageValid,setGrowthStorageValid]=React.useState(()=>{try{const raw=localStorage.getItem(READING_GROWTH_STORAGE_KEY);return raw===null||isValidGrowthRecord(JSON.parse(raw));}catch{return false;}});
  const [now,setNow]=React.useState(()=>Date.now());
  const daily=growthStats(session.record,new Date(now)).todaySeconds;
  const origin=new URL(MAGAZINE_READER_URL).origin;
  const navigate=React.useCallback(()=>{if(navigationRequest)frameRef.current?.contentWindow?.postMessage({type:'vantilo:navigate',target:navigationRequest.target},origin);},[navigationRequest,origin]);
  const pause=React.useCallback((reason:ReadingPauseReason='focus')=>setSession(current=>pauseSession(current,reason)),[]);
  React.useEffect(()=>{
    if(!visible||status!=='ready'){pause('focus');return;}
    if(growthOpen||discoveryOpen)return;
    const onBlur=()=>pause('focus');
    const onVisibility=()=>{if(document.visibilityState!=='visible')pause('focus');};
    window.addEventListener('blur',onBlur);document.addEventListener('visibilitychange',onVisibility);
    const api=(window as Window & {vantilo?:HostBridge}).vantilo;
    const unsubscribe=api?.onSystemSuspended?.(()=>pause('focus'));
    return()=>{window.removeEventListener('blur',onBlur);document.removeEventListener('visibilitychange',onVisibility);unsubscribe?.();};
  },[visible,growthOpen,discoveryOpen,status,pause]);
  React.useEffect(()=>{if(!session.reminder)return;const id=window.setTimeout(()=>setSession(current=>({...current,reminder:false,active:false})),30000);return()=>clearTimeout(id);},[session.reminder]);
  React.useEffect(()=>{
    const id=window.setInterval(()=>{
      const t=Date.now();setNow(t);
      setSession(current=>{
        if(!growthStorageValid)return pauseSession(current);
        const next=tickSession(current,t);
        if(next.record!==current.record){saveGrowthRecord(next.record);window.dispatchEvent(new Event('vantilo:growth-updated'));}
        return next;
      });
    },1000);
    return()=>clearInterval(id);
  },[growthStorageValid]);
  React.useEffect(()=>{
    const receive=(event:MessageEvent<BridgeMessage>)=>{
      if(event.source!==frameRef.current?.contentWindow||event.origin!==origin||!event.data||typeof event.data!=='object')return;
      const data=event.data;
      if(data.type==='vantilo:reader-ready'){navigate();return;}
      if(data.type==='vantilo:open-environment-settings'){onSetup?.();return;}
      if(data.type==='vantilo:open-discovery'){
        if(!instanceToken||data.token!==instanceToken)return;
        if(typeof data.documentId==='string'&&typeof data.bookId==='string'&&typeof data.pageId==='string')setSession(current=>current.documentId===data.documentId&&current.bookId===data.bookId&&current.pageId===data.pageId?leaveReadingSession(current,data.documentId!,data.pageId):current);
        setDiscoveryOpen(true);return;
      }
      if(data.type==='vantilo:reader-appearance'&&isReaderAppearance(data)){onAppearanceChange?.({theme:data.theme,fontSize:data.fontSize,fontFamily:data.fontFamily});return;}
      if(data.type==='vantilo:growth-ready'&&data.token===instanceToken){if(initRetryRef.current!==null){clearInterval(initRetryRef.current);initRetryRef.current=null;}return;}
      if(!instanceToken||data.token!==instanceToken)return;
      if(data.type==='vantilo:vocabulary-backup-status-request'){
        const api=(window as Window & {vantilo?:HostBridge}).vantilo;
        void api?.getVocabularyBackupStatus?.().then(result=>frameRef.current?.contentWindow?.postMessage({type:'vantilo:vocabulary-backup-last-status',token:instanceToken,lastBackup:result.lastBackup},origin)).catch(()=>frameRef.current?.contentWindow?.postMessage({type:'vantilo:vocabulary-backup-last-status',token:instanceToken,lastBackup:null},origin));return;
      }
      if(data.type==='vantilo:vocabulary-backup-reveal'){
        void (window as Window & {vantilo?:HostBridge}).vantilo?.revealVocabularyBackup?.().catch(()=>{});return;
      }
      if(data.type==='vantilo:vocabulary-backup-start'&&typeof data.requestId==='string'&&/^[0-9a-f-]{36}$/i.test(data.requestId)){
        if(vocabularyBackupRequestRef.current)return;
        const api=(window as Window & {vantilo?:HostBridge}).vantilo;
        if(!api?.startVocabularyBackup){frameRef.current?.contentWindow?.postMessage({type:'vantilo:vocabulary-backup-status',token:instanceToken,requestId:data.requestId,phase:'FAILED',message:'桌面词汇备份通道不可用。',terminal:true},origin);return;}
        vocabularyBackupRequestRef.current=data.requestId;
        void api.startVocabularyBackup(data.requestId).then(result=>{if(result?.canceled){frameRef.current?.contentWindow?.postMessage({type:'vantilo:vocabulary-backup-status',token:instanceToken,requestId:data.requestId,phase:'CANCELLED',message:'已取消词汇备份。',terminal:true},origin);if(vocabularyBackupRequestRef.current===data.requestId)vocabularyBackupRequestRef.current=null;}},error=>{const canceled=error instanceof Error&&error.message==='词汇备份已取消';frameRef.current?.contentWindow?.postMessage({type:'vantilo:vocabulary-backup-status',token:instanceToken,requestId:data.requestId,phase:canceled?'CANCELLED':'FAILED',message:canceled?'已取消词汇备份。':error instanceof Error?error.message:'词汇备份失败。',terminal:true},origin);});return;
      }
      if(data.type==='vantilo:vocabulary-backup-snapshot'&&typeof data.requestId==='string'&&data.requestId===vocabularyBackupRequestRef.current&&data.snapshot&&typeof data.snapshot==='object'){
        const api=(window as Window & {vantilo?:HostBridge}).vantilo;
        if(!api?.submitVocabularyBackupSnapshot){void api?.cancelVocabularyBackup?.(data.requestId);return;}
        void api.submitVocabularyBackupSnapshot(data.requestId,data.snapshot).catch(error=>{void api.cancelVocabularyBackup?.(data.requestId!);frameRef.current?.contentWindow?.postMessage({type:'vantilo:vocabulary-backup-status',token:instanceToken,requestId:data.requestId,phase:'FAILED',message:error instanceof Error?error.message:'词汇数据快照提交失败。',terminal:true},origin);});return;
      }
      if(data.type==='vantilo:vocabulary-backup-cancel'&&typeof data.requestId==='string'&&data.requestId===vocabularyBackupRequestRef.current){void (window as Window & {vantilo?:HostBridge}).vantilo?.cancelVocabularyBackup?.(data.requestId);return;}
      if(data.type==='vantilo:vocabulary-backup-error'&&typeof data.requestId==='string'&&data.requestId===vocabularyBackupRequestRef.current){
        const api=(window as Window & {vantilo?:HostBridge}).vantilo;
        void api?.cancelVocabularyBackup?.(data.requestId);
        frameRef.current?.contentWindow?.postMessage({type:'vantilo:vocabulary-backup-status',token:instanceToken,requestId:data.requestId,phase:'FAILED',message:typeof data.message==='string'?data.message:'词汇数据快照失败。',terminal:true},origin);return;
      }
      if(data.type==='vantilo:growth-leave'&&typeof data.documentId==='string'&&typeof data.bookId==='string'&&typeof data.pageId==='string'){
        setSession(current=>current.documentId===data.documentId&&current.bookId===data.bookId&&current.pageId===data.pageId?leaveReadingSession(current,data.documentId!,data.pageId):current);return;
      }
      if(data.type==='vantilo:growth-open-request'){setSession(current=>current.documentId?leaveReadingSession(current,current.documentId,current.pageId??undefined):current);setDiscoveryOpen(false);setGrowthOpen(true);return;}
      if(data.type==='vantilo:growth-resume-request'){if(growthStorageValid&&visible&&document.hasFocus())continueReading();return;}
      if(data.type==='vantilo:growth-state'&&typeof data.bookId==='string'&&data.bookId.length>0&&data.bookId.length<=512&&typeof data.documentId==='string'&&data.documentId.length>0&&data.documentId.length<=512&&typeof data.pageId==='string'&&data.pageId.length>0&&data.pageId.length<=128&&(data.mode==='sentence'||data.mode==='article')&&typeof data.english==='boolean'){
        setSession(current=>{
          const now=Date.now();
          let next=acceptReaderState(current,{bookId:data.bookId!,documentId:data.documentId!,pageId:data.pageId!,mode:data.mode!,english:data.english!},now);
          if(!growthStorageValid)next=pauseSession(next,'focus');
          else if(next.bookId&&next.active&&(!visible||!document.hasFocus()))next=pauseSession(next,'focus');
          return next;
        });return;
      }
      if(data.type==='vantilo:growth-activity'&&['sentence','lookup','translation','scroll'].includes(data.action||'')){
        if(!growthStorageValid||!visible||growthOpen||discoveryOpen||!document.hasFocus()||typeof data.documentId!=='string'||typeof data.pageId!=='string')return;
        const activityAt=Date.now();if(activityAt-lastActivityAt.current<1500)return;lastActivityAt.current=activityAt;
        setSession(current=>current.documentId===data.documentId&&current.pageId===data.pageId?readerActivity(current,activityAt):current);
      }
    };
    window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
  },[origin,navigate,onSetup,onAppearanceChange,instanceToken,visible,growthOpen,discoveryOpen,growthStorageValid]);
  React.useEffect(()=>{
    const api=(window as Window & {vantilo?:HostBridge}).vantilo;
    return api?.onVocabularyBackupEvent?.((event)=>{
      if(!event||event.requestId!==vocabularyBackupRequestRef.current||!frameRef.current?.contentWindow||!instanceToken)return;
      frameRef.current.contentWindow.postMessage({...event,type:`vantilo:vocabulary-backup-${event.type}`,token:instanceToken},origin);
      if(event.type==='resume'&&vocabularyBackupRequestRef.current===event.requestId)vocabularyBackupRequestRef.current=null;
    });
  },[instanceToken,origin]);
  React.useEffect(()=>{if(!instanceToken||!frameRef.current?.contentWindow)return;const send=()=>frameRef.current?.contentWindow?.postMessage({type:'vantilo:growth-summary',token:instanceToken,seconds:daily,active:session.active,canResume:Boolean(growthStorageValid&&session.bookId&&session.mode)},origin);send();const id=window.setInterval(send,1000);return()=>clearInterval(id);},[instanceToken,daily,session.active,session.bookId,session.mode,growthStorageValid,origin]);
  React.useEffect(()=>{if(status==='ready')navigate();},[status,navigate]);
  const onFrameLoad=()=>{
    setSession(current=>current.documentId?leaveReadingSession(current,current.documentId,current.pageId??undefined):current);if(initRetryRef.current!==null)clearInterval(initRetryRef.current);
    const token=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}-${Math.random()}`;
    setInstanceToken(token);const send=()=>frameRef.current?.contentWindow?.postMessage({type:'vantilo:growth-init',token},'*');send();
    let attempts=0;initRetryRef.current=window.setInterval(()=>{send();if(++attempts>=30&&initRetryRef.current!==null){clearInterval(initRetryRef.current);initRetryRef.current=null;}},300);navigate();
  };
  const continueReading=()=>{if(growthStorageValid)setSession(current=>resumeSession(current,Date.now()));};
  return <section className="magazine-reader-module" aria-label="Magazine Reader" hidden={!visible}>
    {growthOpen?<>{!growthStorageValid&&<div className="growth-storage-error" role="alert">阅读成长数据格式无效，计时已暂停，原始数据未覆盖。请先检查或恢复一份有效备份。</div>}<ReadingGrowthPage onBack={()=>setGrowthOpen(false)}/></>:discoveryOpen?<BookDiscovery onBack={()=>setDiscoveryOpen(false)} onOpenShelf={()=>{setDiscoveryOpen(false);frameRef.current?.contentWindow?.postMessage({type:'vantilo:navigate',target:'library'},origin);}}/>:status==='ready'?<iframe ref={frameRef} onLoad={onFrameLoad} className="magazine-reader-frame" title="Magazine Reader" src={MAGAZINE_READER_URL} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" referrerPolicy="no-referrer"/>:status==='error'?<div className="magazine-reader-state" role="alert"><h2>无法打开 Magazine Reader</h2><p className="magazine-reader-error">{error||'阅读模块启动失败。'}</p><div className="magazine-reader-state-actions"><button type="button" onClick={onRetry}>重试</button></div></div>:<div className="magazine-reader-state" role="status" aria-live="polite"><span className="magazine-reader-spinner" aria-hidden="true"/><h2>正在启动阅读空间…</h2><p>正在连接本机 Magazine Reader 服务，请稍候。</p></div>}
    {session.reminder&&visible&&!growthOpen&&<aside className="growth-reminder" role="alertdialog" aria-label="阅读提醒"><strong>还在阅读吗？</strong><p>计时已暂停，你的阅读成果已保存。</p><button onClick={continueReading}>继续阅读</button><button onClick={()=>setSession(s=>pauseSession(s,'user'))}>先暂停</button></aside>}
    {daily>=1800&&daily-1<1800&&<div className="growth-success" role="status">今日30分钟阅读目标已达成，继续阅读也会累计。</div>}
  </section>;
}
