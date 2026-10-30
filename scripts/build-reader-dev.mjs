// Development Reader uses the translation UI shipped in Vantilo Beta.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep development output separate from historical personal-library seeds.
process.env.VANTILO_READER_BUILD_OUTPUT ||= path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../build/reader-dev');
process.env.VANTILO_TRANSLATION_READER = '1';
// Use the release toolbar, settings copy, and reader API bindings in development too.
process.env.VANTILO_CATALOG_READER_PREVIEW = '1';
await import('./build-reader.mjs');
