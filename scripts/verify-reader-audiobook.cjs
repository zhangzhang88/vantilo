require('./workspace-test-environment.cjs').assertWorkspaceTestEnvironment();

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const { createServer } = require('node:http');
const { once } = require('node:events');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { promisify } = require('node:util');
const { app, BrowserWindow, session } = require('electron');
const JSZip = require('jszip');
const { build: bundle } = require('esbuild');
const { startPortableReader } = require('../electron/portable-reader-service.cjs');
app.on('window-all-closed', () => {});
const deadline = setTimeout(() => {
  console.error('中文听书 Electron 验收超时');
  app.exit(1);
}, 150_000);

const opening = '阿岚把 MacBook 放回了桌上。';
const second = '夜色渐深，海边只剩下远处的灯火。';
const chapterDate = '·2005年12月8日';
const secondChapterOpening = '旅人沿着山道走了一段。';
const endPageMarker = '第 18 页';
const englishBody = 'The lantern was still burning when the travelers reached the ridge. They had walked there from the valley with only a few things in their bags, and they were ready to rest. The path that they had taken was steep and narrow. From the top they could see the river, which turned west behind the hills. This was the place that the woman from the village had described. She said that the light would still be there when they arrived, and she was right.';

const englishFollowup = 'The next morning they walked down toward the river. There was mist among the reeds, but they could see the old bridge where the footpath crossed the water. A woman with a blue coat was already waiting on the other side. She had brought a map from the village, and they spread it across the boards together. There were three roads marked on it, but only one led to the southern hill. They chose that road and carried the lantern with them.';
const translatedFirst = '灯笼仍亮着，旅人们到达山脊，看见了山后向西转弯的河流。';
const translatedFollowup = '第二天清晨，旅人沿河而行，在旧桥边遇到了带着地图的女人。';
const magazineBody = 'This original synthetic paragraph exists only to verify local magazine import. It is not a magazine excerpt. Reading tools preserve this text and the local library can read the imported issue.';
const magazineTranslation = '这段合成文字专门用于验证本地期刊导入和中文朗读。';
const magazineOpening = 'This synthetic opening paragraph lets the test distinguish the start of an article from a saved position later in the text.';
const magazineOpeningTranslation = '这是期刊测试文章的开头，用来和保存的续听位置区分。';
const nextMagazineTitle = 'Second fixture article';
const nextMagazineBody = 'The second synthetic article exists to verify that the audiobook stops at the end of the first article. This text belongs to no publication and was written for a test.';

