import React, { useEffect, useRef, useState } from "react";
import { scienceArticleMediaUrl, type ScienceArticle, type ScienceArticleBlock, type ScienceArticleImage } from "../shared/science-article";

function sourceLink(raw: string | null | undefined, fallback: string): string {
  try { const url = new URL(raw || fallback); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "#"; }
  catch { return "#"; }
}

function localImageUrl(articleId: string, image: ScienceArticleImage): string | null {
  return image.status === "cached" && /^[a-f0-9]{64}$/.test(articleId) && /^[a-f0-9]{64}$/.test(image.mediaId ?? "")
    ? scienceArticleMediaUrl(articleId, image.mediaId!) : null;
}

function ArticleImage({ articleId, image, sourceUrl, onExpand }: {
  articleId: string; image: ScienceArticleImage; sourceUrl: string; onExpand: (image: ScienceArticleImage) => void;
}) {
  const [failed, setFailed] = useState(false);
  const localUrl = localImageUrl(articleId, image);
  return <div className="science-article-image">
    {localUrl && !failed ? <>
      <button className="science-image-open" aria-label={`放大查看：${image.alt || "原文图片"}`} onClick={() => onExpand(image)}>
        <img src={localUrl} alt={image.alt} width={image.width} height={image.height} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </button>
      <span className="science-image-hint">点击查看大图</span>
      {image.reason && <small>{image.reason}</small>}
    </> : <div className="science-image-fallback" role="note">
      <strong>{image.alt || "原文图片或图表"}</strong>
      <p>{failed ? "本机图片暂时无法显示，可补全图文后重试" : image.reason || "此图暂未保存"}</p>
      <a href={sourceLink(image.sourceUrl, sourceUrl)} target="_blank" rel="noreferrer">在原站查看图片 ↗</a>
    </div>}
  </div>;
}

function ArticleBlocks({ blocks, articleId, sourceUrl, onExpand }: {
  blocks: ScienceArticleBlock[]; articleId: string; sourceUrl: string; onExpand: (image: ScienceArticleImage) => void;
}) {
  const nested = (items: ScienceArticleBlock[]) => <ArticleBlocks blocks={items} articleId={articleId} sourceUrl={sourceUrl} onExpand={onExpand} />;
  return <>{blocks.map((block, index) => {
    if (block.kind === "paragraph") return <p key={index}>{block.text}</p>;
    if (block.kind === "heading") {
      const Heading = `h${block.level}` as "h2" | "h3" | "h4";
      return <Heading key={index}>{block.text}</Heading>;
    }
    if (block.kind === "list") {
      const List = block.ordered ? "ol" : "ul";
      return <List key={index}>{block.items.map((item, i) => <li key={i}>{nested(item)}</li>)}</List>;
    }
    if (block.kind === "figure") {
      const caption = block.caption ? <figcaption>{block.caption}</figcaption> : null;
      return <figure className="science-article-figure" key={index}>
        {block.captionPlacement === "before" && caption}
        {block.images.map((image) => <ArticleImage key={`${image.id}:${image.mediaId ?? image.status}`} articleId={articleId} image={image} sourceUrl={sourceUrl} onExpand={onExpand} />)}
        {block.captionPlacement !== "before" && caption}
      </figure>;
    }
    if (block.kind === "table") {
      const groups: { section: "head" | "body" | "foot"; rows: typeof block.rows }[] = [];
      for (const row of block.rows) {
        const previous = groups[groups.length - 1];
        if (previous?.section === row.section) previous.rows.push(row);
        else groups.push({ section: row.section, rows: [row] });
      }
      return <div className="science-article-table" key={index} tabIndex={0} role="region" aria-label={block.caption || "原文表格，可横向滚动"}>
        <table>{block.caption && <caption>{block.caption}</caption>}{groups.map((group, i) => {
          const Group = group.section === "head" ? "thead" : group.section === "foot" ? "tfoot" : "tbody";
          return <Group key={i}>{group.rows.map((row, r) => <tr key={r}>{row.cells.map((cell, c) => {
            const Cell = cell.header ? "th" : "td";
            return <Cell key={c} rowSpan={cell.rowSpan} colSpan={cell.colSpan}>{nested(cell.blocks)}</Cell>;
          })}</tr>)}</Group>;
        })}</table>
      </div>;
    }
    return <div className="science-image-fallback" key={index}><p>{block.label}</p><a href={sourceLink(sourceUrl, sourceUrl)} target="_blank" rel="noreferrer">查看原文 ↗</a></div>;
  })}</>;
}

export function ScienceArticleContent({ article }: { article: ScienceArticle }) {
  const [expanded, setExpanded] = useState<ScienceArticleImage | null>(null);
  const [originalSize, setOriginalSize] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (expanded) dialog.current?.showModal();
    else dialog.current?.close();
  }, [expanded]);
  const blocks: ScienceArticleBlock[] = article.blocks ?? article.paragraphs.map((text) => ({ kind: "paragraph", text }));
  const expand = (image: ScienceArticleImage) => { setOriginalSize(false); setExpanded(image); };
  const expandedUrl = expanded && localImageUrl(article.id, expanded);
  return <>
    <div className="science-article-body"><ArticleBlocks blocks={blocks} articleId={article.id} sourceUrl={article.sourceUrl} onExpand={expand} /></div>
    <dialog className="science-image-dialog" ref={dialog} aria-label="查看原图" onClose={() => setExpanded(null)} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <header><strong>{expanded?.alt || "原文图片"}</strong><div>
        <button className="text-button" onClick={() => setOriginalSize((value) => !value)}>{originalSize ? "适应窗口" : "原始尺寸"}</button>
        <button className="text-button" aria-label="关闭原图" onClick={() => dialog.current?.close()}>关闭</button>
      </div></header>
      <div className={`science-image-zoom${originalSize ? " is-original-size" : ""}`}>{expandedUrl && <img src={expandedUrl} alt={expanded?.alt || "原文图片"} />}</div>
    </dialog>
  </>;
}
