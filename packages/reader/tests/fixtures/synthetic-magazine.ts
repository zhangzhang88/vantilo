import JSZip from "jszip";

/** Deterministic, entirely synthetic publication issue for offline parser/service tests. */
const cover = Buffer.concat([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS2cAAAAASUVORK5CYII=", "base64"), Buffer.alloc(1536, 0x31)]);
const image = Buffer.concat([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS2cAAAAASUVORK5CYII=", "base64"), Buffer.alloc(1200, 0x44)]);
const prose = "This synthetic article describes how a small group studies a changing world. Researchers compare careful observations, explain what the evidence can show, and note what remains uncertain. Readers can use these details to understand the topic without relying on any real publication or copyrighted article.";

export async function syntheticMagazineEpub(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
  const items = Array.from({ length: 12 }, (_, i) => `<item id="a${i}" href="Text/a${i}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const nav = [0, 1].map(section => `<li><span>${section === 0 ? "Features" : "Culture"}</span><ol>${Array.from({ length: 6 }, (_, offset) => section * 6 + offset).map(i => `<li><a href="Text/a${i}.xhtml#article">Synthetic Article ${i + 1}</a></li>`).join("")}</ol></li>`).join("");
  zip.file("OEBPS/content.opf", `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0"><metadata><dc:title>The Economist — Synthetic Test Issue</dc:title><dc:language>en</dc:language><dc:identifier>vantilo-synthetic-magazine</dc:identifier><meta name="cover" content="cover"/></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="Images/cover.png" media-type="image/png"/>${items}${Array.from({ length: 3 }, (_, i) => `<item id="img${i}" href="Images/article-${i}.png" media-type="image/png"/>`).join("")}</manifest><spine>${Array.from({ length: 12 }, (_, i) => `<itemref idref="a${i}"/>`).join("")}</spine></package>`);
  zip.file("OEBPS/nav.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><body><nav><ol>${nav}</ol></nav></body></html>`);
  for (let i = 0; i < 12; i++) {
    const images = i === 0 ? `<img class="te_head_image" src="../Images/article-0.png" alt="Synthetic lead"/><p>${prose}</p><img src="../Images/article-1.png" alt="Synthetic inline one"/><p>${prose}</p><img src="../Images/article-2.png" alt="Synthetic inline two"/><p>${prose}</p>` : `<p>${prose}</p><p>${prose}</p>`;
    zip.file(`OEBPS/Text/a${i}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Synthetic Article ${i + 1}</title></head><body><h1 class="te_article_title" id="article">Synthetic Article ${i + 1}</h1><h3 class="te_article_rubric">Original test fixture</h3><p class="te_article_author">By Synthetic Author</p>${images}</body></html>`);
  }
  zip.file("OEBPS/Images/cover.png", cover);
  for (let i = 0; i < 3; i++) zip.file(`OEBPS/Images/article-${i}.png`, image);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
