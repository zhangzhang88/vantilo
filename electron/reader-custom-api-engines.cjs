'use strict';
const { createHash } = require('node:crypto');

function customApiEngineId(profile) {
  const identity = String(profile.id || profile.baseUrl || `${profile.name || ''}|${profile.model || ''}`);
  const cacheIdentity = profile.cacheRevision ? JSON.stringify([identity, profile.cacheRevision]) : identity;
  return 'custom-api:' + createHash('sha256').update(cacheIdentity).digest('hex').slice(0, 12);
}

async function listReaderCustomApiEngines(customApi) {
  let settings;
  try { settings = await customApi?.get(); } catch { return []; }
  return readerCustomApiEngines(settings);
}

function readerCustomApiEngines(settings) {
  if (!settings?.configured) return [];

  const profiles = settings.profiles?.length ? settings.profiles : [settings];
  const activeId = settings.activeId || settings.id;
  const ordered = [...profiles.filter(profile => profile.id === activeId), ...profiles.filter(profile => profile.id !== activeId)];
  return ordered.map(profile => {
    return {
      id: customApiEngineId(profile),
      engine: 'custom-api',
      label: `自定义 API · ${profile.name} / ${profile.model}`,
      modelId: profile.model,
      selectedProfileId: profile.id,
    };
  });
}

module.exports = { customApiEngineId, readerCustomApiEngines, listReaderCustomApiEngines };
