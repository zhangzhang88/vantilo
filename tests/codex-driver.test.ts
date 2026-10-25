import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CodexDriver, resolveCodexPath } = require('../electron/codex-driver.cjs') as { CodexDriver: new(options:any)=>any; resolveCodexPath:(env:any)=>string|null };

class FakeChild extends EventEmitter {
  stdout = new PassThrough(); stderr = new PassThrough(); stdin = new PassThrough(); exitCode: number|null = null; killed = false;
  messages: any[] = [];
  constructor() { super(); this.stdin.on('data', data => { for (const line of String(data).trim().split('\n')) { try { this.messages.push(JSON.parse(line)); } catch {} } }); }
  reply(id: number, result: unknown) { const line=Buffer.from(JSON.stringify({jsonrpc:'2.0',id,result})+'\n'); this.stdout.write(line.subarray(0,7)); this.stdout.write(line.subarray(7)); }
  notify(method:string,params:unknown) { this.stdout.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n'); }
  kill(signal='SIGTERM') { this.killed=true; this.exitCode=signal==='SIGKILL'?137:0; queueMicrotask(()=>this.emit('exit',this.exitCode,signal)); return true; }
}

function setup(options:Record<string,unknown>={}) {
  const child=new FakeChild();let spawnArgs:string[]=[]; const driver=new CodexDriver({ command:'/codex', cwd:'/workspace', spawnProcess:(_command:string,args:string[])=>{spawnArgs=args;return child as any;}, startupTimeoutMs:100, requestTimeoutMs:50, killTimeoutMs:20, ...options });
  const starting=driver.start(); const init=child.messages.find(x=>x.method==='initialize'); child.reply(init.id,{userAgent:'test'});
  return { child, driver, starting, spawnArgs };
}

afterEach(()=>vi.useRealTimers());

describe('Codex app-server JSONL driver',()=>{
  it('parses fragmented JSONL and correlates response IDs',async()=>{const {child,driver,starting}=setup();await starting;const p=driver.request('test/method',{});const req=child.messages.find(x=>x.method==='test/method');child.reply(req.id,{ok:true});await expect(p).resolves.toEqual({ok:true});await driver.close();});
  it('queries the real catalog protocol, filters hidden models, and forwards validated selections on thread and turn',async()=>{
    const {child,driver,starting}=setup();await starting;
    const listing=driver.listModels();await new Promise(resolve=>setImmediate(resolve));
    const listRequest=child.messages.find(message=>message.method==='model/list');
    expect(listRequest.params).toEqual({cursor:null,limit:100,includeHidden:false});
    child.reply(listRequest.id,{data:[{id:'catalog-gpt',model:'gpt-6.1-sol',displayName:'GPT 6.1 Sol',description:'Catalog entry',hidden:false,isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low',description:'Fast'},{reasoningEffort:'high',description:'Deep'}]},{id:'hidden',model:'hidden-model',displayName:'Hidden',description:'Hidden',hidden:true,isDefault:false,defaultReasoningEffort:'low',supportedReasoningEfforts:[]}],nextCursor:null});
    await expect(listing).resolves.toEqual([{id:'gpt-6.1-sol',catalogId:'catalog-gpt',displayName:'GPT 6.1 Sol',description:'Catalog entry',isDefault:true,defaultEffort:'low',efforts:[{id:'low',description:'Fast'},{id:'high',description:'Deep'}]}]);
    const task=driver.startTurn('use selected settings',null,{model:'gpt-6.1-sol',effort:'high'});await new Promise(resolve=>setImmediate(resolve));
    const thread=child.messages.find(message=>message.method==='thread/start');expect(thread.params.model).toBe('gpt-6.1-sol');
    child.reply(thread.id,{thread:{id:'thread-selected'},model:'gpt-6.1-sol'});await new Promise(resolve=>setImmediate(resolve));
    const turn=child.messages.find(message=>message.method==='turn/start');expect(turn.params).toMatchObject({threadId:'thread-selected',model:'gpt-6.1-sol',effort:'high',approvalPolicy:'never',sandboxPolicy:{type:'readOnly',networkAccess:false}});
    child.reply(turn.id,{turn:{id:'turn-selected'}});await expect(task).resolves.toMatchObject({threadId:'thread-selected',turnId:'turn-selected'});await driver.close();
  });
  it('returns an empty catalog and propagates model/list failures without inventing choices',async()=>{
    const {child,driver,starting}=setup();await starting;const empty=driver.listModels();await new Promise(resolve=>setImmediate(resolve));const request=child.messages.find(message=>message.method==='model/list');child.reply(request.id,{data:[],nextCursor:null});await expect(empty).resolves.toEqual([]);
    const failed=driver.listModels();await new Promise(resolve=>setImmediate(resolve));const next=child.messages.filter(message=>message.method==='model/list').at(-1);child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:next.id,error:{code:-1,message:'catalog unavailable'}})+'\n');await expect(failed).rejects.toThrow('catalog unavailable');await driver.close();
  });
  it('permanently deletes the selected Codex thread through the app-server protocol',async()=>{
    const {child,driver,starting}=setup();await starting;driver.threadId='thread-delete';
    const deleting=driver.deleteThread('thread-delete');await new Promise(resolve=>setImmediate(resolve));
    const request=child.messages.find(message=>message.method==='thread/delete');expect(request.params).toEqual({threadId:'thread-delete'});
    child.reply(request.id,{});await expect(deleting).resolves.toEqual({threadId:'thread-delete'});expect(driver.threadId).toBeNull();await driver.close();
  });
  it('reads the original cwd from Codex thread metadata without resuming the thread',async()=>{
    const {child,driver,starting}=setup();await starting;
    const reading=driver.readThreadCwd('thread-legacy');await new Promise(resolve=>setImmediate(resolve));
    const request=child.messages.find(message=>message.method==='thread/read');
    expect(request.params).toEqual({threadId:'thread-legacy',includeTurns:false});
    child.reply(request.id,{thread:{id:'thread-legacy',cwd:'/original/project'}});
    await expect(reading).resolves.toBe('/original/project');
    expect(driver.threadId).toBeNull();
    await driver.close();
  });
  it('enables the verified dynamic-tool protocol while disabling native shell and unrelated local capabilities',async()=>{
    const {child,driver,starting,spawnArgs}=setup();await starting;
    const init=child.messages.find(message=>message.method==='initialize');expect(init.params.capabilities.experimentalApi).toBe(true);
    for(const feature of ['shell_tool','view_image','browser_use','computer_use','apps'])expect(spawnArgs).toContain(feature);
    const definitions=[{type:'function',name:'read_workspace_file',description:'Read an approved workspace file.',inputSchema:{type:'object'}}];
    const creating=driver.createThread({dynamicTools:definitions,workspaceRoot:'/authorized/workspace'});await new Promise(resolve=>setImmediate(resolve));
    const request=child.messages.find(message=>message.method==='thread/start');
    expect(request.params).toMatchObject({cwd:'/authorized/workspace',runtimeWorkspaceRoots:['/authorized/workspace'],sandbox:'read-only',approvalPolicy:'never',dynamicTools:definitions});
    child.reply(request.id,{thread:{id:'thread-dynamic'},model:'gpt-6.1-sol'});await expect(creating).resolves.toBe('thread-dynamic');await driver.close();
  });
  it('waits for the Vantilo tool handler and returns its structured result to the Codex JSON-RPC request',async()=>{
    const {child,driver,starting}=setup();await starting;let finish:(value:any)=>void=()=>{};const handler=vi.fn(()=>new Promise(resolve=>{finish=resolve}));driver.setToolCallHandler(handler);
    child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:'codex-request-22',method:'item/tool/call',params:{threadId:'thread-a',turnId:'turn-a',callId:'call-a',namespace:null,tool:'read_workspace_file',arguments:{path:'README.md'}}})+'\n');
    await new Promise(resolve=>setImmediate(resolve));expect(handler).toHaveBeenCalledWith(expect.objectContaining({requestId:'codex-request-22',callId:'call-a',tool:'read_workspace_file'}));expect(child.messages.some(message=>message.id==='codex-request-22')).toBe(false);
    finish({success:true,contentItems:[{type:'inputText',text:'{"ok":true}'}]});await new Promise(resolve=>setImmediate(resolve));
    expect(child.messages.find(message=>message.id==='codex-request-22')).toMatchObject({jsonrpc:'2.0',result:{success:true,contentItems:[{type:'inputText',text:'{"ok":true}'}]}});await driver.close();
  });
  it('streams only real agent delta notifications',async()=>{const {child,driver,starting}=setup();await starting;const deltas:any[]=[];driver.on('delta',(x:any)=>deltas.push(x));child.notify('item/agentMessage/delta',{threadId:'t',turnId:'turn-1',delta:'real '});child.notify('item/agentMessage/delta',{threadId:'t',turnId:'turn-1',delta:'text'});const utf8=Buffer.from(JSON.stringify({jsonrpc:'2.0',method:'item/agentMessage/delta',params:{threadId:'t',turnId:'turn-1',delta:'中文'}})+'\n');const split=utf8.indexOf(Buffer.from('中'))+1;child.stdout.write(utf8.subarray(0,split));child.stdout.write(utf8.subarray(split));expect(deltas.map(x=>x.delta).join('')).toBe('real text中文');await driver.close();});
  it.each([['completed','completed'],['interrupted','cancelled'],['failed','failed']])('maps %s turn completion to %s',async(raw,expected)=>{const {child,driver,starting}=setup();await starting;const events:any[]=[];driver.on('turn',(x:any)=>events.push(x));child.notify('turn/completed',{turn:{id:'x',status:raw,error:raw==='failed'?{message:'failure'}:null}});expect(events.at(-1).status).toBe(expected);await driver.close();});
  it('rejects unexpected privileged server requests',async()=>{const {child,driver,starting}=setup();await starting;const activities:any[]=[];driver.on('activity',(x:any)=>activities.push(x));child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:91,method:'command/exec',params:{}})+'\n');expect(child.messages.at(-1)).toMatchObject({id:91,error:{code:-32000}});expect(activities[0].kind).toBe('request-rejected');await driver.close();});
  it('fails closed if an unapproved MCP server starts',async()=>{const {child,driver,starting}=setup();await starting;const failed=new Promise(resolve=>driver.once('failure',resolve));child.notify('mcpServer/startupStatus/updated',{name:'unverified-server',status:'starting'});await expect(failed).resolves.toMatchObject({message:expect.stringContaining('unapproved MCP')});expect(child.killed).toBe(true);});
  it('handles startup timeout and synchronous process launch failure',async()=>{vi.useFakeTimers();const child=new FakeChild();const driver=new CodexDriver({command:'/codex',spawnProcess:()=>child as any,startupTimeoutMs:20,requestTimeoutMs:20});const start=driver.start();const rejected=expect(start).rejects.toThrow(/timeout/i);await vi.advanceTimersByTimeAsync(25);await rejected;const broken=new CodexDriver({command:'/missing',spawnProcess:()=>{throw new Error('ENOENT')}});await expect(broken.start()).rejects.toThrow(/ENOENT/);});
  it('uses turn/start overrides instead of re-resuming an already loaded thread',async()=>{
    const {child,driver,starting}=setup();await starting;
    const resumed=driver.resumeThread('thread-saved');await new Promise(resolve=>setImmediate(resolve));
    const originalResume=child.messages.find(x=>x.method==='thread/resume');
    expect(originalResume.params).toMatchObject({threadId:'thread-saved',cwd:'/workspace',approvalPolicy:'never',sandbox:'read-only',excludeTurns:true});
    child.reply(originalResume.id,{thread:{id:'thread-saved'},model:'gpt-6-luna'});await expect(resumed).resolves.toBe('thread-saved');

    const continuing=driver.startTurn('continue','thread-saved',{model:'gpt-6.1-sol',effort:'low'});await new Promise(resolve=>setImmediate(resolve));
    const resumes=child.messages.filter(x=>x.method==='thread/resume');
    expect(resumes).toHaveLength(1);
    const turn=child.messages.find(x=>x.method==='turn/start');
    expect(turn.params).toMatchObject({threadId:'thread-saved',model:'gpt-6.1-sol',effort:'low'});
    child.reply(turn.id,{turn:{id:'turn-next'}});await expect(continuing).resolves.toMatchObject({threadId:'thread-saved',turnId:'turn-next'});
    await driver.close();
  });
  it('fails instead of continuing when Codex reports a different effective model on a resumed thread',async()=>{
    const {child,driver,starting}=setup();await starting;
    const task=driver.startTurn('must not run','thread-saved',{model:'gpt-6.1-sol',effort:'low'});await new Promise(resolve=>setImmediate(resolve));
    const request=child.messages.find(message=>message.method==='thread/resume');
    child.reply(request.id,{thread:{id:'thread-saved'},model:'gpt-6-luna'});
    await expect(task).rejects.toThrow(/not the requested model/);
    expect(child.messages.some(message=>message.method==='turn/start')).toBe(false);
    await driver.close();
  });
  it('verifies the effective model returned by thread/start before starting a turn',async()=>{
    const {child,driver,starting}=setup();await starting;
    const task=driver.startTurn('must not run',null,{model:'gpt-6.1-sol',effort:'low'});await new Promise(resolve=>setImmediate(resolve));
    const request=child.messages.find(message=>message.method==='thread/start');
    child.reply(request.id,{thread:{id:'thread-fallback'},model:'gpt-6-luna'});
    await expect(task).rejects.toThrow(/not the requested model/);
    expect(child.messages.some(message=>message.method==='turn/start')).toBe(false);
    await driver.close();
  });
  it('correlates cancellation to the active thread and turn',async()=>{const {child,driver,starting}=setup();await starting;driver.threadId='thread-1';driver.activeTurnId='turn-1';driver.turnActive=true;const cancel=driver.cancelTurn();const request=child.messages.find(x=>x.method==='turn/interrupt');expect(request.params).toEqual({threadId:'thread-1',turnId:'turn-1'});child.reply(request.id,{});await cancel;await driver.close();});
  it('waits until the server marks a turn active before interrupting it',async()=>{const {child,driver,starting}=setup();await starting;driver.threadId='thread-1';driver.activeTurnId='turn-2';const cancel=driver.cancelTurn();expect(child.messages.some(x=>x.method==='turn/interrupt')).toBe(false);child.notify('turn/started',{threadId:'thread-1',turn:{id:'turn-2'}});await new Promise(resolve=>setImmediate(resolve));const request=child.messages.find(x=>x.method==='turn/interrupt');expect(request.params).toEqual({threadId:'thread-1',turnId:'turn-2'});child.reply(request.id,{});await cancel;await driver.close();});
  it('times out individual requests and fails pending requests on disconnect',async()=>{const {child,driver,starting}=setup();await starting;const pending=driver.request('never/responds',{});const rejected=expect(pending).rejects.toThrow(/timed out/i);await new Promise(resolve=>setTimeout(resolve,60));await rejected;const next=driver.request('also/never',{});const disconnected=expect(next).rejects.toThrow(/exited/);child.emit('exit',1,null);await disconnected;});
  it('cleans the child on close and exposes executable resolution',async()=>{const {child,driver,starting}=setup();await starting;await driver.close();expect(child.killed).toBe(true);expect(resolveCodexPath({PATH:'/nonexistent'})).toContain('/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex');});
});
