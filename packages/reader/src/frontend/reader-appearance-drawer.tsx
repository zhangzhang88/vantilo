import {
  MAX_HORIZONTAL_MARGIN,
  MIN_HORIZONTAL_MARGIN,
  type AppThemePreset,
  type ReaderDarkTint,
  type ReaderFontFamily,
  type ReaderLayoutMode,
  type ReaderLineHeight,
  type ReaderPaperTint,
  type ReaderPreferences,
} from "./reader-preferences";

export const READER_LIGHT_TINTS: ReadonlyArray<{
  id: ReaderPaperTint;
  label: string;
  swatch: string;
}> = [
  { id: "default", label: "纯净白", swatch: "#ffffff" },
  { id: "silver", label: "柔和浅灰", swatch: "#e2e3e5" },
  { id: "parchment", label: "暖羊皮纸", swatch: "#f3e6c8" },
  { id: "sage", label: "护眼豆绿", swatch: "#d8e0c2" },
  { id: "blush", label: "樱花淡粉", swatch: "#f3d8d9" },
  { id: "mist", label: "清澈天蓝", swatch: "#d5e3f3" },
  { id: "ivory", label: "柔光米白", swatch: "#fbf2dc" },
  { id: "butter", label: "护眼鹅黄", swatch: "#f9ecc1" },
  { id: "slate", label: "冷雾蓝灰", swatch: "#eceef3" },
];

export const READER_DARK_TINTS: ReadonlyArray<{
  id: ReaderDarkTint;
  label: string;
  swatch: string;
}> = [
  { id: "pitch", label: "纯粹深黑", swatch: "#101114" },
  { id: "obsidian", label: "石墨深灰", swatch: "#2a2b2d" },
  { id: "espresso", label: "暖褐深棕", swatch: "#383124" },
  { id: "forest", label: "墨橄榄绿", swatch: "#2f3728" },
  { id: "burgundy", label: "暗玫瑰褐", swatch: "#473335" },
  { id: "midnight", label: "深夜岩蓝", swatch: "#262c38" },
  { id: "abyss", label: "深海墨青", swatch: "#113740" },
  { id: "umber", label: "暖炭咖灰", swatch: "#322f2a" },
  { id: "graphite", label: "冷铅夜灰", swatch: "#2b323b" },
];

const LAYOUT_OPTIONS: ReadonlyArray<{ id: ReaderLayoutMode; label: string; icon: string }> = [
  { id: "single", label: "单页模式", icon: "▯" },
  { id: "double", label: "双页模式", icon: "▯▯" },
  { id: "scroll", label: "滚动模式", icon: "▤" },
];

const THEME_MODES: ReadonlyArray<{ id: "light" | "dark" | "system"; label: string; icon: string }> = [
  { id: "light", label: "浅色主题", icon: "☀" },
  { id: "dark", label: "深色主题", icon: "☾" },
  { id: "system", label: "跟随系统", icon: "◐" },
];

function activeThemeGroup(preset: AppThemePreset | undefined): "light" | "dark" | "system" {
  if (preset === "dark") return "dark";
  if (preset === "system") return "system";
  return "light";
}

