'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createReaderModelInstaller } = require('./reader-model-installer.cjs');
const { MODEL_MANIFEST } = require('./reader-model-manifest.cjs');
const {createQwenWorker} = require('./reader-qwen-worker.cjs');
const run = promisify(execFile);

// Main-process-only service. No renderer-supplied filesystem paths or URLs.
function createReaderModelService({ userData, assetsDir, runHelper = run, installer, persistentGloss = false, workerFactory = createQwenWorker } = {}) {
  if (!path.isAbsolute(userData || '') || !path.isAbsolute(assetsDir || '')) throw new Error('本地模型目录无效');
  const manager = installer || createReaderModelInstaller({ root: path.join(userData, 'local-models') });
  const helper = path.join(assetsDir, 'native', 'vantilo-qwen-health');
  // Only Reader's separately branded preview holds an MLX model in memory.
  const resident = persistentGloss ? workerFactory({helper}) : null;
  const selection = path.join(userData, 'local-models', '.adopted-' + MODEL_MANIFEST.id + '.json');
  let activeDownload = null;
  let healthBusy = false;
  let glossBusy = false;
  let lastReport = null;
  let lastVerifiedPath = null;

  async function selectedPath() {
    try {
      const record = JSON.parse(await fs.readFile(selection, 'utf8'));
      if (record.version === 1 && record.id === MODEL_MANIFEST.id &&
          record.revision === MODEL_MANIFEST.revision &&
          typeof record.path === 'string' && path.isAbsolute(record.path)) return record.path;
    } catch { /* Invalid or migrated references never imply readiness. */ }
    // A finished in-app download also remains discoverable after restarting.
    if (typeof manager.destination === 'string') {
      try {
        const entry = await fs.lstat(manager.destination);
        if (entry.isDirectory() && !entry.isSymbolicLink()) return manager.destination;
      } catch { /* Fresh profile or absent model is not configured. */ }
    }
    return null;
  }
  async function inspect() {
    const info = await manager.inspect();
    const folder = await selectedPath();
    let helperAvailable = false;
    // Once an idle worker releases its weights, require a new native health
    // check before trusting the next inference, even at the same path.
    if (resident && !resident.inspect().active) { lastReport=null;lastVerifiedPath=null; }
    try { await fs.access(helper, require('node:fs').constants.X_OK); helperAvailable = true; } catch {}
    return {
      ...info,
      helperAvailable,
      selected: Boolean(folder),
      modelName: MODEL_MANIFEST.label,
      modelPath: folder,
      active: Boolean(activeDownload),
      // A persisted path is NOT evidence of readiness on a restarted or migrated Mac.
      health: (folder && folder === lastVerifiedPath && lastReport) || { ready: false, status:'not-checked' },
    };
  }
  async function runHealth(folder, signal) {
    if (healthBusy) throw new Error('本地模型检测已在进行');
    healthBusy = true;
    try {
      const verified = await manager.verifyExisting(folder);
      const output = resident ? null : await runHelper(helper, ['--health', folder], {
        timeout: 65000,
        maxBuffer: 8 * 1024,
        encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', HF_HUB_OFFLINE:'1',
          HF_HUB_DISABLE_TELEMETRY:'1', HOME: process.env.HOME || '' },
      });
      const response = resident ? await resident.request(folder, {type:'health'}, {signal}) : JSON.parse(output.stdout.trim());
      if (response.result !== 'ok' || response.gloss !== '树皮' || response.runtime !== 'swift-mlx') {
        throw new Error('原生推理返回了无效的健康检查结果');
      }
      lastVerifiedPath = folder;
      lastReport = { ready:true, status:'verified-native', modelId:verified.modelId };
      return lastReport;
    } catch (error) {
      lastVerifiedPath = null;
      lastReport = { ready:false, status: error.code === 'ENOENT' ? 'native-helper-missing' : 'native-health-failed' };
      return lastReport;
    } finally { healthBusy=false; }
  }
  async function chooseExisting(folder) {
    if (activeDownload) throw new Error('下载任务进行时不能切换模型');
    const adopted = await manager.adoptExisting({ consent:true, folder });
    resident?.reset();
    lastReport = null;
    lastVerifiedPath = null;
    return { ...adopted, health: await runHealth(folder) };
  }
  async function recheck({signal} = {}) {
    const selected = await selectedPath();
    if (!selected) return { ready:false, status:'no-selected-model' };
    return runHealth(selected, signal);
  }
  async function startDownload(onProgress) {
    if (activeDownload) throw new Error('已有模型下载任务');
    const ctl = new AbortController();
    activeDownload = ctl;
    resident?.reset();
    lastReport = null;
    lastVerifiedPath = null;
    try {
      const installed = await manager.install({consent:true,signal:ctl.signal,onProgress});
      if (ctl.signal.aborted) return { canceled:true };
      return {...installed, health: await runHealth(installed.path)};
    } finally { activeDownload = null; }
  }
  async function gloss({word,sentence,signal} = {}) {
    signal?.throwIfAborted();
    if (resident && !resident.inspect().active) { lastReport=null;lastVerifiedPath=null; }
    if (!lastReport?.ready) throw new Error('请先在阅读环境设置中验证本地 Qwen 模型');
    if (healthBusy || glossBusy) throw new Error('本地 Qwen 正忙，请稍后重试');
    if (typeof word !== 'string' || !/^[A-Za-z][A-Za-z '-]{0,63}$/.test(word.trim()) ||
        typeof sentence !== 'string' || !sentence.trim() || sentence.length > 600 ||
        /[\u0000-\u001f\u007f]/.test(sentence)) throw new Error('语境输入不符合要求');
    glossBusy = true;
    try {
      const folder = await selectedPath();
      signal?.throwIfAborted();
      if (!folder || folder !== lastVerifiedPath) throw new Error('模型位置已改变，请重新验证');
      const output = resident ? null : await runHelper(helper, ['--gloss',folder,word.trim(),sentence.trim()], {
        timeout:45000,maxBuffer:4096,encoding:'utf8',signal,
        env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',HOME:process.env.HOME||''},
      });
      const result = resident ? await resident.request(folder,{type:'gloss',word:word.trim(),sentence:sentence.trim()},{signal}) : JSON.parse(output.stdout.trim());
      signal?.throwIfAborted();
      if (result.result !== 'ok' || result.word !== word.trim() || result.runtime !== 'swift-mlx' ||
          typeof result.gloss !== 'string' || !/^[\p{Script=Han}、， ]{1,24}$/u.test(result.gloss)) {
        throw new Error('Qwen 释义格式不符合要求');
      }
      return {meaningZh:result.gloss,model:MODEL_MANIFEST.label,provider:'qwen-mlx'};
    } catch (error) {
      // A crash/timeout invalidates the previous health proof; next request must recheck.
      lastReport = null; lastVerifiedPath = null;
      throw error;
    } finally { glossBusy=false; }
  }
  async function translate({text,signal} = {}) {
    signal?.throwIfAborted();
    if (!resident) throw new Error('本地段落翻译需要常驻 MLX helper');
    if (typeof text !== 'string' || !text.trim() || text.length > 1800) throw new Error('本地段落翻译最多 1800 字符');
    if (healthBusy || glossBusy) throw new Error('本地 Qwen 正忙，请稍后重试');
    if (!resident.inspect().active) { lastReport=null;lastVerifiedPath=null; }
    if (!lastReport?.ready) throw new Error('请先验证本地 Qwen 模型');
    // Reserve before filesystem awaits so two callers cannot enter together.
    glossBusy=true;
    try {
      const folder=await selectedPath();
      if (!folder || folder!==lastVerifiedPath) throw new Error('模型已改变，请重新验证');
      const result=await resident.request(folder,{type:'translate',text},{signal});
      signal?.throwIfAborted();
      if(result.runtime!=='swift-mlx' || result.result!=='ok' || typeof result.translation!=='string' ||
          !result.translation.trim() || result.translation.length>6000 || !/\p{Script=Han}/u.test(result.translation))
        throw new Error('Qwen 翻译结果不完整或无效');
      return {translation:result.translation,model:MODEL_MANIFEST.label,provider:'qwen-mlx',profileId:MODEL_MANIFEST.revision};
    } catch(error) { lastReport=null;lastVerifiedPath=null;throw error; }
    finally {glossBusy=false;}
  }
  function cancelDownload() {
    if (!activeDownload) return {canceled:false};
    activeDownload.abort(new Error('下载已取消，已下载部分保留供下次续传'));
    return {canceled:true};
  }
  function close() { resident?.close(); }
  return {inspect, chooseExisting, recheck, startDownload, cancelDownload, gloss, translate, close};
}
module.exports = { createReaderModelService };
