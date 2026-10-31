require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();
// Run with: node node_modules/electron/cli.js scripts/verify-reader-layout.cjs
// Uses actual Reader host markup and styles, without loading Reader or Codex.
const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const repo = path.resolve(__dirname, '..');
const requireRepo = createRequire(path.join(repo, 'package.json'));
const ts = requireRepo('typescript');
const { renderToStaticMarkup } = requireRepo('react-dom/server');
const React = requireRepo('react');
const sourcePath = path.join(repo, 'src/ui/magazine-reader-module.tsx');
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exported = {};
vm.runInNewContext(compiled, {
  exports: exported, URL, require: name => name.endsWith('.css') ? {} : name === '../reader/book-discovery' ? {BookDiscovery:()=>null} : name === '../reader/growth-page' ? {ReadingGrowthPage:()=>null} : name === '../reader/growth' ? {READING_GROWTH_STORAGE_KEY:'fixture',readGrowthRecord:()=>({days:{}}),saveGrowthRecord(){},growthStats:()=>({todaySeconds:0}),emptyGrowthRecord:()=>({days:{}}),isValidGrowthRecord:()=>true} : name === '../reader/growth-session' ? {createReadingSession:record=>({active:false,pausedByIdle:false,reminder:false,mode:null,bookId:null,lastActivity:0,lastTick:null,record}),pauseSession:state=>state,acceptReaderState:state=>state,readerActivity:state=>state,resumeSession:state=>state,tickSession:state=>state} : requireRepo(name),
});
const localProfile = mkdtempSync(path.join(os.tmpdir(), 'vantilo-layout-'));
app.setPath('userData', localProfile);
const deadline = setTimeout(() => { console.error('FAIL: layout verification timed out'); app.exit(1); }, 15000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  try {
    const readerCss = readFileSync(path.join(repo, 'src/ui/magazine-reader-module.css'), 'utf8');
    const shellCss = ['src/style.css', 'src/ui/session-navigation.css', 'src/ui/agent-composer.css', 'src/ui/conversation.css']
      .map(file => readFileSync(path.join(repo, file), 'utf8')).join('\n');
    let count = 0;
    for (const reversed of [false, true]) {
      for (const status of ['ready', 'starting', 'error']) {
        const markup = renderToStaticMarkup(React.createElement(exported.MagazineReaderModule, {
          status, error: 'fixture error', onRetry() {}, onBack() {}, syncState: {enabled:true,status:'idle',message:'已检查，暂无新刊',importedCount:0,failedCount:0},
        })).replace('src="http://127.0.0.1:5175/"', 'src="about:blank"');
        const css = reversed ? shellCss + readerCss : readerCss + shellCss;
        const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="root"><main><div class="app-titlebar"></div><nav class="app-rail"></nav><div class="workspace-sheet workspace-sheet-reader" style="--sidebar-width:230px">${markup}<section class="center" hidden>Shared Agent fixture</section></div></main></div>`;
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        for (const width of [1440, 900, 800, 480]) {
          win.setContentSize(width, 900);
          const result = await win.webContents.executeJavaScript(`(() => {
            const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
            return {workspace:rect('.workspace-sheet'),module:rect('.magazine-reader-module'),content:rect(document.querySelector('iframe') ? 'iframe' : '.magazine-reader-state')};
          })()`);
          const { workspace: sheet, module: panel, content } = result;
          const close = (a, b) => Math.abs(a - b) < 1;
          if (!close(sheet.x, panel.x) || !close(sheet.width, panel.width) || !close(sheet.height, panel.height)
            || !close(content.width, panel.width) || !close(content.height, panel.height)) {
            throw new Error(`Reader fails to fill workspace: width=${width} status=${status} reversedCSS=${reversed} ${JSON.stringify(result)}`);
          }
          count++;
        }
      }
    }
    for (const width of [1440,900,800,480]) {
      win.setContentSize(width,900);
      const markup=renderToStaticMarkup(React.createElement(exported.MagazineReaderModule,{status:'starting',error:null,onRetry(){},onBack(){}}));
      await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<style>${readerCss}${shellCss}</style><div id="root"><main><div class="app-titlebar"></div><nav class="app-rail"></nav><div class="workspace-sheet workspace-sheet-reader">${markup}<section class="center" hidden>Independent project fixture</section></div></main></div>`));
      const size=await win.webContents.executeJavaScript(`(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {width:r.width,x:r.x}};return {sheet:rect('.workspace-sheet'),reader:rect('.magazine-reader-module'),agent:rect('.center')};})()`);
      if(size.agent.width!==0 || Math.abs(size.reader.width-size.sheet.width)>1) throw new Error('Independent Reader layout failed: '+JSON.stringify(size));
      count++;
    }
    console.log(`PASS: ${count} real Chromium layout cases; full Reader workspace/frame width and height across 480/800/900/1440px, all states, both stylesheet orders, project Agent remains hidden at every width.`);
  } finally { win.destroy(); }
}).then(() => { clearTimeout(deadline); app.quit(); }).catch(error => {
  console.error(error.message); clearTimeout(deadline); app.exit(1);
});
app.on('window-all-closed', () => {});
app.on('will-quit', () => { rmSync(localProfile, { recursive: true, force: true }); });
