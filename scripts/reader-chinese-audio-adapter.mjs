/** Start synthesizing the next narration chunks as soon as their text is known. */
export function adaptChineseAudioPlayer(source, filename) {
  if (filename.endsWith('/server/app.ts')) {
    // Unit tests and small source probes may use a minimal server fragment. The
    // actual upstream file has this marker; leave unrelated fragments intact.
    if (!source.includes('const cialloTtsFetch = options.cialloTtsFetchImpl ?? fetch;')) return source;
    const voiceSeam = '    const voice = chinese ? "zh-CN-XiaochenMultilingualNeural" : "en-US-AriaNeural";';
    if (source.split(voiceSeam).length !== 2) throw new Error('Chinese TTS voice seam changed');
    source = source.replace(voiceSeam, `${voiceSeam}
    const ttsController = new AbortController();
    const cancelTts = () => { if (!reply.raw.writableEnded) ttsController.abort(); };
    reply.raw.on("close", cancelTts);`);
    const timeoutSeam = 'signal: AbortSignal.timeout(45_000)';
    if (source.split(timeoutSeam).length !== 2) throw new Error('Chinese TTS timeout seam changed');
    source = source.replace(timeoutSeam, 'signal: AbortSignal.any([ttsController.signal, AbortSignal.timeout(45_000)])');
    const closeSeam = '      return reply.code(502).send({ error: "连接 Ciallo TTS 失败，请检查网络后重试。" });\n    }';
    if (source.split(closeSeam).length !== 2) throw new Error('Chinese TTS cleanup seam changed');
    source = source.replace(closeSeam, '      return reply.code(502).send({ error: "连接 Ciallo TTS 失败，请检查网络后重试。" });\n    } finally { reply.raw.removeListener("close", cancelTts); }');
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
    exact('Ciallo TTS · 晓辰多语言', 'Ciallo TTS · 晓辰多语言 · 后台提前准备');
    return source;
  }
  if (filename.endsWith('/frontend/chinese-listening-state.ts')) {
    const seam = 'export function splitChineseSpeech(text: string, limit = 130): string[] {';
    if (source.split(seam).length !== 2) throw new Error('Chinese speech chunk size seam changed');
    const start = source.indexOf(seam);
    return source.slice(0, start) + `export function splitChineseSpeech(text: string, limit = 200): string[] {
  const characters = Array.from(text);
  const max = Math.max(1, Math.floor(limit) || 200);
  const chunks: string[] = [];
  let offset = 0;
  while (offset < characters.length) {
    let end = Math.min(offset + max, characters.length);
    if (end < characters.length) {
      const minimum = offset + Math.floor(max * 0.45);
      const strong = /[。！？!?；;\\n]/u;
      const weak = /[，、,:：]/u;
      let boundary = -1;
      for (let i = end - 1; i >= minimum; i--) if (strong.test(characters[i])) { boundary = i + 1; break; }
      if (boundary < 0) for (let i = end - 1; i >= minimum; i--) if (weak.test(characters[i])) { boundary = i + 1; break; }
      if (boundary > offset) end = boundary;
    }
    const chunk = characters.slice(offset, end).join("");
    if (chunk.trim()) chunks.push(chunk);
    offset = end;
  }
  return chunks;
}\n`;
  }
  if (!filename.endsWith('/frontend/chinese-audio-player.ts')) return source;
  const start = source.indexOf('    const prepare = async (position: SpeechCursor): Promise<Prepared> => {');
  const loop = source.indexOf('      while (valid()) {', start);
  if (start < 0 || loop < 0) throw new Error('Chinese audio prefetch seams changed');
  const adapted = `    type SpeechJob = { result: Promise<Prepared>; next: Promise<SpeechCursor | null>; isReady: () => boolean };
    let activeSyntheses = 0;
    const waiters: Array<{ resolve: () => void; cancel: () => void }> = [];
    const acquire = async () => {
      if (!valid()) throw new DOMException("Cancelled", "AbortError");
      if (activeSyntheses < 2) { activeSyntheses++; return; }
      await new Promise<void>((resolve, reject) => {
        const waiter = { resolve: () => { signal.removeEventListener("abort", waiter.cancel); resolve(); },
          cancel: () => { const at = waiters.indexOf(waiter); if (at >= 0) waiters.splice(at, 1); reject(new DOMException("Cancelled", "AbortError")); } };
        waiters.push(waiter);
        signal.addEventListener("abort", waiter.cancel, { once: true });
        if (!valid()) waiter.cancel();
      });
      if (!valid()) { release(); throw new DOMException("Cancelled", "AbortError"); }
    };
    const release = () => { const next = waiters.shift(); if (next) next.resolve(); else activeSyntheses--; };
    const synthesize = async (text: string): Promise<Blob> => {
      await acquire();
      const startedAt = Date.now();
      try { try { return await this.dependencies.synthesize(text, signal); }
      catch (error) {
        // Retry only fast failures. A request that already took a long time is
        // likely a slow upstream timeout; repeating it would double the wait.
        if (!valid() || Date.now() - startedAt > 12_000) throw error;
        await new Promise<void>(resolve => setTimeout(resolve, 500));
        if (!valid()) throw error;
        return await this.dependencies.synthesize(text, signal);
      } } finally { release(); }
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
  source = source.replace(queueSeam, `        // Keep two chunks ahead, with at most two syntheses in flight.
        current = ahead; ahead = following; following = advance(following);`);
  return source;
}
