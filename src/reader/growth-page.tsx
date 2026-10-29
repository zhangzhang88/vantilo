import React from 'react';
import { DAILY_GOAL_SECONDS, formatReadingDuration, growthStats, localDayKey, readGrowthRecord } from './growth';
import './growth.css';

export function ReadingGrowthPage({ onBack }: { onBack: () => void }) {
  const [record, setRecord] = React.useState(readGrowthRecord);
  React.useEffect(() => {
    const update = () => setRecord(readGrowthRecord());
    window.addEventListener('storage', update);
    window.addEventListener('vantilo:growth-updated', update);
    const id = setInterval(update, 1000);
    return () => {
      clearInterval(id);
      window.removeEventListener('storage', update);
      window.removeEventListener('vantilo:growth-updated', update);
    };
  }, []);

  const today = new Date();
  const stats = growthStats(record, today);
  const days = Object.keys(record.days).sort().reverse();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

  return <div className="reading-growth-page" role="main">
    <header className="reading-growth-header">
      <button type="button" onClick={onBack}>← 返回阅读空间</button>
      <h1>我的阅读成长</h1>
      <p>每天一点英文阅读，都会留下来。</p>
    </header>
    <section className="reading-growth-today">
      <small>今天</small>
      <strong>{formatReadingDuration(stats.todaySeconds)} <span>/ {formatReadingDuration(DAILY_GOAL_SECONDS)}</span></strong>
      <div className="reading-growth-track"><i style={{ width: `${Math.min(100, stats.todaySeconds / DAILY_GOAL_SECONDS * 100)}%` }} /></div>
      <p>{stats.todaySeconds >= DAILY_GOAL_SECONDS ? '今日目标已达成，继续阅读也会累计。' : `距离今日目标还差 ${formatReadingDuration(Math.max(0, DAILY_GOAL_SECONDS - stats.todaySeconds))}`}</p>
    </section>
    <section className="reading-growth-stats" aria-label="阅读统计">
      <article><small>累计阅读</small><strong>{formatReadingDuration(stats.totalSeconds)}</strong></article>
      <article><small>累计达标</small><strong>{stats.qualifiedDays} 天</strong></article>
      <article><small>当前连续</small><strong>{stats.streak} 天</strong></article>
      <article><small>最长连续</small><strong>{stats.bestStreak} 天</strong></article>
    </section>
    <section className="reading-growth-calendar">
      <h2>{today.getFullYear()}年{today.getMonth() + 1}月</h2>
      <div className="reading-growth-grid" aria-label="本月阅读日历">
        {'一二三四五六日'.split('').map((day, index) => <b key={`weekday-${index}`}>{day}</b>)}
        {Array.from({ length: offset }, (_, index) => <i key={`empty-${index}`} aria-hidden="true" />)}
        {Array.from({ length: count }, (_, index) => {
          const date = new Date(today.getFullYear(), today.getMonth(), index + 1);
          const day = record.days[localDayKey(date)];
          return <span key={index} title={`${index + 1}日：${formatReadingDuration(day?.seconds ?? 0)}`} className={day?.seconds >= DAILY_GOAL_SECONDS ? 'complete' : day?.seconds ? 'partial' : ''}>{index + 1}</span>;
        })}
      </div>
    </section>
    <section className="reading-growth-history">
      <h2>每日阅读</h2>
      {days.length ? days.slice(0, 60).map(key => <div className="reading-growth-history-row" key={key}><time dateTime={key}>{key}</time><strong>{formatReadingDuration(record.days[key].seconds)}</strong></div>) : <p>开始阅读后，这里会记录你的真实阅读积累。</p>}
    </section>
  </div>;
}
