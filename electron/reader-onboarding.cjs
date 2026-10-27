'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { createMacDictionaryLookup } = require('./reader-system-dictionary.cjs');

const SETUP_VERSION = 1;
const MODEL_INFO_URL = 'https://huggingface.co/mlx-community/Qwen3.5-4B-MLX-4bit';

// Only a user-visible dismissal is persisted, never the hardware or dictionary health result.
// Health must be rechecked on the actual Mac after reinstall/migration/settings changes.
function createReaderOnboarding({ userData, assetsDir, platform = process.platform, arch = process.arch,
  totalMemory = os.totalmem(), lookup = createMacDictionaryLookup({ assetsDir, platform }) }) {
  const stateFile = path.join(userData, 'reader-onboarding.json');
  async function getState() {
    try {
      const record = JSON.parse(await fs.readFile(stateFile, 'utf8'));
      return { show: !(record?.version === SETUP_VERSION && ['finished', 'skipped'].includes(record?.decision)) };
    } catch (error) {
      if (error?.code === 'ENOENT') return { show: true };
      // Broken or unreadable state must not silently turn off the setup flow.
      return { show: true };
    }
  }
  async function finish(decision) {
    if (!['finished', 'skipped'].includes(decision)) throw new Error('Invalid Reader onboarding decision');
    await fs.mkdir(userData, { recursive: true, mode: 0o700 });
    const temporary = stateFile + '.' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(temporary, JSON.stringify({ version: SETUP_VERSION, decision }), { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, stateFile);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
    return { show: false };
  }
  async function check() {
    let dictionary = 'unavailable';
    try {
      const answer = await lookup('apple');
      if (answer?.definitionsZh?.some(entry => typeof entry.definition === 'string' && entry.definition.trim())) dictionary = 'bilingual';
      else if (answer?.definitionsEn?.some(entry => typeof entry.definition === 'string' && entry.definition.trim())) dictionary = 'english-only';
    } catch { /* A failed lookup is explicitly unavailable, never a success. */ }
    return {
      dictionary,
      hardware: { appleSilicon: platform === 'darwin' && arch === 'arm64', memoryGiB: Math.round(totalMemory / 1024 ** 3) },
      // No portable MLX backend/download manager has been shipped in Vantilo yet.
      // A developer's installed model is NOT readiness evidence for a fresh user.
      localAi: 'not-integrated',
    };
  }
  return { getState, finish, check };
}
module.exports = { createReaderOnboarding, MODEL_INFO_URL, SETUP_VERSION };
