#!/usr/bin/env bash
# Sets up the Piper TTS backend: a private venv + the Danny voice model.
# Run once from server/: ./setup-piper.sh  (then restart the server)
set -euo pipefail
cd "$(dirname "$0")"

echo "→ creating venv + installing piper-tts"
python3 -m venv piper-venv
./piper-venv/bin/pip install --quiet --upgrade pip piper-tts

echo "→ downloading en_US-danny-low voice model (~20 MB)"
mkdir -p voices
BASE="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/danny/low"
curl -sL -o voices/en_US-danny-low.onnx "$BASE/en_US-danny-low.onnx?download=true"
curl -sL -o voices/en_US-danny-low.onnx.json "$BASE/en_US-danny-low.onnx.json?download=true"

echo "→ smoke test"
echo "I am the voice in the datastream." | ./piper-venv/bin/piper \
  --model voices/en_US-danny-low.onnx --output_file /tmp/piper-test.wav
ls -la /tmp/piper-test.wav
echo "✓ Piper ready. Restart the server (npm start) and the face will use it."
