import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProviderSettingsService } from "./ai-provider-settings-service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "magazine-reader-ai-settings-"));
  roots.push(root);
  return root;
}

const legacyEnv = {
  EASYCLIPROXY_BASE_URL: "http://127.0.0.1:8317/v1",
  EASYCLIPROXY_MODEL: "gpt-6-luna",
  EASYCLIPROXY_API_KEY: "legacy-secret-key",
} as NodeJS.ProcessEnv;

describe("AI provider settings service", () => {
  it("seeds the legacy EasyCLIProxy config without exposing the stored key", async () => {
    const root = await tempRoot();
    const service = await AiProviderSettingsService.create(root, { env: legacyEnv });

    const settings = service.getPublicSettings();
    expect(settings.activeProfileId).toBe("easycliproxy-default");
    expect(settings.profiles).toEqual([expect.objectContaining({
      id: "easycliproxy-default",
      name: "EasyCLIProxy - GPT",
      responsesUrl: "http://127.0.0.1:8317/v1/responses",
      model: "gpt-6-luna",
      hasApiKey: true,
      apiKeyMasked: "••••••••",
    })]);
    expect(JSON.stringify(settings)).not.toContain("legacy-secret-key");
    expect(service.getActiveProfile()?.apiKey).toBe("legacy-secret-key");

    const savedPath = path.join(root, "config", "ai-providers.local.json");
    expect(await readFile(savedPath, "utf8")).toContain("legacy-secret-key");
    if (process.platform !== "win32") {
      expect((await stat(savedPath)).mode & 0o777).toBe(0o600);
    }
  });

  it("saves and activates a Gemini profile while preserving an existing key on blank updates", async () => {
    const root = await tempRoot();
    let sequence = 0;
    const service = await AiProviderSettingsService.create(root, {
      env: legacyEnv,
      idFactory: () => `profile-${++sequence}`,
    });

    const created = await service.saveProfile({
      name: "EasyCLIProxy - Gemini",
      description: "Gemini Flash / 网页翻译",
      responsesUrl: "http://127.0.0.1:8317/v1/responses",
      model: "gemini-3.1-flash-lite",
      apiKey: "gemini-secret-key",
    }, true);
    expect(created.savedProfileId).toBe("profile-1");
    expect(created.activeProfileId).toBe("profile-1");
    expect(JSON.stringify(created)).not.toContain("gemini-secret-key");
    expect(service.getActiveProfile()).toMatchObject({
      id: "profile-1",
      model: "gemini-3.1-flash-lite",
      apiKey: "gemini-secret-key",
    });

    await service.saveProfile({
      id: "profile-1",
      name: "EasyCLIProxy - Gemini",
      description: "Gemini Flash",
      responsesUrl: "http://127.0.0.1:8317/v1/responses",
      model: "gemini-3.1-flash-lite",
      apiKey: "",
    });
    expect(service.getActiveProfile()?.apiKey).toBe("gemini-secret-key");
  });

  it("tests a Responses profile and discovers models through the matching models endpoint", async () => {
    const root = await tempRoot();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(init?.headers).toMatchObject({ Authorization: "Bearer legacy-secret-key" });
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({
          data: [
            { id: "gpt-6-luna" },
            { id: "gemini-3.1-flash-lite" },
            { id: "gpt-6-luna" },
          ],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      expect(url).toBe("http://127.0.0.1:8317/v1/responses");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gpt-6-luna");
      return new Response(JSON.stringify({ output_text: "OK" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const service = await AiProviderSettingsService.create(root, { env: legacyEnv, fetchImpl });
    const profile = service.getPublicSettings().profiles[0];

    await expect(service.testConnection({
      id: profile.id,
      name: profile.name,
      description: profile.description,
      responsesUrl: profile.responsesUrl,
      model: profile.model,
    })).resolves.toEqual({ ok: true, model: "gpt-6-luna", output: "OK" });

    await expect(service.discoverModels({
      id: profile.id,
      name: profile.name,
      description: profile.description,
      responsesUrl: profile.responsesUrl,
      model: profile.model,
    })).resolves.toEqual({
      models: ["gemini-3.1-flash-lite", "gpt-6-luna"],
      modelsUrl: "http://127.0.0.1:8317/v1/models",
    });
  });
});
