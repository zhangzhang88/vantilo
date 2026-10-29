'use strict';
const { createHash } = require('node:crypto');

// Matches the IDs and labels exposed by the Reader translation-engine catalog.
// Only the currently selected, safely stored custom API profile is advertised.
async function listGutenbergIntroEngines({ customApi, listModels }) {
  const engines = [];
  try {
    const profile = await customApi.get();
    if (profile?.configured && profile.model) {
      const identity = String(profile.id || profile.baseUrl || `${profile.name || ''}|${profile.model || ''}`);
      engines.push({
        id: 'custom-api:' + createHash('sha256').update(identity).digest('hex').slice(0, 12),
        label: '自定义 API · ' + (profile.name || '已保存服务') + ' / ' + profile.model,
        engine: 'custom',
        modelId: profile.model,
        effort: null
      });
    }
  } catch {
    // A missing custom profile must not block the authenticated Codex models.
  }
  try {
    const catalog = await listModels();
    for (const model of catalog?.models || []) {
      if (typeof model.id !== 'string' || !model.id || typeof model.displayName !== 'string') continue;
      engines.push({
        id: 'codex:' + model.id,
        label: 'Codex / ChatGPT · ' + model.displayName,
        engine: 'codex',
        modelId: model.id,
        effort: model.defaultEffort ?? null
      });
    }
  } catch {
    // A disconnected Codex catalog must not hide a configured custom profile.
  }
  return { engines, defaultId: engines[0]?.id ?? '' };
}

module.exports = { listGutenbergIntroEngines };
