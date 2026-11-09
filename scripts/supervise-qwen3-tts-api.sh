#!/bin/bash
# Independent Qwen3-TTS LAN API supervisor. Modeled on the existing working
# local Qwen translation service without changing or depending on its process.
set -u

# LaunchAgent can read this preflight copy in Application Support; calling the
# external-disk script directly is denied by macOS in background launchd context.
VERIFY="$HOME/Library/Application Support/Workspace Model Guard/verify-workspace-volume.sh"
MODEL="/Volumes/Workspace/AI/Models/Qwen3-TTS/Qwen3-TTS-12Hz-0.6B-CustomVoice-Q8_0.gguf"
EXPECTED_SHA256="f606ea3981aa42762b16db9a94826d2d560eb60f0b102001618f40d5a2f78cc6"
BINARY="/Volumes/Workspace/Development/Tools/speech.cpp/v0.10.1/speech"
GATEWAY="/Volumes/Workspace/Development/Tools/qwen3-tts-service/qwen-tts-lan-gateway.mjs"
NODE="/opt/homebrew/bin/node"
KEY_FILE="$HOME/Library/Application Support/Workspace Model Guard/qwen3-tts.key"
## Shell redirection to an external volume is restricted for this LaunchAgent,
## even where Node.js and speech.cpp can read it. Keep small diagnostic logs
## under the user's own Library/Logs; the model stays on Workspace.
LOG_DIR="$HOME/Library/Logs/Qwen3-TTS"
SUPERVISOR_LOG="$HOME/Library/Logs/Qwen3-TTS-supervisor.log"

ENGINE_PID=""
GATEWAY_PID=""
RESTART_DELAY=15

log() {
  local entry
  entry="$(/bin/date '+%Y-%m-%d %H:%M:%S') [qwen3-tts] $*"
  printf '%s\n' "$entry" >&2
  # Tiny bounded status log: launchd otherwise discards supervisor stderr.
  if [[ -d "$HOME/Library/Logs" ]]; then
    /bin/chmod 600 "$SUPERVISOR_LOG" 2>/dev/null || true
    if [[ -f "$SUPERVISOR_LOG" ]] && (( $(/usr/bin/stat -f '%z' "$SUPERVISOR_LOG") > 131072 )); then
      : > "$SUPERVISOR_LOG"
    fi
    (umask 077; printf '%s\n' "$entry" >> "$SUPERVISOR_LOG")
  fi
}
stop_services() {
  for pid in "$GATEWAY_PID" "$ENGINE_PID"; do
    if [[ -n "$pid" ]] && /bin/kill -0 "$pid" 2>/dev/null; then /bin/kill -TERM "$pid" 2>/dev/null || true; fi
  done
  /bin/sleep 1
  for pid in "$GATEWAY_PID" "$ENGINE_PID"; do
    if [[ -n "$pid" ]] && /bin/kill -0 "$pid" 2>/dev/null; then /bin/kill -KILL "$pid" 2>/dev/null || true; fi
    if [[ -n "$pid" ]]; then wait "$pid" 2>/dev/null || true; fi
  done
  ENGINE_PID=""
  GATEWAY_PID=""
}
trap 'stop_services; exit 0' TERM INT HUP

