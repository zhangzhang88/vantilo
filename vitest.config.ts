import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';
// Vantilo's isolated Reader adapter/Electron fixtures are under tests/. The
// embedded upstream source tests require its separate private EPUB corpus and
// upstream-only fixtures, so they are not part of the Vantilo test command.
export default mergeConfig(viteConfig, defineConfig({ test: {
  exclude: [...configDefaults.exclude, '**/native/qwen-health/.build/**', '**/packages/reader/src/**/*.test.*']
} }));
