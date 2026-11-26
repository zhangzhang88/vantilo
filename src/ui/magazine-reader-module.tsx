import React from 'react';
import { createPortal } from 'react-dom';
import { AudiobookDock } from '../../packages/reader/src/frontend/audiobook-dock';
import { isAudiobookSnapshot, type AudiobookAction, type AudiobookSnapshot } from '../../packages/reader/src/shared/audiobook-bridge';
import './magazine-reader-module.css';
import { ReadingGrowthPage } from '../reader/growth-page';
import { readDailyGoalSeconds, readGrowthRecord, saveGrowthRecord, growthStats, emptyGrowthRecord, isValidGrowthRecord, READING_GROWTH_STORAGE_KEY } from '../reader/growth';
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
type BgTranslationState = { id: string; bookId: string; bookTitle: string; statusText: string };
type BridgeMessage = {type:string;token?:string;bookId?:string;documentId?:string;pageId?:string;mode?:'sentence'|'article';english?:boolean;action?:'sentence'|'lookup'|'translation'|'scroll';requestId?:string;operation?:'snapshot'|'replace'|'clear';record?:unknown;snapshot?:unknown;state?:unknown;message?:unknown;terminal?:boolean};
function isBgTranslationState(value: unknown): value is BgTranslationState {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.length > 0 && typeof item.bookId === 'string' && item.bookId.length > 0
    && typeof item.bookTitle === 'string' && typeof item.statusText === 'string';
}
type VocabularyBackupEvent = {type:'freeze'|'unfreeze'|'resume'|'status';requestId:string;phase?:string;progress?:number;message?:string;result?:{name:string;size:number;sha256:string;vocabularyCount:number}};
type HostBridge = {onSystemSuspended?:(callback:()=>void)=>()=>void;onTtsInstallUpdated?:(callback:(event:{installed:boolean})=>void)=>()=>void;onCustomApiUpdated?:(callback:(event:{configured:boolean})=>void)=>()=>void;onVocabularyBackupEvent?:(callback:(event:VocabularyBackupEvent)=>void)=>()=>void;startVocabularyBackup?:(requestId:string)=>Promise<{canceled?:boolean}>;submitVocabularyBackupSnapshot?:(requestId:string,snapshot:unknown)=>Promise<{accepted:boolean}>;cancelVocabularyBackup?:(requestId:string)=>Promise<{canceled:boolean}>;revealVocabularyBackup?:()=>Promise<{shown:boolean}>;getVocabularyBackupStatus?:()=>Promise<{lastBackup:{createdAt:string;name:string;path:string;size:number;sha256:string;vocabularyCount:number}|null}>};

