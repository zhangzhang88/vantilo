const path = require('node:path');
const { randomBytes } = require('node:crypto');
class PortableReaderSupervisor {
  constructor({ utilityProcess, assetsDir, libraryRoot, entryPath = path.join(__dirname, 'portable-reader-entry.cjs'), timeoutMs = 30000, enableLocalQwen = false, fetchImpl = globalThis.fetch, healthTimeoutMs = 1000, runAi, getAccountStatus, listModels, cancelAi, softwareUpdates, installSessionCookie, clearSessionCookie }) {
    if(typeof installSessionCookie!=='function'||typeof clearSessionCookie!=='function')throw new Error('Reader session authentication is not configured');
    Object.assign(this, { utilityProcess, assetsDir, libraryRoot, entryPath, timeoutMs, enableLocalQwen, fetchImpl, healthTimeoutMs, runAi, getAccountStatus, listModels, cancelAi, softwareUpdates, installSessionCookie, clearSessionCookie });
    this.webOrigin = 'http://127.0.0.1:5175';
    this.status = 'idle'; this.error = null; this.child = null; this.pending = null; this.stopping = false; this.failedHealthChecks = 0;
    this.sync = { enabled: true, status: 'idle', message: '首次打开后检查新刊', importedCount: 0, failedCount: 0 };
  }
  getStatus() { return { status: this.status, error: this.error, sync: { ...this.sync } }; }
  async checkHealth() {
    if (this.status !== 'ready' || !this.child) return this.getStatus();
    const child = this.child;
    const probe = async (url, identify) => {
      try {
        const response = await this.fetchImpl(url, {
          signal: AbortSignal.timeout(this.healthTimeoutMs), redirect: 'error',
        });
        return response.ok && await identify(response);
      } catch { return false; }
    };
    const [api, web] = await Promise.all([
      probe('http://127.0.0.1:5174/api/health', async response => {
        const result = await response.json();
        return result?.ok === true && result?.reader === 'epub';
      }),
      probe('http://127.0.0.1:5175/', async response => {
        const html = await response.text();
        return html.includes('<title>Magazine Reader</title>') && html.includes('id="root"');
      }),
    ]);
    // A single transient connection failure should not tear down an active reading session.
    if (this.child !== child || this.status !== 'ready' || this.stopping) return this.getStatus();
    this.failedHealthChecks = api && web ? 0 : this.failedHealthChecks + 1;
    if (this.failedHealthChecks >= 2) {
      this.child = null;
      this.status = 'error';
      this.error = '阅读服务连接中断，请重试。';
      child.kill();
    }
    return this.getStatus();
  }
  start() {
    if (this.stopping) return Promise.reject(new Error('阅读服务正在停止'));
    if (this.status === 'ready') return Promise.resolve({ ready: true });
    if (this.pending) return this.pending;
    this.status = 'starting'; this.error = null; this.failedHealthChecks = 0;
    this.sessionToken = randomBytes(32).toString('hex');
    const startup = new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail('阅读服务启动超时，请重试'), this.timeoutMs);
      const fail = message => { clearTimeout(timer); this.status = 'error'; this.error = message; if (child && this.child === child) { this.child = null; child.kill(); } reject(new Error(message)); };
      this.rejectStartup = fail;
      let child;
      try {
        child = this.utilityProcess.fork(this.entryPath, [this.assetsDir, this.libraryRoot, this.enableLocalQwen ? 'preview-local-qwen' : 'disabled'], {
          serviceName: 'Vantilo Reader', stdio: 'ignore',
          // The installed app never inherits developer AI keys, GitHub tokens or local provider configuration.
          env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: process.env.LANG || 'en_US.UTF-8', TMPDIR: process.env.TMPDIR || '/tmp' },
        });
      } catch { fail('无法启动内置阅读服务'); return; }
      this.child = child;
      child.on('message', message => {
        if (this.child !== child || this.stopping) return;
        if (message?.type === 'ai-cancel' && typeof message.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(message.requestId)) { void this.cancelAi?.(message.requestId).catch(()=>{}); return; }
        if (message?.type === 'ai') {
          const id = message.requestId;
          if (['account-status','models','software-status','software-check','software-auto','software-open-release'].includes(message.operation) && typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) {
            const operations={'account-status':this.getAccountStatus,models:this.listModels,
              'software-status':this.softwareUpdates?.status,'software-check':this.softwareUpdates?.check,
              'software-auto':typeof message.automatic==='boolean'&&this.softwareUpdates?()=>this.softwareUpdates.setAutomatic(message.automatic):null,
              'software-open-release':this.softwareUpdates?.openRelease};
            const get=operations[message.operation];
            if(!get){child.postMessage({type:'ai-result',requestId:id,ok:false});return;}
            void get().then(metadata => { if (this.child === child && !this.stopping) child.postMessage({type:'ai-result',requestId:id,ok:true,metadata}); }, () => { if(this.child === child && !this.stopping) child.postMessage({type:'ai-result',requestId:id,ok:false}); });
            return;
          }
          const valid = typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) && typeof message.instructions === 'string' && message.instructions.length > 0 && message.instructions.length <= 8000 && typeof message.input === 'string' && message.input.length > 0 && message.input.length <= 18000 && message.instructions.length + message.input.length <= 19000;
          if (!valid || (message.modelId != null && (typeof message.modelId !== 'string' || message.modelId.length > 256)) || (message.reasoningEffort != null && (typeof message.reasoningEffort !== 'string' || message.reasoningEffort.length > 64)) || !this.runAi) return;
          void this.runAi({ requestId:id, instructions: message.instructions, input: message.input, ...(message.modelId !== undefined ? {modelId:message.modelId} : {}), ...(message.reasoningEffort !== undefined ? {reasoningEffort:message.reasoningEffort} : {}) }).then(result => {
            if (this.child === child && !this.stopping) child.postMessage({type:'ai-result',requestId:id,ok:true,output:result.output});
          }, error => { if (this.child === child && !this.stopping) child.postMessage({type:'ai-result',requestId:id,ok:false,errorCode:require('./reader-errors.cjs').readerErrorCode(error)}); });
        }
        if (message?.type === 'sync'  && validSync(message.state)) this.sync = { ...message.state };
        if (message?.type === 'ready' && this.status === 'starting') {
          if (validSync(message.sync)) this.sync = { ...message.sync };
          this.status = 'authenticating';
          void Promise.resolve().then(()=>this.installSessionCookie(this.sessionToken, this.webOrigin)).then(() => {
            if(this.child!==child || this.stopping)return;
            clearTimeout(timer); this.rejectStartup = null; this.status = 'ready'; resolve({ ready: true });
          },()=>{if(this.child===child && !this.stopping)fail('无法为阅读空间建立安全会话，请重试。');});
        }
        if (message?.type === 'error') fail('阅读服务启动失败，请检查端口 5174/5175 后重试');
      });
      child.on('error', () => fail('阅读服务进程出错，请重试'));
      child.on('exit', () => {
        if (this.child !== child) return;
        this.child = null;
        clearTimeout(timer);
        if (!this.stopping) fail('阅读服务已退出，请重试');
      });
      child.postMessage({type:'reader-session',token:this.sessionToken});
    });
    this.pending = startup.catch(async error => {
      const child = this.child; this.child = null;
      child?.kill();
      throw error;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  deliverDelta({requestId,delta}) {
    if(this.child && !this.stopping && typeof requestId==='string' && /^[0-9a-f-]{36}$/i.test(requestId) && typeof delta==='string' && delta.length>0 && delta.length<=20000) this.child.postMessage({type:'ai-delta',requestId,delta});
  }
  synchronize() {
    if (this.status !== 'ready' || !this.child) throw new Error('请先打开阅读空间');
    this.child.postMessage({ type: 'sync' });
    return { accepted: true };
  }
  async stop() {
    this.stopping = true;
    this.rejectStartup?.('阅读服务启动已取消');
    await this.pending?.catch(() => {});
    const child = this.child; this.child = null;
    if (child) await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.postMessage({ type: 'shutdown' });
    });
    try { await this.clearSessionCookie(this.webOrigin); } catch {}
    this.sessionToken = null;
    this.status = 'stopped'; this.error = null; this.stopping = false; this.failedHealthChecks = 0;
    return this.getStatus();
  }
}
function validSync(value) {
  return typeof value?.enabled === 'boolean' && ['idle', 'checking', 'error'].includes(value.status) && typeof value.message === 'string' && value.message.length <= 300 && Number.isSafeInteger(value.importedCount) && value.importedCount >= 0 && Number.isSafeInteger(value.failedCount) && value.failedCount >= 0;
}
module.exports = { PortableReaderSupervisor };
