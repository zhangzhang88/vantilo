import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);

describe('Reader main-process IPC', () => {
  it('requires the Vantilo main frame and rejects startup payloads', async () => {
    const handlers = new Map<string, Function>();
    const start = vi.fn();
    const checkHealth = vi.fn();
    const windows: any[] = [];
    const windowOptions: any[] = [];
    class BrowserWindow {
      webContents: any;
      constructor(options: unknown) {
        windowOptions.push(options);
        const frame = { url: 'http://127.0.0.1:5173/' };
        this.webContents = { mainFrame: frame, on: vi.fn(), setWindowOpenHandler: vi.fn() };
        windows.push(this);
      }
      loadURL() {}
    }
    const app = { getPath: () => '/tmp/vantilo', getVersion: () => '0.1.1', setName() {}, setPath() {},
      isPackaged: false, on() {}, whenReady: () => ({ then: (fn: Function) => fn() }) };
    const runtime = { on() {}, start: () => Promise.resolve() };
    runInNewContext(readFileSync('electron/main.cjs', 'utf8'), {
      require: (name: string) => name === 'electron' ? {
        app, BrowserWindow, Menu: { buildFromTemplate: vi.fn(), setApplicationMenu() {} },
        session: { defaultSession: { on: vi.fn() } }, powerMonitor: { on: vi.fn() },
        ipcMain: { handle: (key: string, fn: Function) => handlers.set(key, fn) },
      } : name === './runtime-supervisor.cjs' ? { RuntimeSupervisor: function () { return runtime; } }
        : name === './portable-reader-supervisor.cjs' ? {
          PortableReaderSupervisor: function () { return { start, checkHealth }; },
        } : name.startsWith('./') ? require('../electron/' + name.slice(2)) : require(name),
      process: { platform: 'darwin', env: { VANTILO_DEV_SERVER_URL: 'http://127.0.0.1:5173/' }, cwd: () => '/tmp' },
      __dirname: '/tmp/vantilo/electron', module: { exports: {} }, URL,
    });
    expect(windowOptions[0]).toMatchObject({
      titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 },
    });
    const contents = windows[0].webContents;
    const trusted = { sender: contents, senderFrame: contents.mainFrame };
    const reader = { sender: contents, senderFrame: { url: 'http://127.0.0.1:5175/' } };
    for (const channel of ['magazine-reader:start', 'magazine-reader:status', 'magazine-reader:sync']) {
      expect(() => handlers.get(channel)!(reader)).toThrow(/Untrusted/);
    }
    expect(() => handlers.get('magazine-reader:start')!(trusted, 'https://example.com')).toThrow(/Invalid/);
    expect(start).not.toHaveBeenCalled();
    handlers.get('magazine-reader:start')!(trusted);
    handlers.get('magazine-reader:status')!(trusted);
    expect(start).toHaveBeenCalledOnce();
    expect(checkHealth).toHaveBeenCalledOnce();
  });
});
