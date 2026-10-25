const { createHash } = require('node:crypto');

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

// Stable SHA-256 assigned to the archived toolCatalogVersion=1 definitions during migration.
const LEGACY_TOOL_CATALOG_FINGERPRINTS = Object.freeze({ 1: 'cc7bb6a9bdf04eb88af58066e0f217a27b9d5b5d23903fed386e064fe3f3410c' });

function fingerprintToolDefinitions(entries) {
  const canonical = [...entries].sort((a,b) => a.id.localeCompare(b.id)).map(entry => ({
    id: entry.id,
    version: entry.version,
    effect: entry.effect,
    resourceScope: entry.resourceScope,
    requiredScope: entry.requiredScope,
    minimumApproval: entry.minimumApproval,
    approval: entry.approval,
    timeoutMs: entry.timeoutMs,
    definition: entry.definition
  }));
  return createHash('sha256').update(stableJson(canonical)).digest('hex');
}

module.exports = { stableJson, fingerprintToolDefinitions, LEGACY_TOOL_CATALOG_FINGERPRINTS };
