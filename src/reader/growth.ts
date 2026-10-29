export const DAILY_GOAL_SECONDS = 1800;
export type GrowthDay = { seconds: number; books: Record<string, number> };
export type GrowthRecord = { days: Record<string, GrowthDay> };
export const READING_GROWTH_STORAGE_KEY = 'vantilo-reading-growth-v1';
export function formatReadingDuration(seconds:number):string {
  const wholeSeconds=Math.floor(Math.max(0,Number.isFinite(seconds)?seconds:0));
  return `${String(Math.floor(wholeSeconds/60)).padStart(2,'0')}:${String(wholeSeconds%60).padStart(2,'0')}`;
}
export const emptyGrowthRecord = (): GrowthRecord => ({ days: {} });
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function addReadingSeconds(record: GrowthRecord, bookId: string, seconds: number, at: Date): GrowthRecord {
  if (!Number.isFinite(seconds) || seconds <= 0 || !bookId) return record;
  const days = { ...record.days }, key = localDayKey(at), old = days[key] ?? { seconds: 0, books: {} };
  const books = { ...old.books, [bookId]: (old.books[bookId] ?? 0) + seconds };
  days[key] = { seconds: old.seconds + seconds, books };
  return { days };
}
export function splitAtMidnight(record: GrowthRecord, bookId: string, from: Date, to: Date): GrowthRecord {
  let result = record, cursor = from.getTime(), end = to.getTime();
  while (cursor < end) {
    const d = new Date(cursor), midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()+1).getTime();
    const segmentEnd = Math.min(end, midnight);
    result = addReadingSeconds(result, bookId, (segmentEnd-cursor)/1000, d);
    cursor = segmentEnd;
  }
  return result;
}
export function growthStats(record: GrowthRecord, today = new Date()) {
  const keys = Object.keys(record.days).sort(), total = keys.reduce((sum,key)=>sum+record.days[key].seconds,0);
  const qualified = keys.filter(key=>record.days[key].seconds >= DAILY_GOAL_SECONDS);
  let streak = 0, cursor = new Date(today.getFullYear(),today.getMonth(),today.getDate());
  if (!qualified.includes(localDayKey(cursor))) cursor.setDate(cursor.getDate()-1);
  while (qualified.includes(localDayKey(cursor))) { streak++; cursor.setDate(cursor.getDate()-1); }
  const best = (()=>{let max=0,count=0,previous:number|null=null; for(const key of qualified){const [year,month,day]=key.split('-').map(Number);const ordinal=Date.UTC(year,month-1,day)/86400000;if(previous!==null&&ordinal-previous===1)count++;else count=1;max=Math.max(max,count);previous=ordinal;}return max;})();
  return { totalSeconds: total, qualifiedDays: qualified.length, streak, bestStreak: best, todaySeconds: record.days[localDayKey(today)]?.seconds ?? 0 };
}
export function isValidGrowthRecord(value: unknown): value is GrowthRecord {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const days=(value as Record<string,unknown>).days;
  if(!days||typeof days!=='object'||Array.isArray(days)||Object.keys(days).length>20000)return false;
  for(const [date,raw] of Object.entries(days)){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;const parsedDate=new Date(`${date}T00:00:00Z`);if(!Number.isFinite(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==date)return false;
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
    const day=raw as Record<string,unknown>,books=day.books;
    if(typeof day.seconds!=='number'||!Number.isFinite(day.seconds)||day.seconds<0||day.seconds>86400||!books||typeof books!=='object'||Array.isArray(books)||Object.keys(books).length>1000)return false;
    let sum=0;
    for(const [id,seconds] of Object.entries(books)){
      if(!id.trim()||id.length>512||typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0||seconds>86400)return false;
      sum+=seconds;
    }
    if(Math.abs(sum-day.seconds)>0.01)return false;
  }
  return true;
}
export function readGrowthRecord(storage: Pick<Storage,'getItem'> = localStorage): GrowthRecord {
  try { const value=JSON.parse(storage.getItem(READING_GROWTH_STORAGE_KEY)||'null'); if(isValidGrowthRecord(value)) return value; } catch {} return emptyGrowthRecord();
}
export function saveGrowthRecord(record: GrowthRecord, storage: Pick<Storage,'setItem'> = localStorage) { if(!isValidGrowthRecord(record)) throw new Error('阅读成长记录格式无效');storage.setItem(READING_GROWTH_STORAGE_KEY, JSON.stringify(record)); }
