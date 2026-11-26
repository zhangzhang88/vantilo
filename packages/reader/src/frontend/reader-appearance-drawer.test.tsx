// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReaderAppearanceDrawer } from "./reader-appearance-drawer";
import { DEFAULT_READER_PREFERENCES, type ReaderPreferences } from "./reader-preferences";

afterEach(cleanup);

describe("ReaderAppearanceDrawer", () => {
  it("switches layout mode, font family, font size slider, and paper tint swatches live", () => {
    const onChange = vi.fn();
    render(<ReaderAppearanceDrawer preferences={DEFAULT_READER_PREFERENCES} onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "双页模式" }));
    expect(onChange).toHaveBeenCalledWith({ layoutMode: "double" });

    fireEvent.change(screen.getByLabelText("阅读字体"), { target: { value: "sans" } });
    expect(onChange).toHaveBeenCalledWith({ fontFamily: "sans" });

    fireEvent.change(screen.getByLabelText("字号大小"), { target: { value: "21" } });
    expect(onChange).toHaveBeenCalledWith({ fontSize: 21 });

    fireEvent.change(screen.getByLabelText("左右边距"), { target: { value: "0" } });
    expect(onChange).toHaveBeenCalledWith({ horizontalMargin: 0 });

    fireEvent.click(screen.getByRole("button", { name: "减小左右边距" }));
    expect(onChange).toHaveBeenCalledWith({ horizontalMargin: 10 });

    fireEvent.click(screen.getByRole("button", { name: "增大左右边距" }));
    expect(onChange).toHaveBeenCalledWith({ horizontalMargin: 14 });

    fireEvent.click(screen.getByRole("radio", { name: "护眼鹅黄" }));
    expect(onChange).toHaveBeenCalledWith({ paperTint: "butter" });
  });

  it("shows only the 9 dark palettes in dark mode and only the 9 light palettes in light mode", () => {
    const onChange = vi.fn();
    const darkPrefs: ReaderPreferences = {
      ...DEFAULT_READER_PREFERENCES,
      theme: "night",
      themePreset: "dark",
    };
    render(<ReaderAppearanceDrawer preferences={darkPrefs} onChange={onChange} />);

    // Dark mode displays 3 layout cards + 9 dark swatches (no light swatch clutter).
    expect(screen.queryByRole("radio", { name: "护眼鹅黄" })).toBeNull();
    expect(screen.getAllByRole("radio").length).toBe(3 + 9);

    fireEvent.click(screen.getByRole("radio", { name: "暗玫瑰褐" }));
    expect(onChange).toHaveBeenCalledWith({ darkTint: "burgundy" });

    fireEvent.click(screen.getByRole("button", { name: "浅色主题" }));
    expect(onChange).toHaveBeenCalledWith({ themePreset: "light" });
  });

  it("exposes chinese indentation and learning toggles under more settings", () => {
    const onChange = vi.fn();
    render(<ReaderAppearanceDrawer preferences={DEFAULT_READER_PREFERENCES} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("中文段落首行缩进"));
    expect(onChange).toHaveBeenCalledWith({ chineseIndent: false });

    fireEvent.click(screen.getByRole("button", { name: "舒展" }));
    expect(onChange).toHaveBeenCalledWith({ lineHeight: "relaxed" });
  });
});
