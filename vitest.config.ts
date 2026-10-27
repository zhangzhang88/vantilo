import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';
// Exclude third-party SwiftPM checkout tests, not Vantilo's own test suite.
export default mergeConfig(viteConfig, defineConfig({ test: {
  exclude: [...configDefaults.exclude, '**/native/qwen-health/.build/**']
} }));
