const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID}=require('node:crypto');
const DEFAULT_INTERVAL_MS = 3 * 60 * 60 * 1000;

class MagazineSyncController {
  constructor({ syncImpl, stateFile, intervalMs = DEFAULT_INTERVAL_MS, retryMs = 5 * 60 * 1000, now = Date.now, onState = () => {}, checkOnStart = false }) {
    Object.assign(this, { syncImpl, stateFile, intervalMs, retryMs, now, onState, checkOnStart });
    this.state = { enabled: true, status: 'idle', lastAttemptAt: null, lastSuccessAt: null, importedCount: 0, failedCount: 0, message: '首次打开后检查四种杂志的新刊' };
    this.pending = null;
    this.stopped = false;
    this.timer = null;
  }
  getState() { return { ...this.state }; }
  async initialize() {
    try {const preferences=JSON.parse(await fs.readFile(this.stateFile+'.preferences.json','utf8'));
      if(preferences.version!==1||typeof preferences.automatic!=='boolean')throw new Error('Invalid preferences');
      this.state.enabled=preferences.automatic;
    } catch(error){if(error.code!=='ENOENT'){this.state.enabled=false;this.state.message='自动抓取设置读取失败，请重新设置';}}

    try {
      const value = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
      if (value.version === 1) {
        for (const key of ['lastAttemptAt', 'lastSuccessAt']) {
          if (typeof value[key] === 'string' && Number.isFinite(Date.parse(value[key])) && Date.parse(value[key]) <= this.now()) this.state[key] = value[key];
        }
      }
    } catch { /* First run or invalid scheduler metadata: check again. */ }
    // A failed/interrupted attempt is not a successful freshness check.
    if (this.state.lastAttemptAt && (!this.state.lastSuccessAt || Date.parse(this.state.lastAttemptAt) > Date.parse(this.state.lastSuccessAt))) this.state.lastAttemptAt = null;
    return this.getState();
  }
  reportProgress(message) {
    if (this.stopped || this.state.status !== 'checking' || typeof message !== 'string' || message.length > 300) return;
    this.state = { ...this.state, message };
    this.#publish();
  }
  async #persist() {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const temporary = this.stateFile + '.tmp';
    await fs.writeFile(temporary, JSON.stringify({ version: 1, lastAttemptAt: this.state.lastAttemptAt, lastSuccessAt: this.state.lastSuccessAt }), { mode: 0o600 });
    await fs.rename(temporary, this.stateFile);
  }
  #publish() { this.onState(this.getState()); }
  start() {
    if (this.timer || this.stopped || !this.state.enabled) return;
    const tick = () => {
      if (!this.state.lastAttemptAt || this.now() - Date.parse(this.state.lastAttemptAt) >= (this.state.status === 'error' ? this.retryMs : this.intervalMs)) void this.check();
    };
    this.timer = setInterval(tick, Math.min(this.intervalMs, 60000));
    this.timer.unref?.();
    if(this.checkOnStart)void this.check();else tick();
  }
  async setAutomatic(automatic) {
    if(typeof automatic!=='boolean')throw new Error('Invalid automatic update preference');
    await fs.mkdir(path.dirname(this.stateFile),{recursive:true,mode:0o700});
    const file=this.stateFile+'.preferences.json',temporary=file+'.'+randomUUID()+'.tmp';
    await fs.writeFile(temporary,JSON.stringify({version:1,automatic}),{mode:0o600});await fs.rename(temporary,file);
    this.state={...this.state,enabled:automatic};
    if(!automatic){clearInterval(this.timer);this.timer=null;if(this.state.status!=='checking')this.state.message='自动抓取已关闭，仍可手动检查';}
    else this.start();
    this.#publish();return this.getState();
  }
  check() {
    if (this.stopped) return Promise.resolve(this.getState());
    if (this.pending) return this.pending;
    this.pending = this.#check().finally(() => { this.pending = null; });
    return this.pending;
  }
  async #check() {
    this.state = { ...this.state, status: 'checking', importedCount: 0, failedCount: 0, lastAttemptAt: new Date(this.now()).toISOString(), message: '正在检查四种杂志的新刊…' };
    this.#publish();
    try {
      await this.#persist();
      const report = await this.syncImpl();
      if (this.stopped) return this.getState();
      const importedCount = Number.isSafeInteger(report.importedCount) && report.importedCount >= 0 ? report.importedCount : 0;
      const failedCount = Number.isSafeInteger(report.failedCount) && report.failedCount >= 0 ? report.failedCount : 0;
      this.state = { ...this.state, importedCount, failedCount, status: failedCount ? 'error' : 'idle',
        lastSuccessAt: failedCount ? this.state.lastSuccessAt : new Date(this.now()).toISOString(),
        message: failedCount ? `已下载 ${importedCount} 期，部分来源下载失败，请检查 GitHub 网络连接后重试` : importedCount ? `已下载 ${importedCount} 期新刊，已加入本机书库` : '已检查，暂无新刊',
      };
      await this.#persist();
    } catch {
      if (!this.stopped) this.state = { ...this.state, status: 'error', message: '检查更新失败，请检查网络或稍后重试' };
    }
    if (!this.stopped) this.#publish();
    return this.getState();
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = null;
    await this.pending;
  }
}
module.exports = { MagazineSyncController, DEFAULT_INTERVAL_MS };
