const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const viteBin = path.join(root, 'node_modules/vite/bin/vite.js');
const electronBin = path.join(root, 'node_modules/electron/cli.js');
const edgeTtsExecutable = path.join(root, '.runtime/edge-tts-venv/bin/edge-tts');
const url = 'http://127.0.0.1:5173';
let vite; let electron; let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (electron && electron.exitCode === null) electron.kill('SIGTERM');
  if (vite && vite.exitCode === null) vite.kill('SIGTERM');
  process.exitCode = code;
}
vite = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'], cwd: root });
vite.stdout.on('data', chunk => {
  const text = chunk.toString(); process.stdout.write(text);
  if (!electron && /\bready in\b/.test(text)) {
    electron = spawn(process.execPath, [electronBin, '.'], { stdio: 'inherit', cwd: root, env: { ...process.env, VANTILO_DEV_SERVER_URL: url, VANTILO_EDGE_TTS_EXECUTABLE: process.env.VANTILO_EDGE_TTS_EXECUTABLE || (fs.existsSync(edgeTtsExecutable) ? edgeTtsExecutable : '') } });
    electron.on('error', err => { console.error(`Electron failed to start: ${err.message}`); stop(1); });
    electron.on('exit', code => stop(code ?? 1));
  }
});
vite.on('error', err => { console.error(`Vite failed to start: ${err.message}`); stop(1); });
vite.on('exit', code => { if (!stopping) { console.error(`Vite exited before a successful desktop session (code ${code}).`); stop(code ?? 1); } });
process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));
