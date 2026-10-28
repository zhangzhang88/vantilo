// Development Reader uses the translation UI shipped in Vantilo Beta.
process.env.VANTILO_TRANSLATION_READER = '1';
// Use the release toolbar, settings copy, and reader API bindings in development too.
process.env.VANTILO_CATALOG_READER_PREVIEW = '1';
await import('./build-reader.mjs');
