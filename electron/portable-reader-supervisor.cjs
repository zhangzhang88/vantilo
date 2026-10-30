const path = require('node:path');
const { randomBytes } = require('node:crypto');
class PortableReaderSupervisor {
  constructor({ utilityProcess, assetsDir, libraryRoot, userDataRoot, seedDir, entryPath = path.join(__dirname, 'portable-reader-entry.cjs'), timeoutMs = 30000, enableLocalQwen = false, enableTranslation = false, enableReaderPreviews = false, customApi, fetchImpl = globalThis.fetch, healthTimeoutMs = 1000, runAi, getAccountStatus, listModels, cancelAi, softwareUpdates, installSessionCookie, clearSessionCookie }) {
    if(typeof installSessionCookie!=='function'||typeof clearSessionCookie!=='function')throw new Error('Reader session authentication is not configured');
    Object.assign(this, { utilityProcess, assetsDir, libraryRoot, userDataRoot, seedDir, entryPath, timeoutMs, enableLocalQwen, enableTranslation, enableReaderPreviews, customApi, fetchImpl, healthTimeoutMs, runAi, getAccountStatus, listModels, cancelAi, softwareUpdates, installSessionCookie, clearSessionCookie });
    this.webOrigin = 'http://127.0.0.1:5175';
    this.apiOrigin = 'http://127.0.0.1:5174';
    this.status = 'idle'; this.error = null; this.child = null; this.pending = null; this.stopping = false; this.failedHealthChecks = 0;
    this.sync = { enabled: true, status: 'idle', message: '首次打开后检查新刊', importedCount: 0, failedCount: 0 };
    this.customApiRequests = new Map();
    this.readerBackupRequests = new Map();
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
        child = this.utilityProcess.fork(this.entryPath, [this.assetsDir, this.libraryRoot, this.enableLocalQwen ? 'preview-local-qwen' : 'disabled', this.enableTranslation ? 'reader-translation' : 'disabled', this.enableReaderPreviews ? 'reader-previews' : 'disabled', this.seedDir || '--no-seed'], {
          serviceName: 'Vantilo Reader', stdio: 'ignore',
          // The installed app never inherits developer AI keys, GitHub tokens or local provider configuration.
          env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: process.env.LANG || 'en_US.UTF-8', TMPDIR: process.env.TMPDIR || '/tmp', ...(this.userDataRoot ? { VANTILO_READER_USER_DATA_ROOT: this.userDataRoot } : {}) },
        });
      } catch { fail('无法启动内置阅读服务'); return; }
      this.child = child;
      child.on('message', message => {
        if (this.child !== child || this.stopping) return;
        if (message?.type === 'reader-backup-response' && typeof message.requestId === 'string') {
          const pending = this.readerBackupRequests.get(message.requestId);
          if (!pending) return;
          clearTimeout(pending.timer); this.readerBackupRequests.delete(message.requestId);
          if (message.ok === true) pending.resolve(message.result);
          else pending.reject(new Error(typeof message.error === 'string' ? message.error : 'Reader 备份维护请求失败'));
          return;
        }
        if(message?.type==='custom-api-cancel'&&typeof message.requestId==='string') { this.customApiRequests.get(message.requestId)?.abort(new Error('自定义 API 请求已取消'));return; }
        if(message?.type==='custom-api') {
          const {requestId,operation}=message;
          const send=(ok,result,error)=>{if(this.child===child&&!this.stopping)child.postMessage({type:'custom-api-result',requestId,ok,...(ok?{result}:{error})});};
          const idOk=typeof requestId==='string'&&/^[0-9a-f-]{36}$/i.test(requestId);
          const validConfig=config=>config&&typeof config==='object'&&!Array.isArray(config)&&Object.keys(config).every(key=>['id','name','baseUrl','model','apiKey'].includes(key))&&(config.id===undefined||typeof config.id==='string')&&typeof config.name==='string'&&typeof config.baseUrl==='string'&&typeof config.model==='string'&&(config.apiKey===undefined||typeof config.apiKey==='string');
          const valid=operation==='get'?Object.keys(message).sort().join(',')==='operation,requestId,type':operation==='save'||operation==='test'?Object.keys(message).sort().join(',')==='config,operation,requestId,type'&&validConfig(message.config):operation==='activate'||operation==='remove'?Object.keys(message).sort().join(',')==='id,operation,requestId,type'&&typeof message.id==='string'&&/^[a-f0-9-]{36}$/i.test(message.id):operation==='complete'?['input,instruction,operation,requestId,type','input,instruction,operation,profileId,requestId,task,type'].includes(Object.keys(message).sort().join(','))&&(message.task===undefined||(message.task==='word-context'&&typeof message.profileId==='string'&&/^[a-f0-9-]{36}$/i.test(message.profileId)))&&typeof message.instruction==='string'&&message.instruction.length>0&&message.instruction.length<=8000&&typeof message.input==='string'&&message.input.length>0&&message.input.length<=18000&&message.instruction.length+message.input.length<=19000:false;
          if(!idOk||!valid||!this.customApi){if(idOk)send(false,null,'自定义 API 请求无效');return;}
          const controller=operation==='complete'?new AbortController():null;
          if(controller)this.customApiRequests.set(requestId,controller);
          const payload=operation==='get'?{}:operation==='complete'?{instruction:message.instruction,input:message.input,...(message.task?{task:message.task,profileId:message.profileId}:{})}:operation==='save'||operation==='test'?message.config:{id:message.id};
          void Promise.resolve(this.customApi(operation,payload,controller?.signal)).then(result=>send(true,result),error=>send(false,null,error instanceof Error?error.message:'自定义 API 请求失败')).finally(()=>{if(this.customApiRequests.get(requestId)===controller)this.customApiRequests.delete(requestId);});
          return;
        }
        if (message?.type === 'ai-cancel' && typeof message.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(message.requestId)) { void this.cancelAi?.(message.requestId).catch(()=>{}); return; }
        if (message?.type === 'ai') {
          const id = message.requestId;
          if (['account-status','models','software-status','software-check','software-auto','software-open-release','software-download','software-cancel-download','software-reveal-download'].includes(message.operation) && typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) {
            const operations={'account-status':this.getAccountStatus,models:this.listModels,
              'software-status':this.softwareUpdates?.status,'software-check':this.softwareUpdates?.check,
              'software-auto':typeof message.automatic==='boolean'&&this.softwareUpdates?()=>this.softwareUpdates.setAutomatic(message.automatic):null,
              'software-open-release':this.softwareUpdates?.openRelease,'software-download':this.softwareUpdates?.download,'software-cancel-download':this.softwareUpdates?.cancelDownload,'software-reveal-download':this.softwareUpdates?.revealDownload};
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
        for (const [requestId, pending] of this.readerBackupRequests) {
          clearTimeout(pending.timer); pending.reject(new Error('Reader 服务在备份维护期间退出')); this.readerBackupRequests.delete(requestId);
        }
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
  _requestReaderBackup(type, requestId, timeoutMs = 160000) {
    if (this.status !== 'ready' || !this.child || this.stopping) return Promise.reject(new Error('Reader 服务未运行，无法安全备份'));
    if (!['reader-backup-freeze', 'reader-backup-resume'].includes(type) || typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) return Promise.reject(new Error('Reader 备份请求无效'));
    if (this.readerBackupRequests.has(requestId)) return Promise.reject(new Error('Reader 备份请求重复'));
    const child = this.child;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.readerBackupRequests.delete(requestId); reject(new Error('Reader 服务未能在时限内完成写入排空')); }, timeoutMs);
      this.readerBackupRequests.set(requestId, { resolve, reject, timer });
      child.postMessage({ type, requestId });
    });
  }
  freezeForBackup(requestId) { return this._requestReaderBackup('reader-backup-freeze', requestId); }
  resumeAfterBackup(requestId) { return this._requestReaderBackup('reader-backup-resume', requestId); }
  async stop() {
    this.stopping = true;
    for(const controller of this.customApiRequests.values())controller.abort(new Error('阅读服务已停止'));
    this.customApiRequests.clear();
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
