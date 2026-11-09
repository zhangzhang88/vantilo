import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { PassThrough, type Readable } from "node:stream";
import { createInterface } from "node:readline";
import path from "node:path";
import { DEFAULT_QWEN_TTS_VOICE, type QwenTtsVoice } from "../../shared/qwen-tts-voices.js";

/** The local Qwen3-TTS worker speaks one request at a time. Nothing is sent to a remote TTS service. */
export interface ChineseSpeechSource {
  warm(): Promise<void>;
  synthesize(text: string, signal: AbortSignal, language?: "zh" | "en", voice?: QwenTtsVoice, seed?: number): Readable;
  close(): void;
}

type SpeechJob = {
  id: string;
  text: string;
  language: "zh" | "en";
  voice: QwenTtsVoice;
  seed?: number;
  signal: AbortSignal;
  stream: PassThrough;
  onAbort: () => void;
  timer?: ReturnType<typeof setTimeout>;
  aborted: boolean;
};

const sampleRate = 24000;
const fixtureRoot = "/Volumes/Workspace/Development/Vantilo/tts-benchmarks/run-20261106-122508";
const defaultBinary = path.join(fixtureRoot, "extracted", "speech");
const defaultModel = path.join(fixtureRoot, "model", "Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf");
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Explicit paths take precedence; the verified M4 benchmark artifacts support the owner's development checkout. */
export function speechCppPaths(env: NodeJS.ProcessEnv = process.env) {
  const binary = env.VANTILO_SPEECH_CPP_BIN || defaultBinary;
  const model = env.VANTILO_SPEECH_CPP_MODEL || defaultModel;
  return { binary, model };
}

export class SpeechCppTts implements ChineseSpeechSource {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private resolveReady?: () => void;
  private rejectReady?: (error: Error) => void;
  private pending: SpeechJob[] = [];
  private active?: SpeechJob;
  private nextId = 0;
  private closing = false;

  constructor(private paths = speechCppPaths()) {}

