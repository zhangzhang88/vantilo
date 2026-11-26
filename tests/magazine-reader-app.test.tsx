// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const entry = vi.hoisted(() => ({ node: null as React.ReactNode }));
vi.mock('react-dom/client', async importOriginal => {
  const original = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...original,
    createRoot: (container: HTMLElement, options: any) => container
      ? original.createRoot(container, options)
      : { render: (node: React.ReactNode) => { entry.node = node; } },
  };
});
vi.mock('@react-spectrum/s2', () => ({
  Provider: ({ children }: any) => <>{children}</>,
  ActionButton: ({ children, onPress, isDisabled, 'aria-label': label }: any) =>
    <button onClick={onPress} disabled={isDisabled} aria-label={label}>{children}</button>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  Tooltip: () => null,
}));
vi.mock('@react-spectrum/s2/icons/Folder', () => ({ default: () => null }));
vi.mock('@react-spectrum/s2/icons/Lightbulb', () => ({ default: () => null }));
vi.mock('@react-spectrum/s2/icons/Settings', () => ({ default: () => null }));

beforeAll(async () => { await import('../src/main'); });
afterEach(() => { cleanup(); delete window.vantilo; vi.useRealTimers(); });

function mount(overrides: Partial<NonNullable<Window['vantilo']>> = {}) {
  const api = {
    startMagazineReader: vi.fn(async () => ({ ready: true })),
    getMagazineReaderStatus: vi.fn(async () => ({ status: 'ready', error: null as string | null })),
    syncMagazineReader: vi.fn(async () => ({ accepted: true })),
    startVocabularyBackup: vi.fn(async () => ({ canceled: true })),
    submitVocabularyBackupSnapshot: vi.fn(async () => ({ accepted: true })),
    cancelVocabularyBackup: vi.fn(async () => ({ canceled: true })),
    revealVocabularyBackup: vi.fn(async () => ({ shown: true })),
    getVocabularyBackupStatus: vi.fn(async () => ({ lastBackup: null })),
    onVocabularyBackupEvent: vi.fn(() => () => {}),
    getReaderSetupState: vi.fn(async () => ({ show: false })),
    checkReaderSetup: vi.fn(async () => ({ dictionary: 'bilingual' as const, hardware: { appleSilicon: true, memoryGiB: 16 }, localAi: 'not-integrated' as const })),
    finishReaderSetup: vi.fn(async () => ({ show: false })),
    openDictionaryApp: vi.fn(async () => ({ opened: true })),
    ...overrides,
  };
  window.vantilo = api as unknown as NonNullable<Window['vantilo']>;
  render(entry.node);
  return api;
}

describe('Vantilo pure Reading & Learning application', () => {
  it('starts directly into Magazine Reader without Agent or ChatGPT login controls', async () => {
    const api = mount();
    await screen.findByTitle('Magazine Reader');
    expect(api.startMagazineReader).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '对话' })).toBeNull();
    expect(screen.queryByRole('button', { name: '登录 ChatGPT' })).toBeNull();
    expect(screen.queryByRole('button', { name: '退出账号' })).toBeNull();
    expect(document.querySelector('.app-rail')).toBeNull();
    expect(screen.queryByRole('button', { name: '展开侧边导航' })).toBeNull();
    const settingsButton = screen.getByRole('button', { name: '设置' });
    expect(settingsButton).toBeTruthy();
    expect(settingsButton.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(settingsButton);
    expect(settingsButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('allows retrying a genuine startup error', async () => {
    const startMagazineReader = vi.fn()
      .mockRejectedValueOnce(new Error('端口冲突'))
      .mockResolvedValueOnce({ ready: true });
    mount({ startMagazineReader });
    await screen.findByText('端口冲突');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByTitle('Magazine Reader');
    expect(startMagazineReader).toHaveBeenCalledTimes(2);
  });

  it('shows a running-service failure and recovers on retry', async () => {
    vi.useFakeTimers();
    let status: { status: string; error: string | null } = { status: 'ready', error: null };
    const api = mount({
      getMagazineReaderStatus: vi.fn(async () => status),
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTitle('Magazine Reader')).toBeTruthy();
    status = { status: 'error', error: '阅读进程意外退出' };
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('阅读进程意外退出')).toBeTruthy();
    status = { status: 'ready', error: null };
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByTitle('Magazine Reader');
    expect(api.startMagazineReader).toHaveBeenCalledTimes(2);
  });

  it('navigates between Reader, Practice Lab, and Settings without replacing the Reader iframe', async () => {
    mount();
    const frame = await screen.findByTitle('Magazine Reader') as HTMLIFrameElement;
    const posted: unknown[] = [];
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      value: { postMessage: (msg: unknown) => posted.push(msg) },
    });
    fireEvent.keyDown(window, { key: '2', metaKey: true });
    expect(screen.getByTitle('Magazine Reader')).toBe(frame);
    expect(posted).toContainEqual({ type: 'vantilo:navigate', target: 'practice' });

    expect(screen.queryByRole('button', { name: 'Practice Lab' })).toBeNull();
    expect(screen.queryByRole('button', { name: '阅读' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByTitle('Magazine Reader')).toBe(frame);
    expect(posted).toContainEqual({ type: 'vantilo:navigate', target: 'settings' });

    fireEvent.keyDown(window, { key: '1', metaKey: true });
    expect(screen.getByTitle('Magazine Reader')).toBe(frame);
    expect(posted).toContainEqual({ type: 'vantilo:navigate', target: 'library' });
  });
});
