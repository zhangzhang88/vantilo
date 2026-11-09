import { useState } from "react";
import { copyTextToClipboard } from "./clipboard";

/** Copies only the original curated English lesson, never its Chinese study notes. */
export function CuratedArticleCopyButton({ english }: { english: string }) {
  const [status,setStatus]=useState<"idle"|"copied"|"error">("idle");
  async function copy() {
    try { await copyTextToClipboard(english); setStatus("copied"); }
    catch { setStatus("error"); }
  }
  return <button
    type="button"
    className="toolbar-button reader-copy-english-button reader-focus-hidden"
    aria-label={status==="copied"?"已复制英文文章":status==="error"?"复制失败，点击重试":"复制英文文章"}
    title="复制完整英文正文，粘贴到 Practice Lab"
    onClick={()=>void copy()}
  ><span aria-hidden="true">⧉</span><span aria-live="polite">{status==="copied"?"已复制":status==="error"?"复制失败 · 重试":"复制英文文章"}</span></button>;
}
