// Real Chromium computed-style verification, isolated from Vantilo user data.
const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const repo = path.resolve(__dirname, '..');
const css = readFileSync(path.join(repo, 'scripts/reader-dictionary-card.css'), 'utf8');
const profile = mkdtempSync(path.join(os.tmpdir(), 'vantilo-dictionary-colors-'));
app.setPath('userData', profile);
const timeout = setTimeout(() => { console.error('FAIL: dictionary theme timeout'); app.exit(1); }, 15000);
const expected = {
  light: {
    panel: 'rgb(247, 245, 240)', lemma: 'rgb(55, 49, 42)',
    number: 'rgb(138, 104, 46)', english: 'rgb(96, 89, 79)',
    translation: 'rgb(67, 60, 51)', heading: 'rgb(103, 95, 83)',
  },
  night: {
    panel: 'rgb(46, 50, 56)', lemma: 'rgb(240, 236, 228)',
    number: 'rgb(219, 187, 120)', english: 'rgb(203, 195, 183)',
    translation: 'rgb(228, 221, 210)', heading: 'rgb(208, 200, 189)',
  },
};
const markup = [
  '<div class="word-lookup-card"><div class="word-lookup-dictionary-summary">',
  '<strong class="vantilo-dictionary-quick">强制实行；强行收取</strong>',
  '<details class="vantilo-dictionary-full" open><summary>查看完整词条与例句</summary>',
  '<div class="vantilo-dictionary-full-body"><div class="vantilo-dict-article">',
  '<div class="vantilo-dict-lemma-line"><strong>impose</strong><span class="vantilo-dict-phonetic">BrE ɪmˈpəʊz</span></div>',
  '<section class="vantilo-dict-section"><h4 class="vantilo-dict-section-title">A. transitive verb</h4>',
  '<div class="vantilo-dict-sense"><p class="vantilo-dict-sense-text">',
  '<span class="vantilo-dict-number">①</span><span class="vantilo-dict-text-han">强制实行</span></p>',
  '<div class="vantilo-dict-example"><div class="vantilo-dict-example-en">▸ to impose a tax</div>',
  '<div class="vantilo-dict-example-zh"><span class="vantilo-dict-text-han">征税</span></div>',
  '</div></div></section></div></div></details></div></div>',
].join('\n');
const styleQuery = '(() => {' +
  'const style = selector => getComputedStyle(document.querySelector(selector));' +
  'const article = document.querySelector(".vantilo-dict-article");' +
  'return {' +
  'panel:style(".vantilo-dict-article").backgroundColor,' +
  'lemma:style(".vantilo-dict-lemma-line strong").color,' +
  'number:style(".vantilo-dict-number").color,' +
  'english:style(".vantilo-dict-example-en").color,' +
  'translation:style(".vantilo-dict-example-zh .vantilo-dict-text-han").color,' +
  'heading:style(".vantilo-dict-section-title").color,' +
  'overflow:article.scrollWidth-article.clientWidth,' +
  'lemmaSize:style(".vantilo-dict-lemma-line strong").fontSize,' +
  'viewport:document.documentElement.clientWidth' +
  '};})()';
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 760, height: 950,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    let checked = 0;
    for (const [theme, colors] of Object.entries(expected)) {
      const themeClass = theme === 'night' ? ' theme-night' : '';
      const html = '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff}' +
        '.app-shell{padding:20px}.word-lookup-dictionary-summary{max-width:620px}' +
        css + '</style><div class="app-shell' + themeClass + '">' + markup + '</div>';
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      for (const width of [760, 480]) {
        win.setContentSize(width, 950);
        // macOS dispatches viewport resize asynchronously. Wait two Chromium frames.
        await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const actual = await win.webContents.executeJavaScript(styleQuery);
        for (const [key, expectedColor] of Object.entries(colors)) {
          if (actual[key] !== expectedColor) {
            throw new Error('Theme=' + theme + ' width=' + width + ' ' + key +
              ': ' + actual[key] + ' != ' + expectedColor);
          }
        }
        if (actual.overflow > 1) throw new Error('Dictionary overflow: ' + JSON.stringify({theme,width,actual}));
        const desiredSize = width <= 620 ? '20px' : '22px';
        if (actual.lemmaSize !== desiredSize) throw new Error('Wrong lemma size: ' + JSON.stringify({theme,width,actual}));
        checked++;
      }
    }
    console.log('PASS: ' + checked + ' real Chromium dictionary theme/width cases; parchment and night mode verified.');
  } finally { win.destroy(); }
}).then(() => { clearTimeout(timeout); app.quit(); }).catch(error => {
  console.error('FAIL:', error.message); clearTimeout(timeout); app.exit(1);
});
app.on('window-all-closed', () => {});
app.on('will-quit', () => rmSync(profile, { recursive: true, force: true }));