export function MagazineReaderModule({navigationRequest,status,error,onRetry,onBack,syncState,onSync,onSetup,onAppearanceChange,audiobookTarget,onShowReader,visible=true}: {
  navigationRequest?:{target:'settings'|'library'|'practice';sequence:number};status:MagazineReaderStatus;error:string|null;onRetry:()=>void;onBack:()=>void;syncState?:MagazineSyncState|null;onSync?:()=>void;onSetup?:()=>void;onAppearanceChange?:(appearance:ReaderAppearance)=>void;visible?:boolean;audiobookTarget?:HTMLElement|null;onShowReader?:()=>void;
}) {
  const frameRef=React.useRef<HTMLIFrameElement>(null);
  const [growthOpen,setGrowthOpen]=React.useState(false);
  const [instanceToken,setInstanceToken]=React.useState<string|null>(null);
  const [audiobook,setAudiobook]=React.useState<AudiobookSnapshot|null>(null);
  const [bgTranslation,setBgTranslation]=React.useState<BgTranslationState|null>(null);
  const lastActivityAt=React.useRef(0);
  const initRetryRef=React.useRef<number|null>(null);
  const [session,setSession]=React.useState<SessionState>(()=>createReadingSession(readGrowthRecord()));
  const sessionRef=React.useRef(session);sessionRef.current=session;
  const vocabularyBackupRequestRef=React.useRef<string|null>(null);
  const [growthStorageValid,setGrowthStorageValid]=React.useState(()=>{try{const raw=localStorage.getItem(READING_GROWTH_STORAGE_KEY);return raw===null||isValidGrowthRecord(JSON.parse(raw));}catch{return false;}});
  const [goalSeconds,setGoalSeconds]=React.useState(readDailyGoalSeconds);
  const [now,setNow]=React.useState(()=>Date.now());
  const stats=growthStats(session.record,new Date(now),goalSeconds);
  const daily=stats.todaySeconds;
  React.useEffect(()=>{
    const syncGoal=()=>setGoalSeconds(readDailyGoalSeconds());
    window.addEventListener('vantilo:growth-goal-updated',syncGoal);
    window.addEventListener('storage',syncGoal);
    return()=>{window.removeEventListener('vantilo:growth-goal-updated',syncGoal);window.removeEventListener('storage',syncGoal);};
  },[]);
  const origin=new URL(MAGAZINE_READER_URL).origin;
  const navigate=React.useCallback(()=>{if(navigationRequest)frameRef.current?.contentWindow?.postMessage({type:'vantilo:navigate',target:navigationRequest.target},origin);},[navigationRequest,origin]);
  const pause=React.useCallback((reason:ReadingPauseReason='focus')=>setSession(current=>pauseSession(current,reason)),[]);
  React.useEffect(()=>{
    if(!visible||status!=='ready'){pause('focus');return;}
    if(growthOpen)return;
    const onBlur=()=>pause('focus');
    const onVisibility=()=>{if(document.visibilityState!=='visible')pause('focus');};
    window.addEventListener('blur',onBlur);document.addEventListener('visibilitychange',onVisibility);
    const api=(window as Window & {vantilo?:HostBridge}).vantilo;
    const unsubscribe=api?.onSystemSuspended?.(()=>pause('focus'));
    return()=>{window.removeEventListener('blur',onBlur);document.removeEventListener('visibilitychange',onVisibility);unsubscribe?.();};
  },[visible,growthOpen,status,pause]);
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
    if(status!=='ready'){setAudiobook(null);setBgTranslation(null);}
  },[status]);
  React.useEffect(()=>{
    const receive=(event:MessageEvent<BridgeMessage>)=>{
      if(event.source!==frameRef.current?.contentWindow||event.origin!==origin||!event.data||typeof event.data!=='object')return;
      const data=event.data;
      if(data.type==='vantilo:reader-ready'){navigate();return;}
      if(data.type==='vantilo:audiobook-ready'){
        if(instanceToken)frameRef.current?.contentWindow?.postMessage({type:'vantilo:audiobook-connect',token:instanceToken},origin);
        return;
      }
      if(data.type==='vantilo:audiobook-state'){
        if(instanceToken&&data.token===instanceToken&&(data.snapshot===null||isAudiobookSnapshot(data.snapshot)))setAudiobook(data.snapshot);
        return;
      }
      if(data.type==='vantilo:bg-translation-state'){
        if(data.state===null||isBgTranslationState(data.state))setBgTranslation(data.state);
        return;
      }
      if(data.type==='vantilo:open-environment-settings'){onSetup?.();return;}
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
      if(data.type==='vantilo:growth-open-request'){setSession(current=>current.documentId?leaveReadingSession(current,current.documentId,current.pageId??undefined):current);setGrowthOpen(true);return;}
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
        if(!growthStorageValid||!visible||growthOpen||!document.hasFocus()||typeof data.documentId!=='string'||typeof data.pageId!=='string')return;
        const activityAt=Date.now();if(activityAt-lastActivityAt.current<1500)return;lastActivityAt.current=activityAt;
        setSession(current=>current.documentId===data.documentId&&current.pageId===data.pageId?readerActivity(current,activityAt):current);
      }
    };
    window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
  },[origin,navigate,onSetup,onAppearanceChange,instanceToken,visible,growthOpen,growthStorageValid]);
  React.useEffect(()=>{
    const api=(window as Window & {vantilo?:HostBridge}).vantilo;
    return api?.onTtsInstallUpdated?.((event)=>{
      frameRef.current?.contentWindow?.postMessage({type:'vantilo:tts-installer-updated',installed:Boolean(event?.installed)},origin);
    });
  },[origin]);
  React.useEffect(()=>{
    const api=(window as Window & {vantilo?:HostBridge}).vantilo;
    return api?.onCustomApiUpdated?.((event)=>{
      frameRef.current?.contentWindow?.postMessage({type:'vantilo:custom-api-updated',configured:Boolean(event?.configured)},origin);
    });
  },[origin]);
  React.useEffect(()=>{
    const api=(window as Window & {vantilo?:HostBridge}).vantilo;
    return api?.onVocabularyBackupEvent?.((event)=>{
      if(!event||event.requestId!==vocabularyBackupRequestRef.current||!frameRef.current?.contentWindow||!instanceToken)return;
      frameRef.current.contentWindow.postMessage({...event,type:`vantilo:vocabulary-backup-${event.type}`,token:instanceToken},origin);
      if(event.type==='resume'&&vocabularyBackupRequestRef.current===event.requestId)vocabularyBackupRequestRef.current=null;
    });
  },[instanceToken,origin]);
  React.useEffect(()=>{if(!instanceToken||!frameRef.current?.contentWindow)return;const send=()=>frameRef.current?.contentWindow?.postMessage({type:'vantilo:growth-summary',token:instanceToken,seconds:daily,goalSeconds,streak:stats.streak,active:session.active,canResume:Boolean(growthStorageValid&&session.bookId&&session.mode)},origin);send();const id=window.setInterval(send,1000);return()=>clearInterval(id);},[instanceToken,daily,goalSeconds,stats.streak,session.active,session.bookId,session.mode,growthStorageValid,origin]);
  React.useEffect(()=>{
    if(status!=='ready'||!navigationRequest)return;
    setGrowthOpen(false);
    navigate();
  },[status,navigate,navigationRequest]);
  const onFrameLoad=()=>{
    setSession(current=>current.documentId?leaveReadingSession(current,current.documentId,current.pageId??undefined):current);if(initRetryRef.current!==null)clearInterval(initRetryRef.current);
    const token=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}-${Math.random()}`;
    setAudiobook(null);
    setBgTranslation(null);
    setInstanceToken(token);
    const frame=frameRef.current?.contentWindow;
    frame?.postMessage({type:'vantilo:audiobook-connect',token},origin);
    const send=()=>frameRef.current?.contentWindow?.postMessage({type:'vantilo:growth-init',token},origin);send();
    let attempts=0;initRetryRef.current=window.setInterval(()=>{send();if(++attempts>=30&&initRetryRef.current!==null){clearInterval(initRetryRef.current);initRetryRef.current=null;}},300);navigate();
  };
  const continueReading=()=>{if(growthStorageValid)setSession(current=>resumeSession(current,Date.now()));};
  const sendAudiobookAction=React.useCallback((action:AudiobookAction)=>{
    if(!instanceToken||!audiobook)return;
    if(action.type==='return'||action.type==='return-original'){
      setGrowthOpen(false);
      onShowReader?.();
    }
    frameRef.current?.contentWindow?.postMessage({type:'vantilo:audiobook-control',token:instanceToken,sessionId:audiobook.sessionId,action},origin);
  },[instanceToken,audiobook?.sessionId,onShowReader,origin]);
  return <>
  <section className="magazine-reader-module" aria-label="Magazine Reader" hidden={!visible}>
    {status==='ready'&&<iframe ref={frameRef} onLoad={onFrameLoad} className="magazine-reader-frame" title="Magazine Reader"
      hidden={growthOpen} src={MAGAZINE_READER_URL} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
      allow="autoplay 'src'; clipboard-write 'src'" referrerPolicy="no-referrer"/>}
    {growthOpen?<>{!growthStorageValid&&<div className="growth-storage-error" role="alert">阅读成长数据格式无效，计时已暂停，原始数据未覆盖。</div>}<ReadingGrowthPage onBack={()=>setGrowthOpen(false)}/></>
      :status==='error'?<div className="magazine-reader-state" role="alert"><h2>无法打开 Magazine Reader</h2><p className="magazine-reader-error">{error||'阅读模块启动失败。'}</p><div className="magazine-reader-state-actions"><button onClick={onRetry}>重试</button></div></div>
      :status!=='ready'?<div className="magazine-reader-state" role="status" aria-live="polite"><span className="magazine-reader-spinner" aria-hidden="true"/><h2>正在启动阅读空间…</h2><p>正在连接本机 Magazine Reader 服务，请稍候。</p></div>:null}
    {session.reminder&&visible&&!growthOpen&&<aside className="growth-reminder" role="alertdialog" aria-label="阅读提醒"><strong>还在阅读吗？</strong><p>计时已暂停，你的阅读成果已保存。</p><button onClick={continueReading}>继续阅读</button><button onClick={()=>setSession(s=>pauseSession(s,'user'))}>先暂停</button></aside>}
    {daily>=goalSeconds&&daily-1<goalSeconds&&<div className="growth-success" role="status">今日{Math.round(goalSeconds/60)}分钟阅读目标已达成，继续阅读也会累计。</div>}
    {visible&&growthOpen&&bgTranslation&&<aside className="host-bg-translation-pill" aria-label="后台全书翻译">
      <span className="host-bg-translation-dot" aria-hidden="true"/>
      <span role="status" className="host-bg-translation-status">{bgTranslation.statusText}</span>
      <span className="host-bg-translation-actions">
        <button type="button" className="host-bg-translation-open" title={bgTranslation.bookTitle} onClick={()=>{setGrowthOpen(false);onShowReader?.();frameRef.current?.contentWindow?.postMessage({type:'vantilo:bg-translation-action',action:'open',bookId:bgTranslation.bookId},origin);}}>查看《{bgTranslation.bookTitle}》</button>
        <button type="button" onClick={()=>{frameRef.current?.contentWindow?.postMessage({type:'vantilo:bg-translation-action',action:'pause',jobId:bgTranslation.id},origin);}}>暂停全书翻译</button>
      </span>
    </aside>}
  </section>
    {audiobookTarget&&audiobook&&createPortal(<AudiobookDock key={audiobook.sessionId} state={audiobook}
      send={sendAudiobookAction} onOpenTtsSetup={onSetup}/>,audiobookTarget)}
  </>;
}
