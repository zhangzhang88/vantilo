const { createReaderAiClient } = require('./reader-ai-gateway.cjs');
const { startPortableReader } = require('./portable-reader-service.cjs');
const path = require('node:path');
const parent = process.parentPort;
if (!parent) throw new Error('Reader requires its Vantilo parent');
const aiClient = createReaderAiClient(parent);
let service;
let closing = false;
let startup = null;
let backupControlQueue = Promise.resolve();
const send = payload => { if (!closing) parent.postMessage(payload); };
parent.on('message', ({ data }) => {
  if (data?.type === 'reader-backup-freeze' && service && !closing && typeof data.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(data.requestId)) {
    backupControlQueue = backupControlQueue.catch(() => {}).then(() => service.freezeForBackup());
    void backupControlQueue.then(result => send({ type: 'reader-backup-response', requestId: data.requestId, ok: true, result }), error => send({ type: 'reader-backup-response', requestId: data.requestId, ok: false, error: error instanceof Error ? error.message : 'Reader 写入未能安全排空' }));
    return;
  }
  if (data?.type === 'reader-backup-resume' && service && !closing && typeof data.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(data.requestId)) {
    backupControlQueue = backupControlQueue.catch(() => {}).then(() => service.resumeAfterBackup());
    void backupControlQueue.then(result => send({ type: 'reader-backup-response', requestId: data.requestId, ok: true, result }), error => send({ type: 'reader-backup-response', requestId: data.requestId, ok: false, error: error instanceof Error ? error.message : 'Reader 写入未能恢复' }));
    return;
  }
  if (data?.type === 'reader-session' && !startup && !closing && typeof data.token === 'string' && /^[a-f0-9]{64}$/.test(data.token)) {
    startup = startPortableReader({ assetsDir: process.argv[2], libraryRoot: process.argv[3], userDataRoot: process.env.VANTILO_READER_USER_DATA_ROOT, enableLocalQwen: process.argv[4] === 'preview-local-qwen', enableTranslation: process.argv[5] === 'reader-translation', enableReaderPreviews: process.argv[6] === 'reader-previews', customApi:{get:()=>aiClient.customApi('get'),save:config=>aiClient.customApi('save',{config}),test:config=>aiClient.customApi('test',{config}),activate:id=>aiClient.customApi('activate',{id}),remove:id=>aiClient.customApi('remove',{id}),complete:payload=>aiClient.customApi('complete',{instruction:payload.instruction,input:payload.input,...(payload.task?{task:payload.task,profileId:payload.profileId}:{})},payload.signal).then(result=>result.output)}, seedDir: process.argv[7] === '--no-seed' ? undefined : process.argv[7] || path.join(process.argv[2], 'seed'), requireSessionAuth:true, sessionToken: data.token, softwareUpdates: {status:()=>aiClient.run({operation:'software-status'},true),check:()=>aiClient.run({operation:'software-check'},true),setAutomatic:automatic=>aiClient.run({operation:'software-auto',automatic},true),openRelease:()=>aiClient.run({operation:'software-open-release'},true),download:()=>aiClient.run({operation:'software-download'},true),cancelDownload:()=>aiClient.run({operation:'software-cancel-download'},true),revealDownload:()=>aiClient.run({operation:'software-reveal-download'},true)}, runAi: (payload, options) => aiClient.run(payload, false, options?.signal, options?.onDelta), getAccountStatus: () => aiClient.run({operation:'account-status'}, true), listModels: () => aiClient.run({operation:'models'}, true), onSync: state => send({ type: 'sync', state }) })
      .then(result => { service = result; send({ type: 'ready', sync: result.sync.getState() }); })
      .catch(() => { send({ type: 'error', message: '阅读服务启动失败，请检查本机端口 5174/5175 或重新安装' }); process.exitCode = 1; });
  }
  if (data?.type === 'sync' && service && !closing) void service.sync.check();
  if (data?.type === 'shutdown' && !closing) {
    closing = true; aiClient.close();
    void Promise.resolve(startup).then(() => service?.close(), () => {}).finally(() => process.exit(0));
  }
});
