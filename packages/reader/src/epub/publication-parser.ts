import type { Article, IssueFile, IssueRecord } from "../shared/types.js";
import { openEpub, resolveNavigationHref, scanIssueFiles } from "./epub-core.js";
import { publicationAdapter } from "./publication-adapters.js";

export { scanIssueFiles } from "./epub-core.js";

export async function parsePublicationEpub(issueFile: IssueFile): Promise<IssueRecord> {
  const opened = await openEpub(issueFile);
  const adapter = publicationAdapter(issueFile.publicationId);
  const articles: Article[] = [];

  for (const navItem of opened.navItems) {
    const resolvedHref = resolveNavigationHref(opened.navigationPath, navItem.href);
    const entry = opened.zip.file(resolvedHref);
    if (!entry) continue;
    const html = await entry.async("text");
    const article = adapter.parseArticle({ html, navItem, resolvedHref, issueFile });
    if (article) articles.push(article);
  }

  if (!articles.length) throw new Error(`No articles could be parsed from ${issueFile.filename}`);
  const sections = [...new Set(articles.map((article) => article.section))];
  return {
    schemaVersion: 1,
    id: issueFile.id,
    publicationId: issueFile.publicationId,
    publicationName: issueFile.publicationName,
    filename: issueFile.filename,
    sourceFingerprint: issueFile.fingerprint,
    title: issueFile.publicationName,
    date: issueFile.date,
    label: issueFile.label,
    sections,
    articles,
  };
}
