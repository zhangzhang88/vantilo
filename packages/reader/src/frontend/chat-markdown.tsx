import type { ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  const pattern = /(\*\*[^*]+?\*\*|__[^_]+?__|`[^`]+`|\*[^*\n]+?\*|_[^_\n]+?_)/g;
  return text.split(pattern).filter(Boolean).map((part, index) => {
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return part.split("\n").flatMap((line, lineIndex) => lineIndex === 0 ? [line] : [<br key={`${index}-${lineIndex}`} />, line]);
  });
}

export function ChatMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) { index += 1; continue; }

    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index] ?? "")) code.push(lines[index++] ?? "");
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`code-${index}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 2;
      const content = renderInline(heading[2] ?? "");
      if (level === 1) blocks.push(<h3 key={`heading-${index}`}>{content}</h3>);
      else if (level === 2) blocks.push(<h4 key={`heading-${index}`}>{content}</h4>);
      else blocks.push(<h5 key={`heading-${index}`}>{content}</h5>);
      index += 1;
      continue;
    }

    const listType = /^\s*[-*+]\s+/.test(line) ? "ul" : /^\s*\d+[.)]\s+/.test(line) ? "ol" : null;
    if (listType) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = listType === "ul" ? /^\s*[-*+]\s+(.+)$/.exec(lines[index] ?? "") : /^\s*\d+[.)]\s+(.+)$/.exec(lines[index] ?? "");
        if (!item) break;
        items.push(<li key={`item-${index}`}>{renderInline(item[1] ?? "")}</li>);
        index += 1;
      }
      blocks.push(listType === "ul" ? <ul key={`list-${index}`}>{items}</ul> : <ol key={`list-${index}`}>{items}</ol>);
      continue;
    }

    if (/^\s*&gt;|^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index] ?? "")) quote.push((lines[index++] ?? "").replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={`quote-${index}`}><p>{renderInline(quote.join("\n"))}</p></blockquote>);
      continue;
    }

    const emphasizedHeading = /^\s*(?:\*\*(.+?)\*\*|__(.+?)__)\s*$/.exec(line);
    if (emphasizedHeading) {
      blocks.push(<h5 key={`emphasis-heading-${index}`}>{renderInline(emphasizedHeading[1] ?? emphasizedHeading[2] ?? "")}</h5>);
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim()) paragraph.push(lines[index++] ?? "");
    blocks.push(<p key={`paragraph-${index}`}>{renderInline(paragraph.join("\n"))}</p>);
  }
  return <div className="chat-markdown">{blocks}</div>;
}
