import { defineConfig } from "vitest/config";
import { createRequire } from "node:module";

const workspaceGuard = createRequire(import.meta.url)("../../scripts/workspace-test-environment.cjs");

// Reader offline tests use the same required Workspace run directory as the
// root suite and fail closed when invoked directly without the wrapper.
workspaceGuard.assertWorkspaceTestEnvironment();

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
