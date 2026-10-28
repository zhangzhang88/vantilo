const { randomUUID } = require('node:crypto');

// Local compatibility adapter: existing Reader task prompts/parsers stay intact; inference belongs to AgentRuntime.
function createReaderAiFetch(runAi) {
  return async (_url, options = {}) => {
    if (!runAi) throw new Error('请先登录统一的 ChatGPT 账号');
    let body;
    try { body = JSON.parse(String(options.body)); } catch { throw new Error('Invalid Reader AI task'); }
    const instructions = typeof body.instructions === 'string' ? body.instructions : '';
    const input = typeof body.input === 'string' ? body.input : JSON.stringify(body.input ?? '');
    if (!instructions || instructions.length > 8000 || !input || input.length > 18000 || instructions.length + input.length > 19000) throw new Error('阅读任务内容过长，请缩小选中范围后重试');
    const output = await runAi({ instructions, input });
    if (typeof output !== 'string' || !output.trim() || output.length > 20000) throw new Error('Agent 返回格式无效，请重试');
    return new Response(JSON.stringify({ output_text: output }), { headers: { 'content-type': 'application/json' } });
  };
}
function createReaderAiClient(parent) {
  const pending = new Map();
  const customPending = new Map();
  parent.on('message', ({data}) => {
    if(data?.type==='custom-api-result'&&typeof data.requestId==='string'){
      const task=customPending.get(data.requestId);if(!task)return;customPending.delete(data.requestId);clearTimeout(task.timer);
      if(data.ok===true&&data.result&&typeof data.result==='object')task.resolve(data.result);
      else task.reject(new Error(typeof data.error==='string'?data.error:'自定义 API 请求失败'));
      return;
    }
    if(data?.type === 'ai-delta' && typeof data.requestId === 'string' && typeof data.delta === 'string' && data.delta.length <= 20000) { pending.get(data.requestId)?.onDelta?.(data.delta); return; }
    if (data?.type !== 'ai-result' || typeof data.requestId !== 'string') return;
    const task = pending.get(data.requestId);
    if (!task) return;
    pending.delete(data.requestId); clearTimeout(task.timer);
    if (data.ok === true && task.metadata && data.metadata) task.resolve(data.metadata);
    else if (data.ok === true && typeof data.output === 'string' && data.output.length <= 20000) task.resolve(data.output);
    else task.reject(new Error(require('./reader-errors.cjs').readerErrorMessage(data.errorCode)));
  });
  return {
    run(payload, metadata = false, signal, onDelta) {
      if(signal?.aborted)return Promise.reject(new Error("阅读任务已取消"));
      if (pending.size >= 16) return Promise.reject(new Error('阅读任务较多，请稍后重试'));
      const requestId = randomUUID();
      return new Promise((resolve,reject) => {
        const abort=()=>{try{parent.postMessage({type:"ai-cancel",requestId});}catch{} pending.delete(requestId);clearTimeout(timer);signal?.removeEventListener("abort",abort);reject(new Error("阅读任务已取消"));};
        const timer = setTimeout(()=>{
          if (!pending.has(requestId)) return;
          pending.delete(requestId);
          signal?.removeEventListener('abort',abort);
          // Timeout is cancellation, not merely loss of interest: stop only this Reader request.
          try { parent.postMessage({type:'ai-cancel',requestId}); } catch { /* Parent may be gone. */ }
          reject(new Error('阅读任务超时，请重试'));
        },120000);
        pending.set(requestId,{resolve:value=>{signal?.removeEventListener("abort",abort);resolve(value);},reject:error=>{signal?.removeEventListener("abort",abort);reject(error);},timer,metadata,onDelta});
        signal?.addEventListener("abort",abort,{once:true});
        try { parent.postMessage({type:'ai',requestId,...payload}); }
        catch { pending.delete(requestId);clearTimeout(timer);reject(new Error('Agent 暂时不可用')); }
      });
    },
    customApi(operation, payload = {}, signal) {
      if(signal?.aborted)return Promise.reject(new Error('自定义 API 请求已取消'));
      if (customPending.size >= 8) return Promise.reject(new Error('自定义 API 请求较多，请稍后重试'));
      const requestId=randomUUID();
      return new Promise((resolve,reject)=>{
        const cleanup=()=>signal?.removeEventListener('abort',abort);
        const abort=()=>{try{parent.postMessage({type:'custom-api-cancel',requestId});}catch{}customPending.delete(requestId);clearTimeout(timer);cleanup();reject(new Error('自定义 API 请求已取消'));};
        const timer=setTimeout(()=>{customPending.delete(requestId);cleanup();try{parent.postMessage({type:'custom-api-cancel',requestId});}catch{}reject(new Error('自定义 API 请求超时'));},70000);
        customPending.set(requestId,{resolve:value=>{cleanup();resolve(value);},reject:error=>{cleanup();reject(error);},timer});
        signal?.addEventListener('abort',abort,{once:true});
        try {parent.postMessage({type:'custom-api',requestId,operation,...payload});}
        catch {customPending.delete(requestId);clearTimeout(timer);cleanup();reject(new Error('自定义 API 暂时不可用'));}
      });
    },
    close() { for (const task of pending.values()) { clearTimeout(task.timer);task.reject(new Error('阅读空间已停止')); } pending.clear(); for(const task of customPending.values()){clearTimeout(task.timer);task.reject(new Error('阅读空间已停止'));}customPending.clear(); },
  };
}
module.exports = { createReaderAiFetch, createReaderAiClient };
