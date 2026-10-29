import type { BookResearchReport } from "../shared/book-research";
export type PrepStreamEvent = { type: "research"; research: BookResearchReport } | { type: "delta" | "status"; text: string } | { type: "ping" } | { type: "done"; answer: string; paragraphIndexes?: number[] } | { type: "error"; error: string };

/** NDJSON frames may cross byte boundaries, including inside Chinese characters. */
export async function readPrepDiscussion(response: Response, onEvent: (event: PrepStreamEvent) => void): Promise<string> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "讨论服务暂时不可用，请重试。");
  }
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const body = await response.json();
    if (typeof body.answer !== "string" || !body.answer.trim()) throw new Error("Codex 未返回完整回复，请重试。");
    if (body.research) onEvent({ type: "research", research: body.research });
    onEvent({ type: "done", answer: body.answer, paragraphIndexes: body.paragraphIndexes });
    return body.answer;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("无法读取 Codex 回复，请重试。");
  const decoder = new TextDecoder();
  let buffer = "";
  let answer: string | undefined;
  const frame = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as PrepStreamEvent;
    if (event.type === "error") throw new Error(event.error);
    if (event.type === "done") {
      if (typeof event.answer !== "string" || !event.answer.trim()) throw new Error("Codex 返回空回复，请重试。");
      answer = event.answer;
    }
    onEvent(event);
  };
  try {
    while (answer === undefined) {
      const result = await reader.read();
      buffer += result.done ? decoder.decode() : decoder.decode(result.value, { stream: true });
      for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) { frame(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
      if (result.done) { if (buffer.trim()) frame(buffer); break; }
    }
    if (answer === undefined) throw new Error("连接中断，回复尚未完成，请重试。");
    return answer;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
