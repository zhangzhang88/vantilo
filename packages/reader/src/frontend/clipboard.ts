export interface ClipboardCopyAdapters {
  writeText?: (text: string) => Promise<void>;
  fallbackCopy?: (text: string) => boolean;
}

export type ClipboardCopyMethod = "clipboard" | "fallback";

function browserClipboardWriter(): ((text: string) => Promise<void>) | undefined {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return undefined;
  return navigator.clipboard.writeText.bind(navigator.clipboard);
}

function browserFallbackCopy(text: string): boolean {
  if (typeof document === "undefined" || !document.body || typeof document.execCommand !== "function") return false;

  const textarea = document.createElement("textarea");
  const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    previousActiveElement?.focus();
  }
}

export async function copyTextToClipboard(
  text: string,
  adapters: ClipboardCopyAdapters = {},
): Promise<ClipboardCopyMethod> {
  if (!text) throw new Error("没有可复制的内容。");

  const writeText = adapters.writeText ?? browserClipboardWriter();
  if (writeText) {
    try {
      await writeText(text);
      return "clipboard";
    } catch {
      // Clipboard API can be unavailable or denied. Fall through to the local DOM fallback.
    }
  }

  const fallbackCopy = adapters.fallbackCopy ?? browserFallbackCopy;
  if (fallbackCopy(text)) return "fallback";
  throw new Error("无法复制到剪贴板。");
}
