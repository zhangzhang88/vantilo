import type { BookResearchReport } from "../shared/book-research";
import { useEffect, useRef, useState } from "react";
import { readPrepDiscussion } from "./codex-prep-stream";
import "./codex-prep-rico-theme.css";
import type { BookRecord } from "../shared/book-data-contract";
import type { BookLesson, BookLessonDraft, PrepChatMessage } from "../shared/book-lesson";
import { DEFAULT_CODEX_PREP_MODEL_PREFERENCES, type CodexModelOption, type CodexPrepModelPreferences } from "../shared/codex-prep-models";
import { fetchCodexPrepModelPreferences, fetchCodexPrepModels, saveCodexPrepModelPreferences } from "./api";
import { ChatMarkdown } from "./chat-markdown";
import { copyTextToClipboard } from "./clipboard";
import type { AssistantScope } from "../shared/assistant-scope";
import type { ReaderAssistantContext } from "./reader-assistant-context";
import { READING_ASSISTANT_PRESETS } from "./reading-assistant-cache";

interface AuthState { connected: boolean; sharing: boolean; pending: boolean; email?: string; error?: string; }
interface DraftResponse { answer: string; draft?: BookLessonDraft; draftId?: string; existingLessonId?: string; research?: BookResearchReport; }
const PREP_QUICK_PROMPTS = [
  { label: "推荐两个选题", mode: "discussion", prompt: "请从这本书里推荐两个有意思、反直觉的观点，用简单中文解释。先不要生成文章，等我选题。" },
  { label: "讲清选中的观点", mode: "discussion", prompt: "我选了刚才讨论的观点。请先用简单中文把这个观点和原书依据讲清楚，我们再准备英文。" },
  { label: "用两句试读定难度", mode: "discussion", prompt: "我的英语基础比较弱。请用常见单词和短句，每句尽量不超过10个词。围绕刚才选定的观点，先给我两句英文试读，不要生成完整文章。" },
  { label: "把难句再简化", mode: "discussion", prompt: "我读不懂刚才的句子。请保留原意，换成更常见的单词和更短、更简单的句子，并用中文说明改了什么。" },
  { label: "生成精选阅读候选", mode: "draft", prompt: "就按刚才确定的选题和难度，准备一篇80～100词的精选阅读。保留核心观点，附上中文悬念、知识解读、重点词和原书出处。" },
] as const;
const DISCUSSION_FONT_SIZE_STORAGE_KEY = "magazine-reader.codex-prep-discussion-font-size.v1";
const DEFAULT_DISCUSSION_FONT_SIZE = 16;

function splitSpeechText(text: string, maxLength = 130): string[] {
  const normalized = text.replace(/```[\s\S]*?```/g, " code block omitted. ").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  const sentences = normalized.match(/[^.!?。！？]+[.!?。！？]*/g) ?? [normalized];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if (current && `${current} ${part}`.length <= maxLength) { current += ` ${part}`; continue; }
    if (current) chunks.push(current);
    if (part.length <= maxLength) { current = part; continue; }
    const words = part.match(/.{1,130}(?:\s+|$)/g) ?? [part];
    current = "";
    chunks.push(...words.map((word) => word.trim()).filter(Boolean));
  }
  if (current) chunks.push(current);
  return chunks;
}

async function api<T>(path: string, data?: object, signal?: AbortSignal, onResponse?: (response: Response) => void): Promise<T> {
  const response = await fetch(path, data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), signal } : { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败（${response.status}）`);
  }
  onResponse?.(response);
  return response.json() as Promise<T>;
}

async function deleteApi(path: string): Promise<void> {
  const response = await fetch(path, { method: "DELETE" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败（${response.status}）`);
  }
}

