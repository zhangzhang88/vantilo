'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');

const LIMIT = 1024 * 1024;
function isPrivateHost(host) {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local')) return true;
  const version = net.isIP(name);
  if (version === 4) {
    const [a,b] = name.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (version === 6) return name === '::1' || name.startsWith('fc') || name.startsWith('fd') || name.startsWith('fe80:');
  return false;
}
function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['id','name','baseUrl','model','apiKey'].includes(key))) throw new Error('自定义 API 设置无效');
  const id = typeof input.id === 'string' && /^[a-f0-9-]{36}$/i.test(input.id) ? input.id : randomUUID();
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  let url;
  try { url = new URL(typeof input.baseUrl === 'string' ? input.baseUrl.trim() : ''); } catch { throw new Error('请输入有效的 API 地址'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.hostname || /[\r\n\0]/.test(input.baseUrl)) throw new Error('API 地址必须是有效的 HTTP(S) 根地址，不能包含账号、密码、查询参数或片段');
  if (url.protocol === 'http:' && !isPrivateHost(url.hostname)) throw new Error('公网 API 必须使用 HTTPS；HTTP 仅允许 localhost 或局域网地址');
  if (url.pathname.endsWith('/models')) throw new Error('请填写兼容 OpenAI 的 API 根地址或 Responses/Chat Completions 接口地址');
  if (!name || name.length > 80 || /[\u0000-\u001f]/.test(name)) throw new Error('请填写 1–80 个字符的服务名称');
  if (!model || model.length > 256 || /[\r\n\0]/.test(model)) throw new Error('请填写有效的模型名称');
  if (apiKey.length > 4096 || /[\r\n\0]/.test(apiKey)) throw new Error('API 密钥格式无效');
  url.pathname = url.pathname.replace(/\/+$/, '');
  return { id, name, baseUrl: url.toString().replace(/\/$/, ''), model, apiKey };
}
function publicProfile(config) {
  return { id: config.id, name: config.name, baseUrl: config.baseUrl, model: config.model, hasApiKey: config.encryptedApiKey != null, credentialStatus: config.credentialStatus || (config.encryptedApiKey == null ? 'missing' : 'unchecked') };
}
function publicConfig(config, profiles = [], activeId = '') {
  return config ? { ...publicProfile(config), configured: true, profiles: profiles.map(publicProfile), activeId: activeId || config.id } : { configured: false, id: '', name: '', baseUrl: '', model: '', hasApiKey: false, profiles: profiles.map(publicProfile), activeId: '' };
}
async function responseJson(response, apiKey) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('API 没有返回内容');
  const chunks=[];let size=0;
  try { while (true) { const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT){await reader.cancel();throw new Error('API 响应超过 1 MB 限制');}chunks.push(Buffer.from(value)); } }
  finally { reader.releaseLock(); }
  const raw=Buffer.concat(chunks).toString('utf8');let body;
  try { body=JSON.parse(raw); } catch {
    if(!response.ok){const detail=raw.replace(/[\u0000-\u001f\u007f]/g,' ').replaceAll(apiKey||'\0','[已隐藏]').trim().slice(0,240);throw new Error(`API 返回 HTTP ${response.status}${detail?'：'+detail:''}`);}
    throw new Error('API 返回的不是有效 JSON');
  }
  if(!response.ok){
    const detail=typeof body?.error==='string'?body.error:body?.error?.message||body?.message||body?.detail||body?.error?.code||response.statusText;
    const safe=String(detail||'').replace(/[\u0000-\u001f\u007f]/g,' ').replaceAll(apiKey||'\0','[已隐藏]').trim().slice(0,240);
    throw new Error(`API 返回 HTTP ${response.status}${safe?'：'+safe:''}`);
  }
  return body;
}
function createReaderCustomApi({ filePath, safeStorage, fetchImpl = fetch }) {
  if (!path.isAbsolute(filePath)) throw new Error('自定义 API 配置路径无效');
  let statuses = new Map();
  let writes = Promise.resolve();
  const failure = (code, message) => Object.assign(new Error(message), { code });
  function parseProfile(item) {
    if (!item || typeof item !== 'object' || !item.config || typeof item.config.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(item.config.id)) throw failure('corrupt_json', '自定义 API 配置格式无效，原文件已保留');
    const config = validateConfig({ ...item.config, apiKey: '' });
    const encryptedApiKey = item.encryptedApiKey;
    return { ...config, encryptedApiKey: encryptedApiKey ?? null };
  }
  async function read() {
    let raw;
    try { raw = await fs.readFile(filePath, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw failure('read_failed', '自定义 API 配置无法读取，原文件已保留'); }
    let record;
    try { record = JSON.parse(raw); } catch { throw failure('corrupt_json', '自定义 API 配置文件损坏，原文件已保留'); }
    if (!record || typeof record !== 'object') throw failure('corrupt_json', '自定义 API 配置格式无效，原文件已保留');
    if (![1, 2].includes(record.version)) throw failure('unsupported_version', '自定义 API 配置版本不受支持，原文件已保留');
    let profiles, activeId;
    try {
      if (record.version === 1) {
        // Legacy profiles may lack an ID. Derive one from non-secret metadata so reads remain stable.
        const config = { ...record.config };
        if (typeof config.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(config.id)) {
          const hex = require('node:crypto').createHash('sha256').update(JSON.stringify([config.name, config.baseUrl, config.model])).digest('hex');
          config.id = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
        }
        profiles = [parseProfile({config, encryptedApiKey:record.encryptedApiKey})]; activeId = profiles[0].id;
      } else {
        if (!Array.isArray(record.profiles) || typeof record.activeId !== 'string') throw Error();
        profiles = record.profiles.map(parseProfile); activeId = record.activeId;
        if (!profiles.length || profiles.length > 50 || new Set(profiles.map(item => item.id)).size !== profiles.length || !profiles.some(item => item.id === activeId)) throw Error();
      }
    } catch (error) { if (error.code === 'corrupt_json') throw error; throw failure('corrupt_json', '自定义 API 配置格式无效，原文件已保留'); }
    return { profiles, activeId, version: record.version, raw };
  }
  function decrypt(profile) {
    if (profile.encryptedApiKey == null) { statuses.set(profile.id, 'missing'); return ''; }
    const value = profile.encryptedApiKey;
    if (typeof value !== 'string' || !value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || Buffer.from(value, 'base64').toString('base64') !== value) {
      statuses.set(profile.id, 'invalid_ciphertext'); throw failure('invalid_ciphertext', 'API 密钥记录无效，请重新填写密钥');
    }
    if (!safeStorage.isEncryptionAvailable()) { statuses.set(profile.id, 'keychain_unavailable'); throw failure('keychain_unavailable', '系统安全存储不可用，请恢复访问后重试'); }
    try { const key = safeStorage.decryptString(Buffer.from(value, 'base64')); statuses.set(profile.id, key ? 'available' : 'empty_key'); return key; }
    catch { statuses.set(profile.id, 'credential_unavailable'); throw failure('credential_unavailable', 'API 密钥暂不可用，请检查系统授权或重新填写'); }
  }
  function display(state) {
    const profiles = (state?.profiles || []).map(profile => ({...profile, credentialStatus: statuses.get(profile.id)}));
    return publicConfig(profiles.find(item => item.id === state?.activeId) || null, profiles, state?.activeId || '');
  }
  async function persist(state, previous) {
    await fs.mkdir(path.dirname(filePath), { recursive:true, mode:0o700 });
    const record = { version:2, activeId:state.activeId, profiles:state.profiles.map(({id,name,baseUrl,model,encryptedApiKey}) => ({config:{id,name,baseUrl,model},encryptedApiKey})) };
    const temp = filePath + '.' + randomUUID() + '.tmp';
    try {
      if (previous?.version === 1) {
        const backup = filePath + '.v1-backup';
        try { await fs.copyFile(filePath, backup, require('node:fs').constants.COPYFILE_EXCL); await fs.chmod(backup, 0o600); }
        catch (error) { if (error.code !== 'EEXIST' || await fs.readFile(backup, 'utf8') !== previous.raw) throw failure('migration_backup_failed', '无法安全保存旧版 API 配置，未执行迁移'); }
      }
      const serialized = JSON.stringify(record);
      const handle = await fs.open(temp, 'wx', 0o600);
      try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
      if (await fs.readFile(temp, 'utf8') !== serialized) throw failure('write_failed', 'API 配置校验失败，原文件已保留');
      await fs.rename(temp, filePath);
    } finally { await fs.rm(temp, {force:true}).catch(() => {}); }
  }
  function mutate(fn) { const result = writes.then(fn); writes = result.catch(() => {}); return result; }
  async function request(config, { instruction, input, signal, test = false, task } = {}) {
    const responsesEndpoint=config.baseUrl.endsWith('/responses');
    const endpoint=responsesEndpoint||config.baseUrl.endsWith('/chat/completions')?config.baseUrl:config.baseUrl+'/chat/completions';
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(new Error('API 请求超时（60 秒）')),60000);
    const abort=()=>controller.abort(signal.reason||new Error('API 请求已取消'));
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    try {
      const bodyText=test?'Reply with exactly: OK':input;
      const isDeepSeek=/^(?:[a-z0-9-]+\.)*deepseek\.com$/i.test(new URL(config.baseUrl).hostname);
      const quickContext=isDeepSeek && task==='word-context';
      const body=responsesEndpoint
        ?{model:config.model,instructions:test?'Reply with exactly OK.':instruction||'',input:bodyText,temperature:0,max_output_tokens:test?128:quickContext?1000:6000,...(quickContext?{reasoning:{effort:'none'}}:{})}
        :{model:config.model,messages:test?[{role:'user',content:bodyText}]:[{role:'system',content:instruction},{role:'user',content:bodyText}],temperature:0,max_tokens:test?128:quickContext?1000:6000,...((test&&isDeepSeek)||quickContext?{thinking:{type:'disabled'}}:{})};
      const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json',...(config.apiKey?{authorization:'Bearer '+config.apiKey}:{})},body:JSON.stringify(body)});
      const result=await responseJson(response,config.apiKey);const content=result?.choices?.[0]?.message?.content;
      const responseText=typeof result?.output_text==='string'?result.output_text:Array.isArray(result?.output)?result.output.flatMap(item=>Array.isArray(item?.content)?item.content:[]).map(part=>typeof part?.text==='string'?part.text:'').join(''):'';
      const text=typeof content==='string'?content:Array.isArray(content)?content.map(part=>typeof part?.text==='string'?part.text:'').join(''):responseText;
      if(typeof text!=='string'||!text.trim()||text.length>(test?1000:20000))throw new Error('API 返回内容为空或超出长度限制');
      return text.trim();
    } catch(error) {
      if(controller.signal.aborted)throw new Error(signal?.aborted?'API 请求已取消':'API 请求超时（60 秒）');
      if(error instanceof TypeError)throw new Error('无法连接自定义 API；请检查网络、地址和局域网服务状态');
      throw error;
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  return {
    async get(){ await writes; return display(await read()); },
    async save(input){ return mutate(async () => {
      const old = await read(); const state = old || {profiles:[],activeId:''};
      const config = validateConfig({...input,...(input?.id===undefined&&state.activeId?{id:state.activeId}:{})});
      const index = state.profiles.findIndex(item => item.id === config.id);
      const previous = index >= 0 ? state.profiles[index] : null;
      let encryptedApiKey = previous?.encryptedApiKey ?? null;
      if (config.apiKey || !previous) {
        if (!safeStorage.isEncryptionAvailable()) throw failure('keychain_unavailable','系统安全存储不可用，暂时无法保存 API 密钥');
        encryptedApiKey = safeStorage.encryptString(config.apiKey).toString('base64');
      }
      const profile = {...config, apiKey:'', encryptedApiKey};
      const profiles = [...state.profiles];
      if (index >= 0) profiles[index] = profile; else { if (profiles.length >= 50) throw Error('最多保存 50 个 API 服务'); profiles.push(profile); }
      const next = { profiles, activeId:profile.id };
      await persist(next, old); if (config.apiKey) statuses.set(profile.id,'available'); else if (!previous) statuses.set(profile.id,'empty_key');
      return display(next);
    }); },
    async activate(id){return mutate(async()=>{const state=await read();if(!state||!state.profiles.some(item=>item.id===id))throw Error('找不到已保存的 API 服务');const next={...state,activeId:id};await persist(next,state);return display(next);});},
    async remove(id){return mutate(async()=>{const state=await read();if(!state||!state.profiles.some(item=>item.id===id))throw Error('找不到已保存的 API 服务');const profiles=state.profiles.filter(item=>item.id!==id);if(profiles.length){const next={...state,profiles,activeId:state.activeId===id?profiles[0].id:state.activeId};await persist(next,state);statuses.delete(id);return display(next);}await fs.rm(filePath,{force:true});statuses.delete(id);return display(null);});},
    async test(input){await writes;const config=validateConfig(input);if(!config.apiKey){const state=await read();const profile=state?.profiles.find(item=>item.id===config.id)||state?.profiles.find(item=>item.id===state.activeId);if(profile)config.apiKey=decrypt(profile);}await request(config,{test:true});return {ok:true,message:'连接成功，模型已返回测试内容'};},
    async complete({instruction,input,signal,task,profileId}){
      if(typeof instruction!=='string'||!instruction.trim()||instruction.length>8000||typeof input!=='string'||!input.trim()||input.length>18000||instruction.length+input.length>19000)throw new Error('自定义 API 请求超出允许长度');
      await writes;const state=await read();const profile=state?.profiles.find(item=>item.id===state.activeId);if(!profile)throw new Error('请先在阅读设置中配置自定义 API');
      if(task!==undefined&&task!=='word-context')throw new Error('自定义 API 请求类型无效');
      if(profileId!==undefined&&profileId!==profile.id)throw new Error('自定义 API 已切换，请重新点词');
      return request({...profile,apiKey:decrypt(profile)},{instruction,input,signal,task});
    },
  };
}
module.exports={createReaderCustomApi,validateConfig,publicConfig,isPrivateHost};
