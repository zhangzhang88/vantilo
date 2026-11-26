export type CustomApiProviderKind = "deepseek" | "gemini" | "custom";

const OFFICIAL_PROVIDER_ORIGINS: Readonly<Record<string, Exclude<CustomApiProviderKind, "custom">>> = {
  "https://api.deepseek.com": "deepseek",
  "https://generativelanguage.googleapis.com": "gemini",
};

/** Identify an official provider strictly by exact default-port HTTPS origin
 * (no userinfo, no path/query/subdomain substring matching). */
export function detectOfficialApiProvider(baseUrl: string): CustomApiProviderKind {
  const raw = baseUrl.trim();
  if (!raw) return "custom";
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "https:"
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.port !== ""
    ) {
      return "custom";
    }
    const origin = `${parsed.protocol}//${parsed.hostname.toLowerCase()}`;
    return OFFICIAL_PROVIDER_ORIGINS[origin] ?? "custom";
  } catch {
    return "custom";
  }
}

/** Format the actual destination host (host[:port]) so users can verify where
 * their API key will be sent before testing or saving. */
export function formatApiTargetHost(baseUrl: string): string {
  const raw = baseUrl.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.host || "";
  } catch {
    return "";
  }
}