export function CodexPrepPanel({ book, lessons = [], onLessonSaved, onOpenLesson, scope, scopeLabel, onClose, readerContext }: {
  book?: BookRecord;
  lessons?: BookLesson[];
  onLessonSaved?: (lesson: BookLesson) => void;
  onOpenLesson?: (lesson: BookLesson, lessons: BookLesson[]) => void;
  scope?: AssistantScope;
  scopeLabel?: string;
  onClose?: () => void;
  readerContext?: { current: () => ReaderAssistantContext | null };
}) {
  const root = book ? `/api/books/${encodeURIComponent(book.id)}` : `/api/prep/assistant`;
  const scopeQuery = book ? "" : `?scope=${encodeURIComponent(JSON.stringify(scope ?? { kind: "all" }))}`;
  const endpoint = (action: "history" | "chat") => book ? `${root}/prep/${action}` : `${root}/${action}${scopeQuery}`;
  const [historyReady, setHistoryReady] = useState(false);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const quickPrompts: ReadonlyArray<{ label: string; mode: "discussion" | "draft"; prompt: string }> = book ? PREP_QUICK_PROMPTS : readerContext ? [
    ...READING_ASSISTANT_PRESETS.map(preset => ({ label: preset.question, mode: "discussion" as const, prompt: preset.question })),
    { label: "解释当前段", mode: "discussion", prompt: "请用简单中文解释我当前正在看的这一段，说明它与上下文的关系，并引用对应原文段落。" },
  ] : [
    { label: "推荐适合我的阅读", mode: "discussion", prompt: "我的英语基础比较弱。请根据当前范围的书刊，为我推荐两篇或两本适合开始的内容，简短说明原因；如果还不了解我的兴趣，请先问我。" },
    { label: "这里有哪些内容", mode: "discussion", prompt: "请用简单中文介绍当前范围有哪些主要内容，可以从哪里开始阅读？请区分目录信息与实际读到的原文。" },
    { label: "用简单中文解释", mode: "discussion", prompt: "请结合当前内容，用简单中文解释刚才讨论的观点，说明原文依据和需要注意的限制。" },
  ];
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [modelPreferences, setModelPreferences] = useState<CodexPrepModelPreferences>({ ...DEFAULT_CODEX_PREP_MODEL_PREFERENCES });
  const [modelCatalog, setModelCatalog] = useState<CodexModelOption[]>([]);
  const [modelCatalogLoaded, setModelCatalogLoaded] = useState(false);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  const [modelNotice, setModelNotice] = useState("");
  const [modelBusy, setModelBusy] = useState(false);
  const [authUrl, setAuthUrl] = useState("");
  const [history, setHistory] = useState<PrepChatMessage[]>([]);
  const [chapterId, setChapterId] = useState("");
  const [message, setMessage] = useState("");
  const [discussionFontSize, setDiscussionFontSize] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem(DISCUSSION_FONT_SIZE_STORAGE_KEY));
      return Number.isInteger(saved) && saved >= 14 && saved <= 24 ? saved : DEFAULT_DISCUSSION_FONT_SIZE;
    } catch { return DEFAULT_DISCUSSION_FONT_SIZE; }
  });
  const [submissionMode, setSubmissionMode] = useState<"discussion" | "draft">("discussion");
  const [draft, setDraft] = useState<BookLessonDraft | null>(null);
  const [draftId, setDraftId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [research, setResearch] = useState<BookResearchReport | null>(null);
  const [prepNotice, setPrepNotice] = useState("");
  const [existingLessonId, setExistingLessonId] = useState("");
  const [pendingDiscussion, setPendingDiscussion] = useState<{ message: string; answer: string } | null>(null);
  const [discussionStatus, setDiscussionStatus] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [copiedReply, setCopiedReply] = useState<number | null>(null);
  const [speakingReply, setSpeakingReply] = useState<number | null>(null);
  const [ttsLoadingReply, setTtsLoadingReply] = useState<number | null>(null);
  const discussionRequest = useRef<AbortController | null>(null);
  const ttsRequest = useRef<AbortController | null>(null);
  const audioPlayback = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrls = useRef(new Set<string>());
  const chatRef = useRef<HTMLDivElement>(null);
  const rootElement = useRef<HTMLElement>(null);
  const discussionSource = useRef<string | null>(null);
  const followReply = useRef(true);
  useEffect(() => {
    try { window.localStorage.setItem(DISCUSSION_FONT_SIZE_STORAGE_KEY, String(discussionFontSize)); }
    catch { /* Keep the control usable when browser storage is unavailable. */ }
  }, [discussionFontSize]);
  useEffect(() => {
    const chat = chatRef.current;
    if (chat && followReply.current) chat.scrollTop = chat.scrollHeight;
  }, [history, pendingDiscussion]);
  useEffect(() => {
    if (!pendingDiscussion || !busy) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [Boolean(pendingDiscussion), busy]);
  useEffect(() => () => { discussionRequest.current?.abort(); stopReplyAudio(); }, [root, scopeQuery, book?.sourceFingerprint]);
  useEffect(() => { const stop = () => stopReplyAudio(); window.addEventListener("magazine-reader:stop-reply-audio", stop); return () => window.removeEventListener("magazine-reader:stop-reply-audio", stop); }, []);
  useEffect(() => {
    if (!onClose) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && rootElement.current?.contains(document.activeElement)) { event.preventDefault(); onClose(); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  function stopReplyAudio() {
    ttsRequest.current?.abort();
    ttsRequest.current = null;
    if (audioPlayback.current) {
      audioPlayback.current.pause();
      audioPlayback.current.onended = null;
      audioPlayback.current.onerror = null;
      audioPlayback.current = null;
    }
    for (const url of audioObjectUrls.current) URL.revokeObjectURL(url);
    audioObjectUrls.current.clear();
    setSpeakingReply(null);
    setTtsLoadingReply(null);
  }

  async function readReply(index: number) {
    if (speakingReply === index || ttsLoadingReply === index) { stopReplyAudio(); return; }
    stopReplyAudio();
    window.dispatchEvent(new Event("magazine-reader:pause-chinese-audio"));
    const reply = chatRef.current?.querySelector<HTMLElement>(`[data-reply-index="${index}"] .chat-markdown`);
    const chunks = splitSpeechText(reply?.innerText ?? reply?.textContent ?? "");
    if (!chunks.length) return;
    const controller = new AbortController();
    ttsRequest.current = controller;
    setTtsLoadingReply(index);

    async function prepareAudio(chunk: string): Promise<{ url: string } | { error: Error } | null> {
      try {
        const response = await fetch("/api/prep/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: chunk }), signal: controller.signal });
        if (!response.ok) {
          const result = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(result?.error ?? "Ciallo 语音生成失败，请重新尝试朗读。");
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return null;
        const url = URL.createObjectURL(blob);
        audioObjectUrls.current.add(url);
        return { url };
      } catch (err) {
        if (controller.signal.aborted) return null;
        return { error: err instanceof Error ? err : new Error("Ciallo 语音生成失败，请重新尝试朗读。") };
      }
    }

    function releaseAudioUrl(url: string) {
      URL.revokeObjectURL(url);
      audioObjectUrls.current.delete(url);
    }

    try {
      let prepared = prepareAudio(chunks[0]!);
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const result = await prepared;
        if (controller.signal.aborted || !result) return;
        if ("error" in result) throw result.error;
        const url = result.url;
        const nextPrepared = chunkIndex + 1 < chunks.length ? prepareAudio(chunks[chunkIndex + 1]!) : null;
        const audio = new Audio(url);
        audioPlayback.current = audio;
        setTtsLoadingReply(null);
        setSpeakingReply(index);
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const finish = (complete: () => void) => {
            if (settled) return;
            settled = true;
            controller.signal.removeEventListener("abort", onAbort);
            audio.onended = null;
            audio.onerror = null;
            complete();
          };
          const onAbort = () => finish(resolve);
          audio.onended = () => finish(resolve);
          audio.onerror = () => finish(() => reject(new Error("Ciallo 音频播放失败，请重新尝试朗读。")));
          controller.signal.addEventListener("abort", onAbort, { once: true });
          void audio.play().catch((err: unknown) => finish(() => reject(err)));
        });
        releaseAudioUrl(url);
        if (audioPlayback.current === audio) audioPlayback.current = null;
        if (controller.signal.aborted) return;
        setSpeakingReply(null);
        if (nextPrepared) setTtsLoadingReply(index);
        prepared = nextPrepared ?? Promise.resolve(null);
      }
      setSpeakingReply(null);
      setTtsLoadingReply(null);
      if (ttsRequest.current === controller) ttsRequest.current = null;
    } catch (err) {
      const wasStopped = controller.signal.aborted;
      stopReplyAudio();
      if (!wasStopped) setError(err instanceof Error ? err.message : "Ciallo 语音生成失败，请重新尝试朗读。");
    }
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    discussionSource.current = null;
    setHistoryReady(false); setHistory([]); setMessage(""); setSubmissionMode("discussion");
    setChapterId(""); setDraft(null); setDraftId(""); setError(""); setResearch(null); setPrepNotice(""); setExistingLessonId(""); setBusy(false); setPendingDiscussion(null);
    void Promise.all([api<AuthState>("/api/prep/auth", undefined, controller.signal), api<PrepChatMessage[]>(endpoint("history"), undefined, controller.signal, response => { if (active) discussionSource.current = response.headers.get("X-Assistant-Source"); }), fetchCodexPrepModelPreferences()]).then(([a, h, preferences]) => {
      if (active) { setAuth(a); setHistory(h); setHistoryReady(true); setModelPreferences(preferences); setResearch([...h].reverse().find((turn) => turn.research)?.research ?? null); }
    }).catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "备课服务不可用"); });
    return () => { active = false; controller.abort(); };
  }, [root, scopeQuery, book?.sourceFingerprint, historyAttempt]);

  useEffect(() => {
    if (!auth?.pending) return;
    const timer = window.setInterval(() => {
      void api<AuthState>("/api/prep/auth").then((status) => {
        setAuth(status);
        if (!status.pending) setAuthUrl("");
        if (status.sharing) setError("");
      }).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [auth?.pending]);

  async function connect() {
    if (busy || auth?.pending) return;
    // Open synchronously to avoid the browser's popup blocker after the async request.
    const popup = window.open("about:blank", "_blank");
    setBusy(true); setError("");
    try {
      const value = await api<{ url: string }>("/api/prep/auth/start", {});
      setAuthUrl(value.url);
      setAuth((current) => ({ ...(current ?? { connected: false, sharing: false }), pending: true }));
      if (popup) popup.location.href = value.url;
      else setError("浏览器阻止了授权弹窗，请点击下方链接继续。");
    } catch (err) {
      popup?.close();
      setError(err instanceof Error ? err.message : "无法发起 OAuth 授权");
    } finally { setBusy(false); }
  }

  async function refreshModelCatalog() {
    setModelBusy(true); setModelNotice("");
    try {
      const result = await fetchCodexPrepModels();
      setModelCatalog(result.models); setDefaultModelId(result.defaultModelId); setModelCatalogLoaded(true);
      setModelNotice(result.models.length ? "已加载官方模型选项。目录不代表账号一定有调用权限；实际权限由生成请求验证。" : "Codex 当前未返回可选模型。");
    } catch (err) {
      setModelCatalogLoaded(false);
      const message = err instanceof Error ? err.message : "无法读取 Codex 模型目录";
      setModelNotice(auth?.sharing ? message : "请先完成 ChatGPT 授权，再加载可选择的 Codex 模型。" );
    }
    finally { setModelBusy(false); }
  }

  async function saveModelSettings() {
    setModelBusy(true); setModelNotice("");
    try { setModelPreferences(await saveCodexPrepModelPreferences(modelPreferences)); setModelNotice("模型偏好已保存在本机。"); }
    catch (err) { setModelNotice(err instanceof Error ? err.message : "模型设置保存失败"); }
    finally { setModelBusy(false); }
  }

  const activeModel = modelPreferences.modelMode === "manual"
    ? modelCatalog.find((model) => model.model === modelPreferences.model)
    : modelCatalog.find((model) => model.model === defaultModelId) ?? modelCatalog.find((model) => model.isDefault);
  const availableEfforts = activeModel?.supportedReasoningEfforts ?? [];
  const displayDiscussionText = (turn: PrepChatMessage) => turn.role === "assistant"
    ? turn.text.replace(/^\s*(?:[-*]\s*)?topicKey\s*:\s*.*(?:\n|$)/gim, "").replace(readerContext ? /\s*\[P\d+\]/gi : /$^/, "").trim()
    : turn.text;

  async function converse(generateDraft: boolean, promptOverride?: string) {
    const submitted = (promptOverride ?? message).trim();
    if (!submitted || busy || !historyReady || (generateDraft && !book)) return;
    const controller = new AbortController();
    discussionRequest.current = controller;
    setBusy(true); setError(""); setPrepNotice(""); setExistingLessonId(""); setResearch(null);
    if (generateDraft) setPrepNotice("正在检索相关原文并核对已有主题…");
    if (!generateDraft) {
      followReply.current = true;
      setPendingDiscussion({ message: submitted, answer: "" }); setMessage(""); setElapsed(0);
      setDiscussionStatus(book ? "正在连接 Codex、准备书籍上下文…" : "正在连接 Codex、准备当前页面内容…");
    }
    try {
      const currentParagraphIndex = readerContext?.current()?.currentParagraphIndex() ?? undefined;
      const body = { message: submitted, chapterId: chapterId || undefined, draft: generateDraft, ...(currentParagraphIndex === undefined ? {} : { currentParagraphIndex }) };
      if (generateDraft) {
        const response = await api<DraftResponse>(endpoint("chat"), body, controller.signal);
        if (controller.signal.aborted) return;
        setDraft(response.draft ?? null); setDraftId(response.draftId ?? ""); setMessage("");
        setResearch(response.research ?? null); setPrepNotice(response.answer); setExistingLessonId(response.existingLessonId ?? "");
      } else {
        const response = await fetch(endpoint("chat"), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify(body), signal: controller.signal });
        if (!book && response.ok) {
          const source = response.headers.get("X-Assistant-Source");
          if (source && discussionSource.current && source !== discussionSource.current) setHistory([]);
          discussionSource.current = source;
        }
        let paragraphIndexes: number[] | undefined;
        const answer = await readPrepDiscussion(response, (event) => {
          if (controller.signal.aborted) return;
          if (event.type === "delta") {
            setPendingDiscussion((current) => current ? { ...current, answer: current.answer + event.text } : current);
            setDiscussionStatus("Codex 正在回复…");
          }
          if (event.type === "status") setDiscussionStatus(event.text);
          if (event.type === "research") setResearch(event.research);
          if (event.type === "done" && Array.isArray(event.paragraphIndexes)) {
            const count = readerContext?.current()?.paragraphCount ?? 0;
            paragraphIndexes = [...new Set(event.paragraphIndexes.filter(index => Number.isInteger(index) && index >= 0 && index < count))].slice(0, 8);
          }
        });
        if (controller.signal.aborted) return;
        setHistory((current) => [...current, { role: "user", text: submitted }, { role: "assistant", text: answer, ...(paragraphIndexes?.length ? { paragraphIndexes } : {}) }]);
        setPendingDiscussion(null);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Codex 对话失败");
      if (generateDraft) setPrepNotice("");
      if (!generateDraft) { setDiscussionStatus("本轮未完成，片段尚未保存。可修改输入后重试。"); setMessage((current) => current || submitted); }
    } finally { if (!controller.signal.aborted) { setBusy(false); discussionRequest.current = null; } }
  }

  async function discard() {
    if (!draftId || busy) return;
    setBusy(true); setError("");
    try { await api(`${root}/prep/discard`, { draftId }); setDraft(null); setDraftId(""); setPrepNotice("候选已放弃，可重新讨论或准备。"); }
    catch (err) { setError(err instanceof Error ? err.message : "未能放弃候选，请重试。"); }
    finally { setBusy(false); }
  }

  async function clearHistory() {
    if (busy || !history.length || !window.confirm("清空当前范围的 Codex 讨论记录？此操作无法撤销。")) return;
    setBusy(true); setError("");
    try {
      await deleteApi(endpoint("history"));
      stopReplyAudio();
      setCopiedReply(null);
      setHistory([]); setResearch(null); setDiscussionStatus("");
      followReply.current = true;
    } catch (err) { setError(err instanceof Error ? err.message : "未能清空讨论记录，请重试"); }
    finally { setBusy(false); }
  }

  async function copyReply(index: number) {
    const reply = chatRef.current?.querySelector<HTMLElement>(`[data-reply-index="${index}"] .chat-markdown`);
    const text = reply?.innerText.trim() || reply?.textContent?.trim();
    if (!text) return;
    await copyDiscussionText(text, index);
  }

  async function copyDiscussionText(text: string, index?: number) {
    if (!text.trim()) return;
    try {
      await copyTextToClipboard(text);
      if (index !== undefined) {
        setCopiedReply(index);
        window.setTimeout(() => setCopiedReply((current) => current === index ? null : current), 1600);
      }
    } catch { setError("复制失败，请检查浏览器的剪贴板权限。"); }
  }

  async function approve() {
    if (!draftId || busy) return;
    setBusy(true); setError("");
    try {
      const lesson = await api<BookLesson>(`${root}/prep/approve`, { draftId });
      onLessonSaved?.(lesson);
      setDraft(null); setDraftId(""); setPrepNotice("已保存到精选阅读，可开始阅读。"); setExistingLessonId(lesson.id);
      onOpenLesson?.(lesson, [lesson, ...lessons.filter(item => item.id !== lesson.id)]);
    } catch (err) { setError(err instanceof Error ? err.message : "保存失败"); }
    finally { setBusy(false); }
  }

  return (
    <aside ref={rootElement} className={`codex-prep-panel${onClose ? " is-global-assistant" : ""}`} aria-label={book ? "Codex 备课侧栏" : "Codex 助手侧栏"} data-testid="codex-prep-panel">
      {onClose && <div className="assistant-context"><span title={scopeLabel ?? book?.title}>{scopeLabel ?? book?.title ?? "全部书刊"}</span><button type="button" aria-label="收起 Codex 助手" title="收起 Codex 助手" onClick={onClose}>×</button></div>}
      <details className="codex-prep-options">
        <summary aria-label={book ? "备课设置" : "助手设置"} title={book ? "备课设置" : "助手设置"}><span aria-hidden="true">⌄</span></summary>
        <div className="codex-prep-options-content">
        <div className="codex-prep-heading"><h2>{book ? "Codex 备课" : "Codex 助手"}</h2></div>
        {book ? <><div className="eyebrow">Book → Essential Reading</div><p className="codex-prep-small">先与 Codex 讨论原书中值得阅读的观点，确认后再保存成简易英文材料。</p></> : <p className="codex-prep-small">讨论范围：{scopeLabel}。根据本机书刊目录与按需读取的原文回答；切换范围会显示对应的聊天记录。</p>}
        <details className="codex-prep-access" onToggle={(event) => { if (event.currentTarget.open && !modelCatalogLoaded && !modelBusy) void refreshModelCatalog(); }}>
        <summary>
          <strong>连接与模型设置</strong>
          <span>{auth?.sharing ? "ChatGPT 已连接" : auth?.pending ? "正在授权" : auth ? "尚未连接" : "读取连接状态…"} · {modelPreferences.modelMode === "manual" ? modelCatalog.find((item) => item.model === modelPreferences.model)?.displayName ?? modelPreferences.model ?? "手动模型" : modelCatalog.find((item) => item.model === defaultModelId)?.displayName ?? "官方默认模型"}</span>
        </summary>
        <div className="codex-prep-auth">
          {auth?.sharing ? <p className="codex-prep-ok">ChatGPT 已授权{auth.email ? ` · ${auth.email}` : ""}</p> : <p>对话需要你本人授权 ChatGPT 计划额度。</p>}
          {!auth?.sharing && <button className="primary-button" disabled={busy || auth?.pending} onClick={() => void connect()}>Continue with ChatGPT</button>}
          {auth?.connected && <button className="text-button" disabled={busy} onClick={() => { if (window.confirm("断开 ChatGPT 账号与本机备课服务的连接？")) void api<AuthState>("/api/prep/auth/disconnect", {}).then(setAuth).catch((err: unknown) => setError(String(err))); }}>断开连接</button>}
          {authUrl && !auth?.sharing && <a href={authUrl} target="_blank" rel="noreferrer">在浏览器中完成授权 ↗</a>}
          {auth?.pending && <small>正在等待登录或验证授权，连接状态会自动刷新。</small>}
          {auth?.error && <p className="codex-prep-error" role="alert">{auth.error}</p>}
        </div>
        <section className="codex-prep-model-settings" aria-labelledby="codex-prep-model-heading">
        <h3 id="codex-prep-model-heading">模型与思考等级</h3>
        <p className="codex-prep-small">默认跟随当前 Codex 官方默认模型与思考等级。设置仅保存在本机，不使用 AI Provider 的 API Key，也不会自动改用其他模型。</p>
        <button className="text-button" disabled={modelBusy} onClick={() => void refreshModelCatalog()}>{modelBusy ? "读取中…" : modelCatalogLoaded ? "刷新官方模型列表" : "加载官方模型列表"}</button>
        {modelCatalog.length > 0 && <p className="codex-prep-small">Codex 当前默认：{modelCatalog.find((item) => item.model === defaultModelId)?.displayName ?? modelCatalog.find((item) => item.isDefault)?.displayName ?? "未提供"}</p>}
        <label className="codex-prep-label">模型
          <select aria-label="Codex 备课模型" value={modelPreferences.modelMode === "auto" ? "auto" : modelPreferences.model ?? ""} disabled={modelBusy} onChange={(event) => setModelPreferences((current) => ({ ...current, modelMode: event.target.value === "auto" ? "auto" : "manual", model: event.target.value === "auto" ? null : event.target.value }))}>
            <option value="auto">自动（推荐，使用 Codex 官方默认）</option>
            {modelPreferences.modelMode === "manual" && modelPreferences.model && !modelCatalog.some((item) => item.model === modelPreferences.model) && <option value={modelPreferences.model}>不可用：{modelPreferences.model}</option>}
            {modelCatalog.map((item) => <option key={item.model} value={item.model}>{item.displayName} · {item.model}{item.isDefault ? "（官方默认）" : ""}</option>)}
          </select>
        </label>
        <label className="codex-prep-label">思考等级
          <select aria-label="Codex 思考等级" value={modelPreferences.reasoningMode === "auto" ? "auto" : modelPreferences.reasoningEffort ?? ""} disabled={modelBusy} onChange={(event) => setModelPreferences((current) => ({ ...current, reasoningMode: event.target.value === "auto" ? "auto" : "manual", reasoningEffort: event.target.value === "auto" ? null : event.target.value }))}>
            <option value="auto">自动（使用官方默认）</option>
            {modelPreferences.reasoningMode === "manual" && modelPreferences.reasoningEffort && !availableEfforts.some((item) => item.reasoningEffort === modelPreferences.reasoningEffort) && <option value={modelPreferences.reasoningEffort}>当前模型不支持：{modelPreferences.reasoningEffort}</option>}
            {availableEfforts.map((item) => <option key={item.reasoningEffort} value={item.reasoningEffort}>{item.reasoningEffort} · {item.description}</option>)}
          </select>
        </label>
        {modelPreferences.modelMode === "manual" && !activeModel && <p className="codex-prep-error" role="alert">所选模型不在当前官方列表中。请选择其他模型或切回自动；系统不会静默切换。</p>}
        {modelPreferences.reasoningMode === "manual" && activeModel && !availableEfforts.some((item) => item.reasoningEffort === modelPreferences.reasoningEffort) && <p className="codex-prep-error" role="alert">该思考等级不受当前模型支持，请选择官方列出的等级。</p>}
        <button className="primary-button" disabled={modelBusy} onClick={() => void saveModelSettings()}>保存模型设置</button>
        {modelNotice && <p className="codex-prep-small" role="status">{modelNotice}</p>}
        {activeModel?.upgradeInfo && <p className="codex-prep-small">官方升级建议：{activeModel.upgradeInfo.model}{activeModel.upgradeInfo.upgradeCopy ? ` · ${activeModel.upgradeInfo.upgradeCopy}` : ""}</p>}
        {!activeModel?.upgradeInfo && activeModel?.upgrade && <p className="codex-prep-small">官方升级建议：{activeModel.upgrade}</p>}
        </section>
        </details>
          {book && <><label className="codex-prep-label">研究范围
            <select disabled={busy} value={chapterId} onChange={(event) => setChapterId(event.target.value)} aria-label="选择备课章节">
              <option value="">全书探索（全文检索＋按需读原文）</option>
              {book.chapters.filter((chapter) => chapter.role === "chapter").map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
            </select>
          </label>
          <p className="codex-prep-small">先探索选题，再讨论并深入相关原文，最后生成精选阅读。全书可检索不代表已逐段读完。</p>
        {research && <details data-testid="book-research-report"><summary>本轮实际读取的原文依据</summary>
          <p>全文可检索：{research.indexedChapters} 个章节/单元，共 {research.indexedParagraphs} 段。</p>
          <p>本轮范围：{research.scopeChapterId ? book.chapters.find((chapter) => chapter.id === research.scopeChapterId)?.title ?? "指定章节" : "全书探索"}</p>
          <p>检索词：{research.queries.join("；") || "按指定段落读取"}</p>
          {research.read.map((entry) => <p key={entry.chapterId}>{entry.title}：{entry.paragraphs.map((index) => `P${index + 1}`).join("、")}</p>)}
          {research.truncated && <p>部分命中段落超出本轮长度限制，尚未读取；可继续聚焦相关章节。</p>}
          <p>仅以上列出的完整段落用于本轮证据核对，不能据此声称读完了全书。</p>
        </details>}</>}
        <section className="codex-prep-display-settings" aria-label="对话显示设置">
          <label htmlFor="codex-prep-font-size">对话字体大小</label>
          <div className="codex-prep-font-size-control"><input id="codex-prep-font-size" type="range" min="14" max="24" step="1" value={discussionFontSize} onChange={(event) => setDiscussionFontSize(Number(event.target.value))} /><output htmlFor="codex-prep-font-size">{discussionFontSize}px</output></div>
          <small>同时调整你和 Codex 的消息及输入框，并保存在本机</small>
        </section>
        </div>
      </details>

      <>
        {prepNotice && <div role="status" data-testid="prep-topic-notice"><p>{prepNotice}</p>{existingLessonId && lessons.some((lesson) => lesson.id === existingLessonId) && <button className="text-button" onClick={() => { const lesson = lessons.find((lesson) => lesson.id === existingLessonId); if (lesson) onOpenLesson?.(lesson, lessons); }}>打开已有精选阅读</button>}</div>}
        <div className="codex-prep-chat" ref={chatRef} onScroll={(event) => { const chat = event.currentTarget; followReply.current = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40; }} aria-live="polite">
          {!book && !history.length && !pendingDiscussion && <p className="assistant-empty">{historyReady ? "可以问我选什么、讲了什么，或一起理解当前内容。" : "正在读取讨论记录…"}</p>}
          {history.map((turn, index) => <div className={`codex-prep-turn ${turn.role}`} key={`${index}-${turn.role}`} data-reply-index={turn.role === "assistant" ? index : undefined} style={{ fontSize: `${discussionFontSize}px` }}>{turn.role === "assistant" && <span className="codex-prep-turn-author">Codex</span>}<ChatMarkdown text={displayDiscussionText(turn)} />{turn.role === "assistant" && readerContext && <div className="reading-assistant-references">{(turn.paragraphIndexes ?? []).filter(index => Number.isInteger(index) && index >= 0 && index < (readerContext.current()?.paragraphCount ?? 0)).map(index => <button key={index} type="button" onClick={() => { if (window.matchMedia("(max-width: 1150px)").matches) { onClose?.(); requestAnimationFrame(() => readerContext.current()?.locateParagraph(index)); } else readerContext.current()?.locateParagraph(index); }}>第 {index + 1} 段</button>)}<button type="button" disabled={busy || !history.slice(0, index).some(item => item.role === "user")} onClick={() => { const previous = history.slice(0, index).reverse().find(item => item.role === "user"); if (previous) void converse(false, previous.text); }}>重新回答</button></div>}{turn.role === "assistant" ? <div className="codex-prep-reply-actions" aria-label="回复操作"><button type="button" aria-label="复制回复" data-tooltip={copiedReply === index ? "已复制" : "复制回复"} onClick={() => void copyReply(index)}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="6" width="9" height="11" rx="1.5"/><path d="M13 6V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v9A1.5 1.5 0 0 0 4.5 15H7"/></svg></button><button type="button" aria-label={speakingReply === index ? "停止朗读" : ttsLoadingReply === index ? "正在加载音频" : "朗读"} data-tooltip={speakingReply === index ? "停止朗读" : ttsLoadingReply === index ? "正在加载音频" : "朗读"} aria-busy={ttsLoadingReply === index} onClick={() => void readReply(index)}><svg viewBox="0 0 20 20" aria-hidden="true">{speakingReply === index || ttsLoadingReply === index ? <><rect x="6" y="5" width="3" height="10" rx="1"/><rect x="11" y="5" width="3" height="10" rx="1"/></> : <><path d="M3 8v4h3l4 3V5L6 8H3Z"/><path d="M13 7a4 4 0 0 1 0 6M15 5a7 7 0 0 1 0 10"/></>}</svg></button></div> : <div className="codex-prep-reply-actions user-message-actions" aria-label="消息操作"><button type="button" aria-label="复制回复" data-tooltip="复制回复" onClick={() => void copyDiscussionText(turn.text)}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="6" width="9" height="11" rx="1.5"/><path d="M13 6V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v9A1.5 1.5 0 0 0 4.5 15H7"/></svg></button></div>}</div>)}
          {pendingDiscussion && <>
            <div className="codex-prep-turn user" style={{ fontSize: `${discussionFontSize}px` }}><ChatMarkdown text={pendingDiscussion.message} /><div className="codex-prep-reply-actions user-message-actions" aria-label="消息操作"><button type="button" aria-label="复制回复" data-tooltip="复制回复" onClick={() => void copyDiscussionText(pendingDiscussion.message)}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="6" width="9" height="11" rx="1.5"/><path d="M13 6V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v9A1.5 1.5 0 0 0 4.5 15H7"/></svg></button></div></div>
            <div className="codex-prep-turn assistant" data-testid="prep-streaming-answer" style={{ fontSize: `${discussionFontSize}px` }}><span className="codex-prep-turn-author">Codex</span><ChatMarkdown text={displayDiscussionText({ role: "assistant", text: pendingDiscussion.answer })} /><small role="status">{discussionStatus}{busy ? ` · 已等待 ${elapsed} 秒` : ""}</small></div>
          </>}
        </div>
        {history.length > 0 && <div className="codex-prep-composer-heading"><button className="text-button" aria-label="清空讨论记录" title="清空讨论记录" disabled={busy} onClick={() => void clearHistory()}>清空</button></div>}
        <label className="codex-prep-composer-input">
          <textarea id="codex-prep-message" aria-label="消息输入" aria-keyshortcuts="Control+Enter Meta+Enter" value={message} rows={3} maxLength={2000} style={{ fontSize: `${discussionFontSize}px` }} onChange={(event) => setMessage(event.target.value)} onKeyDown={event => { if (!event.nativeEvent.isComposing && event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (auth?.sharing) void converse(submissionMode === "draft"); } }} />
        </label>
        <div className="codex-prep-composer-actions">
          <div className="codex-prep-quick-prompts" aria-label={book ? "备课快捷提示" : "阅读快捷提示"}>
            <div>{quickPrompts.map((item) => <button key={item.label} type="button" className="text-button" disabled={busy} onClick={() => { setMessage(item.prompt); setSubmissionMode(item.mode); }}>{item.label}</button>)}</div>
          </div>
          <div className="codex-prep-submit-row">
            <button className="primary-button" disabled={busy || !historyReady || !auth?.sharing || !message.trim()} onClick={() => void converse(submissionMode === "draft")}>{busy ? "Codex 正在处理…" : submissionMode === "draft" ? "生成一篇候选" : "发送"}</button>
          </div>
        </div>
        {submissionMode === "draft" && <p className="codex-prep-submit-hint">将生成一篇待确认的精选阅读；确认后才会保存。</p>}
        {book && draft && <section className="codex-prep-draft" data-testid="essential-reading-draft">
          <div className="eyebrow">待你确认 · 未保存</div><h3>{draft.titleZh}</h3><p>{draft.teaserZh}</p>
          <div className="codex-prep-english" lang="en">{draft.english}</div>
          <details><summary>中文解读与原书出处</summary><p>{draft.explanationZh}</p><p>重要表达：{draft.keywords.join(" / ")}</p><small>{draft.evidence.map((entry) => `${book.chapters.find((chapter) => chapter.id === entry.chapterId)?.title ?? entry.chapterId} · P${entry.paragraphIndex + 1}`).join("；")}</small></details>
          <button className="primary-button" disabled={busy} onClick={() => void approve()}>确认内容并保存到精选阅读</button>
          <button className="text-button" disabled={busy} onClick={() => void discard()}>放弃候选</button>
        </section>}
      </>
      {error && <p className="codex-prep-error" role="alert">{error}</p>}
      {error && !historyReady && <button className="text-button" onClick={() => setHistoryAttempt(value => value + 1)}>重新读取讨论记录</button>}
    </aside>
  );
}
