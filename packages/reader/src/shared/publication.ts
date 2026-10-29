import type { PublicationId } from "./types.js";

export interface PublicationInfo {
  id: PublicationId;
  name: string;
}

export const PUBLICATIONS: Record<PublicationId, PublicationInfo> = {
  economist: { id: "economist", name: "The Economist" },
  "new-yorker": { id: "new-yorker", name: "The New Yorker" },
  atlantic: { id: "atlantic", name: "The Atlantic" },
  wired: { id: "wired", name: "Wired" },
};

export function publicationFromFilename(filename: string): PublicationInfo | null {
  const normalized = filename.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-");
  if (normalized.includes("economist")) return PUBLICATIONS.economist;
  if (normalized.includes("new-yorker") || normalized.includes("newyorker")) return PUBLICATIONS["new-yorker"];
  if (normalized.includes("atlantic")) return PUBLICATIONS.atlantic;
  if (normalized.includes("wired")) return PUBLICATIONS.wired;
  return null;
}

export function publicationIssueId(publicationId: PublicationId, date: string): string {
  return `${publicationId}:${date}`;
}

export function canonicalIssueId(issueId: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(issueId) ? publicationIssueId("economist", issueId) : issueId;
}

export function legacyEconomistIssueId(issueId: string): string | null {
  const match = issueId.match(/^economist:(\d{4}-\d{2}-\d{2})$/);
  return match?.[1] ?? null;
}
