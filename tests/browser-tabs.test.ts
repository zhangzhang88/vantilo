import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { installIsolatedWebTabs } = require('../electron/isolated-web-tabs.cjs');

class FakeContents extends EventEmitter {
  url = '';
  title = '';
  mainFrame = {};
  closed = false;
  loaded: string[] = [];
  sent: Array<{ channel: string; payload: unknown }> = [];
  navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() };
  getURL() { return this.url; }
  getTitle() { return this.title; }
  send(channel: string, payload: unknown) { this.sent.push({ channel, payload }); }
  isLoading() { return false; }
  isDestroyed() { return this.closed; }
  setWindowOpenHandler(handler: Function) { this.windowOpenHandler = handler; }
  windowOpenHandler: Function | null = null;
  loadURL(url: string) { this.loaded.push(url); return Promise.resolve(); }
  reload() {}
  close() { this.closed = true; this.emit('destroyed'); }
}
class FakeView {
  static instances: FakeView[] = [];
  webContents = new FakeContents();
  visible = false;
  bounds = { x: 0, y: 0, width: 0, height: 0 };
  constructor(public options: any) { FakeView.instances.push(this); }
  setVisible(value: boolean) { this.visible = value; }
  setBounds(value: any) { this.bounds = value; }
}
class FakeOwner extends EventEmitter {
  webContents = new FakeContents();
  children: FakeView[] = [];
  contentView = { addChildView: (view: FakeView) => this.children.push(view), removeChildView: (view: FakeView) => { this.children = this.children.filter(item => item !== view); } };
  isDestroyed() { return false; }
  getContentBounds() { return { x: 0, y: 0, width: 900, height: 700 }; }
}
function harness() {
  FakeView.instances = [];
  const owner = new FakeOwner();
  owner.webContents.url = 'http://127.0.0.1:5173/';
  const handlers = new Map<string, Function>();
  const ipcMain = { handle: (name: string, handler: Function) => handlers.set(name, handler) };
  const isolatedSession: any = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() },
  });
  const session = { fromPartition: vi.fn(() => isolatedSession) };
  const BrowserWindow = { getAllWindows: () => [owner], fromWebContents: (contents: FakeContents) => contents === owner.webContents ? owner : null };
  const trustedSender = (event: any) => event.sender === owner.webContents && event.senderFrame === owner.webContents.mainFrame;
  installIsolatedWebTabs({ ipcMain, BrowserWindow, WebContentsView: FakeView, session, trustedSender });
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame };
  return { handlers, owner, event, isolatedSession, session, trustedSender };
}

describe('sandboxed Browser tab host', () => {
  it('creates an isolated WebContentsView and only permits validated external navigation', async () => {
    const { handlers, owner, event, isolatedSession } = harness();
    const id = await handlers.get('browser:create')!(event);
    const view = FakeView.instances[0]!;
    expect(view.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false });
    expect(view.options.webPreferences).not.toHaveProperty('preload');
    expect(view.visible).toBe(false);
    expect(owner.children).toContain(view);
    expect(isolatedSession.setPermissionRequestHandler).toHaveBeenCalledOnce();
    const requestPermission=isolatedSession.setPermissionRequestHandler.mock.calls[0]![0];
    const permissionCallback=vi.fn();
    requestPermission({},'geolocation',permissionCallback,{requestingUrl:'https://example.com/'});
    expect(permissionCallback).toHaveBeenCalledOnce();
    expect(permissionCallback).toHaveBeenCalledWith(false);
    const checkPermission=isolatedSession.setPermissionCheckHandler.mock.calls[0]![0];
    for(const permission of ['geolocation','geolocation-approximate','media','display-capture','notifications']) expect(checkPermission(null,permission,'https://example.com/',{})).toBe(false);
    const devicePermission=isolatedSession.setDevicePermissionHandler.mock.calls[0]![0];
    expect(devicePermission({deviceType:'usb',origin:'https://example.com/'})).toBe(false);
    expect(view.webContents.windowOpenHandler).not.toBeNull();
    expect(view.webContents.windowOpenHandler!({},'https://example.com/')).toEqual({action:'deny'});
    const requestGate=isolatedSession.webRequest.onBeforeRequest.mock.calls[0]![0];
    let localRequest:any;requestGate({url:'http://127.0.0.1/private'},(result:any)=>{localRequest=result});
    expect(localRequest).toEqual({cancel:true});
    let externalRequest:any;requestGate({url:'https://example.com/image.png'},(result:any)=>{externalRequest=result});
    expect(externalRequest).toEqual({cancel:false});
    expect(handlers.get('browser:navigate')!(event, id, 'http://127.0.0.1:5173/')).toMatchObject({ ok: false, reason: 'app-origin' });
    expect(view.webContents.loaded).toEqual([]);
    expect(handlers.get('browser:navigate')!(event, id, 'https://example.com/path')).toEqual({ ok: true, url: 'https://example.com/path' });
    expect(view.webContents.loaded).toEqual(['https://example.com/path']);
  });
  it('rejects untrusted callers and tab identifiers owned by another window', async () => {
    const { handlers, owner, event } = harness();
    expect(() => handlers.get('browser:create')!({ sender: {}, senderFrame: {} })).toThrow(/Untrusted/);
    const id = await handlers.get('browser:create')!(event);
    const otherEvent = { sender: new FakeContents(), senderFrame: {} };
    expect(() => handlers.get('browser:navigate')!(otherEvent, id, 'https://example.com')).toThrow(/unavailable/);
    expect(owner.children).toHaveLength(1);
  });
  it('clamps browser bounds to the owning window and destroys a tab on close', async () => {
    const { handlers, owner, event } = harness();
    const id = await handlers.get('browser:create')!(event);
    const view = FakeView.instances[0]!;
    expect(handlers.get('browser:bounds')!(event, id, { x: 850, y: 650, width: 300, height: 200 })).toBe(true);
    expect(view.bounds).toEqual({ x: 850, y: 650, width: 50, height: 50 });
    expect(handlers.get('browser:visible')!(event, id, true)).toBe(true);
    expect(view.visible).toBe(true);
    expect(handlers.get('browser:close')!(event, id)).toBe(true);
    expect(owner.children).toHaveLength(0);
    expect(view.webContents.closed).toBe(true);
  });
});
