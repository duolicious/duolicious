#!/bin/bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

set -e

WS_MAX_SIZE=10485760  # 10 MB

export PYTHONUNBUFFERED=true
export PYTHONDONTWRITEBYTECODE=true
export PYTHONPATH=.

if [ "${DUO_USE_VENV:-true}" = true ] && [ -d venv/chat/ ]
then
  export PATH=$(readlink -e venv/chat/bin):$PATH
fi

if [ "${DUO_USE_VENV:-true}" = true ] && [ ! -d venv/chat/ ]
then
  python3 -m venv venv/chat/
  export PATH=$(readlink -e venv/chat/bin):$PATH
  python3 -m pip install -r requirements.txt
fi

if [ -z "$PORT" ]
then
  PORT=5443
fi

if [ "$DUO_ENV" = "prod" ]
then
  exec uvicorn \
    --host 0.0.0.0 \
    --port "$PORT" \
    --ws-max-size "${WS_MAX_SIZE}" \
    --workers "${DUO_WORKERS:-4}" \
    service.chat.asgi:app
elif [ "$DUO_ENV" = "dev" ]
then
  exec uvicorn \
    --host 0.0.0.0 \
    --port "$PORT" \
    --ws-max-size "${WS_MAX_SIZE}" \
    --reload \
    --reload-exclude 'venv/*' \
    service.chat.asgi:app
else
  echo "The environment variable DUO_ENV must be set and have the value 'dev' or 'prod'"
fi
