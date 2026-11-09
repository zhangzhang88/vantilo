import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildServer } from "./app";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

describe("Reader word-audio same-origin endpoint", () => {
  it("serves cached Youdao audio without waiting for dictionary/AI and separates US/UK", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "reader-word-audio-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(520, 9)]);
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(mp3), {
      status: 200, headers: { "content-type": "audio/mpeg" },
    }));
    const lookup = vi.fn(async () => { throw new Error("dictionary blocked"); });
    const app = await buildServer({
      projectRoot: root, serveFrontend: false, dictionaryProvider: { lookup },
      readerGuideProvider: null, sectionTranslationProvider: null,
      selectionAssistProvider: null, wordContextProvider: null,
      wordAudioFetchImpl: fetchImpl as unknown as typeof fetch,
    });
    try {
      const first = await app.inject({method:"GET",url:"/api/word-audio?word=Forest&accent=us"});
      expect(first.statusCode).toBe(200);
      expect(first.headers["content-type"]).toContain("audio/mpeg");
      expect(first.headers["x-word-audio-cache"]).toBe("miss");
      expect(first.rawPayload).toEqual(mp3);
      const repeat = await app.inject({method:"GET",url:"/api/word-audio?word=forest&accent=us"});
      expect(repeat.statusCode).toBe(200);
      expect(repeat.headers["x-word-audio-cache"]).toBe("hit");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const british = await app.inject({method:"GET",url:"/api/word-audio?word=forest&accent=uk"});
      expect(british.statusCode).toBe(200);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(lookup).not.toHaveBeenCalled();
      for (const word of ["two words", "http://evil.com", "../escape"]) {
        const invalid = await app.inject({method:"GET",url:`/api/word-audio?word=${encodeURIComponent(word)}&accent=us`});
        expect(invalid.statusCode).toBe(400);
      }
    } finally { await app.close(); }
  });
  it("fails safely on non-audio responses and never returns a fake MP3", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "reader-word-audio-invalid-"));
    roots.push(root);
    await mkdir(path.join(root, "issues"));
    const fetchImpl = vi.fn(async () => new Response("<!doctype html>forbidden", {status:200,headers:{"content-type":"text/html"}}));
    const app = await buildServer({
      projectRoot: root, serveFrontend:false,
      readerGuideProvider:null, selectionAssistProvider:null, wordContextProvider:null,
      dictionaryProvider:null, wordAudioFetchImpl:fetchImpl as unknown as typeof fetch,
    });
    try {
      const response = await app.inject({method:"GET",url:"/api/word-audio?word=lead&accent=us"});
      expect(response.statusCode).toBe(502);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {await app.close();}
  });
});
