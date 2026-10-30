#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

[[ -f vision_model.onnx ]] && exit 0

curl -fsSL -o vision_model.onnx.part \
  https://huggingface.co/Xenova/clip-vit-large-patch14/resolve/c307790166907339eed5a9a53a249af534102536/onnx/vision_model.onnx

echo 'ff49f8aa57c7abfd26e382eb083e4dbf988505223a9bd3767dbfd4e729206709  vision_model.onnx.part' \
  | sha256sum --check --quiet

mv vision_model.onnx.part vision_model.onnx
