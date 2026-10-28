function VantiloSentenceAppearanceMenu({ value, onChange }: { value: ReaderPreferences; onChange: (patch: Partial<ReaderPreferences>) => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const themes: { id: NonNullable<ReaderPreferences["themePreset"]>; label: string }[] = [
    { id: "light", label: "浅色" }, { id: "sepia", label: "米白" },
    { id: "green", label: "浅绿" }, { id: "blue", label: "蓝色" },
    { id: "dark", label: "深色" }, { id: "system", label: "跟随系统" },
  ];
  const fonts: { id: ReaderPreferences["fontFamily"]; label: string }[] = [
    { id: "serif", label: "衬线" }, { id: "sans", label: "无衬线" },
  ];
  return <div className="vantilo-sentence-appearance" ref={containerRef}>
    <button type="button" className="vantilo-sentence-appearance-trigger" aria-label="主题和字体" aria-expanded={open} onClick={() => setOpen(!open)}>Aa</button>
    {open && <div className="vantilo-sentence-appearance-panel" role="dialog" aria-label="全局主题和字体">
      <div className="vantilo-sentence-appearance-heading"><strong>主题和字体</strong><button type="button" onClick={() => setOpen(false)} aria-label="关闭主题和字体设置">×</button></div>
      <span className="vantilo-sentence-appearance-label">背景颜色</span>
      <div className="vantilo-sentence-theme-options">{themes.map(item => <button type="button" key={item.id} className={`vantilo-sentence-theme-option theme-${item.id}`} aria-label={item.label} aria-pressed={(value.themePreset ?? "system") === item.id} title={item.label} onClick={() => onChange({ themePreset: item.id })}>{item.id === "system" ? "◐" : ""}</button>)}</div>
      <label className="vantilo-sentence-size-label" htmlFor="vantilo-sentence-font-size">文字大小 <span>{value.fontSize}px</span></label>
      <input id="vantilo-sentence-font-size" aria-label="全局阅读文字大小" type="range" min="12" max="24" step="1" value={value.fontSize} onChange={event => onChange({ fontSize: Number(event.currentTarget.value) })} />
      <span className="vantilo-sentence-appearance-label">字体</span>
      <div className="vantilo-sentence-font-options">{fonts.map(item => <button type="button" key={item.id} className={`vantilo-sentence-font-option font-${item.id}`} aria-pressed={value.fontFamily === item.id} onClick={() => onChange({ fontFamily: item.id })}><span>Aa</span>{item.label}</button>)}</div>
      <small>应用到所有阅读页面</small>
    </div>}
  </div>;
}
