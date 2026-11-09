import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WordAudioCache, WordAudioError, normalizedAudioWord } from "./word-audio-cache";

const roots: string[] = [];
const caches: WordAudioCache[] = [];
const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(4093, 0x3f)]);
const mp3Response = () => new Response(new Uint8Array(mp3), {
  status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(mp3.length) },
});

afterEach(async () => {
  await Promise.all(caches.splice(0).map(cache => cache.waitForIdle()));
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
  roots.length = 0;
  vi.useRealTimers();
});

describe("bounded local Youdao word-audio cache", () => {
  it("validates words and never allows an arbitrary URL or path", () => {
    expect(normalizedAudioWord(" Well-known ")).toBe("well-known");
    expect(normalizedAudioWord("DON’T")).toBe("don't");
    for (const invalid of ["two words", "../../config", "https://x", "x?y", "汉字", " ".repeat(20)]) {
      expect(normalizedAudioWord(invalid)).toBeNull();
    }
  });

  it("returns correct US and UK MP3 without dictionary lookup and persists across instances", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "word-audio-cache-"));
    roots.push(dir);
    const fetchAudio = vi.fn(async (_url: string, _options: RequestInit) => mp3Response());
    const cache = new WordAudioCache(dir, fetchAudio as unknown as typeof fetch);
    caches.push(cache);
    const first = await cache.get("Hello", "us");
    expect(first.cached).toBe(false);
    expect(first.audio).toEqual(mp3);
    expect(fetchAudio).toHaveBeenCalledWith(
      "https://dict.youdao.com/dictvoice?audio=hello&type=2",
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
    const second = await cache.get("hello", "us");
    expect(second.cached).toBe(true);
    expect(fetchAudio).toHaveBeenCalledTimes(1);
    const british = await cache.get("hello", "uk");
    expect(british.cached).toBe(false);
    expect(fetchAudio).toHaveBeenLastCalledWith(
      "https://dict.youdao.com/dictvoice?audio=hello&type=1", expect.any(Object),
    );
    expect(fetchAudio).toHaveBeenCalledTimes(2);

    // The MP3 is delivered before disk write finishes; wait for the file only
    // when verifying recovery from a fresh app session.
    let files: string[] = [];
    for (let i = 0; i < 50; i++) {
      files = await (await import("node:fs/promises")).readdir(dir);
      if (files.filter(name => name.endsWith(".mp3")).length === 2) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(files.filter(name => name.endsWith(".mp3"))).toHaveLength(2);
    expect((await Promise.all(files.filter(name => name.endsWith(".mp3")).map(name => stat(path.join(dir, name))))).every(item => item.size === mp3.length)).toBe(true);
    const reloaded = new WordAudioCache(dir, fetchAudio as unknown as typeof fetch);
    caches.push(reloaded);
    expect((await reloaded.get("HELLO", "us")).cached).toBe(true);
    expect(fetchAudio).toHaveBeenCalledTimes(2);
  });

  it("coalesces simultaneous misses and never stores HTML or oversized audio", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "word-audio-miss-"));
    roots.push(dir);
    const fetchAudio = vi.fn(async () => mp3Response());
    const cache = new WordAudioCache(dir, fetchAudio as unknown as typeof fetch);
    caches.push(cache);
    const [one, two] = await Promise.all([cache.get("reading", "us"), cache.get("reading", "us")]);
    expect(one.audio).toEqual(two.audio);
    expect(fetchAudio).toHaveBeenCalledTimes(1);
    await expect(cache.get("../bad", "us")).rejects.toBeInstanceOf(WordAudioError);
    const badFetch = vi.fn(async () => new Response("<html>blocked</html>", {headers:{"content-type":"text/html"}}));
    const separate = new WordAudioCache(dir, badFetch as unknown as typeof fetch);
    caches.push(separate);
    await expect(separate.get("failure", "uk")).rejects.toThrow("没有返回音频");
    expect(badFetch).toHaveBeenCalledTimes(1);
  });

  it("does not let a disk write failure block audible MP3", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "word-audio-unwritable-"));
    roots.push(root);
    const file = path.join(root, "not-directory");
    await (await import("node:fs/promises")).writeFile(file, "file");
    const fetchAudio = vi.fn(async () => mp3Response());
    const cache = new WordAudioCache(file, fetchAudio as unknown as typeof fetch);
    caches.push(cache);
    expect((await cache.get("voice", "us")).audio).toEqual(mp3);
    expect((await cache.get("voice", "us")).cached).toBe(true);
    expect(await readFile(file, "utf8")).toBe("file");
  });
});