async function makeMagazineEpub() {
  const zip = await JSZip.loadAsync(await fs.readFile(path.resolve(__dirname, '../tests/fixtures/minimal-magazine.epub')));
  const packageFile = 'OEBPS/content.opf', navigationFile = 'OEBPS/nav.xhtml';
  const packageXml = await zip.file(packageFile).async('string');
  const navigation = await zip.file(navigationFile).async('string');
  const articleFile = 'OEBPS/article.xhtml';
  const article = await zip.file(articleFile).async('string');
  zip.file(articleFile, article.replace('</h1>', `</h1><p>${magazineOpening}</p>`));
  zip.file(packageFile, packageXml.replace('</manifest>', '<item id="next" href="next.xhtml" media-type="application/xhtml+xml"/></manifest>')
    .replace('</spine>', '<itemref idref="next"/></spine>'));
  zip.file(navigationFile, navigation.replace('</ol>', `<li><a href="next.xhtml">${nextMagazineTitle}</a></li></ol>`));
  zip.file('OEBPS/next.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${nextMagazineTitle}</title></head><body><h1>${nextMagazineTitle}</h1><p>${nextMagazineBody}</p></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function makeEpub(title = '海边灯火测试书', languages = ['zh-Hant'], englishOnly = false) {
  const zip = new JSZip();
  const chapters = [
    ['cover', '版权页', '此处版权说明是测试用的合成文本。'],
    ['one', '第一章', opening],
    ['two', '第二章', chapterDate, secondChapterOpening, second, endPageMarker],
  ];
  if (englishOnly) chapters.splice(0, chapters.length, ['one', 'Chapter 1', englishBody], ['two', 'Chapter 2', englishFollowup]);
  zip.file('mimetype', 'application/epub+zip');
  zip.file('cover.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGMwLi8HIgYIBQAemgSFqJ88IAAAAABJRU5ErkJggg==', 'base64'));
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const endnotesItem = englishOnly ? '<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>' : '';
  if (englishOnly) zip.file('notes.xhtml', '<html><body><ol><li id="note-26"><p>Original synthetic source for the ridge.</p><a role="doc-backlink" href="one.xhtml#ref-26">Go back</a></li></ol></body></html>');
  zip.file('book.opf', `<package version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>测试作者</dc:creator>${languages.map(language => `<dc:language>${language}</dc:language>`).join('')}<dc:identifier>synthetic-audiobook-${title}</dc:identifier></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-img" href="cover.png" media-type="image/png" properties="cover-image"/>${chapters.map(([id]) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`).join('')}${endnotesItem}</manifest><spine>${chapters.map(([id]) => `<itemref idref="${id}"/>`).join('')}</spine></package>`);
  zip.file('nav.xhtml', `<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${chapters.map(([id, title]) => `<li><a href="${id}.xhtml">${title}</a></li>`).join('')}</ol></nav></body></html>`);
  for (const [id, title, ...paragraphs] of chapters) {
    const isEnglishOpening = englishOnly && id === 'one';
    const reference = isEnglishOpening
      ? '<span class="endnote-reference"><a epub:type="noteref" id="ref-26" href="notes.xhtml#note-26">26</a></span>'
      : '';
    zip.file(`${id}.xhtml`,
      `<html xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body><h1>${title}</h1>${isEnglishOpening ? "<h2>The Ridge</h2>" : ""}${paragraphs.map(paragraph => `<p>${paragraph}${reference}</p>`).join('')}</body></html>`);
  }
  return zip.generateAsync({ type: 'base64' });
}

async function main() {
  const artifacts = process.env.VANTILO_TEST_ARTIFACT_ROOT;
  const assetsDir = path.join(artifacts, 'reader-assets');
  const node = process.env.npm_node_execpath || 'node';
  const build = await promisify(execFile)(node, [path.join(__dirname, 'build-reader.mjs')], { env: {
    ...process.env,
    VANTILO_TRANSLATION_READER: "1",
    VANTILO_READER_BUILD_OUTPUT: assetsDir,
    VANTILO_SWIFT_MODULE_CACHE_PATH: path.join(artifacts, 'swift-module-cache'),
  }, timeout: 120_000 });
  process.stdout.write(build.stdout);
  const spoken = [];
  const translationInputs = [];
  const selectedApiRequests = [];
  const profiles = [
    { id: '92000000-0000-4000-8000-000000000001', name: '测试翻译', model: 'fixture-zh' },
    { id: '92000000-0000-4000-8000-000000000002', name: '模拟服务', model: 'fixture-fast' },
    { id: '92000000-0000-4000-8000-000000000003', name: '模拟服务', model: 'fixture-detailed' },
    { id: '92000000-0000-4000-8000-000000000004', name: '本地测试模型', model: 'fixture-local' },
  ];
  let retryFixture = true;
  let issueBodyAttempts = 0;
  let bookBatchBodyAttempts = 0;
  let bookBatchAborts = 0;
  const codexBatchInputs = [];
  const codexFallbackInputs = [];
  let finishBookBatch;
  let testBookBatch = false;
  const issueBodyTranslation = '这是整期任务写入的第二篇文章译文。';
  const catalogRequests = [];
  const provider = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/audio/speech') {
      response.writeHead(404).end();
      return;
    }
    const parts = [];
    for await (const chunk of request) parts.push(chunk);
    const { input } = JSON.parse(Buffer.concat(parts).toString());
    spoken.push(input);
    response.writeHead(200, { 'Content-Type': 'audio/pcm' });
    const seconds = input.includes(magazineTranslation) || input.includes(magazineOpeningTranslation) ? 10
      : (input.includes(second) || input.includes(translatedFollowup)) ? 24 : input.includes(translatedFirst) ? 5 : 2;
    response.end(Buffer.alloc(24_000 * 2 * seconds));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');

  let service, window, browserSession;
  try {
    const token = randomBytes(32).toString('hex');
    service = await startPortableReader({ assetsDir, libraryRoot: process.env.VANTILO_TEST_READER_ROOT, apiPort: 0, webPort: 0,
      autoSync: false, sessionToken: token, enableTranslation: true, enableReaderPreviews: process.env.VANTILO_CATALOG_READER_PREVIEW === "1",
      getAccountStatus: async () => ({ connected: true }),
      listModels: async () => ({ models: [{ id: 'gpt-fixture-luna', displayName: 'Fixture Luna', defaultEffort: 'low' }] }),
      runAi: async ({ input, taskKind, modelId }) => {
        assert.equal(modelId, 'gpt-fixture-luna');
        if (taskKind !== 'translation-batch') {
          codexFallbackInputs.push(input);
          return '山脊。';
        }
        const items = JSON.parse(input);
        codexBatchInputs.push(items.map(item => item.text));
        const translations = items.filter(item => item.text !== 'The Ridge').reverse().map(({ id, text }) => ({
          id, translation: text === englishBody ? translatedFirst : text === englishFollowup ? translatedFollowup : '测试章节标题。',
        }));
        return { output: JSON.stringify({ translations }), timings: { queueMs: 20, preparationMs: 300, modelMs: 1350 } };
      },
      customApi: {
        get: async () => ({ configured: true, ...profiles[0], activeId: profiles[0].id, profiles }),
        complete: async ({ input, selectedProfileId, signal }) => {
          if (input.startsWith('[{"id":')) {
            catalogRequests.push(selectedProfileId);
            const prefix = catalogRequests.length === 1 ? '测试目录 ' : '重新生成的目录 ';
            return JSON.stringify(JSON.parse(input).map(row => ({ id: row.id, titleZh: prefix + row.title })));
          }
          if (selectedProfileId === profiles[2].id) {
            selectedApiRequests.push(input);
            if (testBookBatch && input === englishFollowup) {
              bookBatchBodyAttempts++;
              signal.throwIfAborted();
              return new Promise((resolve, reject) => {
                const abort = () => { bookBatchAborts++; reject(signal.reason); };
                signal.addEventListener('abort', abort, { once: true });
                finishBookBatch = () => {
                  signal.removeEventListener('abort', abort);
                  resolve(translatedFollowup);
                };
              });
            }
            if (testBookBatch && input === englishBody) return translatedFirst;
            return '这段译文来自另一个已保存的测试模型。';
          }
          assert.equal(selectedProfileId, profiles[0].id);
          translationInputs.push(input);
          if (input === englishBody) {
            if (retryFixture) { retryFixture = false; throw new Error("合成翻译短暂失败"); }
            return translatedFirst;
          }
          if (input === englishFollowup) return translatedFollowup;
          if (input === "Chapter 1") return "第一章：旅人";
          if (input === "The Ridge") return "山脊";
          if (input === "Fixture article") return "期刊测试文章";
          if (input === magazineOpening) return magazineOpeningTranslation;
          if (input === magazineBody) return magazineTranslation;
          if (input === nextMagazineTitle) return '第二篇合成文章';
          if (input === nextMagazineBody) {
            issueBodyAttempts++;
            if (issueBodyAttempts === 1) {
              signal.throwIfAborted();
              return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
            }
            if (issueBodyAttempts === 2) throw new Error('整期任务模拟失败');
            return issueBodyTranslation;
          }
          throw new Error("合成翻译服务收到了意外的正文");
        },
      },
    });
    const config = await fetch(`${service.apiOrigin}/api/tts-settings`, { method: 'PUT', headers: {
      cookie: `__Host-vantilo-reader=${token}`, 'content-type': 'application/json',
    }, body: JSON.stringify({ baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, model: 'qwen3-tts-0.6b', apiKey: 'synthetic-test-key' }) });
    assert.equal(config.status, 200, await config.text());
    const imported = await fetch(`${service.apiOrigin}/api/import/epub?filename=TheEconomist.2099.10.29.epub`, {
      method: 'POST', headers: { cookie: `__Host-vantilo-reader=${token}`, 'content-type': 'application/epub+zip' },
      body: await makeMagazineEpub(),
    });
    assert.equal(imported.status, 201);
    const { issueId } = await imported.json();
    const partition = 'persist:synthetic-audiobook';
    browserSession = session.fromPartition(partition);
    const translationCalls = [];
    const profileRequests = [];
    browserSession.webRequest.onBeforeRequest((details, done) => {
      if (new URL(details.url).pathname === '/api/translation-cache-identity') profileRequests.push(details.url);
      if (details.method === 'POST' && /\/api\/(?:translate|vantilo-(?:translate|translation|catalog))/.test(details.url)) translationCalls.push(details.url);
      done({ cancel: !details.url.startsWith(service.webOrigin + '/') && !details.url.startsWith('file:') && !details.url.startsWith('data:') });
    });
    await browserSession.cookies.set({ url: service.webOrigin, name: '__Host-vantilo-reader', value: token, path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction' });
    const host = path.join(artifacts, 'audiobook-host.html');
    const repo = path.resolve(__dirname, '..');
    await bundle({
      stdin: {
        resolveDir: repo, loader: 'tsx', contents: `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { MagazineReaderModule } from './src/ui/magazine-reader-module';
          import './src/ui/macos-shell.css';
          function Host() {
            const [reader, setReader] = React.useState(true);
            const [target, setTarget] = React.useState(null);
            return <main className="vantilo-macos-shell" style={{display:"grid",height:"100vh",gridTemplateRows:"44px minmax(0,1fr) auto",gridTemplateColumns:"minmax(0,1fr)"}}>
              <nav style={{gridColumn:"1 / -1"}}><button onClick={() => setReader(false)}>Agent 工作台</button><button onClick={() => setReader(true)}>返回阅读</button></nav>
              <div className="workspace-sheet workspace-sheet-reader" style={{gridRow:2,gridColumn:1,display:"grid",minHeight:0}}>
                <MagazineReaderModule visible={reader} status="ready" error={null} onRetry={() => {}}
                  onBack={() => setReader(false)} audiobookTarget={target} onShowReader={() => setReader(true)} />
                {!reader && <section aria-label="Agent 工作台">测试工作台</section>}
              </div>
              <div className="vantilo-audiobook-slot" ref={setTarget} />
            </main>;
          }
          createRoot(document.getElementById("root")).render(<Host />);
        `,
      },
      bundle: true, jsx: 'automatic', outfile: path.join(artifacts, 'audiobook-host.js'),
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [{ name: 'isolated-reader-origin', setup(builder) {
        builder.onLoad({ filter: /magazine-reader-module\.tsx$/ }, async ({ path: filename }) => {
          const source = await fs.readFile(filename, 'utf8');
          assert.ok(source.includes("'http://127.0.0.1:5175/'"));
          return { contents: source.replace("'http://127.0.0.1:5175/'", JSON.stringify(service.webOrigin + '/')),
            loader: 'tsx', resolveDir: path.dirname(filename) };
        });
      } }],
    });
    await fs.writeFile(host, '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./audiobook-host.css"><style>body{margin:0}</style><div id="root"></div><script src="./audiobook-host.js"></script>');

    async function openWindow() {
      window = new BrowserWindow({ show: false, width: 1200, height: 850, webPreferences: { partition, sandbox: true, backgroundThrottling: false } });
      window.webContents.on('did-fail-load', (_event, code, description, url) => console.error({ code, description, url }));
      await window.loadFile(host);
      console.log('听书验收窗口已加载');
    }
    async function until(expression) {
      for (let attempt = 0; attempt < 160; attempt++) {
        const frame = window.webContents.mainFrame.frames.find(item => item.url.startsWith(service.webOrigin));
        try {
          if (frame && await Promise.race([frame.executeJavaScript(expression), delay(750, false)])) return frame;
        } catch { /* Chromium may replace the frame during navigation. */ }
        await delay(100);
      }
      const frame = window.webContents.mainFrame.frames.find(item => item.url.startsWith(service.webOrigin));
      throw new Error(`等待条件超时：${expression}\n${await Promise.race([frame?.executeJavaScript('document.body.innerText.slice(-1800)'), delay(750, '无法读取页面')])}`);
    }
    async function click(label) {
      const lookup = `[...document.querySelectorAll('button')].find(b => !b.disabled && (b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}))`;
      const frame = await until(`Boolean(${lookup})`);
      await frame.executeJavaScript(`(${lookup}).click()`, true);
    }

    async function untilHost(expression) {
      for (let attempt = 0; attempt < 160; attempt++) {
        if (await window.webContents.executeJavaScript(expression)) return;
        await delay(100);
      }
      throw new Error(`窗口控件等待超时：${expression}\n${await window.webContents.executeJavaScript('document.body.innerText.slice(-1200)')}`);
    }
    async function clickHost(label) {
      const selector = `[...document.querySelectorAll('button')].find(button =>
        !button.disabled && (button.textContent.trim() === ${JSON.stringify(label)} || button.getAttribute('aria-label') === ${JSON.stringify(label)}))`;
      await untilHost(`Boolean(${selector})`);
      await window.webContents.executeJavaScript(`(${selector}).click()`, true);
    }

    await openWindow();
    await click('电子书');
    console.log('已打开书架');
    const frame = await until('Boolean(document.querySelector("[data-testid=book-epub-import-input]"))');
    const files = [
      ['140857_海边灯火测试书_测试作者.epub', await makeEpub('140857_海边灯火测试书_测试作者')],
      ['Lantern Fixture.epub', await makeEpub('Lantern Fixture', ['zh-CN'], true)],
      ['双语灯火测试书.epub', await makeEpub('双语灯火测试书', ['en', 'zh-CN'])],
    ];
    await frame.executeJavaScript(`(() => {
      const input = document.querySelector('[data-testid=book-epub-import-input]');
      const transfer = new DataTransfer();
      for (const [filename, epub] of ${JSON.stringify(files)}) {
        transfer.items.add(new File([Uint8Array.from(atob(epub), c => c.charCodeAt(0))], filename, { type: 'application/epub+zip' }));
      }
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await click(process.env.VANTILO_CATALOG_READER_PREVIEW === '1' ? '仅导入 3 本' : '导入 3 本');
    console.log('已提交合成 EPUB 导入');
    await click('开始听书');
    console.log('已从导入结果启动播放器');
    const player = 'document.querySelector(".audiobook-dock")';
    await untilHost(`${player}?.querySelector("small").innerText.includes("第一章")`);
    await untilHost(`${player}?.querySelector("small").innerText.includes("第二章") && ${player}.dataset.phase === 'playing'`);
    assert.ok(spoken.includes(secondChapterOpening) && !spoken.includes(chapterDate), '自动跨章应从正文开始');
    const resumeLookup = `JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('vantilo-book-audiobook-v1:'))) || '[]')[0]`;
    await untilHost(`${player}?.querySelector("img")?.naturalWidth > 0`);
    await untilHost(`(() => {
      const dock = ${player}?.getBoundingClientRect();
      const frame = document.querySelector("iframe")?.getBoundingClientRect();
      const slot = document.querySelector(".vantilo-audiobook-slot")?.getBoundingClientRect();
      return dock && frame && slot && slot.top >= frame.bottom && slot.bottom <= innerHeight
        && dock.height > 0 && slot.height <= 50;
    })()`);
    const playbackFrame = await until(`(${resumeLookup})?.sourceText.includes("夜色渐深") && (${resumeLookup})?.seconds > 0.5`);
    const agentEntry = await playbackFrame.executeJavaScript(resumeLookup);
    const callsAtSwitch = spoken.length;
    await clickHost('Agent 工作台');
    await untilHost(`document.querySelector('.magazine-reader-module')?.hidden && ${player}?.dataset.phase === 'playing'`);
    const background = await until(`(${resumeLookup})?.seconds > ${agentEntry.seconds} + 0.5`);
    assert.equal(background, playbackFrame);
    await clickHost('回到当前位置');
    await untilHost(`!document.querySelector('.magazine-reader-module')?.hidden && ${player}?.dataset.phase === 'playing'`);
    await until('document.querySelector(".is-audiobook-source")?.innerText.includes("夜色渐深")');
    assert.equal(spoken.length, callsAtSwitch, '切到 Agent 和回原文不应重新请求语音');
    await clickHost('暂停朗读');
    await untilHost(`${player}?.dataset.phase === 'paused'`);
    await clickHost('Agent 工作台');
    await clickHost('回到当前位置');
    await untilHost(`!document.querySelector('.magazine-reader-module')?.hidden && ${player}?.dataset.phase === 'paused'`);
    await until('document.querySelector(".is-audiobook-source")?.innerText.includes("夜色渐深")');
    await browserSession.flushStorageData();
    const saved = await playbackFrame.executeJavaScript(resumeLookup);
    assert.equal(saved.sourceText, second);
    assert.ok(saved.paragraphIndex > 0, "应回到第二章的非首段");
    assert.ok(saved.seconds > 0.5 && !saved.completed);
    await click('←');
    const libraryGrid = "document.querySelector('[data-testid=book-library-grid]')";
    await click('电子书');
    await click('英文');
    await until(`${libraryGrid}?.innerText.includes('Lantern Fixture') && !${libraryGrid}?.innerText.includes('海边灯火测试书') && !${libraryGrid}?.innerText.includes('双语灯火测试书')`);
    const englishCard = `[...document.querySelectorAll('.book-library-card')].find(card => card.querySelector('strong')?.textContent === 'Lantern Fixture')`;
    const englishShelf = await until(`Boolean(${englishCard})`);
    await englishShelf.executeJavaScript(`(${englishCard}).click()`, true);
    await click('原书目录');
    const englishChapter = 'document.querySelector(".book-toc-row")';
    const detail = await until(`Boolean(${englishChapter})`);
    await detail.executeJavaScript(`${englishChapter}.click()`, true);
    await until('Boolean(document.querySelector(".reader-page-shell"))');
    await click('←');
    await click('电子书');
    await until(`document.querySelector('[data-testid=book-continue-card]')?.innerText.includes('Lantern Fixture')`);
    await click('全部');
    await until(`${libraryGrid}?.innerText.includes('双语灯火测试书')`);
    await until(`(() => {
      const cards = document.querySelectorAll('[data-testid=book-continue-card]');
      return cards.length === 1 && cards[0].querySelector('h2')?.textContent === 'Lantern Fixture'
        && !cards[0].querySelector('[data-testid=book-continue-listening]');
    })()`);
    await click('中文');
    await until(`${libraryGrid}?.innerText.includes('海边灯火测试书') && !${libraryGrid}?.innerText.includes('Lantern Fixture') && !${libraryGrid}?.innerText.includes('双语灯火测试书')`);
    await until(`document.querySelector('[data-testid=book-continue-card] h2')?.textContent === '海边灯火测试书'`);
    await until(`[...${libraryGrid}.querySelectorAll('strong')].some(title => title.textContent === '海边灯火测试书')`);
    await browserSession.flushStorageData();
    window.destroy();
    await openWindow();
    await click('电子书');
    const chineseFilter = `[...document.querySelectorAll('.book-shelf-language button')].find(button => button.textContent === '中文')`;
    await until(`${chineseFilter}?.getAttribute('aria-pressed') === 'true'`);
    await click('继续听');
    await untilHost(`${player}?.querySelector("small").innerText.includes("第二章")`);
    const resumed = await until(`(${resumeLookup})?.seconds > ${saved.seconds} + 0.3`);
    assert.equal(await resumed.executeJavaScript(`(${resumeLookup}).sourceText`), second);
    assert.ok(spoken[0]?.includes('MacBook'), JSON.stringify(spoken));
    assert.ok(spoken.some(text => text.includes(second)), JSON.stringify(spoken));
    assert.ok(spoken.every(text => !text.includes('版权说明')), JSON.stringify(spoken));
    assert.deepEqual(translationCalls, []);
    const languageControl = 'document.querySelector(".book-reading-language select")';
    const detailFrame = await until(`Boolean(${languageControl})`);
    await detailFrame.executeJavaScript(`(() => {
      const select = ${languageControl};
      select.value = 'en';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await click('电子书');
    await until(`${libraryGrid} && !${libraryGrid}.innerText.includes('海边灯火测试书')`);
    await click('英文');
    await until(`${libraryGrid}?.innerText.includes('海边灯火测试书') && ${libraryGrid}?.innerText.includes('Lantern Fixture')`);
    await clickHost('切换播放倍速，当前 1 倍速');
    await untilHost('Boolean(document.querySelector("[data-testid=audiobook-rate-picker]"))');
    await window.webContents.executeJavaScript(`(() => {
      const btn = [...document.querySelectorAll("[data-testid=audiobook-rate-picker] button")].find(item => item.textContent.includes("1.25x"));
      btn?.click();
    })()`, true);
    await until(`(${resumeLookup})?.rate === 1.25`);
    const beforeClose = await resumed.executeJavaScript(resumeLookup);
    await clickHost('关闭播放器');
    await untilHost(`!${player} && document.querySelector(".vantilo-audiobook-slot")?.offsetHeight === 0`);
    const afterClose = await resumed.executeJavaScript(resumeLookup);
    assert.equal(afterClose.sourceText, second);
    assert.ok(afterClose.seconds >= beforeClose.seconds);
    await delay(1150);
    assert.deepEqual(await resumed.executeJavaScript(resumeLookup), afterClose);
    const englishListen = `[...document.querySelectorAll('.book-library-card-wrapper')]
      .find(card => card.querySelector('strong')?.textContent === 'Lantern Fixture')
      ?.querySelector('.book-library-listen')`;
    const englishListenFrame = await until(`(${englishListen})?.textContent.trim() === "听中文译文"`);
    await englishListenFrame.executeJavaScript(`(${englishListen}).click()`, true);
    await untilHost(`${player}?.innerText.includes("Chapter 1") && ${player}.innerText.includes("中文译文")`);
    await untilHost(`${player}?.dataset.phase === 'error' && ${player}.innerText.includes("合成翻译短暂失败")`);
    await clickHost('播放朗读');
    await untilHost(`${player}?.innerText.includes("Chapter 2") && ${player}.dataset.phase === 'playing'`);
    const translatedLookup = `JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('vantilo-book-translated-audiobook-v1:'))) || '[]')[0]`;
    const englishPlayback = await until(`(${translatedLookup})?.seconds > 0.5`);
    const englishPosition = await englishPlayback.executeJavaScript(translatedLookup);
    const ttsBeforeReturn = spoken.length;
    await clickHost('Agent 工作台');
    await until(`(${translatedLookup})?.seconds > ${englishPosition.seconds} + 0.5`);
    await clickHost('回到译文');
    await until(`document.querySelector('[data-testid=audiobook-transcript] .is-audiobook-source p')?.innerText === ${JSON.stringify(translatedFollowup)}`);
    await untilHost(`!document.querySelector('.magazine-reader-module')?.hidden && ${player}?.dataset.phase === 'playing'`);
    assert.equal(spoken.length, ttsBeforeReturn);
    await clickHost('暂停朗读');
    await untilHost(`${player}?.dataset.phase === 'paused'`);
    await clickHost('Agent 工作台');
    await clickHost('回到译文');
    await until(`document.querySelector('[data-testid=audiobook-transcript] .is-audiobook-source p')?.innerText === ${JSON.stringify(translatedFollowup)}`);
    await untilHost(`!document.querySelector('.magazine-reader-module')?.hidden && ${player}?.dataset.phase === 'paused'`);
    const englishVoiceCount = spoken.length;
    await clickHost('Agent 工作台');
    await clickHost('回到原文');
    await until(`document.querySelector('.reading-body .is-audiobook-source > p')?.innerText === ${JSON.stringify(englishFollowup)}`);
    await untilHost(`!document.querySelector('.magazine-reader-module')?.hidden && ${player}?.dataset.phase === 'paused'`);
    assert.equal(spoken.length, englishVoiceCount);
    await clickHost('回到译文');
    await until(`document.querySelector('[data-testid=audiobook-transcript] .is-audiobook-source p')?.innerText === ${JSON.stringify(translatedFollowup)}`);
    await clickHost('关闭播放器');
    await untilHost(`!${player}`);
    const savedTranslation = await englishPlayback.executeJavaScript(translatedLookup);
    assert.equal(savedTranslation.sourceText, englishFollowup);
    assert.ok(savedTranslation.seconds > englishPosition.seconds);
    await click('← 返回书籍');
    await click('← 返回电子书');
    await click('继续听译文');
    await untilHost(`${player}?.innerText.includes("Chapter 2") && ${player}.dataset.phase === 'playing'`);
    await until(`(${translatedLookup})?.seconds > ${savedTranslation.seconds} + 0.3`);
    assert.deepEqual(translationInputs, [englishBody, englishBody, englishFollowup]);
    assert.ok(spoken.includes(translatedFirst) && spoken.includes(translatedFollowup));
    assert.ok(spoken.every(text => !text.includes("The lantern was") && !text.includes("The next morning")));
    await clickHost('关闭播放器');
    await untilHost(`!${player}`);
    await click('电子书');
    const sameBookCard = await until(`(() => {
      const cards = document.querySelectorAll('[data-testid=book-continue-card]');
      return cards.length === 1 && cards[0].querySelector('h2')?.textContent === 'Lantern Fixture'
        && cards[0].querySelectorAll('.book-cover').length === 1 && cards[0].getBoundingClientRect().height <= 110
        && cards[0].querySelector('p')?.textContent.includes('全书')
        && cards[0].querySelector('[data-testid=book-continue-reading]')
        && !cards[0].querySelector('[data-testid=book-continue-listening]');
    })()`);
    await sameBookCard.executeJavaScript(`document.querySelector('[data-testid=book-continue-reading]').click()`, true);
    const resumedBook = await until(`document.querySelector('.reading-body')?.textContent.includes(${JSON.stringify(englishFollowup)})`);
    await resumedBook.executeJavaScript(`document.querySelector('.article-footer-nav button:first-child').click()`, true);
    await until(`document.querySelector('.reading-body')?.textContent.includes(${JSON.stringify(englishBody)})`);
    const referenceButton = 'document.querySelector(".reading-body sup button[aria-label=\'查看注释 26\']")';
    const noteReader = await until(`Boolean(${referenceButton})`);
    assert.equal(await noteReader.executeJavaScript(`${referenceButton}.closest('p').textContent`), englishBody,
      '正文文本排除注释编号，但保留可点击的上标');
    await click('查看注释 26');
    await until(`document.querySelector('.book-source-reference-dialog[open] p')?.textContent === 'Original synthetic source for the ridge.'`);
    await noteReader.executeJavaScript('document.querySelector(".book-source-reference-dialog form button").click()', true);
    await until(`!document.querySelector('.book-source-reference-dialog[open]')`);
    const fullButton = 'document.querySelector(".reader-full-translation-button")';
    const fullView = await until(`${fullButton} && !${fullButton}.disabled`);
    const profileCount = profileRequests.length;
    const expectedInputs = [englishBody, englishBody, englishFollowup, "Chapter 1", "The Ridge"];
    await fullView.executeJavaScript(`${fullButton}.click()`, true);
    await until(`(() => {
      const content = document.querySelector('.reader-page-shell');
      return content?.innerText.includes(${JSON.stringify(translatedFirst)}) &&
        content?.innerText.includes('第一章：旅人') && content?.innerText.includes('山脊')
        && ${fullButton}?.getAttribute('aria-pressed') === 'true' && !${fullButton}.disabled;
    })()`);
    assert.deepEqual(translationInputs, expectedInputs, '全文只补译没缓存的标题和小标题');
    assert.equal(profileRequests.length, profileCount, '已选模型不请求旧的配置接口');
    await fullView.executeJavaScript(`${fullButton}.click()`, true);
    await until(`${fullButton}?.getAttribute('aria-pressed') === 'false'`);
    await fullView.executeJavaScript(`${fullButton}.click()`, true);
    await until(`${fullButton}?.getAttribute('aria-pressed') === 'true' && !${fullButton}.disabled
      && document.querySelector('.reader-page-shell')?.innerText.includes(${JSON.stringify(translatedFirst)})`);
    assert.deepEqual(translationInputs, expectedInputs, '缓存齐全时重新展开全文没有模型调用');
    assert.equal(profileRequests.length, profileCount);
    console.log('PASS: 全文复用听书译文，只补译缺失标题，收起再展开时零翻译请求和零旧配置请求');
    await click('←');
    await click('电子书');
    await click('继续听译文');
    await untilHost(`${player}?.innerText.includes("Chapter 2") && ${player}.dataset.phase === 'playing'`);
    assert.deepEqual(translationInputs, expectedInputs);
    await untilHost(`${player}?.innerText.includes('回到原文') && !${player}.innerText.includes('回到中英对照')`);
    await click('电子书');
    const bookReading = 'document.querySelector("[data-testid=book-continue-reading]")';
    const bookShelf = await until(`Boolean(${bookReading})`);
    await bookShelf.executeJavaScript(`${bookReading}.click()`, true);
    const selectAndListenOriginalBlock = blockExpr => `(async () => {
      const block = ${blockExpr};
      const p = block?.querySelector(':scope > p') ?? block?.querySelector('p');
      if (!p) return false;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const firstNode = walker.nextNode();
      if (!firstNode || !firstNode.textContent) return false;
      let endNode = firstNode;
      let remaining = 12;
      let endOffset = Math.min(remaining, firstNode.textContent.length);
      remaining -= endOffset;
      while (remaining > 0) {
        const next = walker.nextNode();
        if (!next) break;
        if (!next.textContent) continue;
        endNode = next;
        endOffset = Math.min(remaining, next.textContent.length);
        remaining -= endOffset;
      }
      const range = document.createRange();
      range.setStart(firstNode, 0);
      range.setEnd(endNode, endOffset);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      let btn = document.querySelector('[data-testid=selection-assist-popover] .selection-listen-here-button');
      for (let i = 0; !btn && i < 10; i++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        btn = document.querySelector('[data-testid=selection-assist-popover] .selection-listen-here-button');
      }
      if (!btn) return false;
      btn.click();
      return true;
    })()`;
    const firstSourceBlock = 'document.querySelector(".reading-body .reading-paragraph-block")';
    const bookStart = await until(`Boolean(${firstSourceBlock}) && document.querySelector('.reader-page-shell')?.innerText.includes('Chapter 1')`);
    assert.equal(await bookStart.executeJavaScript(selectAndListenOriginalBlock(firstSourceBlock), true), true);
    await until(`(${translatedLookup})?.sourceText === ${JSON.stringify(englishBody)}`);
    await untilHost(`${player}?.innerText.includes("Chapter 1") && ${player}.dataset.phase === 'playing'`);
    await until(`document.querySelector('.reading-body .is-audiobook-source > p')?.innerText === ${JSON.stringify(englishBody)}`);
    await clickHost('暂停朗读');
    await untilHost(`${player}?.dataset.phase === 'paused'`);
    const bookTranslationRequests = translationCalls.length;
    await clickHost('回到译文');
    await until(`document.querySelector('[data-testid=audiobook-transcript] .is-audiobook-source p')?.innerText === ${JSON.stringify(translatedFirst)}`);
    await clickHost('回到中英对照');
    await until(`${fullButton}?.getAttribute('aria-pressed') === 'true'
      && document.querySelector('.reading-body .is-audiobook-source .translation-panel p')?.innerText === ${JSON.stringify(translatedFirst)}
      && document.querySelector('.reading-title-zh')?.innerText === '第一章：旅人'`);
    await untilHost(`${player}?.dataset.phase === 'paused'`);
    assert.equal(translationCalls.length, bookTranslationRequests);
    assert.deepEqual(translationInputs, expectedInputs, '从指定书籍章节和段落听时复用译文');
    await clickHost('关闭播放器');
    await untilHost(`!${player}`);

    await click('←');
    await click('期刊');
    const publicationCard = 'document.querySelector(\'[data-testid^="publication-card-"]\')';
    const publication = await until(`Boolean(${publicationCard})`);
    await publication.executeJavaScript(`${publicationCard}.click()`, true);
    const issueCard = `document.querySelector(${JSON.stringify(`[data-testid="issue-card-${issueId}"]`)})`;
    const magazine = await until(`Boolean(${issueCard})`);
    await magazine.executeJavaScript(`${issueCard}.click()`, true);
    const articleButtons = `[...document.querySelectorAll('[data-testid^="toc-article-"] .toc-article-main')]`;
    const magazineArticle = `${articleButtons}.find(button => button.textContent.includes('Fixture article'))`;
    const contents = await until(`${articleButtons}.length >= 2 && Boolean(${magazineArticle})`);
    await contents.executeJavaScript(`(${magazineArticle}).click()`, true);
    const magazineFullView = await until(`${fullButton} && !${fullButton}.disabled`);
    await magazineFullView.executeJavaScript(`${fullButton}.click()`, true);
    await until(`!${fullButton}?.disabled && document.querySelector('.reader-page-shell')?.innerText.includes(${JSON.stringify(magazineTranslation)})`);
    const translationCount = translationInputs.length;
    const magazineTranslationRequests = translationCalls.length;
    const magazineStorageKey = JSON.stringify('magazine-reader-chinese-listening-v1');
    const magazinePosition = `JSON.parse(localStorage.getItem(${magazineStorageKey}) || '[]')[0]`;
    await magazineFullView.executeJavaScript(`(async () => {
      const database=await new Promise((resolve,reject)=>{
        const request=indexedDB.open('vantilo-issue-translations',1);
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      });
      const records=await new Promise((resolve,reject)=>{
        const request=database.transaction('paragraphs').objectStore('paragraphs').getAll();
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      });
      database.close();
      const target=records.map(item=>item.record).find(record=>record.sourceText===${JSON.stringify(magazineBody)});
      localStorage.setItem(${magazineStorageKey}, JSON.stringify([{ documentId: target.document.documentId, paragraphIndex: target.paragraphIndex,
        sourceText: target.sourceText, chunkIndex: 0, chunkText: ${JSON.stringify(magazineTranslation)}, seconds: 3, rate: 1.25, completed: false }]));
    })()`);
    const magazineSpokenStart = spoken.length;
    await click('听中文译文');
    await untilHost(`${player}?.dataset.phase === 'playing' && ${player}.innerText.includes('Fixture article') && ${player}.innerText.includes('中文译文')`);
    await clickHost('展开播放设置');
    await untilHost(`Boolean(document.querySelector('.audiobook-dock-settings')) && !document.querySelector('.audiobook-dock-chapters')`);
    await clickHost('收起播放设置');
    await until(`(${magazinePosition})?.seconds > 3.35`);
    const secondsBeforeAgent = await magazineFullView.executeJavaScript(`(${magazinePosition}).seconds`);
    await clickHost('Agent 工作台');
    await untilHost(`document.querySelector('.magazine-reader-module')?.hidden && ${player}?.dataset.phase === 'playing'`);
    await until(`(${magazinePosition})?.seconds > ${secondsBeforeAgent} + .35`);
    await clickHost('回到译文');
    const magazineHighlight = `(() => {
      const paragraph = document.querySelector('[data-testid=audiobook-transcript] .is-audiobook-source');
      return Number(paragraph?.dataset.transcriptParagraph) > 0 && paragraph.querySelector('p')?.innerText === ${JSON.stringify(magazineTranslation)};
    })()`;
    await until(magazineHighlight);
    await untilHost(`!document.querySelector('.magazine-reader-module').hidden && ${player}?.dataset.phase === 'playing'`);
    await clickHost('暂停朗读');
    await untilHost(`${player}?.dataset.phase === 'paused'`);
    await clickHost('Agent 工作台');
    await clickHost('回到译文');
    const pausedMagazine = await until(magazineHighlight);
    await untilHost(`!document.querySelector('.magazine-reader-module').hidden && ${player}?.dataset.phase === 'paused'`);
    await clickHost('Agent 工作台');
    await clickHost('回到中英对照');
    const sourceHighlight = 'document.querySelector(".reading-body .is-audiobook-source > p")';
    const bilingualMagazine = await until(`${sourceHighlight}?.textContent.trim() === ${JSON.stringify(magazineBody)}
      && ${fullButton}?.getAttribute('aria-pressed') === 'true'
      && document.querySelector('.reading-body .is-audiobook-source .translation-panel p')?.textContent === ${JSON.stringify(magazineTranslation)}`);
    await untilHost(`!document.querySelector('.magazine-reader-module').hidden && ${player}?.dataset.phase === 'paused'`);
    await bilingualMagazine.executeJavaScript(`${fullButton}.click()`, true);
    await clickHost('回到译文');
    await until(magazineHighlight);
    await clickHost('回到原文');
    await until(`${sourceHighlight}?.textContent.trim() === ${JSON.stringify(magazineBody)}
      && ${fullButton}?.getAttribute('aria-pressed') === 'false' && !document.querySelector('.reading-body .translation-panel')`);
    await clickHost('回到译文');
    await until(magazineHighlight);
    assert.deepEqual(spoken.slice(magazineSpokenStart), [magazineTranslation]);
    await clickHost('关闭播放器');
    await untilHost(`!${player}`);
    const magazineSaved = await pausedMagazine.executeJavaScript(magazinePosition);
    assert.ok(magazineSaved.seconds >= secondsBeforeAgent && !magazineSaved.completed);
    await click('← 返回本期目录');
    const reopenedContents = await until(`${articleButtons}.length >= 2 && Boolean(${magazineArticle})`);
    await reopenedContents.executeJavaScript(`(${magazineArticle}).click()`, true);
    await click('听中文译文');
    await untilHost(`${player}?.dataset.phase === 'playing'`);
    await until(`(${magazinePosition})?.seconds > ${magazineSaved.seconds} + .35`);
    await untilHost(`${player}?.dataset.phase === 'complete'`);
    await until(`(${magazinePosition})?.completed === true`);
    assert.deepEqual(spoken.slice(magazineSpokenStart), [magazineTranslation, magazineTranslation]);
    await clickHost('回到译文');
    const transcriptParagraphSelector = '[data-testid=audiobook-transcript] [data-transcript-paragraph]';
    const listenFromTranscriptParagraph = index => `(async () => {
      const blocks = document.querySelectorAll(${JSON.stringify(transcriptParagraphSelector)});
      const block = blocks[${index}];
      const p = block?.querySelector('p');
      if (!p) return false;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const textNode = walker.nextNode();
      if (!textNode || !textNode.textContent) return false;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(4, textNode.textContent.length));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      let listenButton = document.querySelector('[data-testid=transcript-selection-menu] button');
      for (let i = 0; !listenButton && i < 10; i++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        listenButton = document.querySelector('[data-testid=transcript-selection-menu] button');
      }
      if (!listenButton) return false;
      listenButton.click();
      return true;
    })()`;
    const magazineTranscript = await until(`document.querySelectorAll(${JSON.stringify(transcriptParagraphSelector)}).length >= 2 && ${magazineHighlight}`);
    assert.equal(await magazineTranscript.executeJavaScript(listenFromTranscriptParagraph(0), true), true);
    await until(`(${magazinePosition})?.sourceText === ${JSON.stringify(magazineOpening)} && (${magazinePosition}).seconds > .3`);
    await untilHost(`${player}?.dataset.phase === 'playing'`);
    await clickHost('暂停朗读');
    await untilHost(`${player}?.dataset.phase === 'paused'`);
    assert.equal(await magazineTranscript.executeJavaScript(listenFromTranscriptParagraph(1), true), true);
    await until(`(${magazinePosition})?.sourceText === ${JSON.stringify(magazineBody)} && (${magazinePosition}).seconds > .3`);
    await until(magazineHighlight);
    await clickHost('关闭播放器');
    await untilHost(`!${player}`);
    await click('← 返回本期目录');
    const chooseAgain = await until(`Boolean(${magazineArticle})`);
    await chooseAgain.executeJavaScript(`(${magazineArticle}).click()`, true);
    const magazineStart = await until(`Boolean(${firstSourceBlock})`);
    // Put the second synthetic paragraph below the fold to measure actual scrolling.
    await magazineStart.executeJavaScript(`${firstSourceBlock}.style.minHeight = '180vh'`);
    assert.equal(await magazineStart.executeJavaScript(selectAndListenOriginalBlock(firstSourceBlock), true), true);
    await until(`(${magazinePosition})?.sourceText === ${JSON.stringify(magazineOpening)} && (${magazinePosition}).seconds > .3`);
    await until(`${sourceHighlight}?.textContent.trim() === ${JSON.stringify(magazineOpening)}`);
    await untilHost(`${player}?.dataset.phase === 'playing'`);
    const originalScroll = await magazineStart.executeJavaScript('window.scrollY');
    await until(`(() => {
      const paragraph = ${sourceHighlight};
      if (paragraph?.textContent.trim() !== ${JSON.stringify(magazineBody)}) return false;
      const top = paragraph.getBoundingClientRect().top;
      return window.scrollY > ${originalScroll} + 100 && top >= 0 && top < innerHeight;
    })()`);
    await clickHost('回到译文');
    const transcriptView = await until(`document.querySelectorAll(${JSON.stringify(transcriptParagraphSelector)}).length >= 2 && ${magazineHighlight}`);
    await transcriptView.executeJavaScript(`document.querySelector(${JSON.stringify(transcriptParagraphSelector)}).style.minHeight = '180vh'`);
    assert.equal(await transcriptView.executeJavaScript(listenFromTranscriptParagraph(0), true), true);
    const highlightedTranscriptText = 'document.querySelector("[data-testid=audiobook-transcript] .is-audiobook-source p")';
    await until(`${highlightedTranscriptText}?.textContent === ${JSON.stringify(magazineOpeningTranslation)}`);
    await untilHost(`${player}?.dataset.phase === 'playing'`);
    const transcriptScroll = await transcriptView.executeJavaScript('window.scrollY');
    const laterTranslationVisible = `(() => {
      const paragraph = ${highlightedTranscriptText};
      if (paragraph?.textContent !== ${JSON.stringify(magazineTranslation)}) return false;
      const top = paragraph.getBoundingClientRect().top;
      return window.scrollY > ${transcriptScroll} + 100 && top >= 0 && top < innerHeight;
    })()`;
    await until(laterTranslationVisible);
    await clickHost('暂停朗读');
    await untilHost(`${player}?.dataset.phase === 'paused'`);
    await transcriptView.executeJavaScript('window.scrollTo(0, 0)');
    await until('window.scrollY === 0');
    await clickHost('回到译文');
    await until(laterTranslationVisible);
    await untilHost(`${player}?.dataset.phase === 'paused'`);
    await clickHost('回到原文');
    await until(`${sourceHighlight}?.textContent.trim() === ${JSON.stringify(magazineBody)}`);
    await clickHost('关闭播放器');
    await untilHost(`!${player}`);
    await until(`!${sourceHighlight}`);
    assert.equal(translationInputs.length, translationCount, '期刊听书复用全文翻译缓存');
    assert.equal(translationCalls.length, magazineTranslationRequests, '期刊听书不重复请求翻译，也不准备下一篇');
    const selectEngine = 'document.querySelector(".vantilo-translation-engine select")';
    const modelMenu = await until(`[...${selectEngine}.options].filter(option => option.value.startsWith('custom-api:')).length === 4`);
    await modelMenu.executeJavaScript(`(() => {
      document.querySelector('.vantilo-translation-menu').open = true;
      const select = ${selectEngine};
      const option = [...select.options].find(item => item.textContent === '模拟服务 · fixture-detailed');
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await until(`${selectEngine}?.selectedOptions[0]?.textContent.includes('fixture-detailed')`);
    await modelMenu.executeJavaScript(`${fullButton}.click()`, true);
    await until(`document.querySelector('.reading-body')?.innerText.includes('这段译文来自另一个已保存的测试模型。')`);
    assert.ok(selectedApiRequests.includes(magazineOpening) || selectedApiRequests.includes(magazineBody));
    assert.equal(translationInputs.length, translationCount, '选中的其他 API 不应回退到设置页的当前服务');
    await click('返回本期目录');
    await click('翻译整期');
    const issueModel = 'document.querySelector(".issue-translation-options select")';
    const chooseIssueModel = await until(`[...${issueModel}.options].filter(option => option.value.startsWith('custom-api:')).length === 4`);
    assert.match(await chooseIssueModel.executeJavaScript(`${issueModel}.selectedOptions[0].textContent`), /fixture-detailed/);
    await chooseIssueModel.executeJavaScript(`(() => {
      const select = ${issueModel};
      select.value = [...select.options].find(item => item.textContent.includes('fixture-zh')).value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await until(`document.querySelector('.issue-translation-options')?.innerText.includes('待翻译 1 篇')`);
    const beforeIssueInputs = translationInputs.length;
    await click('开始翻译');
    await until(`document.querySelector('.issue-translation-progress')?.innerText.includes(${JSON.stringify(nextMagazineTitle)})`);
    for (let attempt = 0; issueBodyAttempts < 1 && attempt < 100; attempt++) await delay(50);
    assert.equal(issueBodyAttempts, 1);
    const activeContents = await until(`Boolean(${magazineArticle})`);
    await activeContents.executeJavaScript(`(${magazineArticle}).click()`, true);
    await click('返回本期目录');
    await until(`document.querySelector('.issue-translation-progress')?.innerText.includes('整期翻译中')`);
    await click('暂停整期翻译');
    const pausedIssue = await until(`document.querySelector('.issue-translation-progress')?.innerText.includes('已暂停')`);
    await pausedIssue.executeJavaScript('setTimeout(() => location.reload(), 0); true');
    await until(`!document.querySelector('.issue-translation-progress') && [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '继续翻译整期')`);
    await click('继续翻译整期');
    await until(`${issueModel}?.selectedOptions[0]?.textContent.includes('fixture-zh') && document.querySelector('.issue-translation-options')?.innerText.includes('待翻译 1 篇')`);
    await click('开始翻译');
    await until(`document.querySelector('.issue-translation-progress')?.innerText.includes('部分译文待补齐')`);
    await click('重试未完成');
    await click('重试缺失译文');
    await until(`document.querySelector('.issue-translation-progress')?.innerText.includes('整期译文已就绪 · 2/2 篇')`);
    assert.deepEqual(translationInputs.slice(beforeIssueInputs), [nextMagazineTitle, nextMagazineBody, nextMagazineBody, nextMagazineBody]);

    const secondArticle = `${articleButtons}.find(button => button.textContent.includes(${JSON.stringify(nextMagazineTitle)}))`;
    const secondContents = await until(`${secondArticle}?.querySelector('.toc-title-zh')?.textContent === '第二篇合成文章'`);
    await secondContents.executeJavaScript(`(${secondArticle}).click()`, true);
    const secondView = await until(`${fullButton} && !${fullButton}.disabled && ${selectEngine}?.selectedOptions[0]?.textContent.includes('fixture-zh')`);
    const beforeReuse = translationInputs.length;
    const beforeOtherModelReuse = selectedApiRequests.length;
    const beforeReuseRequests = translationCalls.length;
    await secondView.executeJavaScript(`${fullButton}.click()`, true);
    await until(`document.querySelector('.reading-body')?.innerText.includes(${JSON.stringify(issueBodyTranslation)})`);
    await click('听中文译文');
    await untilHost(`${player}?.dataset.phase === 'playing'`);
    assert.ok(spoken.includes(issueBodyTranslation));
    assert.equal(translationInputs.length, beforeReuse, '全文翻译和听书共用整期缓存');
    assert.equal(selectedApiRequests.length, beforeOtherModelReuse, '上次阅读使用的其他模型不应触发重复翻译');
    assert.equal(translationCalls.length, beforeReuseRequests, '打开整期已译文章的全文译文和听书时没有发出翻译请求');
    await clickHost('关闭播放器');
    await click('返回本期目录');
    await click('翻译整期…');
    await until(`document.querySelector('.issue-translation-options')?.innerText.includes('该模型的本期译文已齐全')`);

    if (process.env.VANTILO_CATALOG_READER_PREVIEW === '1') {
      const catalogSelector = 'document.querySelector(".vantilo-catalog-picker select")';
      const models = await until(`[...${catalogSelector}.options].filter(option => option.value.startsWith('custom-api:')).length === 4`);
      await models.executeJavaScript(`(() => {
        const select = ${catalogSelector};
        select.value = [...select.options].find(item => item.textContent.includes('fixture-fast')).value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`, true);
      await until(`${catalogSelector}.selectedOptions[0].textContent.includes('fixture-fast') && !${catalogSelector}.disabled`);
      const generate = '[...document.querySelectorAll(".vantilo-catalog-control button")].find(b => /生成中文目录|重新生成/.test(b.textContent) && !b.disabled)';
      await models.executeJavaScript(`(${generate}).click()`, true);
      await until(`document.querySelector('.vantilo-catalog-control')?.innerText.includes('已有中文目录 · fixture-fast')
        && ${secondArticle}?.querySelector('.toc-title-zh')?.textContent === '测试目录 Second fixture article'`);
      await click('用所选模型重新生成');
      const catalogView = await until(`${secondArticle}?.querySelector('.toc-title-zh')?.textContent === '重新生成的目录 Second fixture article'`);
      await catalogView.executeJavaScript("document.documentElement.dataset.beforeCatalogReload = '1'; setTimeout(() => location.reload(), 0); true");
      await until(`!document.documentElement.dataset.beforeCatalogReload && ${secondArticle}?.querySelector('.toc-title-zh')?.textContent === '重新生成的目录 Second fixture article'`);
      console.log('PASS: 目录显示生成及重新生成的中文标题，重载后仍可读取');
      assert.deepEqual(catalogRequests, [profiles[1].id, profiles[1].id]);
    }
    console.log('PASS: 整期正文按所选模型翻译，跨页保持，暂停后重载续跑，重试失败段落，全文翻译和听书复用缓存');
    console.log('PASS: 阅读下拉框显示四个已保存的自定义 API，选中其他模型后由对应服务翻译');
    console.log('PASS: 期刊单篇中文听书复用全文译文及旧进度，跨 Agent 续播，从播放或暂停状态回到译文，关闭后续听，篇末停止');
    console.log('PASS: 英文电子书和期刊可从原文的指定段落开始听；期刊可从译文任意段落重播或跳播');
    console.log('PASS: 播放器可回到对应原文或译文，原文高亮会随播放换段并滚入视口，关闭后清除高亮');
    console.log('PASS: 纯中文译文随播放换段自动滚动，暂停后可浏览，点回到译文重新定位');
    console.log('PASS: 期刊与英文电子书恢复各篇章的中英对照并复用译文，主动收起后回到纯原文');

    await click('电子书');
    await click('全部');
    const chineseCard = `[...document.querySelectorAll('.book-library-card')].find(card => card.querySelector('strong')?.textContent === '海边灯火测试书')`;
    const shelf = await until(`Boolean(${chineseCard})`);
    await shelf.executeJavaScript(`(${chineseCard}).click()`, true);
    const datedBook = await until(`Boolean(${languageControl})`);
    await datedBook.executeJavaScript(`(() => {
      const select = ${languageControl};
      select.value = 'zh';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await click('原书目录');
    const chapterRow = `[...document.querySelectorAll('.book-toc-row')].find(row => row.innerText.includes('第二章'))`;
    const datedToc = await until(`Boolean(${chapterRow})`);
    await datedToc.executeJavaScript(`(${chapterRow}).click()`, true);
    const blocks = `[...document.querySelectorAll('.reading-body .reading-paragraph-block')]`;
    const topChineseListenButton = `Boolean(document.querySelector('button.reader-listen-button[aria-label="朗读正文"]'))`;
    const hiddenChineseControls = `Boolean(document.querySelector('.reader-full-translation-button, .vantilo-translation-menu, .reader-mode-switch, .paragraph-translate-button'))`;
    const datedReader = await until(`${blocks}[0]?.textContent.includes(${JSON.stringify(chapterDate)})`);
    assert.equal(await datedReader.executeJavaScript(topChineseListenButton), true, '中文书阅读页显示顶部朗读按钮');
    assert.equal(await datedReader.executeJavaScript(hiddenChineseControls), false, '中文书阅读页不显示全文翻译、翻译模型和整篇/逐句切换控件');

    const selectedParagraph = `[...document.querySelectorAll('.reading-paragraph-block')].find(block => block.textContent.includes(${JSON.stringify(second)}))`;
    const selectedReader = await until(`Boolean(${selectedParagraph})`);
    for (const text of [chapterDate, endPageMarker]) {
      assert.equal(await selectedReader.executeJavaScript(`(async () => {
        const block = ${blocks}.find(item => item.textContent.includes(${JSON.stringify(text)}));
        const p = block?.querySelector(':scope > p');
        if (!p) return false;
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        const textNode = walker.nextNode();
        if (!textNode) return false;
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, Math.min(4, textNode.textContent.length));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const hasListenHere = Boolean(document.querySelector('[data-testid=selection-assist-popover] .selection-listen-here-button'));
        selection.removeAllRanges();
        return !hasListenHere;
      })()`), true);
    }
    const selectedRequestStart = spoken.length;
    assert.equal(await selectedReader.executeJavaScript(selectAndListenOriginalBlock(selectedParagraph), true), true);
    await untilHost(`${player}?.dataset.phase === 'playing'`);
    await until(`${selectedParagraph}?.classList.contains('is-audiobook-source')`);
    assert.equal(spoken[selectedRequestStart], second, '中文原文从本段听应直接合成所选段落');
    await clickHost('关闭播放器');
    console.log('PASS: 中文电子书整篇与逐句模式隐藏顶部听书入口，正文可选段且首条 TTS 请求匹配');
    await click('返回本书目录');
    await click('← 返回电子书');
    const batchBookShelf = await until(`Boolean(${englishCard})`);
    await batchBookShelf.executeJavaScript(`(${englishCard}).click()`, true);
    const secondBookChapter = `[...document.querySelectorAll('.book-toc-row')].find(row => row.textContent.includes('Chapter 2'))`;
    const batchBookDetail = await until(`Boolean(${secondBookChapter})`);
    await batchBookDetail.executeJavaScript(`(${secondBookChapter}).click()`, true);
    await until(`document.querySelector('.reading-body')?.textContent.includes(${JSON.stringify(englishFollowup)})`);
    await click('返回本书目录');
    await click('翻译全书');
    const batchSettings = await until(`[...${issueModel}.options].some(option => option.textContent.includes('fixture-detailed'))`);
    await batchSettings.executeJavaScript(`(() => {
      const select = ${issueModel};
      select.value = [...select.options].find(item => item.textContent.includes('fixture-detailed')).value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await until(`document.querySelector('.issue-translation-options')?.innerText.includes('待翻译 2 章')`);
    testBookBatch = true;
    const batchFirstRequest = selectedApiRequests.length;
    await click('开始翻译');
    await until(`document.querySelector('.issue-translation-progress')?.innerText.includes('1/2 章')`);
    for (let attempt = 0; bookBatchBodyAttempts < 1 && attempt < 100; attempt++) await delay(50);
    assert.equal(bookBatchBodyAttempts, 1);
    const firstRunInputs = selectedApiRequests.slice(batchFirstRequest);
    assert.ok(firstRunInputs.indexOf(englishBody) < firstRunInputs.indexOf(englishFollowup) && firstRunInputs.includes(englishBody),
      '按原书目录顺序优先完成第一章，然后译第二章');
    await click('← 返回电子书');
    const otherBook = await until(`Boolean(${chineseCard})`);
    await otherBook.executeJavaScript(`(${chineseCard}).click()`, true);
    const backgroundStatus = 'document.querySelector(".background-book-translation")';
    await until(`document.querySelector('.book-detail-hero h1')?.textContent === '海边灯火测试书' &&
      ${backgroundStatus}?.textContent.includes('1/2 章')`);
    await click('期刊');
    const browsePublication = await until(`Boolean(${publicationCard})`);
    await browsePublication.executeJavaScript(`${publicationCard}.click()`, true);
    const browseIssue = await until(`Boolean(${issueCard})`);
    await browseIssue.executeJavaScript(`${issueCard}.click()`, true);
    const browseArticle = await until(`Boolean(${magazineArticle})`);
    await browseArticle.executeJavaScript(`(${magazineArticle}).click()`, true);
    await until(`document.querySelector('.reading-body') && ${backgroundStatus}?.textContent.includes('后台翻译全书中')`);
    assert.equal(bookBatchAborts, 0, '切换电子书及阅读期刊不应取消正在翻译的请求');
    await click('查看《Lantern Fixture》');
    await click('暂停全书翻译');
    const pausedBook = await until(`document.querySelector('.issue-translation-progress')?.innerText.includes('已暂停')`);
    await pausedBook.executeJavaScript('setTimeout(() => location.reload(), 0); true');
    await until(`!document.querySelector('.issue-translation-progress') && [...document.querySelectorAll('button')].some(button => button.textContent.trim() === '继续翻译全书')`);
    await click('继续翻译全书');
    await until(`${issueModel}?.selectedOptions[0]?.textContent.includes('fixture-detailed') &&
      document.querySelector('.issue-translation-options')?.innerText.includes('待翻译 1 章')`);
    assert.equal(bookBatchAborts, 1, '显式暂停取消正在处理的段落');
    const resumeRequest = selectedApiRequests.length;
    await click('开始翻译');
    for (let attempt = 0; bookBatchBodyAttempts < 2 && attempt < 100; attempt++) await delay(50);
    assert.equal(bookBatchBodyAttempts, 2);
    await clickHost('Agent 工作台');
    await untilHost(`document.querySelector('section[aria-label="Magazine Reader"]')?.hidden`);
    finishBookBatch();
    await until(`document.querySelector('.issue-translation-progress')?.textContent.includes('全书译文已就绪 · 2/2 章')`);
    await untilHost(`document.querySelector('section[aria-label="Magazine Reader"]')?.hidden`);
    assert.equal(bookBatchAborts, 1, '在 Agent 工作台期间完成任务，Reader 保持隐藏');
    await clickHost('返回阅读');
    assert.deepEqual(selectedApiRequests.slice(resumeRequest), [englishFollowup], '重新打开后只补未完成的段落');

    const firstBookChapter = `[...document.querySelectorAll('.book-toc-row')].find(row => row.textContent.includes('Chapter 1'))`;
    const completedBook = await until(`Boolean(${firstBookChapter})`);
    await completedBook.executeJavaScript(`(${firstBookChapter}).click()`, true);
    const bookReader = await until(`${fullButton} && !${fullButton}.disabled &&
      ${selectEngine}?.selectedOptions[0]?.textContent.includes('fixture-detailed')`);
    const requestsBeforeBookReuse = translationCalls.length;
    await bookReader.executeJavaScript(`${fullButton}.click()`, true);
    await until(`document.querySelector('.reading-body')?.innerText.includes(${JSON.stringify(translatedFirst)})`);
    const beforeBatchPlayback = spoken.length;
    await click('听中文译文');
    await untilHost(`${player}?.innerText.includes("Chapter 2") && ${player}.dataset.phase === 'playing'`);
    assert.ok(spoken.slice(beforeBatchPlayback).includes(translatedFollowup));
    assert.equal(translationCalls.length, requestsBeforeBookReuse, '全文翻译及跨章听书均复用全书译文');
    await clickHost('关闭播放器');
    console.log('PASS: 全书翻译优先最近阅读位置，切换书刊不中断，在 Agent 工作台完成，暂停重载后续跑，全文翻译和跨章听书零重复翻译请求');
    await click('返回本书目录');
    await click('翻译全书…');
    const lunaSettings = await until(`${issueModel}?.querySelector('option[value="codex:gpt-fixture-luna"]')`);
    await lunaSettings.executeJavaScript(`(() => {
      const select = ${issueModel};
      select.value = 'codex:gpt-fixture-luna';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await until(`document.querySelector('.issue-translation-options')?.textContent.includes('待翻译 2 章')`);
    await click('开始翻译');
    await until(`document.querySelector('.issue-translation-progress')?.textContent.includes('全书译文已就绪 · 2/2 章')`);
    if (process.env.VANTILO_CATALOG_READER_PREVIEW === '1') {
      assert.deepEqual(catalogRequests, [profiles[1].id, profiles[1].id, profiles[1].id], '全书翻译自动补目录应复用已保存的目录模型而非改写为正文模型');
    }
    assert.equal(codexBatchInputs.length, 2);
    assert.deepEqual(
      codexBatchInputs,
      process.env.VANTILO_CATALOG_READER_PREVIEW === '1'
        ? [['The Ridge', englishBody], [englishFollowup]]
        : [['Chapter 1', 'The Ridge', englishBody], ['Chapter 2', englishFollowup]],
      'Codex 全书翻译应按章合并请求，并跳过已由中文目录覆盖的章标题',
    );
    assert.deepEqual(codexFallbackInputs, ['The Ridge'], '只重新请求批次中缺少的译文');
    await until(`document.querySelector('.issue-translation-progress details')?.textContent.includes('会话准备 0.3 秒 · 模型响应 1.4 秒')`);
    const batchReady = await until(`Boolean(${firstBookChapter})`);
    await batchReady.executeJavaScript(`(${firstBookChapter}).click()`, true);
    const lunaReader = await until(`${fullButton} && !${fullButton}.disabled && ${selectEngine}?.value === 'codex:gpt-fixture-luna'`);
    await lunaReader.executeJavaScript(`${fullButton}.click()`, true);
    await until(`document.querySelector('.reader-page-shell')?.textContent.includes(${JSON.stringify(translatedFirst)}) &&
      document.querySelector('.reader-page-shell')?.textContent.includes('山脊。')`);
    assert.deepEqual(codexFallbackInputs, ['The Ridge'], '已保存批量及补译结果均供全文翻译复用');
    console.log('PASS: Codex 全书翻译按章合并请求，按编号保存，只重试缺项，并显示耗时与复用译文');
  } catch (error) {
    console.error(error.message);
    throw error;
  } finally {
    window?.destroy();
    await browserSession?.closeAllConnections();
    provider.closeAllConnections();
    const close = Promise.all([service?.close(), promisify(provider.close.bind(provider))()]);
    await Promise.race([close, delay(5000).then(() => { throw new Error('隔离 Reader 服务未在 5 秒内关闭'); })]);
  }
  console.log('PASS: 书架只显示最近一本书，共用封面及书名，续读和续听打开各自的章节');
  console.log('PASS: 英文书只朗读中文译文、自动跨章、失败重试、跨 Agent 播放、播放及暂停时回到对应译文、缓存复用与续听');
  console.log('PASS: EPUB 导入、自动跨章、跨 Agent 不断播、播放及暂停时回原文、结束听书、续听及语言筛选回归');
}

app.whenReady().then(main).then(() => { clearTimeout(deadline); app.exit(0); }, error => {
  clearTimeout(deadline);
  console.error(error.stdout || '', error.stderr || '', error);
  app.exit(1);
});
