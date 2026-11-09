import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type WordAccent = "us" | "uk";
const VALID_WORD = /^[A-Za-z]+(?:[-'’][A-Za-z]+)*$/;
const MAX_WORD = 80;
const MAX_AUDIO_BYTES = 256 * 1024;
const MAX_MEMORY_CLIPS = 96;
const MAX_DISK_CLIPS = 600;
const MAX_DISK_BYTES = 24 * 1024 * 1024;
const CACHE_AGE_MS = 30 * 86400_000;
const FETCH_TIMEOUT_MS = 1_800;

export function normalizedAudioWord(word: string): string | null {
  const text = word.trim();
  return text.length > 0 && text.length <= MAX_WORD && VALID_WORD.test(text)
    ? text.toLocaleLowerCase("en-US").replace(/’/g, "'") : null;
}

export class WordAudioError extends Error {}

function audioLooksValid(data: Buffer): boolean {
  // A cached HTML/JSON/error response must never be played as audio.
  return data.length >= 128 && data.length <= MAX_AUDIO_BYTES
    && (data.toString("ascii", 0, 3) === "ID3"
      || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0));
}

/**
 * Small, bounded, per-word Youdao MP3 cache. All outbound URLs use a fixed
 * HTTPS host. Writes are best-effort so a read-only drive never blocks sound.
 * Each Reader instance uses its own Reader library cache directory.
 */
export class WordAudioCache {
  private memory = new Map<string, Buffer>();
  private pending = new Map<string, Promise<{ audio: Buffer; cached: boolean }>>();
  private writes = new Set<Promise<void>>();
  private completedWrites = 0;

  constructor(private dir: string, private fetchImpl: typeof fetch = fetch) {}

  async get(rawWord: string, accent: WordAccent): Promise<{ audio: Buffer; cached: boolean }> {
    const word = normalizedAudioWord(rawWord);
    if (!word || (accent !== "us" && accent !== "uk")) throw new WordAudioError("无效的英文单词或口音");
    const id = createHash("sha256").update(`v1:${accent}:${word}`).digest("hex");
    const existing = this.memory.get(id);
    if (existing) {
      this.memory.delete(id); this.memory.set(id, existing);
      return { audio: existing, cached: true };
    }
    // Join all concurrent requests before any async file/network check.
    const flight = this.pending.get(id);
    if (flight) return flight;
    const next = this.loadOrDownload(word, accent, id);
    this.pending.set(id, next);
    try { return await next; }
    finally { if (this.pending.get(id) === next) this.pending.delete(id); }
  }

  /** Called at Reader shutdown/backup and in tests; no cache write outlives cleanup. */
  async waitForIdle(): Promise<void> {
    while (this.pending.size || this.writes.size) {
      await Promise.allSettled([...this.pending.values(), ...this.writes]);
    }
  }

  private async loadOrDownload(word: string, accent: WordAccent, id: string): Promise<{ audio: Buffer; cached: boolean }> {
    const filename = path.join(this.dir, id + ".mp3");
    try {
      const info = await stat(filename);
      if (info.size <= MAX_AUDIO_BYTES && Date.now() - info.mtimeMs <= CACHE_AGE_MS) {
        const audio = await readFile(filename);
        if (audioLooksValid(audio)) {
          this.remember(id, audio);
          return { audio, cached: true };
        }
      }
    } catch { /* Empty, unreadable or moved external cache: fetch normally. */ }
    return { audio: await this.download(word, accent, filename, id), cached: false };
  }

  private remember(id: string, data: Buffer) {
    this.memory.delete(id); this.memory.set(id, data);
    if (this.memory.size > MAX_MEMORY_CLIPS) this.memory.delete(this.memory.keys().next().value!);
  }

  private async download(word: string, accent: WordAccent, filename: string, id: string): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${accent === "us" ? 2 : 1}`;
      const response = await this.fetchImpl(url, { signal: controller.signal, redirect: "error" });
      if (!response.ok || !response.body) throw new WordAudioError("有道发音暂不可用");
      const mime = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!mime.includes("audio/") && !mime.includes("application/octet-stream")) {
        throw new WordAudioError("有道没有返回音频文件");
      }
      const declared = Number(response.headers.get("content-length"));
      if (declared > MAX_AUDIO_BYTES) throw new WordAudioError("单词音频超过大小限制");
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let count = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          count += value.byteLength;
          if (count > MAX_AUDIO_BYTES) throw new WordAudioError("单词音频超过大小限制");
          chunks.push(Buffer.from(value));
        }
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      const audio = Buffer.concat(chunks, count);
      if (!audioLooksValid(audio)) throw new WordAudioError("有道音频格式无效");
      this.remember(id, audio);
      // Return audio before the optional disk write: the first sound must
      // never wait for a slow/missing/unmounted external volume.
      const writing = this.persist(filename, audio);
      this.writes.add(writing);
      void writing.finally(() => { this.writes.delete(writing); });
      return audio;
    } catch (error) {
      throw error instanceof WordAudioError ? error : new WordAudioError("有道发音网络超时或连接失败");
    } finally { clearTimeout(timer); }
  }

  private async persist(filename: string, audio: Buffer) {
    try {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const temp = filename + "." + randomUUID() + ".tmp";
      try { await writeFile(temp, audio, { flag: "wx", mode: 0o600 }); await rename(temp, filename); }
      finally { await unlink(temp).catch(() => {}); }
      if (++this.completedWrites % 10 === 0) await this.prune().catch(() => {});
    } catch { /* Cache is best-effort: the user still receives the audio. */ }
  }

  private async prune() {
    const entries = await readdir(this.dir, { withFileTypes: true });
    const files = (await Promise.all(entries.filter(e => e.isFile() && /^[a-f0-9]{64}\.mp3$/.test(e.name)).map(async e => {
      try { const item = await stat(path.join(this.dir, e.name)); return { name: e.name, bytes: item.size, at: item.mtimeMs }; }
      catch { return null; }
    }))).filter((entry): entry is {name:string;bytes:number;at:number} => entry!==null)
      .sort((a, b) => b.at - a.at);
    let size = 0;
    for (const [index, entry] of files.entries()) {
      size += entry.bytes;
      if (index < MAX_DISK_CLIPS && size <= MAX_DISK_BYTES && Date.now() - entry.at <= CACHE_AGE_MS) continue;
      await unlink(path.join(this.dir, entry.name)).catch(() => {});
    }
  }
}
