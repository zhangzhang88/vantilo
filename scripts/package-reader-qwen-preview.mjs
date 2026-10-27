// Build a second, separately named .app without replacing the accepted Reader setup preview.
process.env.VANTILO_QWEN_PREVIEW_BUILD='1';
await import('./package-reader-setup-preview.mjs');
