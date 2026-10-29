import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { learningSourceSentences, type LearningMaterial } from "../../shared/learning-material.js";
import { LEARNING_VOICES, type LearningVoiceAudio, type LearningAudioManifest } from "../../shared/learning-audio.js";

export interface SpeechPreparation { directory: string; voice: string; rate: string; clips: { key: string; text: string }[]; }
export type SpeechSynthesizer = (request: SpeechPreparation) => Promise<void>;
const rate = "-10%";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function learningSpeechTexts(material: LearningMaterial): string[] {
  const sources = learningSourceSentences(material.english);
  return [...new Set([...material.vocabulary.flatMap(word => [word.sourceText,sources.find(source => source.id === word.sentenceId)!.english]),...material.sentences.flatMap(sentence => sentence.steps.map(step => step.english))])];
}
export function pythonSpeechSynthesizer(projectRoot: string): SpeechSynthesizer {
  return request => new Promise((resolve,reject) => {
    const projectPython = path.join(projectRoot,".venv-learning-tts","bin","python");
    const child = spawn(process.env.MAGAZINE_TTS_PYTHON || (existsSync(projectPython) ? projectPython : "python3"),[path.join(projectRoot,"scripts","prepare-learning-tts.py")],{ stdio: ["pipe","ignore","ignore"] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("朗读生成超时")); },240000);
    child.on("error",() => { clearTimeout(timer); reject(new Error("本地 Python 或 Edge TTS 工具不可用")); });
    child.on("exit",code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("本地朗读生成未完成")); });
    child.stdin.on("error",() => {}); child.stdin.end(JSON.stringify(request));
  });
}
export class LearningAudioService {
  private pending = new Map<string,Promise<LearningAudioManifest>>();
  private directory: string;
  constructor(dataDir: string, private synthesize: SpeechSynthesizer, private preparePronunciations?: (material: LearningMaterial) => Promise<Record<string,string>>) { this.directory = path.join(dataDir,"learning-audio"); }
  async readClip(filename: string): Promise<Buffer | null> {
    if (!/^[a-f0-9]{64}\.mp3$/.test(filename)) return null;
    try { const data = await readFile(path.join(this.directory,filename)); return data.length >= 100 && (data.subarray(0,3).toString() === "ID3" || data[0] === 255 && (data[1] & 224) === 224) ? data : null; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  prepare(material: LearningMaterial): Promise<LearningAudioManifest> {
    const existing = this.pending.get(material.materialVersion); if (existing) return existing;
    const task = this.create(material).finally(() => this.pending.delete(material.materialVersion)); this.pending.set(material.materialVersion,task); return task;
  }
  private async create(material: LearningMaterial): Promise<LearningAudioManifest> {
    await mkdir(this.directory,{ recursive: true });
    const manifestFile = path.join(this.directory,`${material.materialVersion}.manifest.json`);
    let pronunciations: Record<string,string> = {}, pronunciationStatus: "ready" | "unavailable" | undefined, pronunciationScope: LearningAudioManifest["pronunciationScope"];
    try { const previous = JSON.parse(await readFile(manifestFile,"utf8")) as LearningAudioManifest; pronunciations = previous.pronunciations ?? {}; pronunciationStatus = previous.pronunciationStatus; pronunciationScope = previous.pronunciationScope; } catch { /* A manifest is rebuilt from validated local files. */ }
    const validPronunciations = (values: Record<string,string>) => [...material.vocabulary,...material.sentences.flatMap(sentence => sentence.steps)].every(item => typeof values[item.id] === "string" && /^\/[^<>\n]{1,1000}\/$/.test(values[item.id]));
    if (!validPronunciations(pronunciations) && material.vocabularyRevision) {
      try {
        const previous = JSON.parse(await readFile(path.join(this.directory,`${material.vocabularyRevision.fromMaterialVersion}.manifest.json`),"utf8")) as LearningAudioManifest;
        const changed = new Set(material.vocabularyRevision.replacedIds);
        pronunciations = { ...Object.fromEntries(Object.entries(previous.pronunciations ?? {}).filter(([id]) => !changed.has(id))),...pronunciations,...Object.fromEntries(material.vocabulary.filter(word => word.pronunciation).map(word => [word.id,word.pronunciation!])) };
        if (validPronunciations(pronunciations)) { pronunciationStatus = "ready"; pronunciationScope = "vocabulary-and-assembly"; }
      } catch { /* Reuse is optional; the regular preparation path handles missing phonetics. */ }
    }
    if (!validPronunciations(pronunciations) && (pronunciationStatus !== "unavailable" || pronunciationScope !== "vocabulary-and-assembly")) {
      const authored = Object.fromEntries(material.vocabulary.filter(word => word.pronunciation).map(word => [word.id,word.pronunciation!]));
      if (validPronunciations(authored)) pronunciations = authored;
      else if (this.preparePronunciations) { try { const generated = await this.preparePronunciations(material); if (validPronunciations(generated)) pronunciations = generated; } catch { /* Missing optional phonetics must not block audio or text practice. */ } }
      pronunciationStatus = validPronunciations(pronunciations) ? "ready" : "unavailable";
      pronunciationScope = "vocabulary-and-assembly";
    }
    const voices: LearningVoiceAudio[] = [];
    for (const { id: voice } of LEARNING_VOICES) {
      const plan = learningSpeechTexts(material).map(text => ({ text,key: hash({ provider: "edge-tts", voice, rate, text }) }));
      const missing = [];
      for (const clip of plan) if (!await this.readClip(`${clip.key}.mp3`)) missing.push(clip);
      if (missing.length) { try { await this.synthesize({ directory: this.directory,voice,rate,clips: missing }); } catch { /* Keep each voice's valid cache; retry only missing clips. */ } }
      const clips: LearningAudioManifest["clips"] = [];
      for (const clip of plan) { const data = await this.readClip(`${clip.key}.mp3`); if (data) clips.push({ ...clip,url: `/api/learning-audio/${clip.key}.mp3`,bytes: data.length }); }
      voices.push({ voice,rate,total: plan.length,status: clips.length === plan.length ? "ready" : "partial",clips });
    }
    const ready = voices.every(item => item.status === "ready");
    // Top-level clips remain the default Jenny voice for older consumers.
    const manifest: LearningAudioManifest = { ...voices[0],schemaVersion: 1,materialVersion: material.materialVersion,provider: "edge-tts",voices,status: ready ? "ready" : "partial",pronunciations,pronunciationStatus,pronunciationScope,...(!ready ? { error: "部分朗读音频尚未准备好，可重试补齐；文字练习仍可使用。" } : {}) };
    const file = path.join(this.directory,`${material.materialVersion}.manifest.json`), temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary,JSON.stringify(manifest,null,2),{ mode: 0o600 }); await rename(temporary,file); return manifest;
  }
}
