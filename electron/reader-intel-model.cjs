'use strict';
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');

// The GGUF identity is distinct from the Apple Silicon MLX model and its cache.
// No model file is included or downloaded by this module.
const INTEL_MODEL = Object.freeze({
  id: 'qwen3.5-4b-gguf-q4-k-m',
  label: 'Qwen3.5 4B (GGUF Q4_K_M)',
  file: 'Qwen3.5-4B-Q4_K_M.gguf',
  bytes: 2783446880,
  sha256: 'b7508d8b4a652bc020a439aafdd4ce1527d49774865ce3334a43b16dbeaa90ca',
  repository: 'https://huggingface.co/twoody/Qwen3.5-4B-GGUF',
  sourceRevision: '851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a',
  license: 'Apache-2.0',
  testedRuntime: 'llama.cpp b11904',
});

async function verifyIntelModel(file, {manifest = INTEL_MODEL, signal} = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('请选择本地 GGUF 模型文件');
  signal?.throwIfAborted();
  const handle = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== manifest.bytes) throw new Error('模型文件大小不符合要求');
    const digest = createHash('sha256');
    const stream = handle.createReadStream({autoClose:false, signal});
    for await (const chunk of stream) digest.update(chunk);
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || digest.digest('hex') !== manifest.sha256)
      throw new Error('模型完整性验证失败');
    return {id:manifest.id, sha256:manifest.sha256, size:before.size};
  } finally { await handle.close(); }
}
module.exports = {INTEL_MODEL, verifyIntelModel};
