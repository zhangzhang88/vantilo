import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';
import { createRequire } from 'node:module';

const workspaceGuard = createRequire(import.meta.url)('./scripts/workspace-test-environment.cjs');

// Vitest is an E2E-like test entry too: direct `vitest` invocations must not
// bypass the external-volume and per-run isolation checks.
workspaceGuard.assertWorkspaceTestEnvironment();

// Vantilo's isolated Reader adapter/Electron fixtures are under tests/. The
// embedded upstream source tests require its separate private EPUB corpus and
// upstream-only fixtures, so they are not part of the Vantilo test command.
export default mergeConfig(viteConfig, defineConfig({ test: {
  exclude: [...configDefaults.exclude, '**/native/qwen-health/.build/**', '**/packages/reader/src/**/*.test.*']
} }));
