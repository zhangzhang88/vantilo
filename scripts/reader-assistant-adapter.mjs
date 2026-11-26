import postcss from 'postcss';

export function adaptScopedAssistant(source, filename) {
  if (!filename.endsWith('/frontend/codex-prep-panel.tsx')) return source;
  return 'export function CodexPrepPanel() { return null; }\n';
}

export function sharedReaderComposerPlugin() {
  return {
    name: 'vantilo-offline-spectrum-fonts',
    enforce: 'pre',
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.css') || typeof asset.source !== 'string') continue;
        const css = postcss.parse(asset.source);
        css.walkAtRules('font-face', rule => {
          if (/https?:\/\//.test(rule.toString())) rule.remove();
        });
        asset.source = css.toString();
      }
    },
    resolveId(id, importer) {
      if (importer?.includes('/@react-spectrum/s2/') && /(?:^|\/)Fonts(?:\.[cm]?[jt]sx?)?$/.test(id)) {
        return '\0vantilo-system-fonts';
      }
    },
    load(id) {
      if (id === '\0vantilo-system-fonts') return 'export function Fonts(){return null}';
    },
  };
}
