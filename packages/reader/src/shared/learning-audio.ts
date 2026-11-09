export const LEARNING_VOICES = [
  { id: "aiden", label: "Aiden · 美式男声" },
  { id: "ryan", label: "Ryan · 英语男声" }
] as const;
export type LearningVoiceId = typeof LEARNING_VOICES[number]["id"];
export interface LearningVoiceAudio {
  voice: string;
  rate: string;
  status: "ready" | "partial";
  total: number;
  clips: { key: string; text: string; url: string; bytes: number }[];
}
export interface LearningAudioManifest extends LearningVoiceAudio {
  schemaVersion: 1;
  materialVersion: string;
  provider: "qwen3-tts";
  voices?: LearningVoiceAudio[];
  error?: string;
  pronunciations?: Record<string,string>;
  pronunciationStatus?: "ready" | "unavailable";
  pronunciationScope?: "vocabulary-and-assembly";
}
