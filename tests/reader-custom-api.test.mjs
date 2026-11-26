import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createReaderCustomApi,validateConfig}=require('../electron/reader-custom-api.cjs');

function safeStorage(){return {isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('encrypted:'+value),decryptString:value=>{const text=value.toString();if(!text.startsWith('encrypted:'))throw Error('bad ciphertext');return text.slice(10);}};}
const config={name:'LAN Qwen',baseUrl:'http://192.168.1.20:1234/v1/',model:'qwen3',apiKey:'secret-test-key'};

describe('custom OpenAI-compatible API provider',()=>{
 it('validates public HTTPS and permits HTTP only for local/private services',()=>{
  expect(validateConfig(config).baseUrl).toBe('http://192.168.1.20:1234/v1');
  expect(()=>validateConfig({...config,baseUrl:'http://api.example.com/v1'})).toThrow(/HTTPS/);
  expect(()=>validateConfig({...config,baseUrl:'https://user:pass@example.com/v1'})).toThrow();
  expect(()=>validateConfig({...config,baseUrl:'https://example.com/v1?key=secret'})).toThrow();
 });
 it.each(['169.254.1.23', '[fe80::1]'])('requires HTTPS for a link-local literal (%s)', host => {
  expect(() => validateConfig({ ...config, baseUrl: `http://${host}/v1` })).toThrow(/HTTPS/);
  expect(validateConfig({ ...config, baseUrl: `https://${host}/v1` }).baseUrl).toBe(`https://${host}/v1`);
 });
 it('keeps legacy link-local profiles editable while blocking their HTTP requests', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vantilo-custom-api-link-local-'));
  const filePath = path.join(dir, 'provider.json');
  const id = '00000000-0000-4000-8000-000000000001';
  const configOnDisk = { id, name: 'Legacy LAN', model: 'qwen3', baseUrl: 'http://169.254.1.23/v1' };
  const fetchImpl = vi.fn(async () => Response.json({ choices: [{ message: { content: '译文' } }] }));
  try {
   const other = { ...configOnDisk, id: '00000000-0000-4000-8000-000000000002', baseUrl: 'http://[::1]:1234/v1' };
   await writeFile(filePath, JSON.stringify({ version: 2, activeId: id, profiles: [{ config: configOnDisk }, { config: other }] }));
   const service = createReaderCustomApi({ filePath, safeStorage: safeStorage(), fetchImpl });
   expect((await service.get()).profiles).toHaveLength(2);
   await expect(service.complete({ instruction: 'Translate', input: 'Hello' })).rejects.toThrow(/HTTPS/);
   expect(fetchImpl).not.toHaveBeenCalled();
   await expect(service.complete({ instruction: 'Translate', input: 'Hello', selectedProfileId: other.id })).resolves.toBe('译文');
   await expect(service.save({ ...configOnDisk, baseUrl: 'http://localhost:1234/v1' })).resolves.toMatchObject({ id, baseUrl: 'http://localhost:1234/v1' });
   expect((await service.get()).profiles).toHaveLength(2);
  } finally {
   await rm(dir, { recursive: true, force: true });
  }
 });
 it('encrypts the key at rest, never returns it, and preserves it when the field is blank',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-custom-api-'));const filePath=path.join(dir,'provider.json');
  try{
   const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:'OK'}}]}),{headers:{'content-type':'application/json'}}));
   const service=createReaderCustomApi({filePath,safeStorage:safeStorage(),fetchImpl});
   expect(await service.save(config)).toMatchObject({configured:true,hasApiKey:true});
   const saved=await readFile(filePath,'utf8');expect(saved).not.toContain(config.apiKey);expect(saved).toContain(Buffer.from('encrypted:'+config.apiKey).toString('base64'));
   expect(await service.get()).not.toHaveProperty('apiKey');
   await service.save({...config,name:'LAN Qwen renamed',apiKey:''});
   const tested=await service.test({...config,name:'LAN Qwen renamed',apiKey:''});expect(tested.ok).toBe(true);
   await expect(service.get()).resolves.toMatchObject({name:'LAN Qwen renamed',hasApiKey:true});
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('sends a bounded OpenAI-compatible request and rejects invalid or failed responses',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-custom-api-'));const fetchImpl=vi.fn(async(_url,options)=>{
   expect(options.headers.authorization).toBe('Bearer '+config.apiKey);
   expect(JSON.parse(options.body)).toMatchObject({model:'qwen3',max_tokens:6000});
   return new Response(JSON.stringify({choices:[{message:{content:'中文翻译'}}]}),{headers:{'content-type':'application/json'}});
  });
  try{
   const service=createReaderCustomApi({filePath:path.join(dir,'provider.json'),safeStorage:safeStorage(),fetchImpl});await service.save(config);
   expect(await service.complete({instruction:'Translate faithfully.',input:'A short passage.'})).toBe('中文翻译');
   await expect(service.complete({instruction:'x',input:''})).rejects.toThrow();
   fetchImpl.mockResolvedValueOnce(new Response('denied',{status:401}));
   await expect(service.test(config)).rejects.toThrow(/HTTP 401/);
   fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({error:{message:'Invalid model for key '+config.apiKey}}),{status:400}));
   const failure=await service.test(config).catch(error=>error);expect(failure.message).toContain('Invalid model');expect(failure.message).not.toContain(config.apiKey);
   expect(fetchImpl).toHaveBeenCalledTimes(3);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('disables DeepSeek thinking for the short connection probe so it can return visible text',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-deepseek-probe-'));let sent;
  const fetchImpl=vi.fn(async(_url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'OK'}}]}),{headers:{'content-type':'application/json'}});});
  try{
   const service=createReaderCustomApi({filePath:path.join(dir,'provider.json'),safeStorage:safeStorage(),fetchImpl});
   await service.test({...config,baseUrl:'https://api.deepseek.com',model:'deepseek-flash'});
   expect(sent).toMatchObject({max_tokens:128,thinking:{type:'disabled'}});
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('uses non-thinking mode for DeepSeek context without changing regular translation',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-deepseek-context-'));const calls=[];
  const fetchImpl=vi.fn(async(_url,options)=>{calls.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{content:'结果'}}]}),{headers:{'content-type':'application/json'}});});
  try{const service=createReaderCustomApi({filePath:path.join(dir,'provider.json'),safeStorage:safeStorage(),fetchImpl});await service.save({...config,baseUrl:'https://api.deepseek.com',model:'deepseek-flash'});
   await service.complete({instruction:'解释语境',input:'bank',task:'word-context'});await service.complete({instruction:'翻译',input:'A passage.'});
   expect(calls[0]).toMatchObject({thinking:{type:'disabled'},max_tokens:1000});expect(calls[1]).not.toHaveProperty('thinking');expect(calls[1].max_tokens).toBe(6000);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('supports a local Responses endpoint on the supplied private LAN address',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-responses-api-'));
  const fetchImpl=vi.fn(async(url,options)=>{
   expect(url).toBe('http://192.168.1.20:18437/v1/responses');
   expect(JSON.parse(options.body)).toMatchObject({model:'qwen3.5-4b',instructions:'Translate faithfully.',input:'A short passage.',max_output_tokens:6000});
   return new Response(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'本地模型译文'}]}]}),{headers:{'content-type':'application/json'}});
  });
  try{
   const service=createReaderCustomApi({filePath:path.join(dir,'provider.json'),safeStorage:safeStorage(),fetchImpl});
   await service.save({name:'陪读蛙本地 Qwen',baseUrl:'http://192.168.1.20:18437/v1/responses',model:'qwen3.5-4b',apiKey:'local-key'});
   await expect(service.complete({instruction:'Translate faithfully.',input:'A short passage.'})).resolves.toBe('本地模型译文');
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('binds saved credentials to their exact service and versions edited models',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-api-identity-'));
  try {
   const fetchImpl=vi.fn(async()=>Response.json({choices:[{message:{content:'OK'}}]}));
   const filePath=path.join(dir,'provider.json');
   const service=createReaderCustomApi({filePath,safeStorage:safeStorage(),fetchImpl});
   const {customApiEngineId}=require('../electron/reader-custom-api-engines.cjs');
   const selected=await service.save(config);
   const initialEngine=customApiEngineId(selected);
   const draft={id:'',name:'Keyless LAN',model:'lan',baseUrl:'http://127.0.0.1:7777/v1',apiKey:''};
   await service.test(draft);
   await service.test({...draft,id:selected.id});
   await service.test({...config,id:selected.id,model:'alternate',apiKey:''});
   expect(fetchImpl.mock.calls.map(([,options])=>options.headers.authorization)).toEqual([undefined,undefined,'Bearer '+config.apiKey]);
   await expect(service.save({...draft,id:selected.id})).rejects.toMatchObject({code:'credential_reentry_required'});
   expect((await service.get()).baseUrl).toBe(selected.baseUrl);
   const edited=await service.save({...config,id:selected.id,model:'alternate',apiKey:''});
   expect(customApiEngineId(edited)).not.toBe(initialEngine);
   await expect(service.complete({instruction:'Translate',input:'Fixture',selectedProfileId:selected.id,expectedEngineId:initialEngine})).rejects.toMatchObject({code:'engine_changed'});
   expect(fetchImpl).toHaveBeenCalledTimes(3);
   const restarted=createReaderCustomApi({filePath,safeStorage:safeStorage(),fetchImpl});
   expect(customApiEngineId(await restarted.get())).toBe(customApiEngineId(edited));
   await restarted.save(draft);
   await restarted.complete({instruction:'Translate',input:'Fixture'});
   expect(fetchImpl.mock.calls.at(-1)[1].headers.authorization).toBeUndefined();
  } finally { await rm(dir,{recursive:true,force:true}); }
 });
 it('uses the explicitly selected saved profile while leaving the active profile and its credentials unchanged',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-custom-api-selection-'));
  try {
   const filePath=path.join(dir,'provider.json');
   const fetchImpl=vi.fn(async()=>Response.json({choices:[{message:{content:'译文'}}]}));
   const service=createReaderCustomApi({filePath,safeStorage:safeStorage(),fetchImpl});
   const first=await service.save(config);
   const active=await service.save({id:'e2e00000-0000-4000-8000-000000000001',name:'另一服务',model:'other-model',baseUrl:'https://example.test/v1',apiKey:'other-fixture-key'});
   const stored=await readFile(filePath,'utf8');
   await service.complete({instruction:'Translate',input:'A phrase.',selectedProfileId:first.id});
   const [url,request]=fetchImpl.mock.calls[0];
   expect(url).toBe('http://192.168.1.20:1234/v1/chat/completions');
   expect(request.headers.authorization).toBe('Bearer '+config.apiKey);
   expect(JSON.parse(request.body).model).toBe(config.model);
   expect((await service.get()).activeId).toBe(active.id);
   expect(await readFile(filePath,'utf8')).toBe(stored);
   await service.remove(first.id);
   await expect(service.complete({instruction:'Translate',input:'A phrase.',selectedProfileId:first.id})).rejects.toThrow('所选自定义 API 已不存在');
   expect(fetchImpl).toHaveBeenCalledOnce();
  } finally { await rm(dir,{recursive:true,force:true}); }
 });
  it('supports Practice Lab prompt and output budgets only for practice-workshop tasks', async () => {
   const dir = await mkdtemp(path.join(os.tmpdir(), 'vantilo-custom-api-workshop-'));
   const longPrompt = 'P'.repeat(21000);
   const longReply = JSON.stringify({ titleZh: '长练习', exercises: Array.from({ length: 80 }, (_, index) => ({ sentence: `word ${index} ${'x'.repeat(240)}`, chinese: '中文提示', pronunciation: '/wɜːrd/' })) });
   expect(longReply.length).toBeGreaterThan(20000);
   let sentBody;
   const fetchImpl = vi.fn(async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: longReply } }] });
   });
   try {
    const service = createReaderCustomApi({ filePath: path.join(dir, 'provider.json'), safeStorage: safeStorage(), fetchImpl });
    await service.save(config);
    await expect(service.complete({ instruction: 'Return JSON', input: longPrompt })).rejects.toThrow('超出允许长度');
    await expect(service.complete({ instruction: 'Return JSON', input: longPrompt, task: 'practice-workshop' })).resolves.toBe(longReply);
    expect(sentBody.max_tokens).toBe(16000);
   } finally {
    await rm(dir, { recursive: true, force: true });
   }
  });
});


