"use strict";
const { listReaderCustomApiEngines } = require("./reader-custom-api-engines.cjs");
const { listReaderCodexEngines } = require("./reader-codex-engines.cjs");

async function listGutenbergIntroEngines({ customApi, listModels }) {
  const [custom, codex] = await Promise.all([
    listReaderCustomApiEngines(customApi),
    listReaderCodexEngines(listModels),
  ]);
  const engines = [
    ...custom.map(({ id, label, modelId }) => ({ id, label, modelId, engine: "custom", effort: null })),
    ...codex.map(({ isDefault, ...engine }) => engine),
  ];
  return { engines, defaultId: engines[0]?.id ?? "" };
}

module.exports = { listGutenbergIntroEngines };
