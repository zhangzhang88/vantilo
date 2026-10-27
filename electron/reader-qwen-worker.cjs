'use strict';
const {spawn} = require('node:child_process');
const {StringDecoder}=require('node:string_decoder');
const {randomUUID} = require('node:crypto');

// Parent-owned offline Swift MLX session. One in-flight request; the model is
// loaded lazily and released after idle. No shell, network API, or book access.
function createQwenWorker({helper, spawnImpl = spawn, idleMs = 180000, timeoutMs = 65000} = {}) {
  if (!helper || !Number.isInteger(idleMs) || idleMs < 1000 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1000) throw new Error('Invalid local MLX worker options');
  let child = null, folder = null, pending = null, buffer = '', idle = null, stopped = false;
  let decoder=new StringDecoder('utf8');
  const offlineEnv = {PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',HF_HUB_OFFLINE:'1',
    HF_HUB_DISABLE_TELEMETRY:'1',HOME:process.env.HOME || ''};
  function clearIdle() { if (idle) clearTimeout(idle); idle = null; }
  function release(error) {
    clearIdle();
    if (pending) {
      const req=pending; pending=null; clearTimeout(req.timeout);
      req.reject(error instanceof Error ? error : new Error('原生模型进程已退出'));
    }
    const old=child; child=null;folder=null;buffer='';
    if (old) { old.removeAllListeners('exit');old.stdout?.removeAllListeners('data');old.kill(); }
  }
  function setIdle() {
    clearIdle();
    idle=setTimeout(()=>release(),idleMs);
    idle.unref?.();
  }
  function onData(data) {
    buffer+=decoder.write(data);
    if(Buffer.byteLength(buffer,'utf8')>32768) {release(new Error('原生模型响应过大'));return;}
    let newline;
    while ((newline=buffer.indexOf('\n'))>=0) {
      const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
      if(!pending) {release(new Error('意外的模型进程输出'));return;}
      let result;
      try { result=JSON.parse(line); }
      catch {release(new Error('模型响应 JSON 无效'));return;}
      if(!result || result.id!==pending.id || result.ok!==true) {
        release(new Error('原生模型响应失败'));return;
      }
      const req=pending;pending=null;clearTimeout(req.timeout);
      setIdle();
      req.resolve(result);
    }
  }
  function create(folderPath) {
    buffer='';decoder=new StringDecoder('utf8');folder=folderPath;
    const proc=spawnImpl(helper,['--serve',folderPath],{
      stdio:['pipe','pipe','pipe'],windowsHide:true,
      env:offlineEnv,shell:false,
    });
    child=proc;
    proc.stdout.on('data',data=>{if(child===proc)onData(data);});
    proc.stderr?.on('data',()=>{}); // Drain diagnostics, never expose model paths to the UI.
    proc.on('error',error=>{if(child===proc)release(error);});
    proc.on('exit',()=>{if(child===proc)release(new Error('原生模型进程已退出'));});
  }
  function request(folderPath, payload, {signal} = {}) {
    if(signal?.aborted)return Promise.reject(new Error('翻译已取消'));
    if(stopped) return Promise.reject(new Error('本地模型服务已停止'));
    if(pending) return Promise.reject(new Error('本地模型正在处理另一条请求'));
    if(!payload || !['health','gloss','translate'].includes(payload.type) ||
        (payload.type==='gloss' && (typeof payload.word!=='string'||typeof payload.sentence!=='string')))
      return Promise.reject(new Error('模型请求类型无效'));
    if(payload.type==='translate' && (typeof payload.text!=='string' || !payload.text.trim() || payload.text.length>1800 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(payload.text)))return Promise.reject(new Error('段落过长或格式无效（最多 1800 字符）'));
    if(child && folder!==folderPath) release();
    try { if(!child)create(folderPath); } catch(error){return Promise.reject(error);}
    clearIdle();
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const abort=()=>{if(pending?.id===id)release(new Error('翻译已取消'));};
      const cleanup=()=>signal?.removeEventListener('abort',abort);
      const timeout=setTimeout(()=>release(new Error('本地模型推理超时')),timeoutMs);
      timeout.unref?.();
      pending={id,resolve:value=>{cleanup();resolve(value);},reject:error=>{cleanup();reject(error);},timeout};
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted){abort();return;}
      try {
        const body={id,type:payload.type,
          ...(payload.type==='translate' ? {text:payload.text} : {}),
          ...(payload.type==='gloss' ? {word:payload.word,sentence:payload.sentence} : {})};
        child.stdin.write(JSON.stringify(body)+'\n',error=>{if(error && pending?.id===id)release(error);});
      } catch(error){release(error);}
    });
  }
  return {request, reset:()=>release(new Error('模型已切换')),
    close:()=>{stopped=true;release(new Error('本地模型服务已关闭'));},
    inspect:()=>({active:!!child,busy:!!pending})};
}
module.exports={createQwenWorker};
