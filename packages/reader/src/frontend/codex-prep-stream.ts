import type { BookResearchReport } from "../shared/book-research";
export type PrepStreamEvent = { type: "research"; research: BookResearchReport } | { type: "delta" | "status"; text: string } | { type: "ping" } | { type: "done"; answer: string; paragraphIndexes?: number[] } | { type: "error"; error: string };

/** Show useful failure categories in the visible unfinished-response bubble,
 * without exposing stack traces, private paths or provider request details. */
export function readablePrepFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/^(书籍|本书|讨论|匹配|原文|研究计划|备课请求|该书).{0,120}(过长|超出|不完整|中断|足够|重试|章节)/.test(message)) {
    return message.slice(0, 140);
  }
  if (/timeout|timed out|deadline|超时/i.test(message)) return "Codex 响应超时，原消息已保留；可缩小阅读范围后重试。";
  if (/429|rate.limit|quota|限额|频率/i.test(message)) return "Codex 调用频率或额度受限，请稍后重试。";
  if (/401|unauthorized|unauthenticated|login|认证|授权|登录/i.test(message)) return "Codex 授权可能已失效，请检查连接与模型设置。";
  if (/model|模型|unsupported/i.test(message)) return "当前 Codex 模型不可用，请检查手动选择的模型。";
  if (/fetch|network|connect|ECONN|socket|ENOTFOUND|网络|连接/i.test(message)) return "Codex 网络连接中断，请检查网络和代理后重试。";
  if (/太长|超出|上限|过大|too.long|exceed|length/i.test(message)) return "书籍讨论内容过长，请聚焦一个章节后重试。";
  return "Codex 处理本轮请求失败，请检查连接状态后重试。";
}

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
