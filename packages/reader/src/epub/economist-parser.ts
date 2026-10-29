import type { IssueFile, IssueRecord } from "../shared/types.js";
import { countWords, dateFromFilename, parseEpub3Navigation, scanIssueFiles } from "./epub-core.js";
import { parsePublicationEpub } from "./publication-parser.js";

export { scanIssueFiles } from "./epub-core.js";

/** @deprecated Use parsePublicationEpub. Kept as a compatibility export for existing callers/tests. */
export async function parseEconomistEpub(issueFile: IssueFile): Promise<IssueRecord> {
  return parsePublicationEpub(issueFile);
}

export const parserInternals = {
  countWords,
  dateFromFilename,
  parseNavigation: parseEpub3Navigation,
};
