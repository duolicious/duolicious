#!/bin/bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

set -e

export PYTHONUNBUFFERED=true
export PYTHONDONTWRITEBYTECODE=true

if [ "${DUO_USE_VENV:-true}" = true ] && [ -d venv/vapid/ ]
then
  export PATH=$(readlink -e venv/vapid/bin):$PATH
fi

if [ "${DUO_USE_VENV:-true}" = true ] && [ ! -d venv/vapid/ ]
then
  python3 -m venv venv/vapid/
  export PATH=$(readlink -e venv/vapid/bin):$PATH
  python3 -m pip install cryptography
fi

python3 - <<'PY'
import base64
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


priv = ec.generate_private_key(ec.SECP256R1())

private_key = b64url(priv.private_numbers().private_value.to_bytes(32, 'big'))
public_key = b64url(priv.public_key().public_bytes(
    serialization.Encoding.X962,
    serialization.PublicFormat.UncompressedPoint))

print(f'DUO_VAPID_PRIVATE_KEY={private_key}')
print(f'DUO_WEB_PUSH_VAPID_PUBLIC_KEY={public_key}')
PY
