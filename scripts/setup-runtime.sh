#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Optional machine-specific settings (see .env.example).
if [[ -f .env.local ]]; then set -a; source .env.local; set +a; fi
# The engine build, source checkout and models need roughly 6 GB under .runtime/.
free_kb=$(df -Pk . | awk 'NR==2 {print $4}')
if (( free_kb < 6 * 1024 * 1024 )); then
  echo "Need about 6 GB free on the drive holding $PWD (have $((free_kb / 1024 / 1024)) GB)." >&2
  exit 1
fi
for tool in cmake ninja git curl; do command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool" >&2; exit 1; }; done
mkdir -p .runtime/models .runtime/model-cache/models .runtime/tmp
export TMPDIR="$PWD/.runtime/tmp"
export NEMO_SPEECH_MODEL_DIR="$PWD/.runtime/model-cache/models"
if [[ ! -d .runtime/nemo-source/.git ]]; then
  git clone https://github.com/NVIDIA/NeMo-Speech.cpp.git .runtime/nemo-source
fi
(
  cd .runtime/nemo-source
  git checkout 97a15afa5caa9bce5baaa86c1184103877af4101
  git submodule update --init ggml llama.cpp
  scripts/configure.sh metal-asr
  cmake --build --preset metal-asr -j 6
  cmake --install build/metal-asr --prefix "$PWD/../nemo-v3"
)
model=.runtime/models/Nemotron-3-Diarization.q8_0.gguf
if [[ ! -f "$model" ]]; then
  curl --fail --location --retry 3 https://huggingface.co/nvidia/Nemotron-3-Diarization/resolve/main/Nemotron-3-Diarization.q8_0.gguf --output "$model.partial"
  mv "$model.partial" "$model"
fi
.runtime/nemo-v3/bin/nemo-speech pull parakeet-tdt
