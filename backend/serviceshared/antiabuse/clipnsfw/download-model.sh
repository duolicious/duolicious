#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

[[ -f model.onnx ]] && exit 0

curl -fsSL -o model.safetensors.part \
  https://huggingface.co/openai/clip-vit-large-patch14/resolve/32bd64288804d66eefd0ccbe215aa642df71cc41/model.safetensors

echo 'a2bf730a0c7debf160f7a6b50b3aaf3703e7e88ac73de7a314903141db026dcb  model.safetensors.part' \
  | sha256sum --check --quiet

python3 build_onnx.py model.safetensors.part model.onnx.part
rm model.safetensors.part
mv model.onnx.part model.onnx
