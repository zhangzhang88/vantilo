import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isTrustedSender, isTrustedPageUrl } = require('../electron/ipc-security.cjs') as { isTrustedSender:(event:any,options:any)=>boolean; isTrustedPageUrl:(url:string,options:any)=>boolean };

describe('renderer IPC boundary',()=>{
  it('accepts only the main Vantilo frame and expected origin',()=>{const frame={url:'http://127.0.0.1:5173/'};const webContents={mainFrame:frame};const win={webContents};expect(isTrustedSender({sender:webContents,senderFrame:frame},{win,packaged:false})).toBe(true);expect(isTrustedSender({sender:{},senderFrame:frame},{win,packaged:false})).toBe(false);expect(isTrustedSender({sender:webContents,senderFrame:{url:'http://127.0.0.1:5174/'}},{win,packaged:false})).toBe(false);expect(isTrustedSender({sender:webContents,senderFrame:{url:'http://127.0.0.1:5173.evil.test/'}},{win,packaged:false})).toBe(false);});
  it('accepts only the exact canonical packaged renderer file URL',()=>{
    const rendererPath=path.resolve('/isolated-vantilo-app/dist/index.html');
    const trusted=pathToFileURL(rendererPath).href;
    const options={packaged:true,rendererPath};
    expect(isTrustedPageUrl(trusted,options)).toBe(true);
    expect(isTrustedPageUrl(pathToFileURL(path.resolve('/untrusted/dist/index.html/attacker.html')).href,options)).toBe(false);
    expect(isTrustedPageUrl(pathToFileURL(path.resolve('/isolated-vantilo-app/dist/index.html.attacker.html')).href,options)).toBe(false);
    expect(isTrustedPageUrl(trusted.replace('/index.html','/%69ndex.html'),options)).toBe(false);
    expect(isTrustedPageUrl(trusted.replace('/dist/index.html','/dist/../dist/index.html'),options)).toBe(false);
    expect(isTrustedPageUrl(trusted.replace('/dist/index.html','/dist/%2e%2e/dist/index.html'),options)).toBe(false);
    expect(isTrustedPageUrl(`${trusted}?mode=1`,options)).toBe(false);
    expect(isTrustedPageUrl(`${trusted}#fragment`,options)).toBe(false);
    expect(isTrustedPageUrl(trusted.replace('file:','https:'),options)).toBe(false);
    expect(isTrustedPageUrl('not a URL',options)).toBe(false);
  });
  it('uses the same page URL decision for packaged IPC senders and navigation',()=>{
    const rendererPath=path.resolve('/isolated-vantilo-app/dist/index.html');
    const exact=pathToFileURL(rendererPath).href;
    const frame={url:exact}; const webContents={mainFrame:frame}; const win={webContents};
    const options={win,packaged:true,rendererPath};
    expect(isTrustedPageUrl(exact,options)).toBe(true);
    expect(isTrustedSender({sender:webContents,senderFrame:frame},options)).toBe(true);
    const forged=pathToFileURL(path.resolve('/untrusted/dist/index.html')).href;
    frame.url=forged;
    expect(isTrustedPageUrl(forged,options)).toBe(false);
    expect(isTrustedSender({sender:webContents,senderFrame:frame},options)).toBe(false);
  });
  it('preserves restricted development origin behavior',()=>{
    const rendererPath=path.resolve('/unused/dist/index.html');
    expect(isTrustedPageUrl('http://127.0.0.1:5173/',{packaged:false,rendererPath})).toBe(true);
    expect(isTrustedPageUrl('http://127.0.0.1:5173/app?tab=1',{packaged:false,rendererPath})).toBe(true);
    expect(isTrustedPageUrl('http://127.0.0.1:5174/',{packaged:false,rendererPath})).toBe(false);
    expect(isTrustedPageUrl('http://127.0.0.1:5173.evil.test/',{packaged:false,rendererPath})).toBe(false);
    expect(isTrustedPageUrl('https://127.0.0.1:5173/',{packaged:false,rendererPath})).toBe(false);
  });
  it('exposes only named, payload-limited preload methods and cleans up listeners',()=>{const exposed:any={};const handlers=new Map<string,Function>();const removed=vi.fn();const ipcRenderer={invoke:vi.fn(async(channel:string,...args:any[])=>({channel,args})),on:vi.fn((channel:string,fn:Function)=>handlers.set(channel,fn)),removeListener:removed};const contextBridge={exposeInMainWorld:vi.fn((name:string,value:any)=>exposed[name]=value)};const source=readFileSync(path.resolve('electron/preload.cjs'),'utf8');runInNewContext(source,{require:(name:string)=>name==='electron'?{contextBridge,ipcRenderer}:require(name),TypeError});expect(Object.keys(exposed.vantilo).sort()).toEqual(['cancelTask','checkReaderSetup','chooseWorkspace','clearWorkspace','createSession','deleteSession','finishReaderSetup','getAccountStatus','getMagazineReaderStatus','getReaderSetupState','getRuntimeStatus','getWorkspace','listCodexModels','listProjects','listSessions','loginWithChatGPT','logoutAccount','onAgentEvent','onRuntimeStatus','onSystemSuspended','openDictionaryApp','openSession','pickWorkspaceReferences','renameSession','requestGutenberg','resolveToolApproval','setSessionModelConfig','showProjectMenu','showSessionMenu','startMagazineReader','submitTask','syncMagazineReader']);void exposed.vantilo.getAccountStatus('ignored');expect(ipcRenderer.invoke).toHaveBeenCalledWith('account:status');void exposed.vantilo.loginWithChatGPT('https://evil.test');expect(ipcRenderer.invoke).toHaveBeenCalledWith('account:login');void exposed.vantilo.logoutAccount('ignored');expect(ipcRenderer.invoke).toHaveBeenCalledWith('account:logout');void exposed.vantilo.submitTask('20000000-0000-4000-8000-000000000001','hello');expect(ipcRenderer.invoke).toHaveBeenCalledWith('agent:submit','20000000-0000-4000-8000-000000000001','hello');void exposed.vantilo.syncMagazineReader('https://evil.test');expect(ipcRenderer.invoke).toHaveBeenCalledWith('magazine-reader:sync');void exposed.vantilo.getMagazineReaderStatus();expect(ipcRenderer.invoke).toHaveBeenCalledWith('magazine-reader:status');void exposed.vantilo.startMagazineReader('https://evil.test', '/arbitrary/path');expect(ipcRenderer.invoke).toHaveBeenCalledWith('magazine-reader:start');void exposed.vantilo.chooseWorkspace();expect(ipcRenderer.invoke).toHaveBeenCalledWith('workspace:choose');void exposed.vantilo.deleteSession('20000000-0000-4000-8000-000000000001');expect(ipcRenderer.invoke).toHaveBeenCalledWith('sessions:delete','20000000-0000-4000-8000-000000000001');void exposed.vantilo.pickWorkspaceReferences();expect(ipcRenderer.invoke).toHaveBeenCalledWith('workspace:pick-references');void exposed.vantilo.showProjectMenu('/authorized/project');expect(ipcRenderer.invoke).toHaveBeenCalledWith('workspace:project-menu','/authorized/project');void exposed.vantilo.showSessionMenu('20000000-0000-4000-8000-000000000001');expect(ipcRenderer.invoke).toHaveBeenCalledWith('sessions:context-menu','20000000-0000-4000-8000-000000000001');void exposed.vantilo.renameSession('20000000-0000-4000-8000-000000000001','Renamed');expect(ipcRenderer.invoke).toHaveBeenCalledWith('sessions:rename','20000000-0000-4000-8000-000000000001','Renamed');expect(exposed.vantilo.setWorkspace).toBeUndefined();for(const method of ['inspectLocalModel','chooseLocalModel','recheckLocalModel','installLocalModel','cancelLocalModel','onLocalModelProgress','viewLocalModelInfo'])expect(exposed.vantilo[method]).toBeUndefined();void exposed.vantilo.resolveToolApproval('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','approved');expect(ipcRenderer.invoke).toHaveBeenCalledWith('tool:approval',{approvalId:'30000000-0000-4000-8000-000000000001',sessionId:'20000000-0000-4000-8000-000000000001',taskId:'30000000-0000-4000-8000-000000000002',decision:'approved'});const callback=vi.fn();const unsubscribe=exposed.vantilo.onAgentEvent(callback);handlers.get('agent:event')!({}, {type:'delta'});expect(callback).toHaveBeenCalledWith({type:'delta'});unsubscribe();expect(removed).toHaveBeenCalledWith('agent:event',expect.any(Function));});
});