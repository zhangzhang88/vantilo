import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./app.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))); });

describe("local Codex preparation routes", () => {
  it("exposes no credentials, rejects cross-origin writes and unknown books", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mr-prep-routes-"));
    roots.push(root);
    const app = await buildServer({ projectRoot: root, serveFrontend: false, aiProviderEnv: {} });
    try {
      const status = await app.inject({ method: "GET", url: "/api/prep/auth" });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ connected: false, sharing: false, pending: false });
      expect(status.body).not.toContain("accessToken");
      expect(status.body).not.toContain("refreshToken");

      const preferences = await app.inject({ method: "GET", url: "/api/prep/model-preferences" });
      expect(preferences.statusCode).toBe(200);
      expect(preferences.json()).toEqual({ modelMode: "auto", model: null, reasoningMode: "auto", reasoningEffort: null });
      const savedPreferences = await app.inject({ method: "PUT", url: "/api/prep/model-preferences", payload: { modelMode: "manual", model: "synthetic-model", reasoningMode: "manual", reasoningEffort: "high" } });
      expect(savedPreferences.statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/prep/model-preferences" })).json()).toMatchObject({ modelMode: "manual", model: "synthetic-model", reasoningMode: "manual", reasoningEffort: "high" });
      const modelsUnauthed = await app.inject({ method: "GET", url: "/api/prep/models" });
      expect(modelsUnauthed.statusCode).toBe(409);

      const authStart = await app.inject({ method: "POST", url: "/api/prep/auth/start", payload: {} });
      expect(authStart.statusCode).toBe(200);
      const authUrl = new URL(authStart.json().url as string);
      expect(authUrl.origin).toBe("https://auth.openai.com");
      expect(authUrl.pathname).toBe("/api/accounts/authorize");
      expect(authUrl.searchParams.get("client_id")).toBe("dynamic_agent_client");
      expect(authUrl.searchParams.get("agent_name_hint")).toBe("magazine_reader");
      expect(authUrl.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
      expect(authUrl.searchParams.has("state")).toBe(true);
      expect(authUrl.searchParams.has("nonce")).toBe(true);
      await fetch(`${authUrl.searchParams.get("redirect_uri")!}?state=invalid`);

      const forbidden = await app.inject({ method: "POST", url: "/api/prep/auth/disconnect", headers: { origin: "https://other.example" } });
      expect(forbidden.statusCode).toBe(403);

      const noBook = await app.inject({ method: "GET", url: "/api/books/book:unknown/lessons" });
      expect(noBook.statusCode).toBe(404);
      const noBookChat = await app.inject({ method: "POST", url: "/api/books/book:unknown/prep/chat", payload: { message: "Choose content" } });
      expect(noBookChat.statusCode).toBe(404);
      const noBookApproval = await app.inject({ method: "POST", url: "/api/books/book:unknown/prep/approve", payload: { draftId: "any" } });
      expect(noBookApproval.statusCode).toBe(404);
    } finally { await app.close(); }
  });
});
