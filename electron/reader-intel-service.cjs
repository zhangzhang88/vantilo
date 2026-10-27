'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {INTEL_MODEL,verifyIntelModel}=require('./reader-intel-model.cjs');
const {createLlamaWorker}=require('./reader-llama-worker.cjs');

function createIntelModelService({userData,assetsDir,persistentGloss=false,workerFactory=createLlamaWorker,verify=verifyIntelModel}={}) {
  const root=path.join(userData,'local-models'), selection=path.join(root,'.intel-qwen-selection.json');
  const helper=path.join(assetsDir,'native','llama-server');
  const worker=workerFactory({helper});let readyFile=null,busy=false;
  async function selectedPath() {
    try {const record=JSON.parse(await fs.readFile(selection,'utf8'));return record.id===INTEL_MODEL.id && record.sha256===INTEL_MODEL.sha256 && path.isAbsolute(record.path)?record.path:null;} catch{return null;}
  }
  async function inspect() {
    const file=await selectedPath();let helperAvailable=false,availableBytes=0;
    try {await fs.access(helper,require('node:fs').constants.X_OK);helperAvailable=true;}catch{}
    try {const d=await fs.statfs(userData);availableBytes=d.bavail*d.bsize;}catch{}
    if(!worker.inspect().active)readyFile=null;
    return {selected:Boolean(file),modelName:INTEL_MODEL.label,modelPath:file,helperAvailable,active:false,
      health:{ready:Boolean(file&&file===readyFile),status:file===readyFile&&file?'verified-native':'not-checked'},
      hardware:{supported:process.platform==='darwin'&&process.arch==='x64'&&os.totalmem()>=8*1024**3,appleSilicon:false,memoryGiB:Math.round(os.totalmem()/1024**3),warning:null},
      disk:{availableBytes,freshInstallBytes:INTEL_MODEL.bytes+2*1024**3},model:{id:INTEL_MODEL.id,label:INTEL_MODEL.label,bytes:INTEL_MODEL.bytes,license:INTEL_MODEL.license}};
  }
  async function recheck({signal}={}) {
    if(busy)throw new Error('本地千问正在处理其他请求');busy=true;
    try {const file=await selectedPath();if(!file)return {ready:false,status:'no-selected-model'};
      await verify(file,{signal});const output=await worker.translate(file,'The small garden looks peaceful after the rain.',{signal});
      if(!output)throw new Error('模型健康检查失败');readyFile=file;return {ready:true,status:'verified-native',modelId:INTEL_MODEL.id};
    } catch(error){readyFile=null;if(signal?.aborted)throw error;return {ready:false,status:'native-health-failed'};} finally {busy=false;if(!persistentGloss){worker.reset();readyFile=null;}}
  }
  async function chooseExisting(file) {
    if(busy)throw new Error('本地千问正在处理其他请求');
    await verify(file);worker.reset();readyFile=null;await fs.mkdir(root,{recursive:true,mode:0o700});
    const temporary=selection+'.'+require('node:crypto').randomUUID()+'.tmp';
    await fs.writeFile(temporary,JSON.stringify({id:INTEL_MODEL.id,sha256:INTEL_MODEL.sha256,path:file}),{mode:0o600,flag:'wx'});
    await fs.rename(temporary,selection);
    return {modelId:INTEL_MODEL.id,health:await recheck()};
  }
  async function translate({text,signal}={}) {
    if(busy)throw new Error('本地千问正在处理其他请求');busy=true;
    try {const file=await selectedPath();if(!file||file!==readyFile||!worker.inspect().active)throw new Error('请先验证 Intel 千问模型');
      const translation=await worker.translate(file,text,{signal});
      return {translation,model:INTEL_MODEL.label,provider:'qwen-gguf',profileId:INTEL_MODEL.sha256};
    } catch(error){readyFile=null;throw error;}finally{busy=false;}
  }
  async function gloss({word,sentence,signal}={}) {
    signal?.throwIfAborted();
    if(typeof word!=='string'||! /^[A-Za-z][A-Za-z '-]{0,63}$/.test(word.trim())||typeof sentence!=='string'||!sentence.trim()||sentence.length>600||/[\u0000-\u001f\u007f]/.test(sentence))throw new Error('语境输入不符合要求');
    if(busy)throw new Error('本地千问正在处理其他请求');busy=true;
    try {const file=await selectedPath();if(!file||file!==readyFile||!worker.inspect().active)throw new Error('请先验证 Intel 千问模型');
      const meaningZh=await worker.gloss(file,word.trim(),sentence.trim(),{signal});
      if(typeof meaningZh!=='string'||!/^[\p{Script=Han}、， ]{1,24}$/u.test(meaningZh))throw new Error('本地千问语境释义格式无效');
      return {meaningZh,model:INTEL_MODEL.label,provider:'qwen-gguf'};
    } catch(error){readyFile=null;throw error;}finally{busy=false;}
  }
  return {inspect,recheck,chooseExisting,translate,gloss,
    startDownload:async()=>{throw new Error('Intel 模型下载尚未开放，请选择已有 GGUF 模型');},cancelDownload:()=>({canceled:false}),close:()=>worker.close()};
}
module.exports={createIntelModelService};
