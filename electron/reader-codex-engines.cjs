"use strict";

async function listReaderCodexEngines(listModels) {
  let catalog;
  try { catalog = await listModels(); } catch { return []; }
  return (catalog?.models ?? []).filter(model =>
    typeof model?.id === "string" && model.id && typeof model.displayName === "string"
  ).map(model => ({
    id: "codex:" + model.id,
    label: "Codex / ChatGPT · " + model.displayName,
    engine: "codex",
    modelId: model.id,
    effort: model.defaultEffort ?? null,
    isDefault: Boolean(model.isDefault),
  }));
}

module.exports = { listReaderCodexEngines };
