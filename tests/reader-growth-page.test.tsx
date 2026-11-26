// @vitest-environment jsdom
import React from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ReadingGrowthPage} from '../src/reader/growth-page';

afterEach(()=>{cleanup();vi.useRealTimers();localStorage.clear();});

it('shows floored, zero-padded durations in the growth page without changing stored fractional seconds',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,29,10));
  const record={days:{'2026-10-29':{seconds:285.45599999999996,books:{'book:real':285.45599999999996}}}};
  localStorage.setItem('vantilo-reading-growth-v1',JSON.stringify(record));
  render(<ReadingGrowthPage onBack={()=>{}}/>);
  const page=screen.getByRole('main');
  expect(page.textContent).toContain('04:45 / 30:00');
  expect(page.textContent).toContain('累计阅读04:45');
  expect(page.textContent).toContain('2026-10-29');
  expect(page.textContent).toContain('2026-10-2904:45');
  expect(JSON.parse(localStorage.getItem('vantilo-reading-growth-v1')!).days['2026-10-29'].seconds).toBe(285.45599999999996);
});

it('switches daily reading goals, renders the 7-day trend chart, and browses previous months',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,29,10));
  const record={days:{
    '2026-09-15':{seconds:950,books:{'book:real':950}},
    '2026-10-29':{seconds:950,books:{'book:real':950}},
  }};
  localStorage.setItem('vantilo-reading-growth-v1',JSON.stringify(record));
  render(<ReadingGrowthPage onBack={()=>{}}/>);
  expect(screen.getByLabelText('近 7 天阅读趋势')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'15 分钟'}));
  expect(localStorage.getItem('vantilo-reading-goal-v1')).toBe('900');
  expect(screen.getByText('今日目标已达成，继续阅读也会累计。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'上个月'}));
  expect(screen.getByText('2026年9月')).toBeTruthy();
  expect(screen.getByText(/本月累计 15:50 · 活跃 1 天 · 达标 1 天/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'回到本月'}));
  expect(screen.getByText('2026年10月')).toBeTruthy();
});
