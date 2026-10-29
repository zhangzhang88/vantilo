export interface CodexReasoningOption {
  reasoningEffort: string;
  description: string;
}

export interface CodexModelOption {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  hidden: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: CodexReasoningOption[];
  upgrade: string | null;
  upgradeInfo: { model: string; upgradeCopy: string | null; modelLink: string | null; migrationMarkdown: string | null; retirementAt: number | null } | null;
}

export interface CodexPrepModelPreferences {
  modelMode: "auto" | "manual";
  model: string | null;
  reasoningMode: "auto" | "manual";
  reasoningEffort: string | null;
}

export interface CodexModelUsage {
  /** Actual only when the request explicitly selected the model or app-server reported a reroute. */
  modelId: string | null;
  /** Actual only when explicitly requested; app-server currently does not report auto-resolved effort per turn. */
  reasoningEffort: string | null;
  requestedModelId: string | null;
  requestedReasoningEffort: string | null;
  generatedAt: string;
}

export const DEFAULT_CODEX_PREP_MODEL_PREFERENCES: CodexPrepModelPreferences = {
  modelMode: "auto",
  model: null,
  reasoningMode: "auto",
  reasoningEffort: null,
};
