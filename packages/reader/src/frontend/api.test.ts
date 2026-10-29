import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteBook, deleteIssue, fetchBooks, translateParagraph } from "./api";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function realParserTransport() {
  const app = Fastify();
  apps.push(app);
  // Keep Fastify's real content-type parser instead of fulfilling a mocked route.
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const response = await app.inject({
      method: (init?.method ?? "GET") as "GET" | "POST" | "DELETE",
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(typeof init?.body === "string" ? { payload: init.body } : {}),
    });
    return new Response(response.body, { status: response.statusCode, headers: { "Content-Type": "application/json" } });
  });
  return app;
}

describe("API request content type", () => {
  it("sends bodyless book/issue deletions and GET through Fastify without an empty JSON error", async () => {
    const app = realParserTransport();
    const deleted: string[] = [];
    app.delete<{ Params: { bookId: string } }>("/api/books/:bookId", async (request) => {
      expect(request.headers["content-type"]).toBeUndefined();
      deleted.push(request.params.bookId);
      return { status: "deleted", bookId: request.params.bookId };
    });
    app.delete("/api/issues/:issueId", async (request) => {
      expect(request.headers["content-type"]).toBeUndefined();
      return { deleted: true };
    });
    app.get("/api/books", async (request) => {
      expect(request.headers["content-type"]).toBeUndefined();
      return [];
    });
    expect(await deleteBook("book:isbn:9780000000002")).toEqual({ status: "deleted", bookId: "book:isbn:9780000000002" });
    expect(deleted).toEqual(["book:isbn:9780000000002"]);
    expect(await deleteIssue("economist:2026-09-19")).toEqual({ deleted: true });
    expect(await fetchBooks()).toEqual([]);
  });

  it("still supplies JSON content type and parses the body for translation POST", async () => {
    const app = realParserTransport();
    app.post("/api/translate", async (request) => {
      expect(request.headers["content-type"]).toBe("application/json");
      expect(request.body).toEqual({ text: "Hello." });
      return { translation: "你好。", model: "fixture", provider: "easycliproxy" };
    });
    expect(await translateParagraph({ text: "Hello." })).toEqual({ translation: "你好。", model: "fixture", provider: "easycliproxy" });
  });
});
