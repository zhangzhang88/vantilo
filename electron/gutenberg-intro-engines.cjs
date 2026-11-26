"use strict";
const { listReaderCustomApiEngines } = require("./reader-custom-api-engines.cjs");

async function listGutenbergIntroEngines({ customApi }) {
  const custom = await listReaderCustomApiEngines(customApi);
  const engines = custom.map(({ id, label, modelId }) => ({ id, label, modelId, engine: "custom", effort: null }));
  return { engines, defaultId: engines[0]?.id ?? "" };
}

module.exports = { listGutenbergIntroEngines };
