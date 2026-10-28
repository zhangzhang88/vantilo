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
  return { id: config.id, name: config.name, baseUrl: config.baseUrl, model: config.model, hasApiKey: Boolean(config.apiKey) };
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
  let cached;
  async function read() {
    if (cached !== undefined) return cached;
    try {
      const record=JSON.parse(await fs.readFile(filePath,'utf8'));
      if(record.version===1&&typeof record.encryptedApiKey==='string'){
        const apiKey=safeStorage.decryptString(Buffer.from(record.encryptedApiKey,'base64'));
        const profile=validateConfig({...record.config,apiKey});cached={profiles:[profile],activeId:profile.id};
      } else if(record.version===2&&Array.isArray(record.profiles)&&typeof record.activeId==='string') {
        const profiles=record.profiles.map(item=>{if(typeof item.encryptedApiKey!=='string')throw new Error('密钥记录无效');return validateConfig({...item.config,apiKey:safeStorage.decryptString(Buffer.from(item.encryptedApiKey,'base64'))});});
        if(profiles.length>50||new Set(profiles.map(item=>item.id)).size!==profiles.length||!profiles.some(item=>item.id===record.activeId))throw new Error('配置记录无效');cached={profiles,activeId:record.activeId};
      } else throw new Error('配置版本无效');
    } catch(error) { if(error.code==='ENOENT'){cached=null;return null;}throw new Error('自定义 API 配置无法读取'); }
    return cached;
  }
  async function persist(state) {
    await fs.mkdir(path.dirname(filePath),{recursive:true,mode:0o700});
    const record={version:2,activeId:state.activeId,profiles:state.profiles.map(config=>({config:{id:config.id,name:config.name,baseUrl:config.baseUrl,model:config.model},encryptedApiKey:safeStorage.encryptString(config.apiKey).toString('base64')}))};
    const temp=filePath+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(record),{mode:0o600});await fs.rename(temp,filePath);cached=state;
  }
  async function request(config, { instruction, input, signal, test = false } = {}) {
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
      const body=responsesEndpoint
        ?{model:config.model,instructions:test?'Reply with exactly OK.':instruction||'',input:bodyText,temperature:0,max_output_tokens:test?128:6000}
        :{model:config.model,messages:test?[{role:'user',content:bodyText}]:[{role:'system',content:instruction},{role:'user',content:bodyText}],temperature:0,max_tokens:test?128:6000,...(test&&isDeepSeek?{thinking:{type:'disabled'}}:{})};
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
    async get(){const state=await read();const active=state?.profiles.find(item=>item.id===state.activeId)||null;return publicConfig(active,state?.profiles||[],state?.activeId||'');},
    async save(input){
      if(!safeStorage.isEncryptionAvailable())throw new Error('系统安全存储不可用，暂时无法保存 API 密钥');
      const state=await read()||{profiles:[],activeId:''};const config=validateConfig({...input,...(input?.id===undefined&&state.activeId?{id:state.activeId}:{})});const index=state.profiles.findIndex(item=>item.id===config.id);const previous=index>=0?state.profiles[index]:null;if(!config.apiKey&&previous?.apiKey)config.apiKey=previous.apiKey;
      if(index>=0)state.profiles[index]=config;else {if(state.profiles.length>=50)throw new Error('最多保存 50 个 API 服务');state.profiles.push(config);}state.activeId=config.id;await persist(state);return publicConfig(config,state.profiles,state.activeId);
    },
    async activate(id){const state=await read();if(!state||!state.profiles.some(item=>item.id===id))throw new Error('找不到已保存的 API 服务');state.activeId=id;await persist(state);const config=state.profiles.find(item=>item.id===id);return publicConfig(config,state.profiles,id);},
    async remove(id){const state=await read();if(!state||!state.profiles.some(item=>item.id===id))throw new Error('找不到已保存的 API 服务');state.profiles=state.profiles.filter(item=>item.id!==id);state.activeId=state.profiles[0]?.id||'';if(state.profiles.length)await persist(state);else{cached=null;await fs.rm(filePath,{force:true});}const active=state.profiles.find(item=>item.id===state.activeId)||null;return publicConfig(active,state.profiles,state.activeId);},
    async test(input){const config=validateConfig(input);if(!config.apiKey){const state=await read();config.apiKey=state?.profiles.find(item=>item.id===config.id)?.apiKey||state?.profiles.find(item=>item.id===state.activeId)?.apiKey||'';}await request(config,{test:true});return {ok:true,message:'连接成功，模型已返回测试内容'};},
    async complete({instruction,input,signal}){
      if(typeof instruction!=='string'||!instruction.trim()||instruction.length>8000||typeof input!=='string'||!input.trim()||input.length>18000||instruction.length+input.length>19000)throw new Error('自定义 API 请求超出允许长度');
      const state=await read();const config=state?.profiles.find(item=>item.id===state.activeId);if(!config)throw new Error('请先在阅读设置中配置自定义 API');
      return request(config,{instruction,input,signal});
    },
  };
}
module.exports={createReaderCustomApi,validateConfig,publicConfig,isPrivateHost};
