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
});
