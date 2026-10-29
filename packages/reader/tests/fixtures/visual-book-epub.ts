import JSZip from "jszip";

/** Creates a deterministic synthetic EPUB exclusively for parser tests. */
export const chartPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS2cAAAAASUVORK5CYII=", "base64");

export async function visualBookEpub(options: { body?: string; fixedLayout?: boolean; secondChapter?: boolean } = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
  const chapters = options.secondChapter
    ? '<item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/><item id="chapter2" href="Text/chapter.xhtml#two" media-type="application/xhtml+xml"/>'
    : '<item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/>';
  zip.file("OEBPS/content.opf", `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0"><metadata><dc:title>Synthetic Visual Fixture</dc:title><dc:language>en</dc:language><dc:identifier>fixture</dc:identifier>${options.fixedLayout ? '<meta property="rendition:layout">pre-paginated</meta>' : ""}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="style" href="style.css" media-type="text/css"/>${chapters}<item id="chart" href="Images/chart.png" media-type="image/png"/></manifest><spine><itemref idref="chapter"/></spine></package>`);
  const nav = options.secondChapter
    ? '<nav><ol><li><a href="Text/chapter.xhtml#chapter">1 Figures</a></li><li><a href="Text/chapter.xhtml#two">2 More figures</a></li></ol></nav>'
    : '<nav><ol><li><a href="Text/chapter.xhtml#chapter">1 Visual evidence</a></li></ol></nav>';
  zip.file("OEBPS/nav.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><body>${nav}</body></html>`);
  const body = options.body ?? '<h1 id="chapter">1 Visual evidence<a href="#chapter"></a></h1><p>Opening source paragraph.</p><div class="image" id="photo"><img src="../Images/chart.png" alt="Red and blue bars"/></div><p class="Figure-Caption">Figure 1. Red and blue bars.</p><p>Middle source paragraph.</p><svg id="standalone-svg"></svg><p id="equation">Formula: E=m<math><msup><mi>c</mi><mn>2</mn></msup></math> in its original context.</p><div class="layout-wrapper"><div id="complex-layout"><span></span></div></div><p id="vector-table"><svg><rect fill="#bd3546"/></svg>Vector table label</p><div class="image" id="missing"><img src="../Images/missing.png"/></div><p class="Figure-Caption">Missing asset caption.</p><p>Closing source paragraph.</p>';
  const second = options.secondChapter && !options.body ? '<h2 id="two">2 More figures</h2><p>Second chapter.</p><img src="../Images/chart.png"/>' : '';
  const fixed = options.fixedLayout ? '<meta name="viewport" content="width=1200,height=1600"/>' : '';
  zip.file("OEBPS/Text/chapter.xhtml", `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head>${fixed}<link rel="stylesheet" href="../Styles/book.css"/></head><body>${body}${second}</body></html>`);
  zip.file("OEBPS/Styles/book.css", "body { font-family: sans-serif; } #complex-layout { position: absolute; } .image { background-image: url(../Images/chart.png); }");
  zip.file("OEBPS/Images/chart.png", chartPng);
  zip.file("OEBPS/Images/vector.svg", '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="teal"/></svg>');
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
