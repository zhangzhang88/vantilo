'use strict';
function registerUpdateSettings(api,{sync,softwareUpdates}){
 const unavailable=()=>({phase:'unconfigured',message:'软件更新尚未接入当前服务',automatic:true,currentVersion:'未知',installSupported:false});
 const software=softwareUpdates||{status:async()=>unavailable(),check:async()=>unavailable(),setAutomatic:async()=>{throw Error('软件更新尚未接入');},openRelease:async()=>{throw Error('没有可用的公开发布版本');}};
 const validAuto=body=>body&&Object.keys(body).join(',')==='automatic'&&typeof body.automatic==='boolean';
 api.get('/api/vantilo-updates/magazines',async(_req,reply)=>{reply.header('Cache-Control','no-store');return {...sync.getState(),intervalHours:3};});
 api.put('/api/vantilo-updates/magazines',async(req,reply)=>{if(!validAuto(req.body))return reply.code(400).send({error:'自动更新设置无效'});try{return {...await sync.setAutomatic(req.body.automatic),intervalHours:3};}catch{return reply.code(503).send({error:'杂志更新设置保存失败'});}});
 api.post('/api/vantilo-updates/magazines/check',async(req,reply)=>{if(req.body&&Object.keys(req.body).length)return reply.code(400).send({error:'检查参数无效'});void sync.check().catch(()=>{});return reply.code(202).send({...sync.getState(),intervalHours:3});});
 api.get('/api/vantilo-updates/software',async(_req,reply)=>{reply.header('Cache-Control','no-store');try{return await software.status();}catch{return reply.code(503).send({error:'软件版本状态读取失败'});}});
 api.put('/api/vantilo-updates/software',async(req,reply)=>{if(!validAuto(req.body))return reply.code(400).send({error:'自动检查设置无效'});try{return await software.setAutomatic(req.body.automatic);}catch{return reply.code(503).send({error:'软件更新设置保存失败'});}});
 api.post('/api/vantilo-updates/software/check',async(req,reply)=>{if(req.body&&Object.keys(req.body).length)return reply.code(400).send({error:'检查参数无效'});try{return await software.check();}catch{return reply.code(503).send({error:'软件版本检查失败'});}});
 api.post('/api/vantilo-updates/software/open-release',async(req,reply)=>{if(req.body&&Object.keys(req.body).length)return reply.code(400).send({error:'打开参数无效'});try{return await software.openRelease();}catch{return reply.code(409).send({error:'当前没有可打开的公开发布版本'});}});
}
module.exports={registerUpdateSettings};
