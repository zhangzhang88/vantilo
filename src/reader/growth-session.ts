import { DAILY_GOAL_SECONDS, splitAtMidnight, type GrowthRecord } from './growth';
export type ReadingMode='sentence'|'article';
export type ReadingPauseReason='navigation'|'user'|'idle'|'focus';
export type SessionState={active:boolean;pausedByIdle:boolean;reminder:boolean;mode:ReadingMode|null;bookId:string|null;documentId:string|null;pageId:string|null;navigationPageId:string|null;pauseReasons:ReadingPauseReason[];lastActivity:number;lastTick:number|null;record:GrowthRecord};
const deriveActive=(s:SessionState,reasons:ReadingPauseReason[])=>reasons.length===0&&Boolean(s.bookId&&s.mode);
export const createReadingSession=(record:GrowthRecord):SessionState=>({active:false,pausedByIdle:false,reminder:false,mode:null,bookId:null,documentId:null,pageId:null,navigationPageId:null,pauseReasons:[],lastActivity:0,lastTick:null,record});
export function acceptReaderState(s:SessionState,input:{bookId:string;documentId?:string;pageId?:string;mode:ReadingMode;english:boolean},now:number):SessionState {
 const documentId=input.documentId??input.bookId;
 const pageId=input.pageId??documentId;
 if(s.pauseReasons.includes('navigation')&&s.navigationPageId&&s.navigationPageId===pageId)return s;
 if(!input.bookId||!input.english){const returnedFromNavigation=s.pauseReasons.includes('navigation')&&s.navigationPageId!==pageId;const pauseReasons=returnedFromNavigation?s.pauseReasons.filter(reason=>reason!=='navigation'):s.pauseReasons;return {...s,active:false,mode:null,bookId:null,documentId:null,pageId:null,navigationPageId:returnedFromNavigation?null:s.navigationPageId,pauseReasons,pausedByIdle:pauseReasons.includes('idle'),lastTick:null,reminder:false};}
 const changed=s.bookId!==input.bookId||s.documentId!==documentId||s.pageId!==pageId||s.mode!==input.mode;
 const returnedFromNavigation=s.pauseReasons.includes('navigation')&&s.navigationPageId!==pageId;
 const pauseReasons=returnedFromNavigation?s.pauseReasons.filter(reason=>reason!=='navigation'):s.pauseReasons;
 const next={...s,bookId:input.bookId,documentId,pageId,navigationPageId:returnedFromNavigation?null:s.navigationPageId,mode:input.mode,pauseReasons};
 const active=deriveActive(next,pauseReasons);
 const withActivity={...next,active,lastActivity:changed&&active?now:s.lastActivity,lastTick:changed&&active?now:s.lastTick,reminder:pauseReasons.includes('idle')&&!pauseReasons.includes('user')};
 return {...withActivity,pausedByIdle:pauseReasons.includes('idle')};
}
export function leaveReadingSession(s:SessionState,documentId:string,pageId?:string):SessionState {
 if(!documentId||!s.documentId||s.documentId!==documentId||(pageId&&s.pageId!==pageId))return s;
 const pauseReasons:ReadingPauseReason[]=s.pauseReasons.includes('navigation')?s.pauseReasons:[...s.pauseReasons,'navigation'];
 const next={...s,active:false,bookId:null,documentId:null,pageId:null,navigationPageId:pageId??s.pageId,mode:null,pauseReasons,lastTick:null,reminder:false};
 return {...next,pausedByIdle:pauseReasons.includes('idle')};
}
export function readerActivity(s:SessionState,now:number):SessionState {
 if(!s.bookId||!s.mode||s.pauseReasons.some(reason=>reason==='navigation'||reason==='user'||reason==='idle'))return s;
 const pauseReasons=s.pauseReasons.filter(reason=>reason!=='focus');
 return {...s,pauseReasons,active:deriveActive(s,pauseReasons),lastActivity:now,lastTick:now,reminder:false};
}
export function pauseSession(s:SessionState,reason:ReadingPauseReason='focus'):SessionState {
 const pauseReasons=s.pauseReasons.includes(reason)?s.pauseReasons:[...s.pauseReasons,reason];
 return {...s,active:false,pauseReasons,pausedByIdle:pauseReasons.includes('idle'),lastTick:null,reminder:reason==='idle'};
}
export function resumeSession(s:SessionState,now:number):SessionState {
 if(!s.bookId||!s.mode)return s;
 const pauseReasons:ReadingPauseReason[]=[];
 return {...s,pauseReasons,active:deriveActive(s,pauseReasons),navigationPageId:null,pausedByIdle:false,lastActivity:now,lastTick:now,reminder:false};
}
export function tickSession(s:SessionState,now:number):SessionState {
 if(!s.active||!s.bookId||!s.mode||s.lastTick===null)return s;
 const idleLimit=s.mode==='sentence'?120_000:240_000;
 if(now-s.lastActivity>=idleLimit)return pauseSession(s,'idle');
 const elapsed=Math.max(0,Math.min(2000,now-s.lastTick));
 return {...s,record:splitAtMidnight(s.record,s.bookId,new Date(s.lastTick),new Date(s.lastTick+elapsed)),lastTick:now};
}
export function qualifiesToday(s:SessionState,day:string){return (s.record.days[day]?.seconds??0)>=DAILY_GOAL_SECONDS;}
