const fs = require('node:fs/promises');

async function cleanupRealCodexE2E(runtime, tempPath, { removePath = fs.rm } = {}) {
  const errors = [];
  if (runtime && typeof runtime.stop === 'function') {
    try { await runtime.stop(); }
    catch (error) { errors.push(new Error(`Could not stop the E2E Runtime: ${error instanceof Error ? error.stack || error.message : String(error)}`, { cause: error })); }
  }
  if (typeof tempPath === 'string' && tempPath.length > 0) {
    try { await removePath(tempPath, { recursive: true, force: true }); }
    catch (error) { errors.push(new Error(`Could not remove E2E temporary directory: ${error instanceof Error ? error.stack || error.message : String(error)}`, { cause: error })); }
  }
  return errors;
}

module.exports = { cleanupRealCodexE2E };
