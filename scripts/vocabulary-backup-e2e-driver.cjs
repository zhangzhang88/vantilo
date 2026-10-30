'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { BrowserWindow } = require('electron');
const { verifyVocabularyBackupDocument } = require('../electron/vocabulary-backup-service.cjs');
const { sourceData, targetData } = require('./vocabulary-backup-e2e-fixtures.cjs');

const STORAGE = {
  selections: 'economist-reader-selections-v1',
  contexts: 'economist-reader-word-context-v1',
  schedules: 'magazine-reader-vocabulary-review-v1',
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const failures = [];
const evidence = [];
function mark(stage, details) { global.__vocabularyE2EStage = { stage, at: new Date().toISOString(), ...(details || {}) }; console.log(`VOCABULARY_E2E_STAGE ${JSON.stringify(global.__vocabularyE2EStage)}`); }

async function until(read, predicate, label, timeout = 30000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try { last = await read(); if (predicate(last)) return last; } catch {}
    await delay(100);
  }
  throw new Error(`等待超时：${label}${last === undefined ? '' : `；最后值=${String(last).slice(0, 240)}`}`);
}

function appWindow() {
  const windows = BrowserWindow.getAllWindows().filter(item => !item.isDestroyed());
  return windows.find(item => item.webContents.getURL().startsWith('http://127.0.0.1:5173/')) || windows[0];
}

function readerFrame(win) {
  return win?.webContents?.mainFrame?.framesInSubtree?.find(frame => frame.url.startsWith('http://127.0.0.1:5175/'))
    || win?.webContents?.mainFrame?.frames?.find(frame => frame.url.startsWith('http://127.0.0.1:5175/'));
}

async function waitReaderFrame(win) {
  return until(async () => readerFrame(win), frame => Boolean(frame), 'Reader iframe');
}

async function ensureReader(win, { settings = false } = {}) {
  await until(() => win.webContents.executeJavaScript(`Boolean(document.querySelector('button[aria-label="阅读"]'))`), Boolean, '宿主阅读入口');
  await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="阅读"]').click()`);
  let frame = await waitReaderFrame(win);
  await until(() => frame.executeJavaScript(`Boolean(document.querySelector('.global-nav-primary')||document.querySelector('.global-nav-assistant'))`), Boolean, 'Reader 页面');
  if (settings) {
    await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="设置"]').click()`);
    frame = await waitReaderFrame(win);
    await delay(300);
    const hostNavigated = await frame.executeJavaScript(`Boolean(document.querySelector('[data-testid="vocabulary-backup-panel"]'))`);
    if (!hostNavigated) {
      const readerSettingsButton = await frame.executeJavaScript(`(()=>{const button=document.querySelector('.global-nav-primary button[aria-label="设置"]')||document.querySelector('button[aria-label="设置"]');if(!button)return false;button.click();return true})()`);
      if (!readerSettingsButton) throw new Error('Reader 设置入口不存在');
      evidence.push({ step: 'host-settings-route', status: 'FALLBACK_TO_READER_SETTINGS' });
    } else evidence.push({ step: 'host-settings-route', status: 'PASS' });
    try {
      await until(() => frame.executeJavaScript(`Boolean(document.querySelector('[data-testid="vocabulary-backup-panel"]'))`), Boolean, '词汇备份界面');
    } catch (error) {
      const state = await frame.executeJavaScript(`({url:location.href,page:document.querySelector('.page')?.className||'',title:document.querySelector('.topbar-title')?.innerText||'',text:(document.body.innerText||'').slice(0,1200),buttons:[...document.querySelectorAll('button')].slice(0,15).map(x=>({text:x.innerText,aria:x.getAttribute('aria-label')}))})`).catch(() => null);
      throw new Error(`${error.message}; Reader state=${JSON.stringify(state)}`);
    }
  }
  return frame;
}

async function seed(frame, data, secrets = false) {
  const values = {
    [STORAGE.selections]: JSON.stringify(data.savedSelections),
    [STORAGE.contexts]: JSON.stringify(data.contextualMeanings),
    [STORAGE.schedules]: JSON.stringify(data.reviewSchedules),
  };
  await frame.executeJavaScript(`(()=>{const values=${JSON.stringify(values)};for(const [key,value] of Object.entries(values))localStorage.setItem(key,value);${secrets ? `localStorage.setItem('synthetic-api-key','E2E_SYNTHETIC_API_KEY_PLAINTEXT');localStorage.setItem('synthetic-api-key-ciphertext','E2E_SYNTHETIC_API_KEY_CIPHERTEXT');localStorage.setItem('synthetic-oauth','E2E_SYNTHETIC_OAUTH_TOKEN');` : ''}return true})()`);
}

async function readData(frame) {
  return frame.executeJavaScript(`({selections:JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE.selections)})||'[]'),contexts:JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE.contexts)})||'[]'),schedules:JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE.schedules)})||'[]')})`);
}

async function getTestId(frame, id) { return frame.executeJavaScript(`document.querySelector('[data-testid="${id}"]')?.innerText||null`); }
async function clickTestId(frame, id) { return frame.executeJavaScript(`(()=>{const element=document.querySelector('[data-testid="${id}"]');if(!element)throw new Error('缺少界面元素 ${id}');element.click();return true})()`); }

