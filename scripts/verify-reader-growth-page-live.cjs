const { app, BrowserWindow } = require('electron');
const { createServer } = require('vite');
const reactPlugin = require('@vitejs/plugin-react');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const repo = path.resolve(__dirname, '..');
  const screenshotDir = process.env.VANTILO_GROWTH_PAGE_SCREENSHOT_DIR || '/tmp/vantilo-growth-page-acceptance';
  if (!path.isAbsolute(screenshotDir) || screenshotDir.startsWith(repo + path.sep)) throw new Error('Screenshot directory must be absolute and outside the repository.');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'vantilo-growth-page-electron-'));
  app.setPath('userData', profile);
  let server;
  let win;
  try {
    await app.whenReady();
    server = await createServer({
      configFile: false,
      root: repo,
      plugins: [reactPlugin()],
      server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [repo] } },
      optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client'] },
      logLevel: 'error',
    });
    await server.listen();
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Vite fixture server did not bind a TCP port.');
    win = new BrowserWindow({ show: true, width: 1440, height: 1100, webPreferences: { contextIsolation: true, sandbox: true } });
    const origin = `http://127.0.0.1:${address.port}`;
    await win.loadURL(`${origin}/scripts/fixtures/reader-growth-page-live.html`);
    const storageKey = 'vantilo-reading-growth-v1';
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const record = { days: { [dayKey(today)]: { seconds: 1800, books: { fixture: 1800 } }, [dayKey(yesterday)]: { seconds: 534, books: { fixture: 534 } } } };
    const seedScript = `localStorage.setItem(${JSON.stringify(storageKey)},${JSON.stringify(JSON.stringify(record))})`;
    await win.webContents.executeJavaScript(seedScript);
    await win.webContents.reload();
    await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{let n=0;const check=()=>{if(document.querySelector('.reading-growth-page'))resolve(true);else if(n++>100)reject(new Error('Growth page did not mount'));else setTimeout(check,50)};check()})`);

    const inspect = () => win.webContents.executeJavaScript(`(()=>{
      const root=document.querySelector('.reading-growth-page'),stats=[...document.querySelectorAll('.reading-growth-stats article')],grid=document.querySelector('.reading-growth-grid'),rows=[...document.querySelectorAll('.reading-growth-history-row')];
      const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
      const overlap=(a,b)=>a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1;
      const pageRect=rect(root),cardRects=stats.map(rect),dateNodes=rows.map(row=>({date:row.querySelector('time'),value:row.querySelector('strong'),row}));
      return {viewport:{width:innerWidth,height:innerHeight},root:{...pageRect,display:getComputedStyle(root).display,scrollWidth:root.scrollWidth,clientWidth:root.clientWidth},heading:rect(root.querySelector('h1')),stats:cardRects,statsColumns:getComputedStyle(document.querySelector('.reading-growth-stats')).gridTemplateColumns,cardOverlaps:cardRects.some((a,i)=>cardRects.slice(i+1).some(b=>overlap(a,b))),calendar:{...rect(grid),columns:getComputedStyle(grid).gridTemplateColumns,scrollWidth:grid.scrollWidth,clientWidth:grid.clientWidth},rows:dateNodes.map(({date,value,row})=>({row:rect(row),date:rect(date),value:rect(value),dateText:date.textContent,dateWhiteSpace:getComputedStyle(date).whiteSpace,dateScrollWidth:date.scrollWidth,dateClientWidth:date.clientWidth,overlap:overlap(rect(date),rect(value))})),bodyScrollWidth:document.documentElement.scrollWidth,bodyClientWidth:document.documentElement.clientWidth,text:root.innerText};
    })()`);
    const assertReadable = (result, width) => {
      if (result.viewport.width !== width || result.root.width < width - 2 || result.root.display !== 'block' || result.root.scrollWidth > result.root.clientWidth + 1 || result.bodyScrollWidth > result.bodyClientWidth + 1) throw new Error(`Growth root/container width failed at ${width}: ${JSON.stringify(result.root)}`);
      if (result.stats.length !== 4 || result.cardOverlaps || result.stats.some(card => card.width < (width <= 650 ? 120 : 140) || card.height < 60)) throw new Error(`Growth stats cards failed at ${width}: ${JSON.stringify(result.stats)}`);
      if (result.calendar.columns.split(' ').length !== 7 || result.calendar.scrollWidth > result.calendar.clientWidth + 1) throw new Error(`Calendar grid failed at ${width}: ${JSON.stringify(result.calendar)}`);
      if (!result.rows.length || result.rows.some(row => row.dateText?.length !== 10 || row.dateWhiteSpace !== 'nowrap' || row.date.width < 80 || row.overlap || row.dateScrollWidth > row.dateClientWidth + 1)) throw new Error(`Reading history rows failed at ${width}: ${JSON.stringify(result.rows)}`);
      for (const text of ['我的阅读成长','累计阅读','累计达标','当前连续','最长连续','30:00 / 30:00','38:54','08:54']) if (!result.text.includes(text)) throw new Error(`Expected data/text missing at ${width}: ${text}`);
    };

    await fs.mkdir(screenshotDir, { recursive: true });
    const results = {};
    for (const width of [1440, 480]) {
      win.setSize(width, 1100);
      await new Promise(resolve => setTimeout(resolve, 350));
      const before = await inspect();
      assertReadable(before, width);
      const image = await win.webContents.capturePage();
      await fs.writeFile(path.join(screenshotDir, `reader-growth-${width}.png`), image.toPNG());
      const afterRecord = await win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}))`);
      if (JSON.stringify(afterRecord) !== JSON.stringify(record)) throw new Error('Growth record changed during display/layout acceptance.');
      results[width] = { ...before, fixtureDataUnchanged: true };
    }
    console.log(JSON.stringify({ result: 'PASS', environment: 'Electron/Chromium rendering the actual ReadingGrowthPage component with Vantilo global and host CSS', screenshots: screenshotDir, data: { today: '30:00', total: '38:54', qualifiedDays: 1, streak: 1, previousDay: '08:54', note: 'synthetic fixture in disposable Electron profile; unchanged by layout' }, results }, null, 2));
  } finally {
    await server?.close().catch(() => {});
    if (!win?.isDestroyed()) win?.destroy();
    await fs.rm(profile, { recursive: true, force: true });
    app.quit();
  }
}

main().catch(error => { console.error(error.stack || error); app.exit(1); });
