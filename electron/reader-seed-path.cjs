const fs = require('node:fs');
const path = require('node:path');

function packagedReaderSeedDir({ isPackaged, assetsDir, existsSync = fs.existsSync }) {
  if (!isPackaged || typeof assetsDir !== 'string' || !path.isAbsolute(assetsDir)) return undefined;
  const seedDir = path.join(assetsDir, 'seed');
  return existsSync(path.join(seedDir, 'manifest.json')) ? seedDir : undefined;
}

module.exports = { packagedReaderSeedDir };
