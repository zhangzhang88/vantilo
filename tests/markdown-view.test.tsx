import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownView } from '../src/ui/markdown-view';

describe('MarkdownView', () => {
  it('renders CJK-adjacent emphasis instead of exposing asterisks', () => {
    const html = renderToStaticMarkup(<MarkdownView text="建议**确定**后，**粗体。**接着" />);
    expect(html).toContain('<strong>确定</strong>');
    expect(html).toContain('<strong>粗体。</strong>');
    expect(html).not.toContain('**');
  });

  it('renders GFM lists, tables, strikethrough and inline code', () => {
    const text = ['- 第一项', '- 第二项', '', '| 项目 | 状态 |', '| --- | --- |', '| 构建 | 通过 |', '', '~~旧说明~~ `npm test`'].join('\n');
    const html = renderToStaticMarkup(<MarkdownView text={text} />);
    expect(html).toContain('<ul>');
    expect(html).toContain('<table>');
    expect(html).toContain('<del>旧说明</del>');
    expect(html).toContain('<code>npm test</code>');
  });

  it('routes safe web links through the isolated browser and does not render raw HTML', () => {
    const onOpenLink = vi.fn();
    const html = renderToStaticMarkup(<MarkdownView text={'[文档](https://example.com) <script>alert(1)</script>'} onOpenLink={onOpenLink} />);
    expect(html).toContain('button');
    expect(html).toContain('文档');
    expect(html).not.toContain('<script>');
    expect(onOpenLink).not.toHaveBeenCalled();
  });
});
