import {useEffect as customApiUseEffect,useState as customApiUseState} from 'react';
type CustomApiProfile={id:string;name:string;baseUrl:string;model:string;hasApiKey:boolean};
type CustomApiSettingsValue=CustomApiProfile&{configured:boolean;profiles:CustomApiProfile[];activeId:string};
const emptyCustomApi:CustomApiSettingsValue={id:'',configured:false,name:'',baseUrl:'',model:'',hasApiKey:false,profiles:[],activeId:''};
function VantiloCustomApiSettings(){
  const [value,setValue]=customApiUseState(emptyCustomApi);
  const [apiKey,setApiKey]=customApiUseState('');
  const [busy,setBusy]=customApiUseState(false);
  const [message,setMessage]=customApiUseState('正在读取自定义 API 设置…');
  const [error,setError]=customApiUseState('');
  customApiUseEffect(()=>{let active=true;fetch('/api/vantilo-custom-api/settings',{cache:'no-store'}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'无法读取自定义 API 设置');if(active){setValue(data);setMessage(data.configured?'已保存设置；密钥不会回显。':'尚未配置自定义 API。');}}).catch(reason=>{if(active)setMessage(reason instanceof Error?reason.message:'自定义 API 设置暂不可用。');});return()=>{active=false;}},[]);
  const update=(patch:Partial<CustomApiSettingsValue>)=>setValue(current=>({...current,...patch}));
  const config=()=>({id:value.id,name:value.name,baseUrl:value.baseUrl,model:value.model,apiKey});
  async function request(path:string,method:string){
    setBusy(true);setError('');setMessage('');
    try{const response=await fetch(path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(config())});const data=await response.json();if(!response.ok)throw new Error(data.error||'自定义 API 请求失败');
      if(path.endsWith('/test'))setMessage(data.message||'连接成功');
      else{setValue({...data});setApiKey('');setMessage('设置已安全保存；阅读翻译和目录模型列表已更新。');window.dispatchEvent(new CustomEvent('vantilo-custom-api-updated'));}
    }catch(reason){setError(reason instanceof Error?reason.message:'自定义 API 请求失败');}finally{setBusy(false);}
  }
  async function switchProfile(id:string){
    if(!id){setValue({...emptyCustomApi,profiles:value.profiles});setApiKey('');setError('');setMessage('填写新服务信息并保存，即可加入服务列表。');return;}
    setBusy(true);setError('');setMessage('');
    try{const response=await fetch(`/api/vantilo-custom-api/profiles/${encodeURIComponent(id)}/activate`,{method:'POST'});const data=await response.json();if(!response.ok)throw new Error(data.error||'切换服务失败');setValue({...data});setApiKey('');setMessage('已切换服务；密钥保存在本机安全存储中。');window.dispatchEvent(new CustomEvent('vantilo-custom-api-updated'));}
    catch(reason){setError(reason instanceof Error?reason.message:'切换服务失败');}finally{setBusy(false);}
  }
  async function removeProfile(){if(!value.id)return;setBusy(true);setError('');setMessage('');try{const response=await fetch(`/api/vantilo-custom-api/profiles/${encodeURIComponent(value.id)}`,{method:'DELETE'});const data=await response.json();if(!response.ok)throw new Error(data.error||'删除服务失败');setValue({...data});setApiKey('');setMessage(data.configured?'服务已删除，已切换到列表中的下一项。':'服务已删除。');window.dispatchEvent(new CustomEvent('vantilo-custom-api-updated'));}catch(reason){setError(reason instanceof Error?reason.message:'删除服务失败');}finally{setBusy(false);}}
  return <section className="settings-card vantilo-custom-api-settings">
    <div className="settings-card-heading"><div><span>Translation provider</span><h2>自定义兼容 API</h2></div><small>MiniMax、DeepSeek 或局域网 OpenAI 兼容服务</small></div>
    <p className="settings-help">支持 OpenAI 兼容的 Chat Completions 和 Responses 接口。公网地址使用 HTTPS；局域网服务可使用 HTTP。密钥由系统安全存储加密，留空会保留已保存的密钥。</p>
    <label>已保存的 API 服务<select value={value.id} disabled={busy} onChange={event=>void switchProfile(event.target.value)}><option value="">＋ 添加新服务</option>{value.profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}</select></label>
    <label>服务名称<input value={value.name} maxLength={80} placeholder="例如 MiniMax、DeepSeek 或书房服务器" onChange={event=>update({name:event.target.value})}/></label>
    <label>API 地址或根地址<input value={value.baseUrl} maxLength={2048} placeholder="https://api.example.com/v1 或 http://192.168.1.20:18437/v1/responses" onChange={event=>update({baseUrl:event.target.value})}/></label>
    <label>模型名称<input value={value.model} maxLength={256} placeholder="例如 MiniMax-M2、deepseek-chat、qwen3" onChange={event=>update({model:event.target.value})}/></label>
    <label>API 密钥<input type="password" value={apiKey} autoComplete="new-password" maxLength={4096} placeholder={value.hasApiKey?'已保存密钥；留空表示保留':'局域网服务可按需留空'} onChange={event=>setApiKey(event.target.value)}/></label>
    <div className="vantilo-custom-api-actions"><button type="button" disabled={busy||!value.name.trim()||!value.baseUrl.trim()||!value.model.trim()} onClick={()=>void request('/api/vantilo-custom-api/test','POST')}>{busy?'正在连接…':'测试连接'}</button><button type="button" className="primary-button" disabled={busy||!value.name.trim()||!value.baseUrl.trim()||!value.model.trim()} onClick={()=>void request('/api/vantilo-custom-api/settings','PUT')}>{busy?'正在保存…':value.id?'保存 API':'保存新服务'}</button>{value.id&&<button type="button" disabled={busy} onClick={()=>void removeProfile()}>删除服务</button>}</div>
    {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="vantilo-custom-api-error">{error}</p>}
  </section>;
}
