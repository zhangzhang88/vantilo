const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const corpus = process.env.VANTILO_READER_CORPUS_DIR;
if (!corpus) {
  console.error("Set VANTILO_READER_CORPUS_DIR to a directory containing the six required licensed/local magazine EPUBs.");
  process.exit(2);
}
const root = path.resolve(__dirname, "..");
const corpusRoot = path.resolve(corpus);
const required = [
  "TheEconomist.2026.09.19.epub", "TheEconomist.2026.09.12.epub",
  "TheNewYorker.2026.09.21.epub", "TheNewYorker.2026.09.14.epub",
  "TheAtlantic.2026.09.02.epub", "Wired.2026.09.02.epub",
];
const missing = required.filter((filename) => !fs.existsSync(path.join(corpusRoot, filename)));
if (missing.length) {
  console.error(`Corpus incomplete at ${corpusRoot}; missing required files:\n${missing.map((name) => `- ${name}`).join("\n")}`);
  process.exit(2);
}
const result = spawnSync("vitest", ["run", "--config", "vitest.config.ts", "src/epub/economist-parser.test.ts"], {
  cwd: root,
  env: { ...process.env, VANTILO_READER_CORPUS_DIR: corpusRoot },
  stdio: "inherit",
});
process.exit(result.status ?? 1);
