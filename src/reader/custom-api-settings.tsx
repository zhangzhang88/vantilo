import {useEffect as customApiUseEffect,useState as customApiUseState} from 'react';
import {detectOfficialApiProvider,formatApiTargetHost,type CustomApiProviderKind} from '../../packages/reader/src/shared/custom-api-provider';
type CustomApiProfile={id:string;name:string;baseUrl:string;model:string;hasApiKey:boolean;credentialStatus?:string};
type CustomApiSettingsValue=CustomApiProfile&{configured:boolean;profiles:CustomApiProfile[];activeId:string};
const emptyCustomApi:CustomApiSettingsValue={id:'',configured:false,name:'',baseUrl:'',model:'',hasApiKey:false,profiles:[],activeId:''};
const customApiProviderPresets:Record<Exclude<CustomApiProviderKind,'custom'>,{tabLabel:string;name:string;baseUrl:string;defaultModel:string;hint:string;models:ReadonlyArray<{id:string;label:string}>}>={
  deepseek:{
    tabLabel:'DeepSeek（国内直连）',
    name:'DeepSeek',
    baseUrl:'https://api.deepseek.com/v1',
    defaultModel:'deepseek-chat',
    hint:'已内置官方地址 https://api.deepseek.com/v1，国内直连无需代理；填好 API Key 后可点击「拉取模型列表」获取最新型号。',
    models:[
      {id:'deepseek-chat',label:'deepseek-chat（推荐 · V3 通用翻译）'},
      {id:'deepseek-reasoner',label:'deepseek-reasoner（R1 深度推理）'},
    ],
  },
  gemini:{
    tabLabel:'Gemini',
    name:'Gemini',
    baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel:'gemini-3.8-flash',
    hint:'已内置 Google Gemini OpenAI 兼容地址，需确保网络可访问 Google；填好 API Key 后可点击「拉取模型列表」同步账号下全部最新模型。',
    models:[
      {id:'gemini-3.8-flash',label:'gemini-3.8-flash（推荐 · 最新高速主力）'},
      {id:'gemini-3.5-flash-lite',label:'gemini-3.5-flash-lite（轻量省额 · 低延迟）'},
      {id:'gemini-3.1-pro-preview',label:'gemini-3.1-pro-preview（Pro 深度理解）'},
    ],
  },
};
const detectCustomApiProvider=detectOfficialApiProvider;
function VantiloCustomApiSettings(){
  const [value,setValue]=customApiUseState(emptyCustomApi);
  const [provider,setProvider]=customApiUseState<CustomApiProviderKind>('deepseek');
  const [customModelMode,setCustomModelMode]=customApiUseState(false);
  const [fetchedModels,setFetchedModels]=customApiUseState<string[]>([]);
  const [fetchingModels,setFetchingModels]=customApiUseState(false);
  const [apiKey,setApiKey]=customApiUseState('');
  const [busy,setBusy]=customApiUseState(false);
  const [message,setMessage]=customApiUseState('正在读取自定义 API 设置…');
  const [error,setError]=customApiUseState('');
  const syncFromProfile=(data:CustomApiSettingsValue)=>{
    if(data.configured){
      const kind=detectCustomApiProvider(data.baseUrl);
      setProvider(kind);
      setValue(data);
      setCustomModelMode(kind!=='custom'&&!customApiProviderPresets[kind].models.some(item=>item.id===data.model));
    }else{
      const preset=customApiProviderPresets.deepseek;
      setProvider('deepseek');
      setCustomModelMode(false);
      setValue({...data,name:preset.name,baseUrl:preset.baseUrl,model:preset.defaultModel});
    }
  };
  customApiUseEffect(()=>{
    let active=true;
    const load=()=>{fetch('/api/vantilo-custom-api/settings',{cache:'no-store'}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'无法读取 AI 模型服务设置');if(active){syncFromProfile(data);setMessage(data.configured?'已保存设置；密钥不会回显。':'尚未配置 AI 模型服务；选择服务商并粘贴 API Key 即可开始使用。');}}).catch(reason=>{if(active)setMessage(reason instanceof Error?reason.message:'AI 模型服务设置暂不可用。');});};
    load();
    const onMessage=(event:MessageEvent)=>{if(event.source===window.parent&&event.data&&typeof event.data==='object'&&(event.data as {type?:unknown}).type==='vantilo:custom-api-updated'){load();}};
    window.addEventListener('message',onMessage);
    return()=>{active=false;window.removeEventListener('message',onMessage);};
  },[]);
  const update=(patch:Partial<CustomApiSettingsValue>)=>setValue(current=>({...current,...patch}));
  const persisted=value.profiles.find(profile=>profile.id===value.id);
  const sameAddress=persisted?.baseUrl===value.baseUrl.trim().replace(/\/+$/, '');
  const config=()=>({id:value.id,name:value.name,baseUrl:value.baseUrl,model:value.model,apiKey});
  function selectProvider(kind:CustomApiProviderKind){
    setProvider(kind);
    setFetchedModels([]);
    setCustomModelMode(false);
    setError('');
    setMessage('');
    if(kind==='custom'){
      const existingCustom=value.profiles.find(item=>item.id===value.activeId&&detectCustomApiProvider(item.baseUrl)==='custom')
        ??value.profiles.find(item=>detectCustomApiProvider(item.baseUrl)==='custom');
      if(existingCustom){
        setValue({...value,id:existingCustom.id,name:existingCustom.name,baseUrl:existingCustom.baseUrl,model:existingCustom.model,hasApiKey:existingCustom.hasApiKey,credentialStatus:existingCustom.credentialStatus});
      }else{
        update({id:'',name:'',baseUrl:'',model:'',hasApiKey:false,credentialStatus:undefined});
      }
      setApiKey('');
      return;
    }
    const preset=customApiProviderPresets[kind];
    const existing=value.profiles.find(item=>detectCustomApiProvider(item.baseUrl)===kind);
    if(existing){
      setValue({...value,id:existing.id,name:existing.name,baseUrl:existing.baseUrl,model:existing.model,hasApiKey:existing.hasApiKey,credentialStatus:existing.credentialStatus});
      setCustomModelMode(!preset.models.some(item=>item.id===existing.model));
    }else{
      update({id:'',name:preset.name,baseUrl:preset.baseUrl,model:preset.defaultModel,hasApiKey:false,credentialStatus:undefined});
    }
    setApiKey('');
  }
  async function fetchModels(){
    if(fetchingModels||busy||!value.baseUrl.trim())return;
    setFetchingModels(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/vantilo-custom-api/models',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(config())});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'拉取模型列表失败');
      const list=Array.isArray(data.models)?data.models as string[]:[];
      setFetchedModels(list);
      setCustomModelMode(false);
      if(list.length&&!list.includes(value.model.trim()))update({model:list[0]});
      setMessage(`已拉取 ${list.length} 个当前可用模型，可在模型下拉框中直接选择。`);
    }catch(reason){setError(reason instanceof Error?reason.message:'拉取模型列表失败');}
    finally{setFetchingModels(false);}
  }
  async function request(path:string,method:string){
    setBusy(true);setError('');setMessage('');
    try{const response=await fetch(path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(config())});const data=await response.json();if(!response.ok)throw new Error(data.error||'自定义 API 请求失败');
      if(path.endsWith('/test')){setMessage(data.message||'连接成功');}
      else{syncFromProfile(data);setApiKey('');setMessage('设置已安全保存；阅读翻译和目录模型列表已更新。');window.dispatchEvent(new CustomEvent('vantilo-custom-api-updated'));}
    }catch(reason){setError(reason instanceof Error?reason.message:'自定义 API 请求失败');}finally{setBusy(false);}
  }
  async function switchProfile(id:string){
    setFetchedModels([]);
    if(!id){
      setProvider('custom');
      setCustomModelMode(false);
      setValue({...emptyCustomApi,profiles:value.profiles,activeId:value.activeId});
      setApiKey('');setError('');setMessage('填写兼容 API 的名称、地址与模型后保存即可加入列表。');return;
    }
    setBusy(true);setError('');setMessage('');
    try{const response=await fetch(`/api/vantilo-custom-api/profiles/${encodeURIComponent(id)}/activate`,{method:'POST'});const data=await response.json();if(!response.ok)throw new Error(data.error||'切换服务失败');syncFromProfile(data);setApiKey('');setMessage('已切换服务；密钥保存在本机安全存储中。');window.dispatchEvent(new CustomEvent('vantilo-custom-api-updated'));}
    catch(reason){setError(reason instanceof Error?reason.message:'切换服务失败');}finally{setBusy(false);}
  }
  async function removeProfile(){if(!value.id)return;setBusy(true);setError('');setMessage('');try{const response=await fetch(`/api/vantilo-custom-api/profiles/${encodeURIComponent(value.id)}`,{method:'DELETE'});const data=await response.json();if(!response.ok)throw new Error(data.error||'删除服务失败');syncFromProfile(data);setApiKey('');setMessage(data.configured?'服务已删除，已切换到列表中的下一项。':'服务已删除。');window.dispatchEvent(new CustomEvent('vantilo-custom-api-updated'));}catch(reason){setError(reason instanceof Error?reason.message:'删除服务失败');}finally{setBusy(false);} }
  const preset=provider==='custom'?null:customApiProviderPresets[provider];
  const customProfiles=value.profiles.filter(profile=>detectCustomApiProvider(profile.baseUrl)==='custom');
  const presetIds=preset?preset.models.map(item=>item.id):[];
  const mergedModels:Array<{id:string;label:string}>=[
    ...(preset?preset.models:[]),
    ...fetchedModels.filter(id=>!presetIds.includes(id)).map(id=>({id,label:id})),
  ];
  const currentInList=mergedModels.some(item=>item.id===value.model);
  const modelSelectValue=customModelMode||(!currentInList&&value.model)?'__custom__':(value.model||mergedModels[0]?.id||'');
  return <section className="settings-card vantilo-custom-api-settings">
    <div className="settings-card-heading"><div><span>AI model service</span><h2>AI 模型服务</h2></div><small>DeepSeek、Gemini 或局域网 OpenAI 兼容服务</small></div>
    <p className="settings-help">支持 OpenAI 兼容的 Chat Completions 和 Responses 接口。公网地址使用 HTTPS；局域网服务可使用 HTTP。密钥由系统安全存储加密，已有服务的地址保持不变时，留空可保留已保存的密钥。</p>
    <div className="vantilo-custom-api-tabs" role="tablist" aria-label="选择模型服务商">
      {(['deepseek','gemini','custom'] as const).map(kind=>(
        <button key={kind} type="button" role="tab" aria-selected={provider===kind} className={`vantilo-custom-api-tab ${provider===kind?'is-active':''}`} onClick={()=>selectProvider(kind)}>
          {kind==='custom'?'其他兼容 API / 局域网':customApiProviderPresets[kind].tabLabel}
        </button>
      ))}
    </div>
    {preset&&<p className="settings-help">{preset.hint}</p>}
    {provider==='custom'&&<>
      {customProfiles.length>0&&<label>已保存的其他 API 服务<select value={value.id} disabled={busy} onChange={event=>void switchProfile(event.target.value)}><option value="">＋ 添加新服务</option>{customProfiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}</select></label>}
      <label>服务名称<input value={value.name} maxLength={80} placeholder="例如 书房服务器、OpenRouter 或中转站" onChange={event=>update({name:event.target.value})}/></label>
      <label>API 地址或根地址<input value={value.baseUrl} maxLength={2048} placeholder="https://api.example.com/v1 或 http://192.168.1.20:18437/v1/responses" onChange={event=>update({baseUrl:event.target.value})}/></label>
    </>}
    <label>{preset?`${preset.name} API 密钥`:'API 密钥'}{formatApiTargetHost(value.baseUrl)&&<small className="vantilo-custom-api-target-host"> · 目标主机：{formatApiTargetHost(value.baseUrl)}</small>}<input type="password" value={apiKey} autoComplete="new-password" maxLength={4096} placeholder={value.hasApiKey&&sameAddress?'已保存密钥；留空表示保留':preset?`粘贴你的 ${preset.name} API Key`:'局域网服务可按需留空'} onChange={event=>setApiKey(event.target.value)}/></label>
    <div className="vantilo-custom-api-model-field">
      <span>模型名称</span>
      <div className="vantilo-custom-api-model-row">
        {mergedModels.length>0?(
          <select aria-label="模型名称" value={modelSelectValue} disabled={busy} onChange={event=>{const chosen=event.target.value;if(chosen==='__custom__'){setCustomModelMode(true);}else{setCustomModelMode(false);update({model:chosen});}}}>
            {mergedModels.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
            <option value="__custom__">手动输入其他模型名…</option>
          </select>
        ):(
          <input aria-label="模型名称" value={value.model} maxLength={256} placeholder="例如 deepseek-chat、gemini-3.8-flash、qwen3" onChange={event=>update({model:event.target.value})}/>
        )}
        <button type="button" className="vantilo-custom-api-fetch-btn" disabled={fetchingModels||busy||!value.baseUrl.trim()} onClick={()=>void fetchModels()}>
          {fetchingModels?'拉取中…':'拉取模型列表'}
        </button>
      </div>
      {mergedModels.length>0&&(customModelMode||(!currentInList&&value.model))&&(
        <input aria-label="手动输入模型名称" value={value.model} maxLength={256} placeholder="输入完整模型 ID" onChange={event=>update({model:event.target.value})}/>
      )}
    </div>
    {value.id&&<p className="settings-help">密钥状态：{({missing:'未设置',unchecked:'存在密钥记录，尚未检查',available:'可用',empty_key:'为空',keychain_unavailable:'系统安全存储不可用，请恢复授权后重试',decrypt_failed:'无法解密，请恢复授权或重新填写',credential_unavailable:'密钥暂不可用，请检查系统授权或重新填写',invalid_ciphertext:'密钥记录无效，请重新填写'} as Record<string,string>)[value.credentialStatus||'missing']||'暂时未知'}。</p>}
    <div className="vantilo-custom-api-actions"><button type="button" disabled={busy||!value.name.trim()||!value.baseUrl.trim()||!value.model.trim()} onClick={()=>void request('/api/vantilo-custom-api/test','POST')}>{busy?'正在连接…':'测试连接'}</button><button type="button" className="primary-button" disabled={busy||!value.name.trim()||!value.baseUrl.trim()||!value.model.trim()} onClick={()=>void request('/api/vantilo-custom-api/settings','PUT')}>{busy?'正在保存…':value.id?'保存 API':'保存新服务'}</button>{value.id&&<button type="button" disabled={busy} onClick={()=>void removeProfile()}>删除服务</button>}</div>
    {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="vantilo-custom-api-error">{error}</p>}
  </section>;
}
