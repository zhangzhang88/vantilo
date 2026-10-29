import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { material } from "../../../tests/fixtures/learning.js";
import { LearningAudioService, learningSpeechTexts, type SpeechPreparation } from "./learning-audio-service.js";
import { buildServer } from "../app.js";

const roots: string[] = [], mp3 = Buffer.concat([Buffer.from("ID3"),Buffer.alloc(200)]);
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root,{ recursive: true,force: true }))); });
async function root() { const directory = await mkdtemp(path.join(os.tmpdir(),"mr-learning-audio-")); roots.push(directory); return directory; }
async function synthesize(request: SpeechPreparation) { for (const clip of request.clips) await writeFile(path.join(request.directory,`${clip.key}.mp3`),mp3,{ flag: "wx" }); }

describe("preparation-time local lesson audio", () => {
  it("reuses unchanged phrase audio and IPA when only a vocabulary word is replaced", async () => {
    const directory = await root(), phonetics = vi.fn(async () => Object.fromEntries([...material.vocabulary,...material.sentences.flatMap(sentence => sentence.steps)].map(item => [item.id,"/original/"])));
    await new LearningAudioService(directory,synthesize,phonetics).prepare(material);
    const revised = structuredClone(material); revised.materialVersion = "single-word-revision";
    revised.vocabulary[0] = { ...revised.vocabulary[0],text: "support",sourceText: "supports",answerText: "supports",answerTokens: [{ text: "supports",start: 0,end: 8 }],pronunciation: "/səˈpɔːrts/" };
    revised.vocabularyRevision = { fromMaterialVersion: material.materialVersion,replacedIds: ["v:0"],detachedLinks: [],review: { approved: true,summaryZh: "单词可用。" } };
    const synth = vi.fn(synthesize), unavailable = vi.fn(async () => { throw new Error("should reuse IPA"); });
    const next = await new LearningAudioService(directory,synth,unavailable).prepare(revised);
    expect(next.status).toBe("ready"); expect(unavailable).not.toHaveBeenCalled();
    expect(next.pronunciations?.["v:0"]).toBe("/səˈpɔːrts/"); expect(next.pronunciations?.["v:1"]).toBe("/original/");
    expect(synth).toHaveBeenCalledTimes(2);
    expect(synth.mock.calls.every(([request]) => request.clips.length === 1 && request.clips[0].text === "supports")).toBe(true);
  });
  it("deduplicates source-only texts and coalesces preparation; cached playback needs neither Python nor Codex", async () => {
    const directory = await root(), generate = vi.fn(synthesize), phonetics = vi.fn(async () => Object.fromEntries([...material.vocabulary,...material.sentences.flatMap(sentence => sentence.steps)].map(item => [item.id,"/test/"]))), service = new LearningAudioService(directory,generate,phonetics), before = JSON.stringify(material);
    const [first,second] = await Promise.all([service.prepare(material),service.prepare(material)]);
    expect(first).toEqual(second); expect(first.status).toBe("ready"); expect(first.total).toBe(learningSpeechTexts(material).length); expect(new Set(first.clips.map(clip => clip.text)).size).toBe(first.total);
    expect(first.clips.some(clip => clip.text === material.english)).toBe(true); expect(first.clips.some(clip => clip.text === "careful")).toBe(true); expect(first.clips.every(clip => /^[a-f0-9]{64}$/.test(clip.key) && clip.url === `/api/learning-audio/${clip.key}.mp3`)).toBe(true);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(first.voices?.map(item => item.voice)).toEqual(["en-US-JennyNeural","en-US-GuyNeural"]);
    expect(first.voices?.every(item => item.status === "ready" && item.clips.length === first.total)).toBe(true);
    expect(new Set(first.voices!.flatMap(item => item.clips.map(clip => clip.key))).size).toBe(first.total * 2); expect(phonetics).toHaveBeenCalledTimes(1);
    const unavailable = vi.fn(async () => { throw new Error("offline"); });
    expect(await new LearningAudioService(directory,unavailable,unavailable).prepare(material)).toEqual(first); expect(unavailable).not.toHaveBeenCalled(); expect(JSON.stringify(material)).toBe(before);
  });
  it("adds both original voices without replacing legacy Aria recordings or changing material identity", async () => {
    const directory = await root(), audioDirectory = path.join(directory,"learning-audio"), filename = `${"b".repeat(64)}.mp3`;
    await mkdir(audioDirectory); await writeFile(path.join(audioDirectory,filename),mp3);
    await writeFile(path.join(audioDirectory,`${material.materialVersion}.manifest.json`),JSON.stringify({ voice: "en-US-AriaNeural",pronunciations: { "v:0": "/legacy/" } }));
    const manifest = await new LearningAudioService(directory,synthesize).prepare(material);
    expect(manifest.materialVersion).toBe(material.materialVersion); expect(manifest.voices).toHaveLength(2);
    expect(manifest.voice).toBe("en-US-JennyNeural"); expect(manifest.status).toBe("ready");
    expect(await readFile(path.join(audioDirectory,filename))).toEqual(mp3);
    expect(manifest.pronunciations?.["v:0"]).toBe("/legacy/");
  });
  it("publishes partial audio honestly and retries only missing clips", async () => {
    const directory = await root(), generate = vi.fn(async (request: SpeechPreparation) => { const first = request.clips[0]; await writeFile(path.join(request.directory,`${first.key}.mp3`),mp3); throw new Error("provider unavailable"); });
    const partial = await new LearningAudioService(directory,generate).prepare(material); expect(partial.status).toBe("partial"); expect(partial.clips).toHaveLength(1); expect(partial.error).toContain("重试");
    const complete = vi.fn(synthesize), service = new LearningAudioService(directory,complete), manifest = await service.prepare(material); expect(manifest.status).toBe("ready"); expect(complete.mock.calls[0][0].clips).toHaveLength(manifest.total - 1);
    expect(await readFile(path.join(directory,"learning-audio",`${partial.clips[0].key}.mp3`))).toEqual(mp3);
    await unlink(path.join(directory,"learning-audio",`${manifest.clips[0].key}.mp3`)); await service.prepare(material); expect(complete.mock.calls[2][0].clips).toHaveLength(1); expect(complete.mock.calls[2][0].voice).toBe("en-US-JennyNeural");
    expect(complete).toHaveBeenCalledTimes(3);
  });
  it("keeps text practice available on unavailable Python/Edge and rejects arbitrary filenames or non-audio data", async () => {
    const directory = await root(), service = new LearningAudioService(directory,async () => { throw new Error("No Python"); });
    expect((await service.prepare(material)).status).toBe("partial"); expect(await service.readClip("../secrets.json")).toBeNull(); expect(await service.readClip("arbitrary.mp3")).toBeNull();
    const filename = `${"a".repeat(64)}.mp3`; await writeFile(path.join(directory,"learning-audio",filename),Buffer.from("<html>error</html>")); expect(await service.readClip(filename)).toBeNull();
  });
  it("serves only validated local MP3s and keeps audio endpoints local", async () => {
    const directory = await root(); await mkdir(path.join(directory,"issues")); const service = new LearningAudioService(path.join(directory,"data"),synthesize), manifest = await service.prepare(material);
    const app = await buildServer({ projectRoot: directory,serveFrontend: false,aiProviderEnv: {} });
    try {
      const response = await app.inject({ method: "GET",url: manifest.clips[0].url,remoteAddress: "127.0.0.1" }); expect(response.statusCode).toBe(200); expect(response.headers["content-type"]).toContain("audio/mpeg"); expect(response.rawPayload).toEqual(mp3); expect(response.headers["cache-control"]).toContain("immutable");
      expect((await app.inject({ method: "GET",url: manifest.clips[0].url,remoteAddress: "192.0.2.1" })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET",url: "/api/learning-audio/missing.mp3",remoteAddress: "127.0.0.1" })).statusCode).toBe(404);
    } finally { await app.close(); }
  });
});
