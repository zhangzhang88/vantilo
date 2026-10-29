import { describe, expect, it } from "vitest";
import { readPrepDiscussion, type PrepStreamEvent } from "./codex-prep-stream";

function response(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { "Content-Type": "application/x-ndjson" } });
}
describe("prep discussion stream", () => {
  it("handles byte-split Chinese frames, heartbeats and authoritative completion", async () => {
    const events: PrepStreamEvent[] = [];
    const text = [{ type: "status", text: "准备中" }, { type: "ping" }, { type: "delta", text: "你好" }, { type: "delta", text: "世界" }, { type: "done", answer: "你好世界" }].map((event) => JSON.stringify(event)).join("\n");
    await expect(readPrepDiscussion(response(text), (event) => events.push(event))).resolves.toBe("你好世界");
    expect(events.filter((event) => event.type === "delta")).toHaveLength(2);
  });
  it("rejects interrupted, failed and empty responses instead of accepting partial text", async () => {
    for (const text of ['{"type":"delta","text":"片段"}\n', '{"type":"error","error":"重试"}\n', '{"type":"done","answer":""}\n']) {
      await expect(readPrepDiscussion(response(text), () => undefined)).rejects.toThrow();
    }
    await expect(readPrepDiscussion(new Response('{"error":"未授权"}', { status: 422 }), () => undefined)).rejects.toThrow("未授权");
  });
  it("retains compatibility with the complete JSON response", async () => {
    await expect(readPrepDiscussion(new Response('{"answer":"完整回复"}'), () => undefined)).resolves.toBe("完整回复");
  });
});

it("delivers real read coverage as a separate progress frame", async () => {
  const report = { indexedChapters: 16, indexedParagraphs: 2800, queries: ["adaptation"], read: [{ chapterId: "late", title: "Late chapter", paragraphs: [160] }], truncated: false };
  const events: PrepStreamEvent[] = [];
  await expect(readPrepDiscussion(response(JSON.stringify({ type: "research", research: report }) + "\n" + JSON.stringify({ type: "done", answer: "完整回复" })), (event) => events.push(event))).resolves.toBe("完整回复");
  expect(events).toContainEqual({ type: "research", research: report });
});
