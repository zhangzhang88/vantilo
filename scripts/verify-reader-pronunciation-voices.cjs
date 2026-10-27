const {app,BrowserWindow}=require('electron');
const {mkdtempSync, rmSync}=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const profile=mkdtempSync(path.join(os.tmpdir(),'vantilo-reader-voice-check-'));
app.setPath('userData',profile);
app.on('will-quit',()=>rmSync(profile,{recursive:true,force:true}));
app.whenReady().then(async()=>{
const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
try{await win.loadURL('data:text/html,%3Ctitle%3EVoice%20Check%3C/title%3E');
const voices=await win.webContents.executeJavaScript(`(async()=>{ const syn=window.speechSynthesis; await new Promise(resolve=>{if(syn.getVoices().length) return resolve();syn.addEventListener('voiceschanged',resolve,{once:true});setTimeout(resolve,1500)});return {supported:!!syn,total:syn.getVoices().length,english:syn.getVoices().filter(v=>v.lang.toLowerCase().startsWith('en')).map(v=>({name:v.name,lang:v.lang,local:v.localService,default:v.default})).slice(0,55)} })()`);
const locales=new Set(voices.english.map(v=>v.lang));
if(!locales.has('en-US') || !locales.has('en-GB'))throw new Error('US or UK system English voice unavailable');
console.log(JSON.stringify({supported:voices.supported,total:voices.total,
  us:voices.english.filter(v=>v.lang==='en-US').map(v=>v.name).slice(0,8),
  uk:voices.english.filter(v=>v.lang==='en-GB').map(v=>v.name).slice(0,8),
  passed:true}));}finally{win.destroy();app.quit();}
}).catch(err=>{console.error(err.message);app.exit(1)});
app.on('window-all-closed',()=>{});