async function setRestoreFile(frame, filename, contents) {
  const serialized = JSON.stringify(contents);
  await frame.executeJavaScript(`(()=>{const input=document.querySelector('[data-testid="vocabulary-backup-input"]');if(!input)throw new Error('恢复文件入口不存在');const file=new File([${serialized}],${JSON.stringify(filename)},{type:'application/json'});const transfer=new DataTransfer();transfer.items.add(file);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'files').set.call(input,transfer.files);input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
}

async function waitPreviewOrError(frame) {
  return until(async () => frame.executeJavaScript(`({preview:Boolean(document.querySelector('[data-testid="vocabulary-restore-preview"]')),error:document.querySelector('[role="alert"]')?.innerText||''})`), state => state.preview || state.error, '恢复验证结果');
}

async function backupFile(round) {
  const filename = process.env.VANTILO_VOCABULARY_E2E_BACKUP;
  if (!filename) throw new Error('缺少隔离备份文件路径');
  global.__vocabularyBackupDialogResults ||= [];
  global.__vocabularyBackupDialogResults.push(round === 'cancel' ? { canceled: true } : { canceled: false, filePath: filename });
  const frame = readerFrame(appWindow());
  await clickTestId(frame, 'vocabulary-backup-start');
}

function makeRaceFixture() {
  const data = sourceData();
  const template = data.savedSelections[0];
  for (let index = 0; index < 300; index += 1) {
    const text = `concurrency-word-${index}`;
    data.savedSelections.push({
      ...template,
      id: `concurrency-seed-${index}`,
      text,
      startOffset: 1000 + index,
      context: `A synthetic sentence that keeps the concurrency fixture large enough to exercise asynchronous file writing for ${text}. `.repeat(4),
      translationZh: `合成释义 ${index}`,
      usageExplanationZh: `隔离并发测试记录 ${index}`,
      familiarity: (index % 4) + 1,
    });
  }
  return data;
}

function makeFrozenWriteCandidates(data) {
  const selections = structuredClone(data.selections ?? data.savedSelections);
  const original = selections.find(item => item.id === 'source-bank-noun');
  original.usageExplanationZh = '冻结期间排队的笔记修改';
  original.familiarity = 4;
  selections.push({
    ...original,
    id: 'concurrency-word-added-during-freeze',
    text: 'concurrency-word-added-during-freeze',
    startOffset: 99999,
    context: 'A synthetic word added while the vocabulary snapshot is frozen.',
    usageExplanationZh: '冻结期间新增的合成词汇',
  });
  const contexts = structuredClone(data.contexts ?? data.contextualMeanings);
  contexts[0].meaningZh = '冻结期间修改的合成释义';
  const schedules = structuredClone(data.schedules ?? data.reviewSchedules);
  const bank = schedules.find(item => item.key === 'bank');
  bank.familiarity = 4;
  bank.intervalDays = 30;
  bank.reviewCount += 1;
  return [
    { key: STORAGE.selections, value: JSON.stringify(selections), label: 'add-word-and-update-familiarity-and-note' },
    { key: STORAGE.contexts, value: JSON.stringify(contexts), label: 'update-contextual-meaning' },
    { key: STORAGE.schedules, value: JSON.stringify(schedules), label: 'update-review-schedule' },
  ];
}

async function installFreezeBoundaryProbe(frame, candidates) {
  await frame.executeJavaScript(`(()=>{
    const candidates=${JSON.stringify(candidates)};
    const log={freezeObserved:false,unfreezeObserved:false,blocked:[],applied:[],errors:[]};
    const receive=event=>{
      const type=event.data?.type;
      if(type==='vantilo:vocabulary-backup-freeze'&&!log.freezeObserved){
        log.freezeObserved=true;
        for(const item of candidates){try{localStorage.setItem(item.key,item.value);log.errors.push({label:item.label,result:'unexpected-write-during-freeze'});}catch(error){if(error?.name==='InvalidStateError')log.blocked.push(item.label);else log.errors.push({label:item.label,message:String(error)});}}
      }
      if(type==='vantilo:vocabulary-backup-unfreeze'&&log.freezeObserved&&!log.unfreezeObserved){
        log.unfreezeObserved=true;
        for(const item of candidates){try{localStorage.setItem(item.key,item.value);log.applied.push(item.label);}catch(error){log.errors.push({label:item.label,message:String(error)});}}
      }
    };
    window.__e2eVocabularyFreezeProbe=log;
    window.addEventListener('message',receive);
  })()`);
}

async function runRaceSource() {
  const win = await until(appWindow, value => Boolean(value && !value.webContents.isLoading()), '并发备份主窗口');
  let frame = await ensureReader(win);
  const seeded = makeRaceFixture();
  await seed(frame, seeded);
  frame = await ensureReader(win, { settings: true });

  // Hold only the native file picker adapter so a real Renderer write can land
  // immediately before the freeze/snapshot boundary.
  let resolveDialog;
  global.__vocabularyBackupDialogResults ||= [];
  global.__vocabularyBackupDialogResults.push(new Promise(resolve => { resolveDialog = resolve; }));
  await clickTestId(frame, 'vocabulary-backup-start');
  await until(() => frame.executeJavaScript(`document.querySelector('[data-testid="vocabulary-backup-progress"]')?.innerText||''`), text => text.includes('请选择备份保存位置'), '并发备份文件位置选择');

  const beforeFreeze = await readData(frame);
  const selectionsBefore = [...beforeFreeze.selections, {
    ...beforeFreeze.selections[0], id: 'concurrency-word-added-before-freeze', text: 'concurrency-word-added-before-freeze',
    startOffset: 99998, context: 'A synthetic word written before snapshot freeze.', usageExplanationZh: '冻结前合法写入',
  }];
  const contextsBefore = structuredClone(beforeFreeze.contexts);
  contextsBefore[0].meaningZh = '冻结前保存的语境释义';
  const schedulesBefore = structuredClone(beforeFreeze.schedules);
  schedulesBefore.find(item => item.key === 'bank').familiarity = 2;
  await frame.executeJavaScript(`(()=>{localStorage.setItem(${JSON.stringify(STORAGE.selections)},${JSON.stringify(JSON.stringify(selectionsBefore))});localStorage.setItem(${JSON.stringify(STORAGE.contexts)},${JSON.stringify(JSON.stringify(contextsBefore))});localStorage.setItem(${JSON.stringify(STORAGE.schedules)},${JSON.stringify(JSON.stringify(schedulesBefore))});return true})()`);
  const snapshotPoint = await readData(frame);
  await installFreezeBoundaryProbe(frame, makeFrozenWriteCandidates(snapshotPoint));
  resolveDialog({ canceled: false, filePath: process.env.VANTILO_VOCABULARY_E2E_BACKUP });

  await until(() => frame.executeJavaScript(`Boolean(document.querySelector('[data-testid="vocabulary-backup-success"]'))`), Boolean, '并发备份完成');
  await until(() => frame.executeJavaScript(`!document.querySelector('[data-testid="vocabulary-backup-progress"]')`), Boolean, '并发备份退出维护状态');
  const probe = await frame.executeJavaScript(`window.__e2eVocabularyFreezeProbe`);
  assert.equal(probe.freezeObserved, true, '必须观察到真实 Reader 冻结事件');
  assert.equal(probe.unfreezeObserved, true, 'Main 接收快照后必须明确通知解除冻结');
  assert.deepEqual(probe.blocked.sort(), ['add-word-and-update-familiarity-and-note', 'update-contextual-meaning', 'update-review-schedule'].sort(), '冻结窗口的真实 localStorage 写入口必须拒绝词汇更改');
  assert.deepEqual(probe.errors, [], '冻结期拒绝或解除冻结后的重试不得出现意外错误');
  assert.deepEqual(probe.applied.sort(), ['add-word-and-update-familiarity-and-note', 'update-contextual-meaning', 'update-review-schedule'].sort(), '被安全拒绝的合成写入必须在解除冻结后重试');

  const serialized = await fs.readFile(process.env.VANTILO_VOCABULARY_E2E_BACKUP, 'utf8');
  const backup = JSON.parse(serialized);
  verifyVocabularyBackupDocument(backup, serialized);
  assert.ok(backup.data.savedSelections.some(item => item.id === 'concurrency-word-added-before-freeze'), '冻结前完成的合法词汇写入必须进入一致性快照');
  assert.equal(backup.data.savedSelections.some(item => item.id === 'concurrency-word-added-during-freeze'), false, '冻结期写入不得泄漏进备份快照');
  assert.equal(backup.data.savedSelections.find(item => item.id === 'source-bank-noun')?.usageExplanationZh, selectionsBefore.find(item => item.id === 'source-bank-noun')?.usageExplanationZh, '快照应包含冻结前的笔记版本');
  assert.equal(backup.data.contextualMeanings[0].meaningZh, '冻结前保存的语境释义');
  assert.equal(backup.data.reviewSchedules.find(item => item.key === 'bank').familiarity, 2);

  const after = await readData(frame);
  assert.equal(after.selections.some(item => item.id === 'concurrency-word-added-during-freeze'), true, '冻结期被拒绝的新增词汇在解除冻结后重试并持久化');
  assert.equal(after.selections.find(item => item.id === 'source-bank-noun')?.usageExplanationZh, '冻结期间排队的笔记修改');
  assert.equal(after.contexts[0].meaningZh, '冻结期间修改的合成释义');
  assert.equal(after.schedules.find(item => item.key === 'bank').reviewCount, 10);
  evidence.push({ step: 'real-electron-vocabulary-write-race-and-snapshot-boundary', status: 'PASS', pid: process.pid, selectionsAtSnapshot: backup.data.savedSelections.length, blockedDuringFreeze: probe.blocked, retriedAfterUnfreeze: probe.applied, preFreezeWriteIncluded: true, frozenWritesExcludedFromSnapshot: true, frozenWritesPersistedAfterRetry: true, snapshotSha256: backup.integrity.sha256 });
}

async function loadRestorePreview(frame, backupPath = process.env.VANTILO_VOCABULARY_E2E_BACKUP) {
  await frame.executeJavaScript(`window.confirm=()=>true`);
  const serialized = await fs.readFile(backupPath, 'utf8');
  await setRestoreFile(frame, path.basename(backupPath), serialized);
  await until(() => frame.executeJavaScript(`Boolean(document.querySelector('[data-testid="vocabulary-restore-preview"]'))`), Boolean, '安全测试恢复预览');
  return serialized;
}

async function runRollbackFailure() {
  const win = await until(appWindow, value => Boolean(value && !value.webContents.isLoading()), '二次回滚失败主窗口');
  let frame = await ensureReader(win);
  await seed(frame, targetData());
  frame = await ensureReader(win, { settings: true });
  const serialized = await loadRestorePreview(frame);
  const expectedRaw = await frame.executeJavaScript(`Object.fromEntries(${JSON.stringify([STORAGE.selections, STORAGE.contexts, STORAGE.schedules])}.map(key=>[key,localStorage.getItem(key)]))`);
  await fs.writeFile(process.env.VANTILO_VOCABULARY_E2E_EXPECTED_RAW, JSON.stringify(expectedRaw, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await frame.executeJavaScript(`(()=>{
    const target=${JSON.stringify(STORAGE.schedules)};
    const descriptor=Object.getOwnPropertyDescriptor(Storage.prototype,'setItem');
    let failures=0;
    Object.defineProperty(Storage.prototype,'setItem',{...descriptor,value:function(key,value){
      if(key===target&&failures<2){failures+=1;throw new DOMException('E2E isolated persistent schedule write failure','QuotaExceededError');}
      return Reflect.apply(descriptor.value,this,[key,value]);
    }});
    window.__e2eRollbackDoubleFailure={descriptor,get failures(){return failures}};
  })()`);
  await clickTestId(frame, 'vocabulary-restore-confirm');
  await delay(150);
  const failureState = await frame.executeJavaScript(`({failures:window.__e2eRollbackDoubleFailure?.failures||0,alerts:[...document.querySelectorAll('[role="alert"]')].map(node=>node.innerText),restoreText:[...document.querySelectorAll('[role="status"]')].map(node=>node.innerText),journal:localStorage.getItem('vantilo-vocabulary-restore-journal-v1'),result:Boolean(document.querySelector('[data-testid="vocabulary-restore-result"]'))})`);
  const alert = failureState.alerts.join('\n');
  const failures = failureState.failures;
  assert.equal(failures, 2, `恢复写入和回滚写入必须都发生真实失败：${JSON.stringify(failureState)}`);
  assert.match(alert, /自动回滚未能确认/, `界面必须显示恢复保护状态：${JSON.stringify(failureState)}`);
  const journal = await frame.executeJavaScript(`JSON.parse(localStorage.getItem('vantilo-vocabulary-restore-journal-v1')||'null')`);
  assert.equal(journal?.phase, 'PREPARED', '回滚再次失败时必须保留未完成事务日志');
  assert.deepEqual(journal.original, expectedRaw, '持久化恢复点必须保持原始词汇数据');
  const beforeClose = await readData(frame);
  assert.equal(await frame.executeJavaScript(`Boolean(document.querySelector('[data-testid="vocabulary-restore-confirm"]')?.disabled)`), true, '恢复不确定时必须阻止新的普通恢复操作');
  const blocked = await frame.executeJavaScript(`(()=>{try{localStorage.setItem(${JSON.stringify(STORAGE.selections)},'[]');return {blocked:false};}catch(error){return {blocked:true,name:error.name};}})()`);
  assert.deepEqual(blocked, { blocked: true, name: 'InvalidStateError' }, 'RECOVERY_REQUIRED 状态必须阻止普通词汇写入');
  assert.deepEqual(await readData(frame), beforeClose, '二次失败不得改变原词汇记录');
  evidence.push({ step: 'real-electron-rollback-failure-quarantines-data', status: 'PASS', pid: process.pid, writeFailures: failures, journalPhase: journal.phase, originalSnapshotPreserved: true, regularWritesBlocked: blocked.blocked, message: alert, backupBytes: Buffer.byteLength(serialized) });
}

async function runRollbackRecovery() {
  const win = await until(appWindow, value => Boolean(value && !value.webContents.isLoading()), '重启后恢复窗口');
  const frame = await ensureReader(win);
  const expectedRaw = JSON.parse(await fs.readFile(process.env.VANTILO_VOCABULARY_E2E_EXPECTED_RAW, 'utf8'));
  const actualRaw = await frame.executeJavaScript(`Object.fromEntries(${JSON.stringify([STORAGE.selections, STORAGE.contexts, STORAGE.schedules, 'vantilo-vocabulary-restore-journal-v1'])}.map(key=>[key,localStorage.getItem(key)]))`);
  for (const key of Object.keys(expectedRaw)) assert.equal(actualRaw[key], expectedRaw[key], `重启恢复后原始数据必须原样保留：${key}`);
  assert.equal(actualRaw['vantilo-vocabulary-restore-journal-v1'], null, '启动恢复只在校验原始词汇恢复后清理 PREPARED 日志');
  const retryWrite = await frame.executeJavaScript(`(()=>{try{localStorage.setItem(${JSON.stringify(STORAGE.selections)},${JSON.stringify(expectedRaw[STORAGE.selections])});return 'accepted';}catch(error){return error.name;}})()`);
  assert.equal(retryWrite, 'accepted', '确认恢复点回滚成功后才允许恢复普通词汇写入');
  evidence.push({ step: 'restart-performs-and-verifies-pending-rollback', status: 'PASS', pid: process.pid, journalClearedAfterVerifiedRollback: true, originalDataPreserved: true, writesEnabledOnlyAfterRecovery: true });
}

async function runDiskFull() {
  const win = await until(appWindow, value => Boolean(value && !value.webContents.isLoading()), '受限磁盘备份窗口');
  let frame = await ensureReader(win);
  const capacityFixture = sourceData();
  const template = capacityFixture.savedSelections[0];
  for (let index = 0; index < 150; index += 1) {
    const text = `capacity-word-${index}`;
    capacityFixture.savedSelections.push({
      ...template,
      id: `capacity-seed-${index}`,
      text,
      startOffset: 2000 + index,
      context: `Synthetic capacity fixture for ${text}.`,
      translationZh: 'x'.repeat(18000),
      usageExplanationZh: `受限容量合成数据 ${index}`,
    });
  }
  await seed(frame, capacityFixture);
  frame = await ensureReader(win, { settings: true });
  const before = await readData(frame);
  await backupFile('write');
  const alert = await until(() => frame.executeJavaScript(`document.querySelector('[role="alert"]')?.innerText||''`), text => text.includes('磁盘空间不足'), '真实受限 APFS 卷空间不足提示');
  await until(() => frame.executeJavaScript(`!document.querySelector('[data-testid="vocabulary-backup-progress"]')`), Boolean, '满盘失败解除冻结');
  const backupPath = process.env.VANTILO_VOCABULARY_E2E_BACKUP;
  const created = await fs.stat(backupPath).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error));
  assert.equal(created, false, '空间不足时不得留下貌似完整的最终备份');
  const partials = await fs.readdir(path.dirname(backupPath)).then(names => names.filter(name => name.startsWith(`${path.basename(backupPath)}.`) && name.endsWith('.partial')));
  assert.deepEqual(partials, [], '空间不足时清理所有不完整临时文件');
  assert.deepEqual(await readData(frame), before, '空间不足不得修改原词汇');
  await frame.executeJavaScript(`localStorage.setItem('e2e-after-disk-full','released')`);
  const stat = await fs.statfs(path.dirname(backupPath));
  const freeBytes = Number(stat.bavail) * Number(stat.bsize);
  const estimatedBackupBytes = Buffer.byteLength(JSON.stringify({
    format: 'vantilo-vocabulary-backup',
    backupFormatVersion: 1,
    appVersion: require('../package.json').version,
    createdAt: '2026-10-30T00:00:00.000Z',
    counts: { vocabulary: 155, savedSelections: 155, contextualMeanings: 3, reviewSchedules: 2 },
    exclusions: require('../electron/vocabulary-backup-service.cjs').EXCLUSIONS,
    data: before,
    integrity: { algorithm: 'SHA-256', sha256: '0'.repeat(64), payloadBytes: 0, fileBytes: 0 },
  }, null, 2) + '\n');
  assert.ok(freeBytes < estimatedBackupBytes + Math.min(estimatedBackupBytes, 1024 * 1024), `容量受限卷必须低于真实备份写入所需空间：free=${freeBytes}, backup=${estimatedBackupBytes}`);
  evidence.push({ step: 'real-apfs-capacity-limited-backup-failure', status: 'PASS', pid: process.pid, actualFreeBytes: freeBytes, estimatedBackupBytes, enospcPreviouslyObserved: true, backupCreated: false, partialFiles: partials.length, originalVocabularyUnchanged: true, writeFreezeReleased: true, message: alert });
}

async function runUnwritable() {
  const win = await until(appWindow, value => Boolean(value && !value.webContents.isLoading()), '只读目录备份窗口');
  let frame = await ensureReader(win);
  await seed(frame, sourceData());
  frame = await ensureReader(win, { settings: true });
  const before = await readData(frame);
  await backupFile('write');
  const alert = await until(() => frame.executeJavaScript(`document.querySelector('[role="alert"]')?.innerText||''`), text => Boolean(text && !text.includes('磁盘空间不足')), '不可写目录拒绝提示');
  await until(() => frame.executeJavaScript(`!document.querySelector('[data-testid="vocabulary-backup-progress"]')`), Boolean, '不可写失败解除冻结');
  const output = process.env.VANTILO_VOCABULARY_E2E_BACKUP;
  assert.equal(await fs.stat(output).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error)), false, '不可写位置不得生成最终备份');
  assert.deepEqual(await readData(frame), before, '不可写错误不得修改原词汇');
  await frame.executeJavaScript(`localStorage.setItem('e2e-after-unwritable','released')`);
  evidence.push({ step: 'real-filesystem-unwritable-directory', status: 'PASS', pid: process.pid, outputCreated: false, originalVocabularyUnchanged: true, writeFreezeReleased: true, message: alert });
}

async function runRestoreRace() {
  const win = await until(appWindow, value => Boolean(value && !value.webContents.isLoading()), '恢复并发窗口');
  let frame = await ensureReader(win);
  await seed(frame, targetData());
  frame = await ensureReader(win, { settings: true });
  await loadRestorePreview(frame, process.env.VANTILO_VOCABULARY_E2E_RACE_BACKUP);
  await frame.executeJavaScript(`window.__e2eRestoreWriteProbe={attempted:false,accepted:false,error:null};window.__e2eRestoreWriteTimer=setInterval(()=>{if(window.__e2eRestoreWriteProbe.attempted||!document.body.innerText.includes('正在重新加载'))return;window.__e2eRestoreWriteProbe.attempted=true;try{const key=${JSON.stringify(STORAGE.selections)};const rows=JSON.parse(localStorage.getItem(key)||'[]');const existing=rows.find(item=>item.id==='target-bank-duplicate');existing.usageExplanationZh='恢复提交后并发保留的本机笔记';existing.familiarity=4;rows.push({...existing,id:'restore-concurrency-added',text:'restore-concurrency-added',startOffset:88888,context:'A synthetic word created immediately after restore commit.',usageExplanationZh:'恢复后新增'});localStorage.setItem(key,JSON.stringify(rows));const contextKey=${JSON.stringify(STORAGE.contexts)};const contexts=JSON.parse(localStorage.getItem(contextKey)||'[]');contexts[0].meaningZh='恢复提交后并发更新';localStorage.setItem(contextKey,JSON.stringify(contexts));const scheduleKey=${JSON.stringify(STORAGE.schedules)};const schedules=JSON.parse(localStorage.getItem(scheduleKey)||'[]');schedules.find(item=>item.key==='bank').familiarity=4;localStorage.setItem(scheduleKey,JSON.stringify(schedules));window.__e2eRestoreWriteProbe.accepted=true;}catch(error){window.__e2eRestoreWriteProbe.error={name:error.name,message:error.message};}clearInterval(window.__e2eRestoreWriteTimer);},5)`);
  await clickTestId(frame, 'vocabulary-restore-confirm');
  const probe = await until(() => frame.executeJavaScript(`window.__e2eRestoreWriteProbe`), state => state?.attempted, '恢复提交期间排队的实际词汇写入');
  assert.equal(probe.accepted, true, `事务提交后新写入必须成功并保留：${JSON.stringify(probe.error)}`);
  const notice = await until(async () => { frame = readerFrame(win); return frame && frame.executeJavaScript(`Boolean(document.querySelector('[data-testid="vocabulary-restore-result"]'))`); }, Boolean, '并发写入后的恢复完成状态');
  const final = await readData(frame);
  assert.equal(final.selections.length, 311, '跨设备词汇合并和提交后并发新增均应保留');
  assert.equal(final.selections.find(item => item.id === 'target-bank-duplicate')?.usageExplanationZh, '恢复提交后并发保留的本机笔记');
  assert.equal(final.selections.find(item => item.id === 'target-bank-duplicate')?.familiarity, 4);
  assert.ok(final.selections.some(item => item.id === 'restore-concurrency-added'));
  assert.equal(final.contexts[0].meaningZh, '恢复提交后并发更新');
  assert.equal(final.schedules.find(item => item.key === 'bank')?.familiarity, 4);
  evidence.push({ step: 'real-electron-restore-commit-write-race', status: 'PASS', pid: process.pid, userWriteAcceptedAfterVerifiedCommit: true, sourceRowsMerged: final.selections.length, concurrentWordRetained: true, noteAndFamiliarityRetained: true, contextAndScheduleRetained: true, resultVisible: notice });
}

async function runSource() {
  const win = await until(appWindow, value => Boolean(value && !value.webContents.isLoading()), 'Vantilo 主窗口');
  let frame = await ensureReader(win);
  const initial = sourceData();
  await seed(frame, initial, true);
  frame = await ensureReader(win, { settings: true });
  const countText = await until(() => frame.executeJavaScript(`document.querySelector('[data-testid="vocabulary-backup-panel"]')?.innerText||''`), text => text.includes('当前词汇：4 条'), '合成词汇数量');
  evidence.push({ step: 'source-ui-count', status: 'PASS', text: countText.match(/当前词汇：[^·]+/)?.[0]?.trim() || '' });

  await backupFile('cancel');
  await until(async () => frame.executeJavaScript(`!document.querySelector('[data-testid="vocabulary-backup-progress"]')`), Boolean, '备份选择器取消完成');
  assert.equal(await fs.stat(process.env.VANTILO_VOCABULARY_E2E_BACKUP).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error)), false);
  evidence.push({ step: 'cancel-save-dialog', status: 'PASS' });

  await backupFile('write');
  await until(async () => frame.executeJavaScript(`Boolean(document.querySelector('[data-testid="vocabulary-backup-success"]'))`), Boolean, '备份界面成功');
  await until(async () => frame.executeJavaScript(`!document.querySelector('[data-testid="vocabulary-backup-progress"]')`), Boolean, '备份写入结束并恢复词汇写入');
  assert.equal(await frame.executeJavaScript(`(()=>{localStorage.setItem('e2e-after-backup-write','released');return localStorage.getItem('e2e-after-backup-write')})()`), 'released', '备份完成后 Reader 存储写入屏障必须释放');
  const serialized = await fs.readFile(process.env.VANTILO_VOCABULARY_E2E_BACKUP, 'utf8');
  const document = JSON.parse(serialized);
  const verified = verifyVocabularyBackupDocument(document, serialized);
  assert.deepEqual(document.data, sourceData(), 'JSON 必须完整保留合成词汇的每个已支持字段');
  assert.equal(document.counts.vocabulary, 4);
  assert.equal(document.data.savedSelections.length, 5);
  assert.equal(document.data.contextualMeanings.length, 3);
  assert.equal(document.data.reviewSchedules.length, 2);
  assert.deepEqual(document.data.savedSelections.map(item => item.text), ['bank', 'bank', 'look after', 'lucid', 'legacy']);
  assert.equal(Object.hasOwn(document.data.savedSelections.find(item => item.id === 'source-legacy-no-position'), 'startOffset'), false);
  assert.ok(document.data.contextualMeanings.some(item => item.partOfSpeech === 'verb' && item.meaningZh === '使倾斜'));
  assert.ok(document.data.contextualMeanings.some(item => item.examplesEn.includes('She looks after the garden.')));
  assert.ok(document.data.savedSelections.some(item => item.usageExplanationZh === '动词用法：倾斜。' && item.familiarity === 1));
  assert.equal(document.data.savedSelections[0].document.documentId, 'reading:book:synthetic-book:chapter-1');
  for (const secret of ['E2E_SYNTHETIC_API_KEY_PLAINTEXT', 'E2E_SYNTHETIC_API_KEY_CIPHERTEXT', 'E2E_SYNTHETIC_OAUTH_TOKEN']) assert.equal(serialized.includes(secret), false, `备份含有敏感标记：${secret}`);
  evidence.push({ step: 'real-ui-ipc-json-backup', status: 'PASS', path: process.env.VANTILO_VOCABULARY_E2E_BACKUP, sha256: verified.sha256, bytes: Buffer.byteLength(serialized), counts: document.counts });

  const before = await fs.readFile(process.env.VANTILO_VOCABULARY_E2E_BACKUP);
  await backupFile('write');
  await delay(1200);
  const duplicateState = await frame.executeJavaScript(`({alert:document.querySelector('[role="alert"]')?.innerText||'',progress:document.querySelector('[data-testid="vocabulary-backup-progress"]')?.innerText||'',success:document.querySelector('[data-testid="vocabulary-backup-success"]')?.innerText||'',panel:document.querySelector('[data-testid="vocabulary-backup-panel"]')?.innerText||''})`);
  const duplicateAlert = duplicateState.alert;
  if (!duplicateAlert.includes('同名备份')) throw new Error(`重复备份的真实 UI 状态不符合拒绝覆盖预期：${JSON.stringify(duplicateState)}`);
  assert.deepEqual(await fs.readFile(process.env.VANTILO_VOCABULARY_E2E_BACKUP), before);
  evidence.push({ step: 'no-overwrite-existing-backup', status: 'PASS', message: duplicateAlert });
}

async function runTarget() {
  mark('target-start');
  const win = await until(appWindow, value => Boolean(value && !value.webContents.isLoading()), 'Vantilo 主窗口');
  let frame = await ensureReader(win);
  const initial = targetData();
  await seed(frame, initial);
  frame = await ensureReader(win, { settings: true });
  mark('target-settings-ready');
  await frame.executeJavaScript(`window.confirm=()=>false`);
  const backupText = await fs.readFile(process.env.VANTILO_VOCABULARY_E2E_BACKUP, 'utf8');

  await setRestoreFile(frame, 'invalid.json', '{');
  const corrupt = await until(async () => frame.executeJavaScript(`document.querySelector('[role="alert"]')?.innerText||''`), text => text.includes('有效 JSON'), '损坏 JSON 拒绝');
  evidence.push({ step: 'corrupt-json-rejected', status: 'PASS', message: corrupt });

  const validDoc = JSON.parse(backupText);
  const badHash = JSON.stringify({ ...validDoc, integrity: { ...validDoc.integrity, sha256: '0'.repeat(64) } });
  await setRestoreFile(frame, 'wrong-hash.json', badHash);
  const hashError = await until(async () => frame.executeJavaScript(`document.querySelector('[role="alert"]')?.innerText||''`), text => /SHA-256|完整性/.test(text), '错误 SHA 拒绝');
  evidence.push({ step: 'wrong-sha256-rejected', status: 'PASS', message: hashError });

  await setRestoreFile(frame, 'unsupported.json', JSON.stringify({ ...validDoc, backupFormatVersion: 99 }));
  const versionError = await until(async () => frame.executeJavaScript(`document.querySelector('[role="alert"]')?.innerText||''`), text => text.includes('不支持词汇备份格式版本'), '不兼容格式拒绝');
  evidence.push({ step: 'unsupported-version-rejected', status: 'PASS', message: versionError });

  await setRestoreFile(frame, 'truncated.json', backupText.slice(0, Math.floor(backupText.length / 2)));
  const truncatedError = await until(async () => frame.executeJavaScript(`document.querySelector('[role="alert"]')?.innerText||''`), text => text.includes('有效 JSON'), '截断文件拒绝');
  mark('target-invalid-inputs-rejected');
  evidence.push({ step: 'truncated-file-rejected', status: 'PASS', message: truncatedError });

  await setRestoreFile(frame, path.basename(process.env.VANTILO_VOCABULARY_E2E_BACKUP), backupText);
  const preview = await until(async () => frame.executeJavaScript(`document.querySelector('[data-testid="vocabulary-restore-preview"]')?.innerText||''`), text => text.includes('确认合并恢复'), '恢复预览');
  assert.match(preview, /本机尚未找到|来源目录暂不可用|来源/);
  const beforeCancel = await readData(frame);
  await clickTestId(frame, 'vocabulary-restore-confirm');
  await delay(200);
  assert.deepEqual(await readData(frame), beforeCancel, '用户取消必须保持本地词汇不变');
  mark('target-confirm-cancelled');
  evidence.push({ step: 'cancel-restore-confirmation', status: 'PASS' });

  await frame.executeJavaScript(`window.confirm=()=>true`);

  const beforeInjectedFailure = await readData(frame);
  const failOnce = await frame.executeJavaScript(`(()=>{
    const key=${JSON.stringify(STORAGE.contexts)};
    const descriptor=Object.getOwnPropertyDescriptor(Storage.prototype,'setItem');
    let injected=false;
    Object.defineProperty(Storage.prototype,'setItem',{...descriptor,value:function(name,value){
      if(!injected&&name===key){injected=true;throw new DOMException('E2E injected isolated storage write failure','QuotaExceededError')}
      return Reflect.apply(descriptor.value,this,[name,value]);
    }});
    window.__e2eRestoreStorageWriteHook={descriptor,get injected(){return injected}};
    return true;
  })()`);
  assert.equal(failOnce, true);
  await clickTestId(frame, 'vocabulary-restore-confirm');
  const rollbackError = await until(async () => frame.executeJavaScript(`document.querySelector('[role="alert"]')?.innerText||''`), text => text.includes('E2E injected isolated storage write failure'), '恢复写入失败提示');
  mark('target-transient-failure-rolled-back');
  assert.deepEqual(await readData(frame), beforeInjectedFailure, '真实 localStorage 写入失败后必须完整回滚所有词汇键');
  assert.equal(await frame.executeJavaScript(`localStorage.getItem('vantilo-vocabulary-restore-journal-v1')`), null, '成功回滚后不得残留 PREPARED 日志');
  assert.equal(await frame.executeJavaScript(`(()=>{const hook=window.__e2eRestoreStorageWriteHook;if(!hook)return false;Object.defineProperty(Storage.prototype,'setItem',hook.descriptor);delete window.__e2eRestoreStorageWriteHook;localStorage.setItem('e2e-after-rollback-write','released');return localStorage.getItem('e2e-after-rollback-write')})()`), 'released', '回滚后必须解除词汇写入冻结');
  evidence.push({ step: 'injected-real-localstorage-write-failure-rollback', status: 'PASS', message: rollbackError });

  await clickTestId(frame, 'vocabulary-restore-confirm');
  mark('target-final-restore-clicked');
  await until(async () => {
    const currentFrame = readerFrame(win);
    return currentFrame && currentFrame.executeJavaScript(`Boolean(document.querySelector('[data-testid="vocabulary-restore-result"]'))`);
  }, Boolean, '恢复提交并重新加载', 30000);
  mark('target-final-restore-result-visible');
  frame = readerFrame(win);
  const final = await readData(frame);
  assert.equal(final.selections.length, 9, '跨设备有字符位置的重复项合并，缺少位置的旧记录和不同来源记录分别保留');
  const mergedDuplicate = final.selections.find(item => item.id === 'target-bank-duplicate');
  assert.ok(mergedDuplicate, '跨设备重复项保留本机 ID');
  assert.equal(mergedDuplicate.usageExplanationZh, '本机笔记必须保留。');
  assert.equal(mergedDuplicate.familiarity, 5);
  assert.equal(final.selections.filter(item => item.text === 'bank').length, 3, '同词不同义项与位置分别保留');
  assert.ok(final.selections.some(item => item.text === 'look after'));
  assert.ok(final.selections.some(item => item.text === 'lucid'));
  assert.ok(final.selections.some(item => item.text === 'harbor'));
  assert.equal(final.selections.filter(item => item.text === 'lucid').length, 2, '不同书籍来源的同词不得错误合并');
  assert.equal(final.selections.filter(item => item.text === 'legacy').length, 2, '跨设备旧记录缺少字符位置时必须保留为两条，不猜测合并');
  assert.equal(final.contexts.length, 4, '同位置语境合并，不同词性或位置保留');
  assert.ok(final.contexts.some(item => item.partOfSpeech === 'verb' && item.meaningZh === '使倾斜'));
  assert.ok(final.contexts.some(item => item.partOfSpeech === 'adjective' && item.meaningZh === '安全的'));
  const bankSchedule = final.schedules.find(item => item.key === 'bank');
  assert.equal(bankSchedule.reviewCount, 9, '学习历史合并取较大次数，不重复相加');
  assert.equal(bankSchedule.familiarity, 2, '复习状态采用最近复习记录策略');
  evidence.push({ step: 'merge-result-in-real-localstorage', status: 'PASS', selections: final.selections.length, contexts: final.contexts.length, schedules: final.schedules.length, bankReviewCount: bankSchedule.reviewCount, bankNote: mergedDuplicate.usageExplanationZh, missingSourceRetained: final.selections.some(item => item.document.bookId === 'synthetic-book') });

  frame = await ensureReader(win, { settings: true });
  await setRestoreFile(frame, path.basename(process.env.VANTILO_VOCABULARY_E2E_BACKUP), backupText);
  await until(async () => frame.executeJavaScript(`Boolean(document.querySelector('[data-testid="vocabulary-restore-preview"]'))`), Boolean, '重复导入预览');
  await clickTestId(frame, 'vocabulary-restore-confirm');
  await until(async () => {
    const currentFrame = readerFrame(win);
    return currentFrame && currentFrame.executeJavaScript(`Boolean(document.querySelector('[data-testid="vocabulary-restore-result"]'))`);
  }, Boolean, '重复导入完成');
  frame = readerFrame(win);
  await until(async () => frame && frame.executeJavaScript(`JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE.selections)})||'[]').length===9`), Boolean, '重复导入后数据加载');
  const afterRepeat = await readData(frame);
  assert.deepEqual(afterRepeat, final, '重复导入不得增加重复记录或改变已有笔记、熟悉度和复习历史');
  evidence.push({ step: 'repeat-ui-import-idempotency', status: 'PASS', selections: afterRepeat.selections.length, contexts: afterRepeat.contexts.length, bankReviewCount: afterRepeat.schedules.find(item => item.key === 'bank')?.reviewCount });

  await frame.executeJavaScript(`(()=>{
    const keys=${JSON.stringify([STORAGE.selections,STORAGE.contexts,STORAGE.schedules])};
    const original=Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)]));
    localStorage.setItem('vantilo-vocabulary-restore-journal-v1',JSON.stringify({version:1,phase:'PREPARED',createdAt:new Date().toISOString(),original}));
    localStorage.setItem(${JSON.stringify(STORAGE.selections)},'[]');
    return true;
  })()`);
  evidence.push({ step: 'interrupted-restore-journal-before-app-exit', status: 'PASS', journal: 'PREPARED', damagedKey: STORAGE.selections });
}

async function runVerify() {
  const win = await until(appWindow, value => Boolean(value && !value.webContents.isLoading()), '重启后的 Vantilo 主窗口');
  const frame = await ensureReader(win);
  const final = await readData(frame);
  assert.equal(final.selections.length, 9);
  assert.equal(final.contexts.length, 4);
  assert.equal(final.selections.filter(item => item.text === 'legacy').length, 2);
  assert.equal(final.selections.filter(item => item.text === 'lucid').length, 2);
  assert.equal(final.selections.find(item => item.id === 'target-bank-duplicate')?.usageExplanationZh, '本机笔记必须保留。');
  assert.equal(final.schedules.find(item => item.key === 'bank')?.reviewCount, 9);
  assert.equal(await frame.executeJavaScript(`localStorage.getItem('vantilo-vocabulary-restore-journal-v1')`), null, '启动恢复应在 Reader 界面加载前还原并清理 PREPARED 日志');
  evidence.push({ step: 'restart-persistence-and-interrupted-restore-recovery', status: 'PASS', selections: final.selections.length, contexts: final.contexts.length, reviewCount: final.schedules.find(item => item.key === 'bank')?.reviewCount, preparedJournalCleared: true });
}

async function run() {
  const mode = process.env.VANTILO_VOCABULARY_E2E_MODE;
  if (mode === 'source') await runSource();
  else if (mode === 'target') await runTarget();
  else if (mode === 'verify') await runVerify();
  else if (mode === 'race-source') await runRaceSource();
  else if (mode === 'race-target') await runRestoreRace();
  else if (mode === 'rollback-failure') await runRollbackFailure();
  else if (mode === 'rollback-recovery') await runRollbackRecovery();
  else if (mode === 'disk-full') await runDiskFull();
  else if (mode === 'unwritable') await runUnwritable();
  else throw new Error(`未知 E2E 模式：${mode}`);
  const result = { status: 'PASS', mode, pid: process.pid, finishedAt: new Date().toISOString(), evidence };
  await fs.writeFile(process.env.VANTILO_VOCABULARY_E2E_RESULT, JSON.stringify(result, null, 2) + '\n', { flag: 'w', mode: 0o600 });
  console.log(`VOCABULARY_E2E_RESULT ${JSON.stringify(result)}`);
}

module.exports = { run };