export function ReaderAppearanceDrawer({
  preferences,
  onChange,
  paginationDisabled,
}: {
  preferences: ReaderPreferences;
  onChange: (patch: Partial<ReaderPreferences>) => void;
  paginationDisabled?: boolean;
}) {
  const themeGroup = activeThemeGroup(preferences.themePreset);
  const isDark = preferences.theme === "night";

  return (
    <div className="drawer-scroll reader-appearance-drawer" data-testid="reader-appearance-drawer">
      <section className="reader-appearance-group" aria-label="阅读方式">
        <span className="reader-appearance-label">阅读方式</span>
        <div className="reader-layout-cards" role="radiogroup" aria-label="阅读方式">
          {LAYOUT_OPTIONS.map((option) => {
            const active = preferences.layoutMode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`reader-layout-card ${active ? "is-active" : ""}`}
                disabled={paginationDisabled && option.id !== "scroll"}
                title={paginationDisabled && option.id !== "scroll" ? "逐句模式下仅支持滚动模式" : option.label}
                onClick={() => onChange({ layoutMode: option.id })}
              >
                <span className="reader-layout-card-icon" aria-hidden="true">{option.icon}</span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="reader-appearance-group">
        <label className="reader-appearance-field">
          <span className="reader-appearance-label">字体</span>
          <select
            aria-label="阅读字体"
            value={preferences.fontFamily}
            onChange={(event) => onChange({ fontFamily: event.target.value as ReaderFontFamily })}
          >
            <option value="serif">衬线体（书卷感）</option>
            <option value="sans">无衬线（现代清晰）</option>
          </select>
        </label>
      </section>

      <section className="reader-appearance-group">
        <div className="reader-appearance-row-head">
          <span className="reader-appearance-label">字号</span>
          <strong className="reader-appearance-value">{preferences.fontSize}px</strong>
        </div>
        <div className="reader-font-slider-row">
          <button
            type="button"
            className="reader-font-step"
            aria-label="减小字号"
            disabled={preferences.fontSize <= 15}
            onClick={() => onChange({ fontSize: Math.max(15, preferences.fontSize - 1) })}
          >A</button>
          <input
            type="range"
            aria-label="字号大小"
            min={15}
            max={24}
            step={1}
            value={preferences.fontSize}
            onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
          />
          <button
            type="button"
            className="reader-font-step is-large"
            aria-label="增大字号"
            disabled={preferences.fontSize >= 24}
            onClick={() => onChange({ fontSize: Math.min(24, preferences.fontSize + 1) })}
          >A</button>
        </div>
      </section>

      <section className="reader-appearance-group">
        <div className="reader-appearance-row-head">
          <span className="reader-appearance-label">左右边距</span>
          <strong className="reader-appearance-value">
            {preferences.horizontalMargin <= MIN_HORIZONTAL_MARGIN ? "0%（铺满）" : `${preferences.horizontalMargin}%`}
          </strong>
        </div>
        <div className="reader-font-slider-row">
          <button
            type="button"
            className="reader-font-step"
            aria-label="减小左右边距"
            title="减小边距（内容更宽）"
            disabled={preferences.horizontalMargin <= MIN_HORIZONTAL_MARGIN}
            onClick={() => onChange({ horizontalMargin: Math.max(MIN_HORIZONTAL_MARGIN, preferences.horizontalMargin - 2) })}
          >−</button>
          <input
            type="range"
            aria-label="左右边距"
            min={MIN_HORIZONTAL_MARGIN}
            max={MAX_HORIZONTAL_MARGIN}
            step={2}
            value={preferences.horizontalMargin}
            onChange={(event) => onChange({ horizontalMargin: Number(event.target.value) })}
          />
          <button
            type="button"
            className="reader-font-step"
            aria-label="增大左右边距"
            title="增大边距（留白更宽）"
            disabled={preferences.horizontalMargin >= MAX_HORIZONTAL_MARGIN}
            onClick={() => onChange({ horizontalMargin: Math.min(MAX_HORIZONTAL_MARGIN, preferences.horizontalMargin + 2) })}
          >+</button>
        </div>
      </section>

      <section className="reader-appearance-group" aria-label="主题">
        <span className="reader-appearance-label">主题</span>
        <div className="reader-theme-mode-cards">
          {THEME_MODES.map((item) => {
            const active = themeGroup === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`reader-theme-mode-card ${active ? "is-active" : ""}`}
                aria-pressed={active}
                onClick={() => onChange({ themePreset: item.id })}
              >
                <span aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
        {isDark ? (
          <div className="reader-tint-swatches" role="radiogroup" aria-label="深色底色">
            {READER_DARK_TINTS.map((tint) => {
              const active = preferences.darkTint === tint.id;
              return (
                <button
                  key={tint.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={tint.label}
                  title={tint.label}
                  className={`reader-tint-swatch is-dark-swatch ${active ? "is-active" : ""}`}
                  style={{ backgroundColor: tint.swatch }}
                  onClick={() => onChange({ darkTint: tint.id })}
                />
              );
            })}
          </div>
        ) : (
          <div className="reader-tint-swatches" role="radiogroup" aria-label="纸张底色">
            {READER_LIGHT_TINTS.map((tint) => {
              const active = preferences.paperTint === tint.id;
              return (
                <button
                  key={tint.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={tint.label}
                  title={tint.label}
                  className={`reader-tint-swatch ${active ? "is-active" : ""}`}
                  style={{ backgroundColor: tint.swatch }}
                  onClick={() => onChange({ paperTint: tint.id })}
                />
              );
            })}
          </div>
        )}
      </section>

      <details className="reader-appearance-more">
        <summary>更多设置</summary>
        <div className="reader-appearance-more-body">
          <div className="reader-appearance-group">
            <span className="reader-appearance-label">行距</span>
            <div className="reader-segmented">
              {(["compact", "standard", "relaxed"] as const satisfies readonly ReaderLineHeight[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={preferences.lineHeight === value ? "is-active" : ""}
                  aria-pressed={preferences.lineHeight === value}
                  onClick={() => onChange({ lineHeight: value })}
                >
                  {value === "compact" ? "紧凑" : value === "standard" ? "标准" : "舒展"}
                </button>
              ))}
            </div>
          </div>

          <label className="reader-appearance-toggle">
            <input
              type="checkbox"
              checked={preferences.chineseIndent}
              onChange={(event) => onChange({ chineseIndent: event.target.checked })}
            />
            <span>中文段落首行缩进</span>
          </label>

          <label className="reader-appearance-toggle">
            <input
              type="checkbox"
              checked={preferences.showVocabularyBackgrounds}
              onChange={(event) => onChange({ showVocabularyBackgrounds: event.target.checked })}
            />
            <span>显示已收藏词汇高亮</span>
          </label>

          <label className="reader-appearance-toggle">
            <input
              type="checkbox"
              checked={preferences.showChineseGlosses}
              onChange={(event) => onChange({ showChineseGlosses: event.target.checked })}
            />
            <span>显示生词中文行间提示</span>
          </label>
        </div>
      </details>
    </div>
  );
}
