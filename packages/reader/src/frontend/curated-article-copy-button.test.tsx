// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CuratedArticleCopyButton } from "./curated-article-copy-button";
import { copyTextToClipboard } from "./clipboard";

vi.mock("./clipboard", () => ({ copyTextToClipboard: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("copies every character of the original English article, preserving paragraph breaks and excluding Chinese notes", async () => {
  const english="The morning was calm.\n\nSuddenly, the wind changed.\nThe travelers stopped.";
  vi.mocked(copyTextToClipboard).mockResolvedValue("clipboard");
  render(<CuratedArticleCopyButton english={english} />);
  fireEvent.click(screen.getByRole("button",{name:"复制英文文章"}));
  await waitFor(()=>expect(copyTextToClipboard).toHaveBeenCalledWith(english));
  expect(screen.getByRole("button",{name:"已复制英文文章"})).toBeTruthy();
  expect(copyTextToClipboard).toHaveBeenCalledTimes(1);
});

it("reports a clipboard permission failure and allows retry without modifying the article", async()=>{
  const english="A short article.";
  vi.mocked(copyTextToClipboard).mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce("fallback");
  render(<CuratedArticleCopyButton english={english} />);
  fireEvent.click(screen.getByRole("button",{name:"复制英文文章"}));
  expect(await screen.findByRole("button",{name:"复制失败，点击重试"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"复制失败，点击重试"}));
  expect(await screen.findByRole("button",{name:"已复制英文文章"})).toBeTruthy();
  expect(vi.mocked(copyTextToClipboard).mock.calls).toEqual([[english],[english]]);
});
