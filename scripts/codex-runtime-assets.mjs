import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';

// Codex 0.163.0 uses the sibling host even when the code_mode feature is off.
export const CODEX_RUNTIME_FILES = Object.freeze(['codex', 'codex-code-mode-host']);
export async function copyCodexRuntime(sourceBinDir, outputDir) {
  // Check the complete set before replacing any existing executable.
  for (const name of CODEX_RUNTIME_FILES) {
    const filename = path.join(sourceBinDir, name);
    if (!(await fs.stat(filename)).isFile()) throw new Error(`Missing Codex runtime executable: ${name}`);
    await fs.access(filename, constants.X_OK);
  }
  await fs.mkdir(outputDir, {recursive:true});
  for (const name of CODEX_RUNTIME_FILES) {
    await fs.copyFile(path.join(sourceBinDir, name), path.join(outputDir, name));
    await fs.chmod(path.join(outputDir, name), 0o755);
  }
}
