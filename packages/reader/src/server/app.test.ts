import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexPrepService } from "./services/codex-prep-service.js";
import { buildServer } from "./app.js";
import { JsonStorage } from "../storage/json-storage.js";
import type { Article, IssueRecord } from "../shared/types.js";
import { bookChapterReadingDocumentIdentity, bookLessonReadingDocumentIdentity } from "../shared/reading-document-identity.js";
import { syntheticMagazineEpub } from "../../tests/fixtures/synthetic-magazine.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createBookImportFixture(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  zip.file("OEBPS/content.opf", `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>API Fixture Book</dc:title><dc:creator>API Author</dc:creator><dc:language>en</dc:language>
    <dc:publisher>Fixture Press</dc:publisher><dc:date>2026-09-27</dc:date>
    <dc:identifier id="bookid">9780000000002</dc:identifier><meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-image" href="Images/cover.jpg" media-type="image/jpeg"/>
    <item id="ch1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest><spine toc="ncx"><itemref idref="ch1"/></spine>
</package>`);
  zip.file("OEBPS/toc.ncx", `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
  <navPoint id="ch1"><navLabel><text>1 API Chapter</text></navLabel><content src="Text/ch1.xhtml#ch1"/></navPoint>
</navMap></ncx>`);
  zip.file("OEBPS/Text/ch1.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>1 API Chapter</h1><p>One API paragraph.</p></body></html>`);
  zip.file("OEBPS/Images/cover.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("Fastify app", () => {
  it("serves health and an empty issue list", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-server-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: null,
      readerGuideProvider: null,
      sectionTranslationProvider: null,
      selectionAssistProvider: null,
      readingAssistantProvider: null,
      wordContextProvider: null,
      dictionaryProvider: null,
    });

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({
      ok: true,
      reader: "epub",
      translation: false,
      readerGuides: false,
      sectionTranslations: false,
      selectionAssist: false,
      readingAssistant: false,
      wordContext: false,
      dictionary: false,
    });

    const issues = await app.inject({ method: "GET", url: "/api/issues" });
    expect(issues.statusCode).toBe(200);
    expect(issues.json()).toEqual([]);
    const missingCover = await app.inject({ method: "GET", url: "/api/issues/economist%3A2099-01-01/cover" });
    expect(missingCover.statusCode).toBe(404);

    const guides = await app.inject({ method: "POST", url: "/api/issues/2026-09-19/guides", payload: { limit: 8 } });
    expect(guides.statusCode).toBe(503);
    const sectionTranslations = await app.inject({ method: "POST", url: "/api/issues/2026-09-19/section-translations" });
    expect(sectionTranslations.statusCode).toBe(503);
    const selectionAssist = await app.inject({
      method: "POST",
      url: "/api/selection-assist",
      payload: { action: "translate", text: "selected text" },
    });
    expect(selectionAssist.statusCode).toBe(503);
    const readingAssistant = await app.inject({
      method: "POST",
      url: "/api/reading-assistant",
      payload: { issueId: "economist:2099-01-01", articleId: "missing", question: "What is the point?", mode: "quick" },
    });
    expect(readingAssistant.statusCode).toBe(503);
    const wordContext = await app.inject({
      method: "POST",
      url: "/api/word-context",
      payload: { text: "bank", sentence: "Mary sat on the bank." },
    });
    expect(wordContext.statusCode).toBe(503);
    const dictionary = await app.inject({ method: "GET", url: "/api/dictionary?word=husband" });
    expect(dictionary.statusCode).toBe(503);
    await app.close();
  });

  it("runs GitHub magazine sync through the local Fastify endpoint without a live network", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-github-sync-api-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    const epub = await syntheticMagazineEpub();
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/contents/01_economist?")) {
        return new Response(JSON.stringify([
          { type: "dir", name: "te_2099.04.01", path: "01_economist/te_2099.04.01", download_url: null },
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/contents/01_economist/te_2099.04.01?")) {
        return new Response(JSON.stringify([
          {
            type: "file",
            name: "TheEconomist.2099.04.01.epub",
            path: "01_economist/te_2099.04.01/TheEconomist.2099.04.01.epub",
            download_url: "https://raw.example/2099.04.01.epub",
          },
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://raw.example/2099.04.01.epub") {
        return new Response(epub, { status: 200, headers: { "content-length": String(epub.length) } });
      }
      throw new Error(`Unexpected GitHub sync request: ${url}`);
    };
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: null,
      readerGuideProvider: null,
      sectionTranslationProvider: null,
      selectionAssistProvider: null,
      wordContextProvider: null,
      dictionaryProvider: null,
      contentDiscoveryFetchImpl: (async () => new Response("offline", { status: 503 })) as typeof fetch,
      scienceArticleFetchImpl: (async () => new Response("offline", { status: 503 })) as typeof fetch,
      githubMagazineSync: {
        fetchImpl,
        sources: [{ publicationId: "economist", directory: "01_economist" }],
      },
    });

    const first = await app.inject({ method: "POST", url: "/api/source-sync/github" });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ importedCount: 1, failedCount: 0 });
    expect(await readdir(path.join(root, "issues"))).toEqual(["TheEconomist.2099.04.01.epub"]);

    const rawRequests = requests.filter((url) => url.startsWith("https://raw.example/")).length;
    const second = await app.inject({ method: "POST", url: "/api/source-sync/github" });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ importedCount: 0, failedCount: 0 });
    expect(requests.filter((url) => url.startsWith("https://raw.example/"))).toHaveLength(rawRequests);
    await vi.waitFor(async () => {
      const snapshot = JSON.parse(await readFile(path.join(root, "data", "content-discovery.json"), "utf8")) as { lastAttemptAt?: string };
      expect(snapshot.lastAttemptAt).toBeTruthy();
    }, { timeout: 5_000, interval: 25 });
    await app.close();
  });

  it("serves only discovered images for the exact issue and article", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-article-images-"));
    roots.push(root);
    const issuesDir = path.join(root, "issues");
    await mkdir(issuesDir);
    await writeFile(path.join(issuesDir, "TheEconomist.2026.09.19.epub"), await syntheticMagazineEpub());
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: null,
      readerGuideProvider: null,
      sectionTranslationProvider: null,
      selectionAssistProvider: null,
      wordContextProvider: null,
      dictionaryProvider: null,
    });
    const issue = await app.inject({ method: "GET", url: "/api/issues/economist%3A2026-09-19" });
    const article = (issue.json() as IssueRecord).articles[0];
    const base = `/api/issues/economist%3A2026-09-19/articles/${encodeURIComponent(article.id)}/images`;

    const metadata = await app.inject({ method: "GET", url: base });
    expect(metadata.statusCode).toBe(200);
    const images = metadata.json() as Array<{ id: string; role: string; afterParagraphIndex: number }>;
    expect(images).toHaveLength(3);
    expect(images[0]).toMatchObject({ id: "image-01", role: "lead", afterParagraphIndex: -1 });
    expect(metadata.body).not.toContain("entryPath");
    expect(metadata.body).not.toContain("static_images");

    const binary = await app.inject({ method: "GET", url: `${base}/image-01` });
    expect(binary.statusCode).toBe(200);
    expect(binary.headers["content-type"]).toMatch(/^image\/png/);
    expect(binary.rawPayload.byteLength).toBeGreaterThan(1_000);

    const missingImage = await app.inject({ method: "GET", url: `${base}/not-a-real-image` });
    expect(missingImage.statusCode).toBe(404);
    const missingArticle = await app.inject({
      method: "GET",
      url: "/api/issues/economist%3A2026-09-19/articles/not-a-real-article/images",
    });
    expect(missingArticle.statusCode).toBe(404);
    await app.close();
  });

  it("routes paragraph translation through the configured provider", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-translate-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    const translate = vi.fn(async () => ({
      translation: "这是一段测试翻译。",
      model: "gpt-6-luna",
      provider: "easycliproxy" as const,
    }));
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: { translate },
      readerGuideProvider: null,
      selectionAssistProvider: null,
      wordContextProvider: null,
      dictionaryProvider: null,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/translate",
      payload: {
        text: "Target paragraph.",
        contextBefore: "Previous paragraph.",
        contextAfter: "Next paragraph.",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      translation: "这是一段测试翻译。",
      model: "gpt-6-luna",
      provider: "easycliproxy",
    });
    expect(translate).toHaveBeenCalledWith({
      text: "Target paragraph.",
      contextBefore: "Previous paragraph.",
      contextAfter: "Next paragraph.",
    });
    for (const text of ["—", ". . .", "***", "\u200b", "　"]) {
      const invalid = await app.inject({ method: "POST", url: "/api/translate", payload: { text } });
      expect(invalid.statusCode).toBe(400);
    }
    expect(translate).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("routes selected text translate and explain through the selection provider", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-selection-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    const assist = vi.fn(async (request: { action: "translate" | "explain" }) => ({
      action: request.action,
      result: request.action === "translate" ? "投资热潮" : "这里指一波强劲的投资增长。",
      model: "gpt-6-luna",
      provider: "easycliproxy" as const,
    }));
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: null,
      readerGuideProvider: null,
      selectionAssistProvider: { assist },
      wordContextProvider: null,
      dictionaryProvider: null,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/selection-assist",
      payload: {
        action: "explain",
        text: "riding a wave",
        context: "The economy is riding a wave of investment.",
        articleTitle: "An AI boom",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      action: "explain",
      result: "这里指一波强劲的投资增长。",
      provider: "easycliproxy",
    });
    expect(assist).toHaveBeenCalledWith({
      action: "explain",
      text: "riding a wave",
      context: "The economy is riding a wave of investment.",
      articleTitle: "An AI boom",
    });
    await app.close();
  });

  it("routes AI reading questions through canonical EPUB article context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-reading-assistant-"));
    roots.push(root);
    const issuesDir = path.join(root, "issues");
    await mkdir(issuesDir);
    await writeFile(path.join(issuesDir, "TheEconomist.2026.09.19.epub"), await syntheticMagazineEpub());
    const assist = vi.fn(async (request: { mode: "quick" | "deep"; paragraphs: string[] }) => ({
      answer: "文章认为投资热潮正在改变经济。",
      paragraphIndexes: [0, 2],
      mode: request.mode,
      model: request.mode === "deep" ? "gpt-6-sol" : "gpt-6-luna",
      provider: "easycliproxy" as const,
    }));
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: null,
      readerGuideProvider: null,
      sectionTranslationProvider: null,
      selectionAssistProvider: null,
      readingAssistantProvider: { assist },
      wordContextProvider: null,
      dictionaryProvider: null,
    });
    const issueResponse = await app.inject({ method: "GET", url: "/api/issues/economist%3A2026-09-19" });
    expect(issueResponse.statusCode).toBe(200);
    const issue = issueResponse.json() as IssueRecord;
    const article = issue.articles[0];
    expect(article).toBeTruthy();
    const expectedParagraphs = article.bodyText.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);

    const response = await app.inject({
      method: "POST",
      url: "/api/reading-assistant",
      payload: {
        issueId: issue.id,
        articleId: article.id,
        question: "这篇文章的核心观点是什么？",
        mode: "quick",
        currentParagraphIndex: 0,
        history: [{ role: "user", text: "先解释一下背景。" }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      answer: "文章认为投资热潮正在改变经济。",
      paragraphIndexes: [0, 2],
      mode: "quick",
      model: "gpt-6-luna",
    });
    expect(assist).toHaveBeenCalledTimes(1);
    expect(assist.mock.calls[0][0]).toMatchObject({
      question: "这篇文章的核心观点是什么？",
      mode: "quick",
      publicationName: "The Economist",
      articleTitle: article.title,
      paragraphs: expectedParagraphs,
      currentParagraphIndex: 0,
      history: [{ role: "user", text: "先解释一下背景。" }],
    });
    await app.close();
  });

  it("resolves Book Chapter reading-assistant content from the imported EPUB, not browser text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-book-assistant-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    const assist = vi.fn(async (request: { mode: "quick" | "deep"; paragraphs: string[] }) => ({
      answer: "The chapter has one paragraph.",
      paragraphIndexes: [0],
      mode: request.mode,
      model: "fixture-model",
      provider: "easycliproxy" as const,
    }));
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: null,
      readerGuideProvider: null,
      sectionTranslationProvider: null,
      selectionAssistProvider: null,
      readingAssistantProvider: { assist },
      wordContextProvider: null,
      dictionaryProvider: null,
    });
    const imported = await app.inject({
      method: "POST",
      url: "/api/books/import?filename=Assistant%20Fixture.epub",
      headers: { "content-type": "application/epub+zip" },
      payload: await createBookImportFixture(),
    });
    expect(imported.statusCode).toBe(201);
    const bookId = "book:isbn:9780000000002";
    const book = await app.inject({ method: "GET", url: `/api/books/${encodeURIComponent(bookId)}` });
    const chapter = book.json().chapters[0];
    const payload = {
      document: bookChapterReadingDocumentIdentity(bookId, chapter.id),
      question: "What does this chapter say?",
      mode: "quick",
      paragraphs: ["Browser-controlled text must be ignored."],
    };
    const response = await app.inject({ method: "POST", url: "/api/reading-assistant", payload });
    expect(response.statusCode).toBe(200);
    expect(assist).toHaveBeenCalledTimes(1);
    expect(assist.mock.calls[0][0]).toMatchObject({
      sourceKind: "book-chapter",
      publicationName: "API Fixture Book",
      articleTitle: "1 API Chapter",
      paragraphs: chapter.paragraphs,
    });
    expect(chapter.paragraphs).not.toContain(payload.paragraphs[0]);

    for (const [document, error] of [
      [bookChapterReadingDocumentIdentity("book:isbn:missing", chapter.id), "Book not found"],
      [bookChapterReadingDocumentIdentity(bookId, "chapter:missing"), "Chapter not found"],
    ] as const) {
      const missing = await app.inject({ method: "POST", url: "/api/reading-assistant", payload: { ...payload, document } });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual({ error });
    }
    const invalid = await app.inject({ method: "POST", url: "/api/reading-assistant", payload: { ...payload, document: { kind: "book-chapter", bookId, chapterId: "" } } });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });

  it("resolves lesson assistant text from a saved matching book version and rejects stale or unrelated lessons", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-lesson-assistant-"));
    roots.push(root);
    const bootstrap = await buildServer({ projectRoot: root, serveFrontend: false, aiProviderEnv: {} });
    let book: { id: string; title: string; sourceFingerprint: string };
    try {
      const imported = await bootstrap.inject({ method: "POST", url: "/api/books/import?filename=Lesson.epub", headers: { "content-type": "application/epub+zip" }, payload: await createBookImportFixture() });
      expect(imported.statusCode).toBe(201);
      book = (await bootstrap.inject({ method: "GET", url: `/api/books/${encodeURIComponent("book:isbn:9780000000002")}` })).json();
    } finally { await bootstrap.close(); }
    const lesson = { id: "saved-lesson", bookId: book!.id, bookTitle: book!.title, sourceFingerprint: book!.sourceFingerprint, createdAt: "2026-10-16",
      titleZh: "精选问题", teaserZh: "悬念", english: "Saved English lesson.\n\nSecond saved paragraph.", explanationZh: "解读", keywords: ["saved"], evidence: [], wordCount: 7, adaptation: "AI 简易英文改写，非原著引文" };
    await writeFile(path.join(root, "data", "book-lessons.local.json"), JSON.stringify([lesson, { ...lesson, id: "stale", sourceFingerprint: "old" }, { ...lesson, id: "unrelated", bookId: "other-book" }]));
    const assist = vi.fn(async () => ({ answer: "Saved lesson answer.", paragraphIndexes: [0], mode: "quick" as const, model: "fixture", provider: "easycliproxy" as const }));
    const app = await buildServer({ projectRoot: root, serveFrontend: false, aiProviderEnv: {}, readingAssistantProvider: { assist } });
    const payload = { document: bookLessonReadingDocumentIdentity(book!.id, lesson.id), question: "Explain this lesson", mode: "quick", paragraphs: ["Forged browser text"] };
    try {
      const response = await app.inject({ method: "POST", url: "/api/reading-assistant", payload });
      expect(response.statusCode).toBe(200);
      expect(assist).toHaveBeenCalledWith(expect.objectContaining({ sourceKind: "book-lesson", articleTitle: lesson.titleZh, paragraphs: ["Saved English lesson.", "Second saved paragraph."] }));
      for (const id of ["missing", "stale", "unrelated"]) {
        const invalid = await app.inject({ method: "POST", url: "/api/reading-assistant", payload: { ...payload, document: bookLessonReadingDocumentIdentity(book!.id, id) } });
        expect(invalid.statusCode).toBe(404);
      }
      expect(assist).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });

  it("routes exact word occurrences through the contextual-meaning provider", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-word-context-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    const explain = vi.fn(async () => ({
      meaningZh: "河岸",
      explanationZh: "这里指河边的岸；句中的 river 明确了这个义项。",
      meaningEn: "the land beside a river",
      explanationEn: "Here, bank means land beside a river. The nearby river makes that sense clear.",
      examplesEn: ["We rested on the bank.", "Grass grew along the river bank."],
      partOfSpeech: "noun",
      model: "gpt-6-luna",
      provider: "easycliproxy" as const,
    }));
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: null,
      readerGuideProvider: null,
      selectionAssistProvider: null,
      wordContextProvider: { explain },
      dictionaryProvider: null,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/word-context",
      payload: {
        text: "bank",
        sentence: "Mary sat on the bank by the river.",
        paragraph: "Mary sat on the bank by the river. The grass was wet.",
        contextBefore: "She walked outside.",
        contextAfter: "Later she went into town.",
        articleTitle: "The Weekend",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      meaningZh: "河岸",
      meaningEn: "the land beside a river",
      examplesEn: ["We rested on the bank.", "Grass grew along the river bank."],
      partOfSpeech: "noun",
    });
    expect(explain).toHaveBeenCalledWith({
      text: "bank",
      sentence: "Mary sat on the bank by the river.",
      paragraph: "Mary sat on the bank by the river. The grass was wet.",
      contextBefore: "She walked outside.",
      contextAfter: "Later she went into town.",
      articleTitle: "The Weekend",
    });
    const verification = { text: "help choose", sentence: "We help choose our world.", paragraph: "We help choose our world.", verifyConsistency: true, sentenceTranslationZh: "我们参与选择自己的环境。", expressionExplanationZh: "参与选择。", suggestedMeaningZh: "帮助选择" };
    expect((await app.inject({ method: "POST", url: "/api/word-context", payload: verification })).statusCode).toBe(200);
    expect(explain).toHaveBeenLastCalledWith(expect.objectContaining(verification));
    for (const invalid of [{ verifyConsistency: "true" }, { suggestedMeaningZh: 4 }, { sentenceTranslationZh: "x".repeat(12001) }]) {
      expect((await app.inject({ method: "POST", url: "/api/word-context", payload: { ...verification, ...invalid } })).statusCode).toBe(400);
    }
    await app.close();
  });

  it("previews and imports a validated EPUB binary without overwriting duplicates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-import-api-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: null,
      readerGuideProvider: null,
      sectionTranslationProvider: null,
      selectionAssistProvider: null,
      wordContextProvider: null,
      dictionaryProvider: null,
    });
    const source = await syntheticMagazineEpub();
    const filename = "TheEconomist.2099.01.03.epub";
    const encoded = encodeURIComponent(filename);

    const preview = await app.inject({
      method: "POST",
      url: `/api/import/epub/preview?filename=${encoded}`,
      headers: { "content-type": "application/epub+zip" },
      payload: source,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ status: "ready", issueId: "economist:2099-01-03", hasCover: true });

    const imported = await app.inject({
      method: "POST",
      url: `/api/import/epub?filename=${encoded}`,
      headers: { "content-type": "application/epub+zip" },
      payload: source,
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({ status: "imported", issueId: "economist:2099-01-03" });
    expect(await readdir(path.join(root, "issues"))).toEqual([filename]);

    const issues = await app.inject({ method: "GET", url: "/api/issues" });
    expect(issues.statusCode).toBe(200);
    expect(issues.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: "economist:2099-01-03" })]));

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/import/epub?filename=${encoded}`,
      headers: { "content-type": "application/epub+zip" },
      payload: source,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({ status: "duplicate" });

    const brokenName = encodeURIComponent("TheEconomist.2099.01.04.epub");
    const broken = await app.inject({
      method: "POST",
      url: `/api/import/epub?filename=${brokenName}`,
      headers: { "content-type": "application/epub+zip" },
      payload: Buffer.from("broken epub"),
    });
    expect(broken.statusCode).toBe(200);
    expect(broken.json()).toMatchObject({ status: "invalid" });
    expect(await readdir(path.join(root, "issues"))).toEqual([filename]);
    await app.close();
  });

  it("previews and imports a Book EPUB into books/ without touching the magazine library", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-book-import-api-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: null,
      readerGuideProvider: null,
      sectionTranslationProvider: null,
      selectionAssistProvider: null,
      readingAssistantProvider: null,
      wordContextProvider: null,
      dictionaryProvider: null,
    });
    const source = await createBookImportFixture();
    const filename = "API Fixture Book.epub";
    const encoded = encodeURIComponent(filename);

    const preview = await app.inject({
      method: "POST",
      url: `/api/books/import/preview?filename=${encoded}`,
      headers: { "content-type": "application/epub+zip" },
      payload: source,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      status: "ready",
      bookId: "book:isbn:9780000000002",
      title: "API Fixture Book",
      authors: ["API Author"],
      numberedChapterCount: 1,
      readableUnitCount: 1,
      hasCover: true,
    });
    expect(preview.json().coverDataUrl).toMatch(/^data:image\/jpeg;base64,/);

    const imported = await app.inject({
      method: "POST",
      url: `/api/books/import?filename=${encoded}`,
      headers: { "content-type": "application/epub+zip" },
      payload: source,
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({ status: "imported", bookId: "book:isbn:9780000000002" });
    expect(await readdir(path.join(root, "books"))).toEqual([filename]);
    expect(await readdir(path.join(root, "issues"))).toEqual([]);

    const books = await app.inject({ method: "GET", url: "/api/books" });
    expect(books.statusCode).toBe(200);
    expect(books.json()).toEqual([
      expect.objectContaining({
        id: "book:isbn:9780000000002",
        title: "API Fixture Book",
        authors: ["API Author"],
        hasCover: true,
        partCount: 0,
        numberedChapterCount: 1,
        readableUnitCount: 1,
      }),
    ]);

    const bookId = encodeURIComponent("book:isbn:9780000000002");
    const detail = await app.inject({ method: "GET", url: `/api/books/${bookId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      id: "book:isbn:9780000000002",
      title: "API Fixture Book",
      chapters: [expect.objectContaining({ title: "1 API Chapter", role: "chapter" })],
    });
    const cover = await app.inject({ method: "GET", url: `/api/books/${bookId}/cover` });
    expect(cover.statusCode).toBe(200);
    expect(cover.headers["content-type"]).toContain("image/jpeg");
    expect(cover.rawPayload).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const missing = await app.inject({ method: "GET", url: `/api/books/${encodeURIComponent("book:isbn:missing")}` });
    expect(missing.statusCode).toBe(404);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/books/import?filename=${encodeURIComponent("Renamed API Book.epub")}`,
      headers: { "content-type": "application/epub+zip" },
      payload: source,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      status: "duplicate",
      bookId: "book:isbn:9780000000002",
      existingFilename: filename,
    });
    expect(await readdir(path.join(root, "books"))).toEqual([filename]);
    const cachePath = path.join(root, "data", "book-toc-chinese.json");
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify({ version: 1, books: { "book:isbn:9780000000002": {}, other: { marker: "keep" } } }));
    const deleted = await app.inject({ method: "DELETE", url: `/api/books/${bookId}` });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ status: "deleted", bookId: "book:isbn:9780000000002" });
    expect(await readdir(path.join(root, "books"))).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/books" })).json()).toEqual([]);
    expect((await app.inject({ method: "GET", url: `/api/books/${bookId}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/books/${bookId}/cover` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/books/${bookId}/toc-chinese` })).statusCode).toBe(404);
    expect(JSON.parse(await readFile(cachePath, "utf8")).books).toEqual({ other: { marker: "keep" } });
    expect((await app.inject({ method: "DELETE", url: `/api/books/${bookId}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/books/${encodeURIComponent("../../outside.epub")}` })).statusCode).toBe(404);
    const reimported = await app.inject({ method: "POST", url: `/api/books/import?filename=${encoded}`, headers: { "content-type": "application/epub+zip" }, payload: source });
    expect(reimported.json()).toMatchObject({ status: "imported", bookId: "book:isbn:9780000000002" });
    await app.close();
  });

  it("blocks Book deletion while Chinese TOC generation is running", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "book-delete-busy-"));
    roots.push(root);
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const generate = vi.fn(async (_book: unknown, titles: Array<{ id: string }>) => {
      await wait;
      return new Map(titles.map(({ id }) => [id, "章节"]));
    });
    const app = await buildServer({ projectRoot: root, serveFrontend: false,
      aiProviderEnv: { EASYCLIPROXY_API_KEY: "test-key" }, bookTocChineseProvider: { generate },
      readerGuideProvider: null, sectionTranslationProvider: null,
    });
    const imported = await app.inject({ method: "POST", url: "/api/books/import?filename=Fixture.epub", headers: { "content-type": "application/epub+zip" }, payload: await createBookImportFixture() });
    const url = `/api/books/${encodeURIComponent(imported.json().bookId)}`;
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect((await app.inject({ method: "DELETE", url })).statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(200);
    release();
    await vi.waitFor(async () => expect((await app.inject({ method: "GET", url: `${url}/toc-chinese` })).json().state).toBe("ready"));
    expect((await app.inject({ method: "DELETE", url })).statusCode).toBe(200);
    await app.close();
  });

  it("starts Book TOC Chinese after import, caches it, and regenerates on explicit model switch", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-book-toc-api-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    const requests: Array<{ model: string; titles: Array<{ id: string; title: string }> }> = [];
    const aiFetchImpl = vi.fn(async (_input: unknown, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      const input = JSON.parse(payload.input) as { titles: Array<{ id: string; title: string }> };
      requests.push({ model: payload.model, titles: input.titles });
      return new Response(JSON.stringify({ output_text: JSON.stringify(input.titles.map(({ id }) => ({ id, titleZh: `${payload.model} 中文标题` }))) }), { status: 200 });
    });
    const app = await buildServer({
      projectRoot: root, serveFrontend: false, aiFetchImpl: aiFetchImpl as typeof fetch,
      aiProviderEnv: { EASYCLIPROXY_API_KEY: "test-key", EASYCLIPROXY_MODEL: "first-model" },
      readerGuideProvider: null, sectionTranslationProvider: null, dictionaryProvider: null,
    });
    const bookId = encodeURIComponent("book:isbn:9780000000002");
    const url = `/api/books/${bookId}/toc-chinese`;
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
    const imported = await app.inject({ method: "POST", url: "/api/books/import?filename=Fixture.epub", headers: { "content-type": "application/epub+zip" }, payload: await createBookImportFixture() });
    expect(imported.statusCode).toBe(201);
    await vi.waitFor(async () => expect((await app.inject({ method: "GET", url })).json().state).toBe("ready"));
    expect(requests).toEqual([{ model: "first-model", titles: [expect.objectContaining({ title: "1 API Chapter" })] }]);
    const original = (await app.inject({ method: "GET", url: `/api/books/${bookId}` })).json();
    expect(original.chapters[0].title).toBe("1 API Chapter");
    expect(original.chapters[0]).not.toHaveProperty("titleZh");
    expect((await app.inject({ method: "GET", url })).json().titles.chapters[original.chapters[0].id]).toBe("first-model 中文标题");
    expect((await app.inject({ method: "POST", url, payload: {} })).json().state).toBe("ready");
    expect(aiFetchImpl).toHaveBeenCalledTimes(1);
    const saved = await app.inject({ method: "PUT", url: "/api/ai-settings/profile", payload: {
      activate: true,
      profile: { name: "Second", description: "", responsesUrl: "http://127.0.0.1:8317/v1/responses", model: "second-model", apiKey: "test-key" },
    } });
    expect(saved.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url })).json().model).toBe("first-model");
    expect((await app.inject({ method: "POST", url, payload: { regenerate: true } })).json().state).toBe("running");
    await vi.waitFor(async () => expect((await app.inject({ method: "GET", url })).json().model).toBe("second-model"));
    expect(aiFetchImpl).toHaveBeenCalledTimes(2);
    expect((await app.inject({ method: "POST", url, payload: { regenerate: "yes" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/issues" })).json()).toEqual([]);
    await app.close();
  });

  it("replaces one validated issue atomically while preserving stable state boundaries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-replace-issue-api-"));
    roots.push(root);
    const issuesDir = path.join(root, "issues");
    await mkdir(issuesDir);
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: null,
      readerGuideProvider: null,
      sectionTranslationProvider: null,
      selectionAssistProvider: null,
      wordContextProvider: null,
      dictionaryProvider: null,
    });
    const source = await syntheticMagazineEpub();
    const filename = "TheEconomist.2099.01.10.epub";
    const issueId = "economist:2099-01-10";
    const imported = await app.inject({
      method: "POST",
      url: `/api/import/epub?filename=${encodeURIComponent(filename)}`,
      headers: { "content-type": "application/epub+zip" },
      payload: source,
    });
    expect(imported.statusCode).toBe(201);

    const parsed = await app.inject({ method: "GET", url: `/api/issues/${encodeURIComponent(issueId)}` });
    expect(parsed.statusCode).toBe(200);
    const originalIssue = parsed.json() as IssueRecord;
    const firstArticleId = originalIssue.articles[0].id;
    const storage = new JsonStorage(path.join(root, "data"));
    const cached = await storage.loadIssue(issueId);
    expect(cached).not.toBeNull();
    cached!.articles[0].status = "save";
    cached!.articles[0].readerGuide = {
      titleZh: "旧中文标题",
      subtitleZh: null,
      summaryZh: "旧缓存摘要。",
      model: "old-guide",
      provider: "easycliproxy",
      generatedAt: "2099-01-10T00:00:00.000Z",
    };
    await storage.saveIssue(cached!);
    await storage.saveSectionTranslations({ version: 1, publications: { economist: { Leaders: "社论" } } });
    await storage.saveGuidePreparationStatuses({
      version: 1,
      issues: {
        [issueId]: {
          issueId,
          state: "complete",
          total: cached!.articles.length,
          completed: cached!.articles.length,
          remaining: 0,
          sectionTotal: cached!.sections.length,
          sectionCompleted: cached!.sections.length,
          sectionRemaining: 0,
          attemptCount: 1,
          failedArticleIds: [],
          lastAttemptAt: "2099-01-10T00:00:00.000Z",
          lastCompletedAt: "2099-01-10T00:01:00.000Z",
          lastError: null,
          updatedAt: "2099-01-10T00:01:00.000Z",
        },
      },
    });

    const archive = await JSZip.loadAsync(source);
    archive.file("replacement-marker.txt", "corrected-edition");
    const replacement = await archive.generateAsync({ type: "nodebuffer" });
    expect(replacement.equals(source)).toBe(false);

    const mismatch = await app.inject({
      method: "POST",
      url: `/api/issues/${encodeURIComponent(issueId)}/replace/preview?filename=${encodeURIComponent("TheEconomist.2099.01.11.epub")}`,
      headers: { "content-type": "application/epub+zip" },
      payload: replacement,
    });
    expect(mismatch.statusCode).toBe(200);
    expect(mismatch.json()).toMatchObject({ status: "mismatch", targetIssueId: issueId, issueId: "economist:2099-01-11" });
    expect((await readFile(path.join(issuesDir, filename))).equals(source)).toBe(true);

    const preview = await app.inject({
      method: "POST",
      url: `/api/issues/${encodeURIComponent(issueId)}/replace/preview?filename=${encodeURIComponent("economist-2099-01-10.epub")}`,
      headers: { "content-type": "application/epub+zip" },
      payload: replacement,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ status: "ready", targetIssueId: issueId, issueId, existingFilename: filename });

    const replaced = await app.inject({
      method: "POST",
      url: `/api/issues/${encodeURIComponent(issueId)}/replace?filename=${encodeURIComponent("economist-2099-01-10.epub")}`,
      headers: { "content-type": "application/epub+zip" },
      payload: replacement,
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toMatchObject({ status: "replaced", targetIssueId: issueId, issueId, existingFilename: filename });
    expect(await readdir(issuesDir)).toEqual([filename]);
    expect((await readFile(path.join(issuesDir, filename))).equals(replacement)).toBe(true);
    expect((await readdir(issuesDir)).some((name) => name.startsWith(".epub-replace-"))).toBe(false);
    expect((await storage.loadGuidePreparationStatuses()).issues[issueId]).toBeUndefined();
    await expect(storage.loadSectionTranslations()).resolves.toEqual({ version: 1, publications: { economist: { Leaders: "社论" } } });

    const refreshed = await app.inject({ method: "GET", url: `/api/issues/${encodeURIComponent(issueId)}` });
    expect(refreshed.statusCode).toBe(200);
    const refreshedIssue = refreshed.json() as IssueRecord;
    expect(refreshedIssue.id).toBe(issueId);
    expect(refreshedIssue.articles.find((article) => article.id === firstArticleId)?.status).toBe("save");
    expect(refreshedIssue.articles.find((article) => article.id === firstArticleId)?.readerGuide).toBeNull();
    await app.close();
  });

  it("safely deletes a recognized issue and only its regenerable issue caches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-delete-issue-api-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: null,
      readerGuideProvider: null,
      sectionTranslationProvider: null,
      selectionAssistProvider: null,
      wordContextProvider: null,
      dictionaryProvider: null,
    });
    const source = await syntheticMagazineEpub();
    const filename = "TheEconomist.2099.01.08.epub";
    const issueId = "economist:2099-01-08";
    const imported = await app.inject({
      method: "POST",
      url: `/api/import/epub?filename=${encodeURIComponent(filename)}`,
      headers: { "content-type": "application/epub+zip" },
      payload: source,
    });
    expect(imported.statusCode).toBe(201);

    const parsed = await app.inject({ method: "GET", url: `/api/issues/${encodeURIComponent(issueId)}` });
    expect(parsed.statusCode).toBe(200);
    const storage = new JsonStorage(path.join(root, "data"));
    await expect(storage.loadIssue(issueId)).resolves.not.toBeNull();
    await storage.saveSectionTranslations({ version: 1, publications: { economist: { Leaders: "社论" } } });
    await storage.saveGuidePreparationStatuses({
      version: 1,
      issues: {
        [issueId]: {
          issueId,
          state: "error",
          total: 70,
          completed: 0,
          remaining: 70,
          sectionTotal: 19,
          sectionCompleted: 0,
          sectionRemaining: 19,
          attemptCount: 1,
          failedArticleIds: [],
          lastAttemptAt: null,
          lastCompletedAt: null,
          lastError: "test status",
          updatedAt: "2099-01-08T00:00:00.000Z",
        },
      },
    });

    const traversal = await app.inject({ method: "DELETE", url: `/api/issues/${encodeURIComponent("../data/section-translations.json")}` });
    expect(traversal.statusCode).toBe(404);
    expect(await readdir(path.join(root, "issues"))).toEqual([filename]);

    const deleted = await app.inject({ method: "DELETE", url: `/api/issues/${encodeURIComponent(issueId)}` });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true, issueId, filename });
    expect(await readdir(path.join(root, "issues"))).toEqual([]);
    await expect(storage.loadIssue(issueId)).resolves.toBeNull();
    expect((await storage.loadGuidePreparationStatuses()).issues[issueId]).toBeUndefined();
    await expect(storage.loadSectionTranslations()).resolves.toEqual({ version: 1, publications: { economist: { Leaders: "社论" } } });

    const issues = await app.inject({ method: "GET", url: "/api/issues" });
    expect(issues.statusCode).toBe(200);
    expect(issues.json()).toEqual([]);
    const missing = await app.inject({ method: "GET", url: `/api/issues/${encodeURIComponent(issueId)}` });
    expect(missing.statusCode).toBe(404);
    const deletedAgain = await app.inject({ method: "DELETE", url: `/api/issues/${encodeURIComponent(issueId)}` });
    expect(deletedAgain.statusCode).toBe(404);
    await app.close();
  });

  it("rejects issue deletion while Chinese-guide preparation is running", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-delete-running-guide-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    let releaseGuide!: () => void;
    const guideGate = new Promise<void>((resolve) => { releaseGuide = resolve; });
    const generate = vi.fn(async (articles: Article[]) => {
      await guideGate;
      return new Map(articles.map((article) => [article.id, {
        titleZh: `中文：${article.title}`,
        subtitleZh: null,
        summaryZh: "删除保护测试摘要。",
        model: "test-reader-guide",
        provider: "easycliproxy" as const,
        generatedAt: "2099-01-09T00:00:00.000Z",
      }]));
    });
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: null,
      readerGuideProvider: { generate },
      sectionTranslationProvider: null,
      selectionAssistProvider: null,
      wordContextProvider: null,
      dictionaryProvider: null,
      guidePreparationRetryDelaysMs: [0, 0],
    });
    const source = await syntheticMagazineEpub();
    const filename = "TheEconomist.2099.01.09.epub";
    const issueId = "economist:2099-01-09";
    const imported = await app.inject({
      method: "POST",
      url: `/api/import/epub?filename=${encodeURIComponent(filename)}`,
      headers: { "content-type": "application/epub+zip" },
      payload: source,
    });
    expect(imported.statusCode).toBe(201);
    await vi.waitFor(() => expect(generate).toHaveBeenCalled(), { timeout: 5_000 });

    const blocked = await app.inject({ method: "DELETE", url: `/api/issues/${encodeURIComponent(issueId)}` });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: expect.stringContaining("正在导入或生成中文导读") });
    expect(await readdir(path.join(root, "issues"))).toEqual([filename]);

    const blockedReplace = await app.inject({
      method: "POST",
      url: `/api/issues/${encodeURIComponent(issueId)}/replace?filename=${encodeURIComponent(filename)}`,
      headers: { "content-type": "application/epub+zip" },
      payload: source,
    });
    expect(blockedReplace.statusCode).toBe(409);
    expect(blockedReplace.json()).toMatchObject({ error: expect.stringContaining("正在生成中文导读") });
    expect(await readdir(path.join(root, "issues"))).toEqual([filename]);

    releaseGuide();
    await vi.waitFor(async () => {
      const status = await app.inject({ method: "GET", url: `/api/issues/${encodeURIComponent(issueId)}/guide-preparation` });
      expect(status.statusCode).toBe(200);
      expect(status.json().state).not.toBe("running");
    }, { timeout: 10_000, interval: 50 });

    const deleted = await app.inject({ method: "DELETE", url: `/api/issues/${encodeURIComponent(issueId)}` });
    expect(deleted.statusCode).toBe(200);
    expect(await readdir(path.join(root, "issues"))).toEqual([]);
    await app.close();
  });

  it("starts Chinese section, title and summary preparation after import without blocking the response", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-import-background-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    let releaseFirstGuide!: () => void;
    const firstGuideGate = new Promise<void>((resolve) => { releaseFirstGuide = resolve; });
    let firstGuideCall = true;
    const generate = vi.fn(async (articles: Article[]) => {
      if (firstGuideCall) {
        firstGuideCall = false;
        await firstGuideGate;
      }
      return new Map(articles.map((article) => [article.id, {
        titleZh: `中文：${article.title}`,
        subtitleZh: null,
        summaryZh: "后台生成的测试摘要。",
        model: "test-reader-guide",
        provider: "easycliproxy" as const,
        generatedAt: "2099-01-01T00:00:00.000Z",
      }]));
    });
    const translate = vi.fn(async (_publicationId: Article["publicationId"], sections: string[]) =>
      new Map(sections.map((section) => [section, `中文栏目：${section}`])));
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: null,
      readerGuideProvider: { generate },
      sectionTranslationProvider: { translate },
      selectionAssistProvider: null,
      wordContextProvider: null,
      dictionaryProvider: null,
    });
    const source = await syntheticMagazineEpub();
    const filename = "TheEconomist.2099.01.06.epub";

    const imported = await app.inject({
      method: "POST",
      url: `/api/import/epub?filename=${encodeURIComponent(filename)}`,
      headers: { "content-type": "application/epub+zip" },
      payload: source,
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({ status: "imported", issueId: "economist:2099-01-06" });

    await vi.waitFor(() => expect(generate).toHaveBeenCalled(), { timeout: 5_000 });
    releaseFirstGuide();

    await vi.waitFor(async () => {
      const issueResponse = await app.inject({ method: "GET", url: "/api/issues/economist%3A2099-01-06" });
      expect(issueResponse.statusCode).toBe(200);
      const issue = issueResponse.json() as IssueRecord;
      expect(issue.articles.every((article) => Boolean(article.readerGuide?.titleZh) && Boolean(article.readerGuide?.summaryZh))).toBe(true);
      expect(issue.sections.every((section) => Boolean(issue.sectionTranslations?.[section]))).toBe(true);
    }, { timeout: 10_000, interval: 50 });
    expect(generate.mock.calls.length).toBeGreaterThan(1);
    await app.close();
  });

  it("keeps the EPUB imported when background Chinese preparation fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-import-background-failure-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    const generate = vi.fn(async () => {
      throw new Error("test reader-guide provider offline");
    });
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: null,
      readerGuideProvider: { generate },
      sectionTranslationProvider: null,
      selectionAssistProvider: null,
      wordContextProvider: null,
      dictionaryProvider: null,
    });
    const source = await syntheticMagazineEpub();
    const filename = "TheEconomist.2099.01.07.epub";

    const imported = await app.inject({
      method: "POST",
      url: `/api/import/epub?filename=${encodeURIComponent(filename)}`,
      headers: { "content-type": "application/epub+zip" },
      payload: source,
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({ status: "imported", issueId: "economist:2099-01-07" });
    await vi.waitFor(() => expect(generate).toHaveBeenCalled(), { timeout: 5_000 });

    const issues = await app.inject({ method: "GET", url: "/api/issues" });
    expect(issues.statusCode).toBe(200);
    expect(issues.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: "economist:2099-01-07" })]));
    expect(await readdir(path.join(root, "issues"))).toEqual([filename]);
    await vi.waitFor(async () => {
      const status = await app.inject({ method: "GET", url: "/api/issues/economist%3A2099-01-07/guide-preparation" });
      expect(status.statusCode).toBe(200);
      expect(status.json().state).toBe("error");
    }, { timeout: 20_000, interval: 50 });
    await app.close();
  });

  it("manages masked AI profiles and applies an activated Gemini profile without restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-ai-profile-api-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    const calls: Array<{ url: string; model?: string; authorization?: string }> = [];
    const aiFetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url.endsWith("/models")) {
        calls.push({ url, authorization: headers.get("Authorization") ?? undefined });
        return new Response(JSON.stringify({ data: [
          { id: "gpt-6-luna" },
          { id: "gemini-3.1-flash-lite" },
        ] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const body = JSON.parse(String(init?.body));
      calls.push({ url, model: body.model, authorization: headers.get("Authorization") ?? undefined });
      return new Response(JSON.stringify({ output_text: body.input === "Target paragraph to translate:\nTarget paragraph." ? "Gemini 翻译结果" : "OK" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      aiProviderEnv: {
        EASYCLIPROXY_BASE_URL: "http://127.0.0.1:8317/v1",
        EASYCLIPROXY_MODEL: "gpt-6-luna",
        EASYCLIPROXY_API_KEY: "legacy-api-secret",
      },
      aiFetchImpl,
      dictionaryProvider: null,
    });

    const initial = await app.inject({ method: "GET", url: "/api/ai-settings" });
    expect(initial.statusCode).toBe(200);
    expect(initial.body).not.toContain("legacy-api-secret");
    expect(initial.json()).toMatchObject({
      activeProfileId: "easycliproxy-default",
      profiles: [expect.objectContaining({ model: "gpt-6-luna", hasApiKey: true, apiKeyMasked: "••••••••" })],
    });

    const saved = await app.inject({
      method: "PUT",
      url: "/api/ai-settings/profile",
      payload: {
        activate: true,
        profile: {
          name: "EasyCLIProxy - Gemini",
          description: "Gemini Flash / 网页翻译",
          responsesUrl: "http://127.0.0.1:8317/v1/responses",
          model: "gemini-3.1-flash-lite",
          apiKey: "gemini-api-secret",
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain("gemini-api-secret");
    const savedJson = saved.json() as { savedProfileId: string; activeProfileId: string };
    expect(savedJson.activeProfileId).toBe(savedJson.savedProfileId);

    const testConnection = await app.inject({
      method: "POST",
      url: "/api/ai-settings/test",
      payload: {
        id: savedJson.savedProfileId,
        name: "EasyCLIProxy - Gemini",
        description: "Gemini Flash / 网页翻译",
        responsesUrl: "http://127.0.0.1:8317/v1/responses",
        model: "gemini-3.1-flash-lite",
      },
    });
    expect(testConnection.statusCode).toBe(200);
    expect(testConnection.json()).toMatchObject({ ok: true, model: "gemini-3.1-flash-lite", output: "OK" });

    const models = await app.inject({
      method: "POST",
      url: "/api/ai-settings/models",
      payload: {
        id: savedJson.savedProfileId,
        name: "EasyCLIProxy - Gemini",
        description: "",
        responsesUrl: "http://127.0.0.1:8317/v1/responses",
        model: "gemini-3.1-flash-lite",
      },
    });
    expect(models.statusCode).toBe(200);
    expect(models.json()).toMatchObject({ models: ["gemini-3.1-flash-lite", "gpt-6-luna"] });

    const translated = await app.inject({
      method: "POST",
      url: "/api/translate",
      payload: { text: "Target paragraph." },
    });
    expect(translated.statusCode).toBe(200);
    expect(translated.json()).toEqual({
      translation: "Gemini 翻译结果",
      profileId: savedJson.savedProfileId,
      model: "gemini-3.1-flash-lite",
      provider: "easycliproxy",
    });
    expect(calls.some((call) => call.model === "gemini-3.1-flash-lite" && call.authorization === "Bearer gemini-api-secret")).toBe(true);
    await app.close();
  });

  it("routes English word lookups through the dictionary provider", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-dictionary-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    const lookup = vi.fn(async () => ({
      word: "husband",
      phonetic: "/ˈhʌzbənd/",
      usPhonetic: "ˈhʌzbənd",
      ukPhonetic: "ˈhʌzbənd",
      usAudioUrl: "https://dict.youdao.com/dictvoice?audio=husband&type=2",
      ukAudioUrl: "https://dict.youdao.com/dictvoice?audio=husband&type=1",
      definitionsZh: [{ definition: "n. 丈夫", partOfSpeech: null, example: null, source: "youdao" as const }],
      definitionsEn: [{ definition: "the man someone is married to", partOfSpeech: "noun", example: "Her husband is a doctor.", source: "dictionaryapi" as const }],
      englishDefinitionSource: "exact" as const,
      englishLookupWord: "husband",
      youdaoAvailable: true,
      dictionaryApiAvailable: true,
    }));
    const app = await buildServer({
      projectRoot: root,
      serveFrontend: false,
      translationProvider: null,
      readerGuideProvider: null,
      selectionAssistProvider: null,
      wordContextProvider: null,
      dictionaryProvider: { lookup },
    });

    const response = await app.inject({ method: "GET", url: "/api/dictionary?word=husband" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      word: "husband",
      usPhonetic: "ˈhʌzbənd",
      ukPhonetic: "ˈhʌzbənd",
      definitionsZh: [{ definition: "n. 丈夫" }],
    });
    expect(lookup).toHaveBeenCalledWith("husband");

    const invalid = await app.inject({ method: "GET", url: "/api/dictionary?word=two%20words" });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });
  it("delivers live preparation frames before completion and aborts on client disconnect", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-prep-stream-api-")); roots.push(root);
    const app = await buildServer({ projectRoot: root, serveFrontend: false, aiProviderEnv: {} });
    const imported = await app.inject({ method: "POST", url: "/api/books/import?filename=Stream.epub", headers: { "content-type": "application/epub+zip" }, payload: await createBookImportFixture() });
    expect(imported.statusCode).toBe(201);
    const bookId = "book:isbn:9780000000002";
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    let aborted = false;
    const mock = vi.spyOn(CodexPrepService.prototype, "converse").mockImplementation(async (_book, message, _chapter, _draft, options) => {
      options?.onStatus?.("正在全文检索");
      options?.onResearch?.({ indexedChapters: 1, indexedParagraphs: 2, queries: ["source"], read: [{ chapterId: "fixture", title: "Fixture", paragraphs: [1] }], truncated: false });
      options?.onDelta?.("第一段");
      if (message === "abort") await new Promise<void>((resolve) => { options?.signal?.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }); });
      else await gate;
      options?.onDelta?.("第二段");
      return { answer: "第一段第二段" };
    });
    try {
      const address = await app.listen({ port: 0, host: "127.0.0.1" });
      const url = `${address}/api/books/${encodeURIComponent(bookId)}/prep/chat`;
      const headers = { "content-type": "application/json", accept: "application/x-ndjson", connection: "close" };
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ message: "stream" }) });
      const reader = response.body!.getReader();
      let first = new TextDecoder().decode((await reader.read()).value);
      while (!first.includes("第一段")) { const chunk = await reader.read(); if (chunk.done) break; first += new TextDecoder().decode(chunk.value); }
      expect(first).toContain('"type":"status"'); expect(first).toContain("第一段"); expect(first).toContain('"type":"research"'); expect(first).toContain("正在全文检索"); expect(first).not.toContain('"type":"done"');
      finish();
      let remaining = "";
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; remaining += new TextDecoder().decode(chunk.value); }
      expect(remaining).toContain('"type":"done"');
      const controller = new AbortController();
      const cancelled = await fetch(url, { method: "POST", headers, body: JSON.stringify({ message: "abort" }), signal: controller.signal });
      await cancelled.body!.getReader().read(); controller.abort();
      await vi.waitFor(() => expect(aborted).toBe(true));
      const invalid = await app.inject({ method: "POST", url: `/api/books/${encodeURIComponent(bookId)}/prep/chat`, headers, payload: { message: 5 } });
      expect(invalid.statusCode).toBe(400);
    } finally { finish(); mock.mockRestore(); await app.close(); }
  });

  it("routes contextual sentence requests and rejects invalid or oversized context before calling the provider", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-sentence-translation-")); roots.push(root);
    const translate = vi.fn(async () => ({ translation: "自然句译", expressions: [{ text: "world", explanationZh: "生活环境" }], profileId: "profile-a", model: "model-a", provider: "easycliproxy" as const }));
    const app = await buildServer({ projectRoot: root, serveFrontend: false, translationProvider: { translate }, getTranslationCacheIdentity: () => ({ profileId: "profile-a", model: "model-a" }) });
    try {
      const payload = { text: "Our world.", mode: "sentence", paragraphContext: "Before. Our world. After.", expectedProfileId: "profile-a", expectedModel: "model-a" };
      const response = await app.inject({ method: "POST", url: "/api/translate", payload });
      expect(response.statusCode).toBe(200); expect(response.json().expressions).toHaveLength(1);
      expect(translate).toHaveBeenCalledWith(expect.objectContaining({ text: payload.text, mode: payload.mode, paragraphContext: payload.paragraphContext }));
      const wrongProfile = await app.inject({ method: "POST", url: "/api/translate", payload: { ...payload, expectedProfileId: "profile-b" } });
      expect(wrongProfile.statusCode).toBe(409);
      for (const change of [{ text: 7 }, { mode: "invalid" }, { paragraphContext: "Other sentence." }, { paragraphContext: "a".repeat(12001) }, { contextBefore: {} }]) {
        const invalid = await app.inject({ method: "POST", url: "/api/translate", payload: { ...payload, ...change } });
        expect(invalid.statusCode).toBe(400);
      }
      expect(translate).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });

});
