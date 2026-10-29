import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { scienceArticleImages, type ScienceArticle, type ScienceArticleImage } from "../../shared/science-article.js";
import { isAccessibleScienceArticle } from "../../shared/science-article-curation.js";
import { isLocalScienceMediaSource, parseScienceArticle, safeScienceSourceUrl } from "./science-article-parser.js";

const MAX_HTML_BYTES = 2_000_000;
const MAX_IMAGE_BYTES = 8_000_000;
const MAX_ARTICLE_MEDIA_BYTES = 32_000_000;
const MAX_SAVED_IMAGES = 16;
const MAX_ARTICLES = 200;
const SAFE_ID = /^[a-f0-9]{64}$/;
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

async function boundedBytes(response: Response, limit: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("来源文件超过本机保存大小限制");
  }
  if (!response.body) throw new Error("来源没有返回内容");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new Error("来源文件超过本机保存大小限制"); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

function normalizeUrl(raw: string, media = false, articleUrl?: string): URL {
  const safe = safeScienceSourceUrl(raw);
  const url = safe ? new URL(safe) : null;
  const isNoaaArticle = url?.hostname === "oceanservice.noaa.gov" && url.pathname.startsWith("/facts/");
  const isNasaArticle = url?.hostname === "spaceplace.nasa.gov" && /^\/[a-z0-9-]+\/en\/$/i.test(url.pathname);
  const isNasaClimateKidsArticle = url?.hostname === "climatekids.nasa.gov" && /^\/(?:climate-change-meaning|water-cycle|greenhouse-effect|air-pollution|ocean\/the|soil|polar-temperatures\/here|cloud-climate|how-to-help|sun-people|science-fair)\/?$/i.test(url.pathname);
  const isNpsArticle = url?.hostname === "www.nps.gov" && /^\/[a-z0-9]+\/(?:learn|learnandexplore)\/.+\.htm$/i.test(url.pathname);
  const isBitcoinArticle = url?.hostname === "bitcoin.org" && url.pathname === "/en/faq";
  const isOpenLearnArticle = url?.hostname === "www.open.edu" && /^\/openlearn\/(?:money-business|health-sports-psychology|education-development)\//i.test(url.pathname);
  const isOurWorldInDataArticle = ["ourworldindata.org", "www.ourworldindata.org"].includes(url?.hostname ?? "")
    && /^\/[a-z0-9][a-z0-9-]*\/?$/i.test(url?.pathname ?? "")
    && !/^\/(?:about|latest|topics?|data|grapher|search|team|donate|faqs?|atom\.xml)\/?$/i.test(url?.pathname ?? "");
  if (!url || (media ? !articleUrl || !isLocalScienceMediaSource(safe!, articleUrl) : !(isNoaaArticle || isNasaArticle || isNasaClimateKidsArticle || isNpsArticle || isOpenLearnArticle || isOurWorldInDataArticle || isBitcoinArticle))) {
    throw new Error(`当前来源不在支持的科普文章来源白名单内（${url?.hostname.toUpperCase() ?? "未知来源"}）`);
  }
  url.hash = "";
  return url;
}

function imageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export class ScienceArticleService {
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly mediaDir: string;

  constructor(private readonly statePath: string, private readonly fetchImpl: typeof fetch = fetch) {
    this.mediaDir = path.join(path.dirname(statePath), "science-article-media");
  }

  async list(): Promise<ScienceArticle[]> { return this.readAll(); }

  importFromSource(rawUrl: string): Promise<ScienceArticle> {
    return this.withMutation(async () => {
      const article = await this.importOnce(rawUrl);
      if (!article) throw new Error("文章未能完成收录");
      return article;
    });
  }

  importAutomatically(rawUrl: string): Promise<ScienceArticle | null> {
    return this.withMutation(() => this.importOnce(rawUrl, false, true));
  }

  refresh(id: string): Promise<ScienceArticle> {
    return this.withMutation(async () => {
      const article = (await this.readAll()).find((record) => record.id === id);
      if (!article) throw new Error("本机科普文章不存在");
      const refreshed = await this.importOnce(article.sourceUrl, true);
      if (!refreshed) throw new Error("文章未能完成更新");
      return refreshed;
    });
  }

  private async sourceResponse(url: URL, media = false, articleUrl?: string): Promise<Response> {
    for (let redirects = 0; redirects < 3; redirects++) {
      const response = await this.fetchImpl(url, {
        headers: { Accept: media ? "image/png, image/jpeg, image/gif, image/webp" : "text/html", "User-Agent": "MagazineReader/0.2 (local science article library)" },
        signal: AbortSignal.timeout(media ? 8_000 : 15_000), redirect: "manual",
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new Error("NOAA 重定向缺少目标地址");
        url = normalizeUrl(new URL(location, url).toString(), media, articleUrl);
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`NOAA 返回 HTTP ${response.status}`); }
      if (response.url) normalizeUrl(response.url, media, articleUrl);
      return response;
    }
    throw new Error("NOAA 重定向次数过多");
  }

  private async collectMedia(images: ScienceArticleImage[], articleUrl: string): Promise<Map<string, Buffer>> {
    const groups = new Map<string, ScienceArticleImage[]>();
    for (const image of images) {
      if (!image.sourceUrl || image.reason) continue;
      groups.set(image.sourceUrl, [...(groups.get(image.sourceUrl) ?? []), image]);
    }
    const assets = new Map<string, Buffer>();
    const jobs = [...groups.entries()];
    let cursor = 0;
    let totalBytes = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        const index = cursor++;
        const [sourceUrl, references] = jobs[index]!;
        if (index >= MAX_SAVED_IMAGES) { for (const image of references) image.reason = "本篇离线图片数量达到上限，可查看原图"; continue; }
        try {
          const bytes = await boundedBytes(await this.sourceResponse(normalizeUrl(sourceUrl, true, articleUrl), true, articleUrl), MAX_IMAGE_BYTES);
          const mimeType = imageMime(bytes);
          if (!mimeType) throw new Error("此图格式暂不支持本机保存，可查看原图");
          if (totalBytes + bytes.byteLength > MAX_ARTICLE_MEDIA_BYTES) throw new Error("本篇离线图片大小达到上限，可查看原图");
          totalBytes += bytes.byteLength;
          const mediaId = createHash("sha256").update(bytes).digest("hex");
          assets.set(mediaId, bytes);
          for (const image of references) { image.status = "cached"; image.mediaId = mediaId; image.mimeType = mimeType; delete image.reason; }
        } catch (error) {
          for (const image of references) {
            image.status = "unavailable";
            image.reason = error instanceof Error ? error.message : "图片暂时无法保存，可重试或查看原图";
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
    return assets;
  }

  private async importOnce(rawUrl: string, force = false, requireAccessible = false): Promise<ScienceArticle | null> {
    const url = normalizeUrl(rawUrl);
    const existing = await this.readAll();
    const known = existing.find((article) => article.sourceUrl === url.toString());
    if (known && !SAFE_ID.test(known.id)) throw new Error("本机文章标识无效，未更新文章或图片");
    if (known?.contentVersion === 2 && !force) return known;
    if (!known && existing.length >= MAX_ARTICLES) throw new Error("本机科普文章库已达到 200 篇上限，请先移除文章");
    const html = (await boundedBytes(await this.sourceResponse(url), MAX_HTML_BYTES)).toString("utf8");
    const parsed = parseScienceArticle(html, url.toString());
    if (requireAccessible && !isAccessibleScienceArticle(parsed.blocks)) return null;
    if (JSON.stringify(parsed.blocks).length > 250_000) throw new Error("文章结构超过本机收录上限");
    const images = scienceArticleImages(parsed.blocks);
    const assets = await this.collectMedia(images, url.toString());
    // An offline image refresh must not discard a previously saved illustration.
    const previousImages = scienceArticleImages(known?.blocks ?? []);
    for (const image of images) {
      if (image.status !== "unavailable") continue;
      const previous = previousImages.find((item) => item.sourceUrl === image.sourceUrl && item.status === "cached");
      if (!previous?.mediaId || !SAFE_ID.test(previous.mediaId) || !previous.mimeType || !known || !SAFE_ID.test(known.id)) continue;
      const saved = await readFile(path.join(this.mediaDir, known.id, previous.mediaId)).catch(() => null);
      if (!saved) continue;
      image.status = "cached"; image.mediaId = previous.mediaId; image.mimeType = previous.mimeType;
      image.reason = "此次图片更新失败，已保留此前保存的原图";
    }
    const now = new Date().toISOString();
    const host = url.hostname;
    const sourceName = host === "spaceplace.nasa.gov" ? "NASA Space Place" : host === "climatekids.nasa.gov" ? "NASA Climate Kids" : host === "bitcoin.org" ? "Bitcoin.org" : host === "www.nps.gov" ? "National Park Service" : host === "www.open.edu" ? "OpenLearn · The Open University" : host === "ourworldindata.org" || host === "www.ourworldindata.org" ? "Our World in Data" : "NOAA Ocean Facts";
    const credit = host === "spaceplace.nasa.gov" ? "Courtesy: NASA Space Place; local personal reading copy" : host === "climatekids.nasa.gov" ? "Courtesy: NASA Climate Kids; local personal reading copy" : host === "bitcoin.org" ? "Bitcoin.org; private local reading copy, not for redistribution" : host === "www.nps.gov" ? "Courtesy: National Park Service (NPS)" : host === "www.open.edu" ? "The Open University, OpenLearn · CC BY-NC-SA 4.0" : host === "ourworldindata.org" || host === "www.ourworldindata.org" ? `${parsed.author || "Our World in Data authors"}; Our World in Data · CC BY 4.0` : "Courtesy: National Oceanic and Atmospheric Administration (NOAA)";
    const record: ScienceArticle = {
      id: known?.id ?? createHash("sha256").update(url.toString()).digest("hex"),
      ...parsed, sourceName, sourceUrl: url.toString(), credit,
      savedAt: known?.savedAt ?? now, updatedAt: now, contentVersion: 2,
    };
    const articleDir = path.join(this.mediaDir, record.id);
    const written: string[] = [];
    try {
      if (assets.size) await mkdir(articleDir, { recursive: true });
      for (const [mediaId, bytes] of assets) {
        const file = path.join(articleDir, mediaId);
        const previousBytes = await readFile(file).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
        if (previousBytes?.equals(bytes)) continue;
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, bytes, { flag: "wx" });
          await rename(temporary, file);
          if (!previousBytes) written.push(file);
        } finally { await rm(temporary, { force: true }); }
      }
      await this.writeAll([record, ...existing.filter((article) => article.id !== record.id)]);
    } catch (error) {
      await Promise.all(written.map((file) => rm(file, { force: true })));
      throw error;
    }
    // Keep only media referenced by the committed snapshot, including after a refresh.
    const currentIds = new Set(images.flatMap((image) => image.mediaId ? [image.mediaId] : []));
    const oldFiles = await readdir(articleDir).catch(() => [] as string[]);
    await Promise.all(oldFiles.filter((file) => SAFE_ID.test(file) && !currentIds.has(file)).map((file) => rm(path.join(articleDir, file), { force: true }).catch(() => undefined)));
    return record;
  }

  async getMedia(articleId: string, mediaId: string): Promise<{ data: Buffer; mimeType: string } | null> {
    if (!SAFE_ID.test(articleId) || !SAFE_ID.test(mediaId)) return null;
    const article = (await this.readAll()).find((record) => record.id === articleId);
    const image = article && scienceArticleImages(article.blocks ?? []).find((item) => item.status === "cached" && item.mediaId === mediaId);
    if (!image?.mimeType || !MIME_TYPES.has(image.mimeType)) return null;
    try { return { data: await readFile(path.join(this.mediaDir, articleId, mediaId)), mimeType: image.mimeType }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  delete(id: string): Promise<boolean> {
    return this.withMutation(async () => {
      const existing = await this.readAll();
      if (!existing.some((article) => article.id === id)) return false;
      await this.writeAll(existing.filter((article) => article.id !== id));
      if (SAFE_ID.test(id)) await rm(path.join(this.mediaDir, id), { recursive: true, force: true });
      return true;
    });
  }

  private withMutation<T>(task: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(task);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readAll(): Promise<ScienceArticle[]> {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as { version?: unknown; articles?: unknown };
      if (parsed.version !== 1 || !Array.isArray(parsed.articles)) throw new Error("本机科普文章库格式无效");
      return parsed.articles as ScienceArticle[];
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }

  private async writeAll(articles: ScienceArticle[]): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify({ version: 1, articles }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporary, this.statePath);
    } finally { await rm(temporary, { force: true }); }
  }
}
