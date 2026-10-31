import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import parcelMacros from 'unplugin-parcel-macros';
import { runtimeModuleInventoryPlugin } from './scripts/runtime-module-inventory.mjs';
const testArtifacts = process.env.VANTILO_TEST_ARTIFACT_ROOT;
const runtimeInventory = process.env.VANTILO_RUNTIME_MODULE_INVENTORY_PATH || (testArtifacts
  ? path.join(testArtifacts, 'runtime-modules/main-renderer.json')
  : path.resolve('build/runtime-modules/main-renderer.json'));
export default defineConfig({
  base: './',
  cacheDir: testArtifacts ? path.join(testArtifacts, 'vite-cache') : undefined,
  plugins: [parcelMacros.vite(), react(), runtimeModuleInventoryPlugin(runtimeInventory)],
  optimizeDeps: { exclude: ['@react-spectrum/s2/style'] },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
