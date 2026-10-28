/** Start synthesizing the next narration chunks as soon as their text is known. */
export function adaptChineseAudioPlayer(source, filename) {
  if (filename.endsWith('/server/app.ts')) {
    // Unit tests and small source probes may use a minimal server fragment. The
    // actual upstream file has this marker; leave unrelated fragments intact.
    if (!source.includes('const cialloTtsFetch = options.cialloTtsFetchImpl ?? fetch;')) return source;
    const fsImport = 'import { existsSync } from "node:fs";';
    if (source.split(fsImport).length !== 2) throw new Error('Chinese TTS import seam changed');
    source = source.replace(fsImport, `${fsImport}
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";`);
    const fetchSeam = '  const cialloTtsFetch = options.cialloTtsFetchImpl ?? fetch;';
    if (source.split(fetchSeam).length !== 2) throw new Error('Chinese TTS client seam changed');
    source = source.replace(fetchSeam, `${fetchSeam}
  const edgeTtsExecutable = process.env.VANTILO_EDGE_TTS_EXECUTABLE;
  const synthesizeWithEdgeTts = async (text: string, voice: string): Promise<Buffer | null> => {
    if (!edgeTtsExecutable) return null;
    const directory = await mkdtemp(path.join(os.tmpdir(), "vantilo-edge-tts-"));
    const destination = path.join(directory, "speech.mp3");
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(edgeTtsExecutable, ["--voice", voice, "--text", text, "--write-media", destination], { stdio: ["ignore", "ignore", "ignore"] });
        const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Edge TTS synthesis timed out")); }, 30_000);
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("exit", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("Edge TTS synthesis failed")); });
      });
      const audio = await readFile(destination);
      const hasMp3Header = audio.length > 100 && (audio.subarray(0, 3).toString("ascii") === "ID3" || (audio[0] === 0xff && ((audio[1] ?? 0) & 0xe0) === 0xe0));
      return hasMp3Header ? audio : null;
    } catch { return null; }
    finally { await rm(directory, { recursive: true, force: true }).catch(() => {}); }
  };`);
    const voiceSeam = '    const voice = chinese ? "zh-CN-XiaochenMultilingualNeural" : "en-US-AriaNeural";';
    if (source.split(voiceSeam).length !== 2) throw new Error('Chinese TTS voice seam changed');
    source = source.replace(voiceSeam, `${voiceSeam}
    const edgeAudio = await synthesizeWithEdgeTts(chinese ? chineseSpeechText(text) : text, chinese ? "zh-CN-XiaoxiaoNeural" : "en-US-AriaNeural");
    if (edgeAudio) return reply.header("Cache-Control", "no-store").type("audio/mpeg").send(edgeAudio);`);
    const check = '      const validMp3 = audio.length > 2 && (audio.subarray(0, 3).toString("ascii") === "ID3" || (audio[0] === 0xff && ((audio[1] ?? 0) & 0xe0) === 0xe0));';
    const report = '      if (!validMp3) return reply.code(502).send({ error: "Ciallo TTS 返回的音频无法识别，请稍后重试。" });';
    if (source.split(check).length !== 2 || source.split(report).length !== 2) throw new Error('Chinese TTS validation seam changed');
    source = source.replace(check, `      const hasMp3Frame = (start: number, end: number) => {
        for (let index = start; index <= Math.min(end, audio.length - 4); index++) {
          const second = audio[index + 1] ?? 0, third = audio[index + 2] ?? 0;
          const version = (second >> 3) & 3, layer = (second >> 1) & 3;
          const bitrate = (third >> 4) & 15, sampleRate = (third >> 2) & 3;
          if (audio[index] === 0xff && (second & 0xe0) === 0xe0 && version !== 1 && layer !== 0 && bitrate !== 0 && bitrate !== 15 && sampleRate !== 3) return true;
        }
        return false;
      };
      const validMp3 = audio.length > 2 && (audio.subarray(0, 3).toString("ascii") === "ID3" || hasMp3Frame(0, 4096));`);
    source = source.replace(report, '      if (!validMp3) return reply.code(502).send({ error: `Ciallo TTS 返回的音频无法识别（${audio.length} 字节，头部 ${audio.subarray(0, 8).toString("hex")}），请稍后重试。` });');
    return source;
  }
  if (filename.endsWith('/frontend/chinese-reader.tsx')) {
    const exact = (before, after) => {
      if (source.split(before).length !== 2) throw new Error('Chinese reader interruption status seam changed');
      source = source.replace(before, after);
    };
    exact('phase === "paused" ? "继续朗读" : phase === "complete" ? "重新朗读" : "播放中文"',
      'phase === "paused" ? "继续朗读" : phase === "complete" ? "重新朗读" : phase === "error" ? "重试朗读" : "播放中文"');
    exact('phase === "complete" ? "已听完" : phase === "playing" ? "正在朗读" : "听书"',
      'phase === "complete" ? "已听完" : phase === "playing" ? "正在朗读" : phase === "error" ? "朗读中断" : "听书"');
    exact('Ciallo TTS · 晓辰多语言', 'Edge TTS · 晓晓，失败时使用晓辰');
    return source;
  }
  if (!filename.endsWith('/frontend/chinese-audio-player.ts')) return source;
  const start = source.indexOf('    const prepare = async (position: SpeechCursor): Promise<Prepared> => {');
  const loop = source.indexOf('      while (valid()) {', start);
  if (start < 0 || loop < 0) throw new Error('Chinese audio prefetch seams changed');
  const adapted = `    type SpeechJob = { result: Promise<Prepared>; next: Promise<SpeechCursor | null>; isReady: () => boolean };
    const synthesize = async (text: string): Promise<Blob> => {
      const startedAt = Date.now();
      try { return await this.dependencies.synthesize(text, signal); }
      catch (error) {
        // Retry only fast failures. A request that already took a long time is
        // likely a slow upstream timeout; repeating it would double the wait.
        const reason = error instanceof Error ? error.message : String(error);
        if (!valid() || (Date.now() - startedAt > 12_000 && !reason.includes("音频无法识别"))) throw error;
        await new Promise<void>(resolve => setTimeout(resolve, 500));
        if (!valid()) throw error;
        return this.dependencies.synthesize(text, signal);
      }
    };
    const prepare = (position: SpeechCursor): SpeechJob => {
      let resolveNext!: (cursor: SpeechCursor | null) => void;
      let ready = false;
      const next = new Promise<SpeechCursor | null>(resolve => { resolveNext = resolve; });
      const result = (async (): Promise<Prepared> => {
        try {
          const chunks = splitChineseSpeech(await this.dependencies.getText(position.paragraphIndex));
          if (!valid()) { resolveNext(null); return null; }
          if (!chunks.length) throw new Error("这一段没有可朗读的中文。");
          const chunkIndex = position.chunkText && chunks[position.chunkIndex] !== position.chunkText ? 0 : Math.min(position.chunkIndex, chunks.length - 1);
          const text = chunks[chunkIndex];
          const nextParagraph = this.dependencies.indices[this.dependencies.indices.indexOf(position.paragraphIndex) + 1];
          const nextCursor = chunkIndex + 1 < chunks.length ? { paragraphIndex: position.paragraphIndex, chunkIndex: chunkIndex + 1 }
            : nextParagraph !== undefined ? { paragraphIndex: nextParagraph, chunkIndex: 0 } : null;
          // Release the following synthesis job before this MP3 has finished generating.
          resolveNext(nextCursor);
          const blob = await synthesize(text);
          if (!valid()) return null;
          const url = (this.dependencies.createUrl ?? URL.createObjectURL)(blob); this.urls.add(url);
          return { part: { cursor: { ...position, chunkIndex, chunkText: text, seconds: chunkIndex === position.chunkIndex && (!position.chunkText || position.chunkText === text) ? position.seconds : 0 }, text, next: nextCursor, url } };
        } catch (error) {
          resolveNext(null);
          return valid() ? { error: error instanceof Error ? error : new Error("语音准备失败，请重试。") } : null;
        } finally { ready = true; }
      })();
      return { result, next, isReady: () => ready };
    };
    const advance = (item: Promise<SpeechJob | null>): Promise<SpeechJob | null> => item.then(async job => {
      if (!job) return null;
      const ready = await job.result;
      if (!ready || !("part" in ready) || !ready.part?.next) return null;
      const cursor = await job.next;
      return cursor && valid() ? prepare(cursor) : null;
    });
    try {
      let current: Promise<SpeechJob | null> = Promise.resolve(prepare(cursor));
      let ahead = advance(current);
      let following = advance(ahead);
`;
  source = source.slice(0, start) + adapted + source.slice(loop);
  const finishSeam = '          audio.onended = audio.onerror = null;';
  if (source.split(finishSeam).length !== 2) throw new Error('Chinese audio finish handler seam changed');
  source = source.replace(finishSeam, '          audio.onended = audio.onerror = audio.onabort = null;');
  const onErrorSeam = '          audio.onerror = () => finish(new Error("音频播放失败，请重试。"));';
  if (source.split(onErrorSeam).length !== 2) throw new Error('Chinese audio error handler seam changed');
  source = source.replace(onErrorSeam, onErrorSeam + '\n          audio.onabort = () => finish(new Error("音频播放中断，请点击播放重试。"));');
  const awaitCurrent = `      while (valid()) {
        const result = await current;
        if (!valid() || !result) break;
`;
  const awaitJob = `      while (valid()) {
        const job = await current;
        if (!valid()) break;
        if (!job) throw new Error("朗读任务意外结束，请点击播放重试。");
        if (!job.isReady()) this.dependencies.phase("loading");
        const result = await job.result;
        if (!valid()) break;
        if (!result) throw new Error("音频准备被中断，请点击播放重试。");
`;
  if (source.split(awaitCurrent).length !== 2) throw new Error('Chinese audio playback loop seam changed');
  source = source.replace(awaitCurrent, awaitJob);
  const queueSeam = '        current = ahead; ahead = following; following = advance(following);\n        if (!this.paused) this.dependencies.phase("loading");';
  if (source.split(queueSeam).length !== 2) throw new Error('Chinese audio queue seam changed');
  source = source.replace(queueSeam, `        // Match the release queue: keep two chunks prepared ahead while
        // each upstream synthesis finishes before the next request begins.
        current = ahead; ahead = following; following = advance(following);
        if (!this.paused) this.dependencies.phase("loading");`);
  return source;
}
