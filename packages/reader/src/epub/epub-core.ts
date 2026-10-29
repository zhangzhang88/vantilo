import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import * as cheerio from "cheerio";
import { publicationFromFilename, publicationIssueId } from "../shared/publication.js";
import type { IssueFile } from "../shared/types.js";

const posix = path.posix;

export interface EpubNavItem {
  section: string;
  title: string;
  href: string;
}

export interface OpenedEpub {
  zip: JSZip;
  packagePath: string;
  packageXml: string;
  packageTitle: string | null;
  navigationPath: string;
  navigationType: "nav" | "ncx";
  navItems: EpubNavItem[];
}

export interface EpubCoverAsset {
  data: Buffer;
  mediaType: string;
  entryPath: string;
}

export function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function countWords(value: string): number {
  return value.match(/[A-Za-z0-9]+(?:[’'][A-Za-z0-9]+)*/g)?.length ?? 0;
}

export function dateFromFilename(filename: string): string | null {
  const match = filename.match(/(\d{4})[._-](\d{2})[._-](\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function dateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export async function scanIssueFiles(issuesDir: string): Promise<IssueFile[]> {
  const entries = await readdir(issuesDir, { withFileTypes: true }).catch(() => []);
  const files: IssueFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLocaleLowerCase("en-US").endsWith(".epub")) continue;
    const publication = publicationFromFilename(entry.name);
    const date = dateFromFilename(entry.name);
    if (!publication || !date) continue;
    const filePath = path.join(issuesDir, entry.name);
    const info = await stat(filePath);
    files.push({
      id: publicationIssueId(publication.id, date),
      publicationId: publication.id,
      publicationName: publication.name,
      date,
      label: dateLabel(date),
      filename: entry.name,
      filePath,
      fingerprint: `${info.size}:${Math.trunc(info.mtimeMs)}`,
    });
  }

  return files.sort((a, b) => b.date.localeCompare(a.date) || a.publicationName.localeCompare(b.publicationName));
}

async function zipText(zip: JSZip, entryPath: string): Promise<string> {
  const normalized = entryPath.replace(/^\//, "");
  const entry = zip.file(normalized);
  if (!entry) throw new Error(`EPUB entry not found: ${normalized}`);
  return entry.async("text");
}

function packagePathFromContainer(containerXml: string): string {
  const $ = cheerio.load(containerXml, { xmlMode: true });
  const rootfile = $("rootfile").first().attr("full-path");
  if (!rootfile) throw new Error("EPUB container does not declare a package document");
  return rootfile;
}

function packageTitle(packageXml: string): string | null {
  const $ = cheerio.load(packageXml, { xmlMode: true });
  const metadata = $("metadata").first();
  const titleElement = metadata.children().toArray().find((element) => element.tagName.toLowerCase().endsWith("title"));
  return titleElement ? normalizeSpace($(titleElement).text()) : null;
}

function coverFromPackage(packageXml: string, packagePath: string): { entryPath: string; mediaType: string } | null {
  const $ = cheerio.load(packageXml, { xmlMode: true });
  const manifest = $("manifest item").toArray();
  let coverItem = manifest.find((element) => ($(element).attr("properties") ?? "").split(/\s+/).includes("cover-image"));

  if (!coverItem) {
    const coverId = $("metadata meta[name='cover']").first().attr("content");
    if (coverId) coverItem = manifest.find((element) => $(element).attr("id") === coverId);
  }
  if (!coverItem) {
    coverItem = manifest.find((element) => {
      const id = $(element).attr("id") ?? "";
      const mediaType = $(element).attr("media-type") ?? "";
      return id.toLocaleLowerCase("en-US") === "cover" && mediaType.startsWith("image/");
    });
  }
  if (!coverItem) {
    coverItem = manifest.find((element) => {
      const href = $(element).attr("href") ?? "";
      const mediaType = $(element).attr("media-type") ?? "";
      return mediaType.startsWith("image/") && /(^|[\/_\-.])cover([\/_\-.]|$)/i.test(href);
    });
  }
  if (!coverItem) return null;

  const href = $(coverItem).attr("href");
  const mediaType = $(coverItem).attr("media-type") ?? "";
  if (!href || !mediaType.startsWith("image/")) return null;
  return {
    entryPath: posix.normalize(posix.join(posix.dirname(packagePath), href)),
    mediaType,
  };
}

function navigationFromPackage(packageXml: string, packagePath: string): { path: string; type: "nav" | "ncx" } | null {
  const $ = cheerio.load(packageXml, { xmlMode: true });
  const manifest = $("manifest item").toArray();
  const navItem = manifest.find((element) => ($(element).attr("properties") ?? "").split(/\s+/).includes("nav"));
  if (navItem) {
    const href = $(navItem).attr("href");
    if (href) return { path: posix.normalize(posix.join(posix.dirname(packagePath), href)), type: "nav" };
  }
  const ncxItem = manifest.find((element) => $(element).attr("media-type") === "application/x-dtbncx+xml" || $(element).attr("id") === "ncx");
  if (ncxItem) {
    const href = $(ncxItem).attr("href");
    if (href) return { path: posix.normalize(posix.join(posix.dirname(packagePath), href)), type: "ncx" };
  }
  return null;
}

function pushNavItem(items: EpubNavItem[], seen: Set<string>, section: string, title: string, rawHref: string | undefined) {
  if (!rawHref) return;
  const href = rawHref.split("#")[0];
  if (!href || seen.has(href)) return;
  const cleanTitle = normalizeSpace(title);
  if (!cleanTitle) return;
  seen.add(href);
  items.push({ section: normalizeSpace(section) || "Other", title: cleanTitle, href });
}

export function parseEpub3Navigation(navXml: string): EpubNavItem[] {
  const $ = cheerio.load(navXml, { xmlMode: true });
  const nav = $("nav").first();
  const items: EpubNavItem[] = [];
  const seen = new Set<string>();

  nav.children("ol").first().children("li").each((_, element) => {
    const node = $(element);
    const label = normalizeSpace(node.children("span").first().text())
      || normalizeSpace(node.children("a").first().text())
      || "Other";
    const nested = node.children("ol").first().find("a[href]").toArray();
    if (nested.length) {
      for (const anchorElement of nested) {
        const anchor = $(anchorElement);
        pushNavItem(items, seen, label, anchor.text(), anchor.attr("href"));
      }
      return;
    }
    const anchor = node.children("a[href]").first();
    if (anchor.length) pushNavItem(items, seen, "Other", anchor.text(), anchor.attr("href"));
  });
  return items;
}

export function parseNcxNavigation(ncxXml: string): EpubNavItem[] {
  const $ = cheerio.load(ncxXml, { xmlMode: true });
  const items: EpubNavItem[] = [];
  const seen = new Set<string>();
  const top = $("navMap").children("navPoint").toArray();

  for (const topElement of top) {
    const node = $(topElement);
    const label = normalizeSpace(node.children("navLabel").first().text()) || "Other";
    const children = node.children("navPoint").toArray();
    if (children.length) {
      for (const child of children) {
        const childNode = $(child);
        const childTitle = normalizeSpace(childNode.children("navLabel").first().text());
        pushNavItem(items, seen, label, childTitle, childNode.children("content").first().attr("src"));
        childNode.find("navPoint").each((_, descendant) => {
          const descendantNode = $(descendant);
          pushNavItem(
            items,
            seen,
            label,
            descendantNode.children("navLabel").first().text(),
            descendantNode.children("content").first().attr("src"),
          );
        });
      }
    } else {
      pushNavItem(items, seen, "Other", label, node.children("content").first().attr("src"));
    }
  }
  return items;
}

export async function openEpub(issueFile: IssueFile): Promise<OpenedEpub> {
  const zip = await JSZip.loadAsync(await readFile(issueFile.filePath));
  const containerXml = await zipText(zip, "META-INF/container.xml");
  const packagePath = packagePathFromContainer(containerXml);
  const packageXml = await zipText(zip, packagePath);
  const navigation = navigationFromPackage(packageXml, packagePath);
  if (!navigation) throw new Error(`EPUB navigation not found: ${issueFile.filename}`);
  const navigationXml = await zipText(zip, navigation.path);
  const navItems = navigation.type === "nav" ? parseEpub3Navigation(navigationXml) : parseNcxNavigation(navigationXml);
  return {
    zip,
    packagePath,
    packageXml,
    packageTitle: packageTitle(packageXml),
    navigationPath: navigation.path,
    navigationType: navigation.type,
    navItems,
  };
}

export async function readEpubCover(issueFile: IssueFile): Promise<EpubCoverAsset | null> {
  const opened = await openEpub(issueFile);
  const cover = coverFromPackage(opened.packageXml, opened.packagePath);
  if (!cover) return null;
  const entry = opened.zip.file(cover.entryPath);
  if (!entry) return null;
  return {
    ...cover,
    data: await entry.async("nodebuffer"),
  };
}

export function resolveNavigationHref(navigationPath: string, href: string): string {
  return posix.normalize(posix.join(posix.dirname(navigationPath), href));
}