while true; do
  if ! verify_result=$(/bin/sh "$VERIFY" 2>&1); then
    stop_services
    log "Workspace verification failed: $verify_result; refusing to start until the exact APFS disk is available."
    /bin/sleep 15
    continue
  fi
  if [[ ! -x "$BINARY" || ! -x "$NODE" || ! -f "$MODEL" || ! -r "$GATEWAY" || ! -f "$KEY_FILE" ]]; then
    stop_services
    log 'Required program, verified model, gateway or API key file is absent; not starting.'
    /bin/sleep 15
    continue
  fi
  if [[ -z "$ENGINE_PID" || -z "$GATEWAY_PID" ]]; then
    # The launchd background process is denied direct external-volume reads by
    # /usr/bin/shasum on this Mac, even though Node.js can read the same file.
    # Use the already required Node binary to stream-hash the verified GGUF,
    # without buffering the 1.2 GB model in RAM or weakening validation.
    hash_output="$("$NODE" -e '
      const {createHash} = require("node:crypto");
      const {createReadStream} = require("node:fs");
      const hash = createHash("sha256");
      const file = createReadStream(process.argv[1]);
      file.on("data", chunk => hash.update(chunk));
      file.on("end", () => process.stdout.write(hash.digest("hex")));
      file.on("error", error => { console.error(error.code || "MODEL_READ_ERROR"); process.exitCode = 1; });
    ' "$MODEL" 2>&1)"
    hash_status=$?
    if [[ "$hash_status" != 0 ]]; then
      log "Cannot read model to verify SHA-256 (status $hash_status): $hash_output"
      /bin/sleep 30
      continue
    fi
    actual_hash="$hash_output"
    if [[ "$actual_hash" != "$EXPECTED_SHA256" ]]; then
      log 'Model SHA-256 mismatch; refusing to start.'
      /bin/sleep 30
      continue
    fi
    /bin/mkdir -p "$LOG_DIR"
    /bin/chmod 700 "$LOG_DIR" 2>/dev/null || true
    for filename in engine.log gateway.log; do
      if [[ -f "$LOG_DIR/$filename" ]] && (( $(/usr/bin/stat -f '%z' "$LOG_DIR/$filename") > 1048576 )); then
        : > "$LOG_DIR/$filename"
      fi
    done
    if /usr/sbin/lsof -nP -iTCP:18439 -sTCP:LISTEN 2>/dev/null | /usr/bin/grep -q LISTEN ||
       /usr/sbin/lsof -nP -iTCP:18440 -sTCP:LISTEN 2>/dev/null | /usr/bin/grep -q LISTEN; then
      log 'Reserved TTS port already occupied; not interfering with another process.'
      /bin/sleep 15
      continue
    fi
    log 'Starting speech.cpp on loopback 127.0.0.1:18440.'
    "$BINARY" serve "$MODEL" --host 127.0.0.1 --port 18440 >"$LOG_DIR/engine.log" 2>&1 &
    ENGINE_PID=$!
    ready=0
    for _ in {1..30}; do
      if ! /bin/kill -0 "$ENGINE_PID" 2>/dev/null; then break; fi
      if /usr/bin/curl --noproxy '*' --silent --fail --max-time 2 http://127.0.0.1:18440/health >/dev/null; then ready=1; break; fi
      /bin/sleep 1
    done
    if [[ "$ready" != 1 ]]; then
      log 'Speech engine did not become ready.'
      stop_services
      /bin/sleep 15
      continue
    fi
    log 'Starting authenticated LAN gateway on 0.0.0.0:18439.'
    QWEN_TTS_API_KEY_FILE="$KEY_FILE" QWEN_TTS_HOST=0.0.0.0 QWEN_TTS_PORT=18439 QWEN_TTS_UPSTREAM=http://127.0.0.1:18440 \
      QWEN_TTS_ALLOW_SHORT_KEY=1 QWEN_TTS_ALLOWED_SUBNET_PREFIX=192.168.3. \
      "$NODE" "$GATEWAY" >"$LOG_DIR/gateway.log" 2>&1 &
    GATEWAY_PID=$!
    RESTART_DELAY=15
  fi
  if ! /bin/kill -0 "$ENGINE_PID" 2>/dev/null || ! /bin/kill -0 "$GATEWAY_PID" 2>/dev/null; then
    log 'A child process exited; shutting down both and restarting.'
    stop_services
    /bin/sleep "$RESTART_DELAY"
    if (( RESTART_DELAY < 300 )); then RESTART_DELAY=$((RESTART_DELAY * 2)); fi
    continue
  fi
  /bin/sleep 15
done
