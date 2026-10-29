export const LEARNING_VOICES = [
  { id: "en-US-JennyNeural", label: "Jenny (English - US)" },
  { id: "en-US-GuyNeural", label: "Guy (English - US)" }
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
  provider: "edge-tts";
  voices?: LearningVoiceAudio[];
  error?: string;
  pronunciations?: Record<string,string>;
  pronunciationStatus?: "ready" | "unavailable";
  pronunciationScope?: "vocabulary-and-assembly";
}
