import { describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./clipboard";

describe("clipboard copy", () => {
  it("prefers the async Clipboard API", async () => {
    const writeText = vi.fn(async () => undefined);
    const fallbackCopy = vi.fn(() => true);

    await expect(copyTextToClipboard("A useful sentence.", { writeText, fallbackCopy })).resolves.toBe("clipboard");
    expect(writeText).toHaveBeenCalledWith("A useful sentence.");
    expect(fallbackCopy).not.toHaveBeenCalled();
  });

  it("falls back when Clipboard API writing fails", async () => {
    const writeText = vi.fn(async () => { throw new Error("denied"); });
    const fallbackCopy = vi.fn(() => true);

    await expect(copyTextToClipboard("Fallback text", { writeText, fallbackCopy })).resolves.toBe("fallback");
    expect(fallbackCopy).toHaveBeenCalledWith("Fallback text");
  });

  it("reports failure only after both copy paths fail", async () => {
    const writeText = vi.fn(async () => { throw new Error("denied"); });
    const fallbackCopy = vi.fn(() => false);

    await expect(copyTextToClipboard("Cannot copy", { writeText, fallbackCopy })).rejects.toThrow("无法复制到剪贴板");
  });
});
