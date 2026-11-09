require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();
const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const originalTyping=readFileSync(path.resolve(__dirname,'../../magazine-reader/public/worm/typing.mp3'));
let win;
const servers=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function serve(handler){
  const server=createServer(handler);servers.push(server);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return 'http://127.0.0.1:'+server.address().port;
}
(async()=>{
  await app.whenReady();
  const child=await serve((request,response)=>{
    if(request.url==='/original-typing.mp3') {
      response.writeHead(200,{'Content-Type':'application/octet-stream','X-Content-Type-Options':'nosniff'});
      response.end(originalTyping);return;
    }
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    response.end('<!doctype html><title>Reader policy fixture</title><input id="typing" />');
  });
  const parent=await serve((request,response)=>{
    const enabled=new URL(request.url,'http://127.0.0.1').pathname==='/enabled';
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    response.end('<!doctype html><title>Host policy fixture</title><iframe title="Reader" src="'+child+'/" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" '+(enabled?'allow="autoplay \'src\'; clipboard-write \'src\'"':'')+'></iframe>');
  });
  win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
  const output=[];
  for(const enabled of [false,true]){
    await win.loadURL(parent+(enabled?'/enabled':'/disabled'));
    let frame;
    for(let i=0;i<80;i++){
      frame=win.webContents.mainFrame.frames.find(item=>item.url.startsWith(child+'/'));
      if(frame)break;
      await delay(75);
    }
    if(!frame)throw new Error('Reader 子窗口未加载');
    const policy=await frame.executeJavaScript('document.permissionsPolicy?.allowsFeature("autoplay") ?? document.featurePolicy?.allowsFeature("autoplay") ?? null');
    const clipboardWrite=await frame.executeJavaScript('document.permissionsPolicy?.allowsFeature("clipboard-write") ?? document.featurePolicy?.allowsFeature("clipboard-write") ?? null');
    output.push({delegated:enabled,autoplay:policy,clipboardWrite});
    if(enabled) {
      const playback=await frame.executeJavaScript(`(async()=>{
        const audio=window.__testSound=new Audio('/original-typing.mp3');
        try { await audio.play();return {ok:true,paused:audio.paused,readyState:audio.readyState,volume:audio.volume}; }
        catch(e){ return {ok:false,errorName:e?.name}; }
      })()`,true);
      if(!playback.ok||playback.paused||playback.readyState<2) throw new Error('application/octet-stream MP3 在 Electron 嵌入视图无法播放: '+JSON.stringify(playback));
      await frame.executeJavaScript('window.__testSound.pause()');
      console.log('OCTET_MP3_EMBEDDED_PLAYBACK=PASS '+JSON.stringify(playback));
    }
  }
  if(output[0].autoplay!==false || output[1].autoplay!==true || output[0].clipboardWrite!==false || output[1].clipboardWrite!==true)throw new Error('嵌入页面 autoplay/clipboard-write 权限差异没有得到证实: '+JSON.stringify(output));
  console.log('EMBEDDED_READER_AUDIO_POLICY=PASS '+JSON.stringify(output));
})().catch(error=>{console.error('EMBEDDED_READER_AUDIO_POLICY=FAIL '+error.message);process.exitCode=1;}).finally(async()=>{
  try{win?.destroy();}catch{}
  await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
  app.exit(process.exitCode||0);
});
