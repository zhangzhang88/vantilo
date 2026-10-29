import React, { type ReactNode } from "react";
import type { ReadingDocumentTable, ReadingDocumentVisual } from "../shared/book-data-contract";
import type { ReadingDocumentIdentity } from "../shared/reading-document-identity";
import { BookVisual } from "./book-visual";

export function tableParagraphIndexes(table: ReadingDocumentTable): number[] {
  return [...table.captionParagraphIndexes, ...table.rows.flatMap(row => row.cells.flatMap(cell => cell.paragraphIndexes))];
}

export function BookTable({ table, renderParagraph }: { table: ReadingDocumentTable; renderParagraph: (index: number) => ReactNode }) {
  const groups: Array<{ section: "head" | "body" | "foot"; rows: ReadingDocumentTable["rows"] }> = [];
  for (const row of table.rows) {
    if (groups.at(-1)?.section === row.section) groups.at(-1)!.rows.push(row);
    else groups.push({ section: row.section, rows: [row] });
  }
  return <div className="book-table-scroll" tabIndex={0} role="region" aria-label="原书表格">
    <table className="book-table" data-book-table={table.id}>
      {table.captionParagraphIndexes.length > 0 && <caption>{table.captionParagraphIndexes.map(index => <React.Fragment key={index}>{renderParagraph(index)}</React.Fragment>)}</caption>}
      {groups.map((group, groupIndex) => {
        const Group = group.section === "head" ? "thead" : group.section === "foot" ? "tfoot" : "tbody";
        return <Group key={groupIndex}>{group.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.cells.map((cell, cellIndex) => {
          const Cell = cell.header ? "th" : "td";
          return <Cell key={cellIndex} colSpan={cell.colSpan} rowSpan={cell.rowSpan} scope={cell.header ? cell.scope : undefined}>
            {cell.paragraphIndexes.map(index => <React.Fragment key={index}>{renderParagraph(index)}</React.Fragment>)}
            {cell.images.map((image, index) => /^data:image\/(?:png|jpeg|gif|webp);base64,/.test(image.dataUrl)
              ? <img key={index} src={image.dataUrl} alt={image.alt} width={image.width} height={image.height}
                  className={image.height && image.height <= 2 && image.width && image.width >= 10 ? "book-table-rule-image" : undefined} /> : null)}
          </Cell>;
        })}</tr>)}</Group>;
      })}
    </table>
  </div>;
}

/** Place source tables among the same paragraphs without duplicating text or changing anchors. */
export function renderBookLayout({ paragraphs, tables = [], visuals = [], identity }: { paragraphs: string[]; tables?: ReadingDocumentTable[]; visuals?: ReadingDocumentVisual[]; identity?: ReadingDocumentIdentity }, renderParagraph: (index: number) => ReactNode, beforeParagraph?: (index: number) => ReactNode, renderCaption = renderParagraph): ReactNode {
  if (!tables.length && !visuals.length) return paragraphs.map((_, index) => <React.Fragment key={index}>{beforeParagraph?.(index)}{renderParagraph(index)}</React.Fragment>);
  const covered = new Set([...tables.flatMap(tableParagraphIndexes), ...visuals.flatMap(visual => [...visual.coveredParagraphIndexes, ...visual.captionParagraphIndexes])]);
  type Placement = { kind: "table"; item: ReadingDocumentTable } | { kind: "visual"; item: ReadingDocumentVisual };
  const before = new Map<number, Placement[]>();
  const placements: Placement[] = [...tables.map(item => ({ kind: "table" as const, item })), ...visuals.map(item => ({ kind: "visual" as const, item }))];
  placements.sort((left, right) => (left.item.sourceOrder ?? 0) - (right.item.sourceOrder ?? 0));
  for (const placement of placements) before.set(placement.item.beforeParagraphIndex, [...before.get(placement.item.beforeParagraphIndex) ?? [], placement]);
  return Array.from({ length: paragraphs.length + 1 }, (_, index) => <React.Fragment key={index}>
    {(before.get(index) ?? []).map(placement => {
      if (placement.kind === "visual") {
        const visual = placement.item;
        const first = visual.coveredParagraphIndexes[0] ?? visual.captionParagraphIndexes[0];
        return identity ? <React.Fragment key={visual.id}>{first === undefined ? null : beforeParagraph?.(first)}<BookVisual visual={visual} identity={identity} renderCaption={renderCaption} /></React.Fragment> : null;
      }
      const table = placement.item, first = tableParagraphIndexes(table)[0];
      return <React.Fragment key={table.id}>{first === undefined ? null : beforeParagraph?.(first)}<BookTable table={table}
        renderParagraph={paragraphIndex => <>{paragraphIndex !== first ? beforeParagraph?.(paragraphIndex) : null}{renderParagraph(paragraphIndex)}</>} /></React.Fragment>;
    })}
    {index < paragraphs.length && !covered.has(index) ? <>{beforeParagraph?.(index)}{renderParagraph(index)}</> : null}
  </React.Fragment>);
}
