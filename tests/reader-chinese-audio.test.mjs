import { beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { readerSourceRoot } from '../scripts/reader-source-path.mjs';

let audioModule, speechModule;
beforeAll(async () => {
  const load = async file => {
    const result = await build({
      entryPoints: [`${readerSourceRoot}/src/frontend/${file}`],
      bundle: true, write: false, format: 'esm', platform: 'node',
    });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
  };
  audioModule = await load('chinese-streaming-audio-player.ts');
  speechModule = await load('chinese-listening-state.ts');
});
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const frame = { sampleRate: 24000, samples: new Int16Array(2400) };
function fixture(synthesize = async function* () { yield frame; }) {
  const events = [], positions = [], scheduled = [];
  let current = null;
  const sink = {
    append(_frame, cursor, offset, resume) {
      scheduled.push({ cursor, offset, resume });
      current = { cursor, seconds: offset + 0.1 };
    },
    position: () => current,
    bufferedSeconds: () => 0,
    finish: async () => {},
    pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), setRate: vi.fn(),
  };
  const player = new audioModule.ChineseStreamingAudioPlayer({
    indices: [0, 1, 2], getText: async i => `第${i}段中文。`, synthesize,
    phase: (phase, error) => events.push([phase, error]),
    position: (...args) => positions.push(args),
    sink: () => sink,
  });
  return { player, sink, events, positions, scheduled };
}

describe('local Qwen3 streaming narration compatibility', () => {
  it('plays each paragraph through PCM chunks without constructing MP3 blobs', async () => {
    const requests = [];
    const f = fixture(async function* (text) { requests.push(text); yield frame; });
    await f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    expect(requests).toEqual(['第0段中文。', '第1段中文。', '第2段中文。']);
    expect(f.scheduled.map(x => x.cursor.paragraphIndex)).toEqual([0, 1, 2]);
    expect(f.events.map(x => x[0])).toEqual(['loading', 'playing', 'complete']);
    expect(f.positions.at(-1)[2]).toBe(true);
  });
  it('cancels pending streaming audio and never plays stale PCM on stop', async () => {
    let release;
    let cancelled = false;
    const f = fixture(async function* (_text, signal) {
      yield frame;
      await new Promise(resolve => { release = resolve; });
      cancelled = signal.aborted;
      if (!signal.aborted) yield frame;
    });
    const run = f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    await flush();
    f.player.stop();
    release();
    await run;
    expect(cancelled).toBe(true);
    // The initial 650 ms PCM buffer is intentionally discarded when stopped
    // before enough frames arrive; no stale audio may reach the speaker.
    expect(f.scheduled).toHaveLength(0);
    expect(f.events.some(x => x[0] === 'error')).toBe(false);
  });
  it('reports local worker failures without falling back to a remote service', async () => {
    const f = fixture(async function* (text) {
      if (text.startsWith('第1')) throw new Error('本地 Worker 已退出');
      yield frame;
    });
    await f.player.start({ paragraphIndex: 0, chunkIndex: 0 });
    expect(f.events.at(-1)).toEqual(['error', '本地 Worker 已退出']);
    // The new cold-start safety gate must not play even an early short frame
    // when generation of the next segment fails before startup is ready.
    expect(f.scheduled.map(x => x.cursor.paragraphIndex)).toEqual([]);
  });
  it('splits long Chinese text without losing characters or exceeding 130 characters', () => {
    const text = '这是测试句子。'.repeat(80) + '结尾';
    const chunks = speechModule.splitChineseSpeech(text);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every(chunk => Array.from(chunk).length <= 130)).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
  });
  it('safely restarts an old listening position after the translated segment changes', async () => {
    const f = fixture();
    await f.player.start({ paragraphIndex: 1, chunkIndex: 4, chunkText: '过期分段', seconds: 6 });
    expect(f.scheduled[0]).toMatchObject({ cursor: { paragraphIndex: 1, chunkIndex: 0 }, resume: 0 });
  });
});