  warm(): Promise<void> {
    if (this.closing) return Promise.reject(new Error("朗读服务已关闭"));
    if (this.ready) return this.ready;
    const { binary, model } = this.paths;
    if (!path.isAbsolute(binary) || !path.isAbsolute(model) || !existsSync(binary) || !existsSync(model)) {
      return Promise.reject(new Error("本地 Qwen3-TTS 尚未配置，请确认 speech.cpp 和 GGUF 模型位于 Workspace，或设置 VANTILO_SPEECH_CPP_BIN / VANTILO_SPEECH_CPP_MODEL。"));
    }
    this.ready = new Promise<void>((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    const startup = this.ready;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(binary, ["worker", model, "--voice", "serena", "--language", "zh"], {
        stdio: ["pipe", "pipe", "pipe"], shell: false,
      });
    } catch (error) {
      this.fail(message(error)); return startup;
    }
    this.child = child;
    let buffer = "";
    // EPIPE may arrive asynchronously if the worker exits while a request is being sent.
    // Handle it here rather than letting Node terminate the Reader service.
    child.stdin.on("error", () => {
      if (this.child === child && !this.closing) this.fail("本地 Qwen3-TTS 输入管道意外关闭");
    });
    child.stdout.on("error", () => {
      if (this.child === child && !this.closing) this.fail("本地 Qwen3-TTS 输出管道意外关闭");
    });
    const timeout = setTimeout(() => this.fail("Qwen3-TTS 模型启动超时"), 30000);
    this.ready.then(() => clearTimeout(timeout), () => clearTimeout(timeout));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      buffer += data;
      if (buffer.length > 2_000_000) { this.fail("TTS Worker 输出超过安全限制"); return; }
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try { this.handle(JSON.parse(line)); } catch { this.fail("TTS Worker 协议数据无效"); return; }
      }
    });
    // stderr is deliberately not forwarded to a renderer or persisted with user text.
    child.stderr.resume();
    child.on("error", (error) => { if (this.child === child) this.fail(`无法启动 Qwen3-TTS：${error.message}`); });
    child.on("exit", () => { if (this.child === child && !this.closing) this.fail("Qwen3-TTS Worker 意外退出"); });
    return startup;
  }

  synthesize(text: string, signal: AbortSignal, language: "zh" | "en" = "zh", voice: QwenTtsVoice = DEFAULT_QWEN_TTS_VOICE, seed?: number): Readable {
    const stream = new PassThrough({ highWaterMark: 256 * 1024 });
    if (this.closing) { stream.end(JSON.stringify({ type: "error", message: "朗读服务已关闭" }) + "\n"); return stream; }
    if (this.pending.length >= 4) { stream.end(JSON.stringify({ type: "error", message: "朗读请求过多，请稍后重试" }) + "\n"); return stream; }
    const job: SpeechJob = {
      id: String(++this.nextId), text, language, voice, ...(seed === undefined ? {} : { seed }), signal, stream, aborted: false,
      onAbort: () => {},
    };
    job.onAbort = () => {
      job.aborted = true;
      stream.end();
      if (this.active === job) {
        this.child?.stdin.write(JSON.stringify({ type: "cancel", id: job.id }) + "\n");
      } else {
        this.pending = this.pending.filter(item => item !== job);
        signal.removeEventListener("abort", job.onAbort);
      }
    };
    if (signal.aborted) { job.onAbort(); return stream; }
    signal.addEventListener("abort", job.onAbort, { once: true });
    this.pending.push(job);
    this.pump();
    return stream;
  }

  private pump() {
    if (this.closing || this.active || !this.pending.length) return;
    const job = this.pending.shift()!;
    this.active = job;
    void this.warm().then(() => {
      if (!job.aborted && this.active === job) {
        job.timer = setTimeout(() => this.fail("Qwen3-TTS 单段生成超时"), 120000);
        this.child!.stdin.write(JSON.stringify({ type: "synthesize", id: job.id, text: job.text, voice: job.voice, language: job.language, ...(job.seed === undefined ? {} : { seed: job.seed }) }) + "\n");
      } else this.complete(job);
    }).catch(error => this.finishWithError(job, message(error)));
  }

  private handle(frame: unknown) {
    if (!frame || typeof frame !== "object") throw new Error("Invalid worker frame");
    const record = frame as Record<string, unknown>;
    if (record.type === "ready") {
      if (record.protocol !== 4) throw new Error("不支持的 TTS Worker 协议版本");
      this.resolveReady?.(); this.resolveReady = undefined; this.rejectReady = undefined;
      return;
    }
    if (record.type === "fatal") { this.fail("Qwen3-TTS Worker 无法加载模型"); return; }
    const job = this.active;
    if (!job || record.id !== job.id) throw new Error("TTS Worker 返回了未请求的音频");
    if (record.type === "chunk") {
      if (typeof record.pcm !== "string" || record.pcm.length > 1_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(record.pcm)) throw new Error("PCM 数据无效");
      if (!job.aborted) job.stream.write(JSON.stringify({ type: "chunk", pcm: record.pcm, sampleRate }) + "\n");
    } else if (record.type === "end" || record.type === "cancelled") {
      if (!job.aborted) job.stream.end(JSON.stringify({ type: record.type, stop: record.stop }) + "\n");
      this.complete(job);
    } else if (record.type === "error") {
      this.finishWithError(job, typeof (record.error as {message?:unknown})?.message === "string" ? (record.error as {message:string}).message : "语音合成失败");
    }
    // Progress frames carry no PCM and are not forwarded.
  }

  private complete(job: SpeechJob) {
    if (job.timer) clearTimeout(job.timer);
    job.signal.removeEventListener("abort", job.onAbort);
    if (this.active === job) this.active = undefined;
    this.pump();
  }
  private finishWithError(job: SpeechJob, reason: string) {
    if (!job.aborted) job.stream.end(JSON.stringify({ type: "error", message: reason }) + "\n");
    this.complete(job);
  }
  private fail(reason: string) {
    this.rejectReady?.(new Error(reason));
    this.rejectReady = undefined; this.resolveReady = undefined;
    this.ready = undefined;
    if (this.child) { const child = this.child; this.child = undefined; child.kill(); }
    const jobs = [this.active, ...this.pending].filter((j): j is SpeechJob => !!j);
    this.active = undefined; this.pending = [];
    for (const job of jobs) {
      if (job.timer) clearTimeout(job.timer);
      job.signal.removeEventListener("abort", job.onAbort);
      if (!job.aborted) job.stream.end(JSON.stringify({ type: "error", message: reason }) + "\n");
    }
  }
  close() {
    if (this.closing) return;
    this.closing = true;
    this.fail("朗读服务已关闭");
  }
}