describe('credential recovery and migration', () => {
 it('does not consult Keychain when no configuration exists',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-empty-'));const storage={isEncryptionAvailable:vi.fn(),encryptString:vi.fn(),decryptString:vi.fn()};try{const service=createReaderCustomApi({filePath:path.join(dir,'provider.json'),safeStorage:storage});expect((await service.get()).configured).toBe(false);expect(storage.isEncryptionAvailable).not.toHaveBeenCalled();expect(storage.decryptString).not.toHaveBeenCalled();}finally{await rm(dir,{recursive:true,force:true});}});
 it('loads profiles without touching Keychain and isolates a failed credential', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-safe-')); const filePath=path.join(dir,'provider.json');
  const ids=['11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222'];
  let available=false; const storage={isEncryptionAvailable:vi.fn(()=>available),encryptString:vi.fn(v=>Buffer.from('encrypted:'+v)),decryptString:vi.fn(v=>{const text=v.toString();if(text==='bad')throw Error('bad');return text.slice(10);})};
  const profiles=ids.map((id,i)=>({config:{id,name:'service '+i,baseUrl:'https://example.com',model:'model'},encryptedApiKey:Buffer.from(i?'encrypted:good':'bad').toString('base64')}));
  await writeFile(filePath,JSON.stringify({version:2,activeId:ids[0],profiles}));const before=await readFile(filePath,'utf8');
  const service=createReaderCustomApi({filePath,safeStorage:storage,fetchImpl:vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:'OK'}}]})))});
  try {
   const initial=await service.get();expect(initial.profiles.map(p=>p.name)).toEqual(['service 0','service 1']);expect(storage.isEncryptionAvailable).not.toHaveBeenCalled();expect(storage.decryptString).not.toHaveBeenCalled();expect(JSON.stringify(initial)).not.toContain(profiles[0].encryptedApiKey);
   await expect(service.complete({instruction:'x',input:'y'})).rejects.toMatchObject({code:'keychain_unavailable'});expect(await readFile(filePath,'utf8')).toBe(before);
   available=true;await expect(service.complete({instruction:'x',input:'y'})).rejects.toMatchObject({code:'credential_unavailable'});expect((await service.get()).profiles[0].credentialStatus).toBe('credential_unavailable');
   await service.save({...profiles[0].config,apiKey:''});expect(JSON.parse(await readFile(filePath,'utf8')).profiles[0].encryptedApiKey).toBe(profiles[0].encryptedApiKey);
   await service.activate(ids[1]);expect(await service.complete({instruction:'x',input:'y'})).toBe('OK');
   await service.save({...profiles[0].config,apiKey:'replacement'});expect(await service.complete({instruction:'x',input:'y'})).toBe('OK');
  } finally {await rm(dir,{recursive:true,force:true});}
 });
 it('retains v1 input during migration and preserves ciphertext when a key is blank',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-v1-'));const filePath=path.join(dir,'provider.json');const raw=JSON.stringify({version:1,config:{name:'old',baseUrl:'https://example.com',model:'m'},encryptedApiKey:Buffer.from('encrypted:old').toString('base64')});
  try { await writeFile(filePath,raw);const storage=safeStorage();const service=createReaderCustomApi({filePath,safeStorage:storage});const first=await service.get();expect((await service.get()).id).toBe(first.id);await service.save({id:first.id,name:'edited',baseUrl:first.baseUrl,model:first.model,apiKey:''});expect(await readFile(filePath+'.v1-backup','utf8')).toBe(raw);expect(JSON.parse(await readFile(filePath,'utf8')).profiles[0].encryptedApiKey).toBe(JSON.parse(raw).encryptedApiKey); }
  finally{await rm(dir,{recursive:true,force:true});}
 });
 it('never replaces corrupt or unsupported input and retains state after failed encryption',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-corrupt-'));const filePath=path.join(dir,'provider.json');
  try {const storage=safeStorage();const service=createReaderCustomApi({filePath,safeStorage:storage});await writeFile(filePath,'{');await expect(service.get()).rejects.toMatchObject({code:'corrupt_json'});await expect(service.save(config)).rejects.toMatchObject({code:'corrupt_json'});expect(await readFile(filePath,'utf8')).toBe('{');await writeFile(filePath,JSON.stringify({version:99}));await expect(service.get()).rejects.toMatchObject({code:'unsupported_version'});await rm(filePath);await service.save(config);const old=await readFile(filePath,'utf8');storage.encryptString=()=>{throw Error('unavailable')};await expect(service.save({...config,name:'changed',apiKey:'new'})).rejects.toThrow();expect(await readFile(filePath,'utf8')).toBe(old);expect((await service.get()).name).toBe(config.name);}
  finally{await rm(dir,{recursive:true,force:true});}
 });
 it('keeps the original file and removes the temporary file when rename fails',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-save-failure-'));const filePath=path.join(dir,'provider.json');const fs=require('node:fs/promises');
  try{const service=createReaderCustomApi({filePath,safeStorage:safeStorage()});await service.save(config);const before=await readFile(filePath,'utf8');const rename=vi.spyOn(fs,'rename').mockRejectedValueOnce(Object.assign(Error('write failed'),{code:'EIO'}));try{await expect(service.save({...config,name:'changed',apiKey:''})).rejects.toThrow('write failed');}finally{rename.mockRestore();}expect(await readFile(filePath,'utf8')).toBe(before);expect((await fs.readdir(dir)).sort()).toEqual(['provider.json']);expect((await service.get()).name).toBe(config.name);}finally{await rm(dir,{recursive:true,force:true});}
 });
 it('reports invalid ciphertext without calling the keychain',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-invalid-'));const filePath=path.join(dir,'provider.json');const id='11111111-1111-1111-1111-111111111111';const storage=safeStorage();storage.decryptString=vi.fn(storage.decryptString);
  try {await writeFile(filePath,JSON.stringify({version:2,activeId:id,profiles:[{config:{id,name:'bad',baseUrl:'https://example.com',model:'m'},encryptedApiKey:'@@@'}]}));const service=createReaderCustomApi({filePath,safeStorage:storage});await expect(service.complete({instruction:'x',input:'y'})).rejects.toMatchObject({code:'invalid_ciphertext'});expect(storage.decryptString).not.toHaveBeenCalled();expect((await service.get()).credentialStatus).toBe('invalid_ciphertext');}
  finally{await rm(dir,{recursive:true,force:true});}
 });
 it('lists live chat models for Gemini and DeepSeek, strips models/ prefix, filters non-chat models, and reuses saved key',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-models-'));const filePath=path.join(dir,'provider.json');
  const seen=[];
  const fetchImpl=vi.fn(async(url,init)=>{
   seen.push({url,auth:init.headers.authorization});
   if(url==='https://generativelanguage.googleapis.com/v1beta/openai/models'){
    return new Response(JSON.stringify({data:[{id:'models/gemini-2.5-flash'},{id:'models/gemini-3-flash-preview'},{id:'models/text-embedding-004'},{id:'models/imagen-3.0-generate-002'}]}),{status:200});
   }
   if(url==='https://api.deepseek.com/v1/models'){
    return new Response(JSON.stringify({data:[{id:'deepseek-chat'},{id:'deepseek-reasoner'},{id:'deepseek-v4'}]}),{status:200});
   }
   return new Response('not found',{status:404});
  });
  try{
   const service=createReaderCustomApi({filePath,safeStorage:safeStorage(),fetchImpl});
   const gemini=await service.listModels({baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',apiKey:'gem-key'});
   expect(gemini.models).toEqual(['gemini-2.5-flash','gemini-3-flash-preview']);
   const saved=await service.save({name:'DeepSeek',baseUrl:'https://api.deepseek.com/v1',model:'deepseek-chat',apiKey:'ds-saved-key'});
   const deepseek=await service.listModels({id:saved.id,baseUrl:'https://api.deepseek.com/v1',apiKey:''});
   expect(deepseek.models).toEqual(['deepseek-chat','deepseek-reasoner','deepseek-v4']);
   expect(seen).toEqual([
    {url:'https://generativelanguage.googleapis.com/v1beta/openai/models',auth:'Bearer gem-key'},
    {url:'https://api.deepseek.com/v1/models',auth:'Bearer ds-saved-key'},
   ]);
   await expect(service.listModels({baseUrl:'http://example.com/v1',apiKey:'x'})).rejects.toThrow(/HTTPS/);
  }finally{await rm(dir,{recursive:true,force:true});}
 });

 it('surfaces Google Gemini JSON-array error messages cleanly while redacting API keys', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'vantilo-custom-api-err-'));
  const filePath=path.join(dir,'custom-api.json');
  const fetchImpl=vi.fn(async ()=>new Response(JSON.stringify([
   {error:{code:404,message:'models/gemini-2.5-flash is not found for API version v1beta (key gem-secret)',status:'NOT_FOUND'}},
  ]),{status:404,headers:{'content-type':'application/json'}}));
  try{
   const service=createReaderCustomApi({filePath,safeStorage:safeStorage(),fetchImpl});
   await expect(service.test({
    name:'Gemini',
    baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',
    model:'gemini-2.5-flash',
    apiKey:'gem-secret',
   })).rejects.toThrow(/API 返回 HTTP 404：models\/gemini-2\.5-flash is not found.*\[已隐藏\]/);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
