export function adaptReaderSource(
  source: string,
  filename: string,
  options?: {
    qwenPreview?: boolean;
    translationPreview?: boolean;
    catalogPreview?: boolean;
  },
): string;

export function readerVariantPlugin(): {
  name: string;
  enforce: "pre";
  transform(source: string, id: string): null | { code: string; map: null };
};
