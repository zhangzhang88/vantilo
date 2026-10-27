import type { Components } from 'react-markdown';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/parseOnly';

function safeWebAddress(value?: string) {
  if (!value) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export function MarkdownView({ text }: { text: string }) {
  const renderers: Components = {
    a: ({ href, title, children }) => {
      const address = safeWebAddress(href);
      return address ? <span className="markdown-external-link" title={title || address}>{children}</span> : <span>{children}</span>;
    },
    img: ({ alt }) => alt ? <span className="markdown-image-caption">[图片：{alt}]</span> : null,
    table: ({ children }) => <div className="markdown-table-scroll"><table>{children}</table></div>,
  };
  return <div className="conversation-markdown"><Markdown remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkCjkFriendlyGfmStrikethrough]} components={renderers}>{text}</Markdown></div>;
}
