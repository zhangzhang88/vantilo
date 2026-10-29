import path from "node:path";
import { compactBookEpubSpikeReport, inspectBookEpubSpike } from "./book-parser-spike.js";

const defaultPath = path.resolve("data/source-sync/epub-book-audit/The Craft of Research.epub");
const inputPath = path.resolve(process.argv[2] ?? defaultPath);

const report = await inspectBookEpubSpike(inputPath);
process.stdout.write(`${JSON.stringify(compactBookEpubSpikeReport(report), null, 2)}\n`);
