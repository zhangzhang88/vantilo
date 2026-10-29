// @vitest-environment jsdom
import React from 'react';
import {cleanup,render,screen} from '@testing-library/react';
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
