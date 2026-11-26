'use strict';

// Pinned provenance for Vantilo's optional local offline Qwen3-TTS 0.6B runtime & weights.
// Verified on Apple Silicon (M4, arm64 Metal) in /Volumes/Workspace/Development/Vantilo/tts-benchmarks/run-20261106-122508/.
// Neither the runtime nor the model weights are bundled in the Vantilo installer; users download
// them on demand into userData/tts/ after explicit consent and mandatory SHA-256 verification.
const TTS_INSTALL_DIR_NAME = 'qwen3-tts-0.6b';

const TTS_MODEL_MANIFEST = Object.freeze({
  version: 1,
  id: 'qwen3-tts-0.6b-q8-metal',
  displayName: 'Qwen3-TTS 0.6B（离线高质量中文/英文听书）',
  installDirName: TTS_INSTALL_DIR_NAME,
  runtime: Object.freeze({
    id: 'speech-cpp-v0.10.1-macos-arm64-metal',
    repository: 'nyosegawa/speech.cpp',
    releaseTag: 'v0.10.1',
    license: 'MIT',
    archiveName: 'speech-0.10.1-macos-arm64-metal.zip',
    archiveBytes: 6087757,
    archiveSha256: 'ff24f6f58c9d2dedb01caa88ba043ae845c76eff228e4cbfae5de749174404c1',
    url: 'https://github.com/nyosegawa/speech.cpp/releases/download/v0.10.1/speech-0.10.1-macos-arm64-metal.zip',
    binaryName: 'speech',
    binaryBytes: 11588712,
    binarySha256: 'a42f083867d137fce5ef84b69244d6ead1595bc20cce2f790a10c3a3f9391e79',
  }),
  model: Object.freeze({
    id: 'qwen3-tts-12hz-0.6b-customvoice-q8_0',
    repository: 'sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF',
    upstreamRepository: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
    revision: 'fd9df9364613a92a86b4137074bc281204823033',
    license: 'Apache-2.0',
    fileName: 'Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf',
    bytes: 1213534464,
    sha256: 'f606ea3981aa42762b16db9a94826d2d560eb60f0b102001618f40d5a2f78cc6',
    url: 'https://huggingface.co/sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF/resolve/fd9df9364613a92a86b4137074bc281204823033/Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf?download=true',
    mirrorUrl: 'https://hf-mirror.com/sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF/resolve/fd9df9364613a92a86b4137074bc281204823033/Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf?download=true',
  }),
});

module.exports = { TTS_MODEL_MANIFEST, TTS_INSTALL_DIR_NAME };
