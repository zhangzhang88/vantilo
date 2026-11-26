import React from 'react';
import { formatReadingDuration, growthStats, localDayKey, monthSummary, readDailyGoalSeconds, readGrowthRecord, READING_GOAL_PRESETS, recentDaysSeries, saveDailyGoalSeconds } from './growth';
import './growth.css';

export function ReadingGrowthPage({ onBack }: { onBack: () => void }) {
  const [record, setRecord] = React.useState(readGrowthRecord);
  const [goalSeconds, setGoalSeconds] = React.useState(readDailyGoalSeconds);
  const today = new Date();
  const [viewMonth, setViewMonth] = React.useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));

  React.useEffect(() => {
    const update = () => {
      setRecord(readGrowthRecord());
      setGoalSeconds(readDailyGoalSeconds());
    };
    window.addEventListener('storage', update);
    window.addEventListener('vantilo:growth-updated', update);
    window.addEventListener('vantilo:growth-goal-updated', update);
    const id = setInterval(update, 1000);
    return () => {
      clearInterval(id);
      window.removeEventListener('storage', update);
      window.removeEventListener('vantilo:growth-updated', update);
      window.removeEventListener('vantilo:growth-goal-updated', update);
    };
  }, []);

  const changeGoal = (seconds: number) => {
    const saved = saveDailyGoalSeconds(seconds);
    setGoalSeconds(saved);
    window.dispatchEvent(new Event('vantilo:growth-goal-updated'));
  };

  const stats = growthStats(record, today, goalSeconds);
  const weekly = recentDaysSeries(record, today, 7, goalSeconds);
  const maxWeekSeconds = Math.max(goalSeconds, ...weekly.map(item => item.seconds), 1);
  const goalLineBottomPct = Math.min(100, Math.round((goalSeconds / maxWeekSeconds) * 100));
  const days = Object.keys(record.days).sort().reverse();
  const first = new Date(viewMonth.year, viewMonth.month, 1);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
  const todayKey = localDayKey(today);
  const isCurrentMonth = viewMonth.year === today.getFullYear() && viewMonth.month === today.getMonth();
  const monthStats = monthSummary(record, viewMonth.year, viewMonth.month, goalSeconds);

  const shiftMonth = (delta: number) => {
    setViewMonth(current => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  return <div className="reading-growth-page" role="main">
    <header className="reading-growth-header">
      <button type="button" onClick={onBack}>← 返回阅读空间</button>
      <h1>我的阅读成长</h1>
      <p>每天一点英文阅读，都会留下来。</p>
    </header>
    <section className="reading-growth-today">
      <div className="reading-growth-today-head">
        <small>今天</small>
        <div className="reading-growth-goal-picker" role="group" aria-label="每日阅读目标">
          <span>每日目标</span>
          {READING_GOAL_PRESETS.map(preset => (
            <button
              key={preset}
              type="button"
              className={goalSeconds === preset ? 'is-active' : ''}
              aria-pressed={goalSeconds === preset}
              onClick={() => changeGoal(preset)}
            >
              {Math.round(preset / 60)} 分钟
            </button>
          ))}
        </div>
      </div>
      <strong>{formatReadingDuration(stats.todaySeconds)} <span>/ {formatReadingDuration(goalSeconds)}</span></strong>
      <div className="reading-growth-track"><i style={{ width: `${Math.min(100, stats.todaySeconds / goalSeconds * 100)}%` }} /></div>
      <p>{stats.todaySeconds >= goalSeconds ? '今日目标已达成，继续阅读也会累计。' : `距离今日目标还差 ${formatReadingDuration(Math.max(0, goalSeconds - stats.todaySeconds))}`}</p>
    </section>
    <section className="reading-growth-stats" aria-label="阅读统计">
      <article><small>累计阅读</small><strong>{formatReadingDuration(stats.totalSeconds)}</strong></article>
      <article><small>累计达标</small><strong>{stats.qualifiedDays} 天</strong></article>
      <article><small>当前连续</small><strong>{stats.streak} 天</strong></article>
      <article><small>最长连续</small><strong>{stats.bestStreak} 天</strong></article>
    </section>
    <section className="reading-growth-week" aria-label="近 7 天阅读趋势">
      <div className="reading-growth-section-head">
        <h2>近 7 天阅读趋势</h2>
        <small>目标线 {Math.round(goalSeconds / 60)} 分钟/天</small>
      </div>
      <div className="reading-growth-bars">
        <div className="reading-growth-goal-line" style={{ bottom: `${goalLineBottomPct}%` }} aria-hidden="true" />
        {weekly.map(item => {
          const heightPct = item.seconds > 0 ? Math.max(8, Math.round((item.seconds / maxWeekSeconds) * 100)) : 0;
          return <div className={`reading-growth-bar-col${item.isToday ? ' is-today' : ''}`} key={item.key} title={`${item.key}：${formatReadingDuration(item.seconds)}`}>
            <div className="reading-growth-bar-track">
              {item.seconds > 0 && <div className={`reading-growth-bar-fill${item.qualified ? ' is-qualified' : ''}`} style={{ height: `${heightPct}%` }} />}
            </div>
            <strong>{item.weekday}</strong>
            <small>{item.dateLabel}</small>
          </div>;
        })}
      </div>
    </section>
    <section className="reading-growth-calendar">
      <div className="reading-growth-calendar-head">
        <div>
          <h2>{viewMonth.year}年{viewMonth.month + 1}月</h2>
          <small className="reading-growth-month-summary">
            本月累计 {formatReadingDuration(monthStats.totalSeconds)} · 活跃 {monthStats.activeDays} 天 · 达标 {monthStats.qualifiedDays} 天
          </small>
        </div>
        <div className="reading-growth-month-nav">
          <button type="button" aria-label="上个月" onClick={() => shiftMonth(-1)}>‹ 上月</button>
          {!isCurrentMonth && <button type="button" onClick={() => setViewMonth({ year: today.getFullYear(), month: today.getMonth() })}>回到本月</button>}
          <button type="button" aria-label="下个月" disabled={isCurrentMonth} onClick={() => shiftMonth(1)}>下月 ›</button>
        </div>
      </div>
      <div className="reading-growth-grid" aria-label="本月阅读日历">
        {'一二三四五六日'.split('').map((day, index) => <b key={`weekday-${index}`}>{day}</b>)}
        {Array.from({ length: offset }, (_, index) => <i key={`empty-${index}`} aria-hidden="true" />)}
        {Array.from({ length: count }, (_, index) => {
          const date = new Date(viewMonth.year, viewMonth.month, index + 1);
          const key = localDayKey(date);
          const day = record.days[key];
          const seconds = day?.seconds ?? 0;
          const levelClass = seconds >= goalSeconds ? 'complete' : seconds >= goalSeconds * 0.5 ? 'partial level-2' : seconds > 0 ? 'partial level-1' : '';
          const todayClass = key === todayKey ? ' is-today' : '';
          return <span key={key} title={`${key}：${formatReadingDuration(seconds)}`} className={`${levelClass}${todayClass}`.trim()}>{index + 1}</span>;
        })}
      </div>
    </section>
    <section className="reading-growth-history">
      <h2>每日阅读</h2>
      {days.length ? days.slice(0, 60).map(key => <div className="reading-growth-history-row" key={key}><time dateTime={key}>{key}</time><strong>{formatReadingDuration(record.days[key].seconds)}</strong></div>) : <p>开始阅读后，这里会记录你的真实阅读积累。</p>}
    </section>
  </div>;
}
