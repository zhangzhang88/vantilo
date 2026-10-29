import type { GuidePreparationStatus } from "../shared/types";

export function guidePreparationIssueNeedsRefresh(
  previous: GuidePreparationStatus,
  next: GuidePreparationStatus,
): boolean {
  return next.completed !== previous.completed
    || next.sectionCompleted !== previous.sectionCompleted
    || (previous.state === "running" && next.state !== "running");
}
