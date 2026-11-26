import { describe, expect, it } from 'vitest';
import { addReadingSeconds, emptyGrowthRecord, formatReadingDuration, growthStats, localDayKey, monthSummary, readDailyGoalSeconds, recentDaysSeries, saveDailyGoalSeconds, splitAtMidnight, readGrowthRecord, saveGrowthRecord } from '../src/reader/growth';

describe('reading growth date accounting',()=>{
 it('formats fractional elapsed seconds as stable zero-padded MM:SS without rounding stored time',()=>{expect(formatReadingDuration(285.45599999999996)).toBe('04:45');expect(formatReadingDuration(59.999)).toBe('00:59');expect(formatReadingDuration(3600.8)).toBe('60:00');expect(formatReadingDuration(-1)).toBe('00:00');});
 it('accumulates sessions and qualifies each day only once',()=>{let r=emptyGrowthRecord();const d=new Date(2026,9,29,10);r=addReadingSeconds(r,'book:a',600,d);r=addReadingSeconds(r,'book:a',1200,d);r=addReadingSeconds(r,'book:b',60,d);expect(growthStats(r,d)).toMatchObject({todaySeconds:1860,qualifiedDays:1,totalSeconds:1860});expect(r.days[localDayKey(d)].books).toEqual({'book:a':1800,'book:b':60});});
 it('splits elapsed time at local midnight',()=>{const from=new Date(2026,9,29,23,59,30),to=new Date(2026,9,30,0,0,30);const r=splitAtMidnight(emptyGrowthRecord(),'book:x',from,to);expect(Object.values(r.days).map(x=>x.seconds)).toEqual([30,30]);});
 it('keeps accumulated results through a missed day and computes streaks',()=>{let r=emptyGrowthRecord();for(const day of [27,29])r=addReadingSeconds(r,'b',1800,new Date(2026,9,day,12));expect(growthStats(r,new Date(2026,9,29))).toMatchObject({qualifiedDays:2,streak:1,bestStreak:1});expect(growthStats(r,new Date(2026,9,30)).streak).toBe(1);});
 it('restores persisted history without overwriting older records',()=>{const store=new Map<string,string>();const storage={getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>store.set(key,value)};let r=addReadingSeconds(emptyGrowthRecord(),'book-real',321,new Date(2026,9,29,10));saveGrowthRecord(r,storage);r=addReadingSeconds(readGrowthRecord(storage),'book-real',9,new Date(2026,9,29,11));saveGrowthRecord(r,storage);expect(readGrowthRecord(storage).days['2026-10-29']).toMatchObject({seconds:330,books:{'book-real':330}});});
 it('persists preset daily goals and computes 7-day trend & month summaries',()=>{
  const store=new Map<string,string>();
  const storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v)};
  expect(readDailyGoalSeconds(storage)).toBe(1800);
  expect(saveDailyGoalSeconds(900,storage)).toBe(900);
  expect(readDailyGoalSeconds(storage)).toBe(900);
  expect(()=>saveDailyGoalSeconds(123,storage)).toThrow();
  let r=emptyGrowthRecord();
  r=addReadingSeconds(r,'b1',950,new Date(2026,9,28,10));
  r=addReadingSeconds(r,'b1',500,new Date(2026,9,29,10));
  expect(growthStats(r,new Date(2026,9,29),900)).toMatchObject({qualifiedDays:1,streak:1});
  const series=recentDaysSeries(r,new Date(2026,9,29),7,900);
  expect(series).toHaveLength(7);
  expect(series[5]).toMatchObject({key:'2026-10-28',qualified:true,ratio:1});
  expect(series[6]).toMatchObject({key:'2026-10-29',isToday:true,qualified:false});
  expect(monthSummary(r,2026,9,900)).toEqual({totalSeconds:1450,activeDays:2,qualifiedDays:1});
 });
});
