#!/bin/bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

set -e

export PYTHONUNBUFFERED=true
export PYTHONDONTWRITEBYTECODE=true
export PYTHONPATH=.

if [ "${DUO_USE_VENV:-true}" = true ] && [ -d venv/api/ ]
then
  export PATH=$(readlink -e venv/api/bin):$PATH
fi

if [ "${DUO_USE_VENV:-true}" = true ] && [ ! -d venv/api/ ]
then
  python3 -m venv venv/api/
  export PATH=$(readlink -e venv/api/bin):$PATH
  python3 -m pip install -r requirements.txt
fi

if [ -z "$PORT" ]
then
  PORT=5000
fi

if [ "$DUO_ENV" = "prod" ]
then
  python3 database/initapi.py
  exec uvicorn \
    --host 0.0.0.0 \
    --port "$PORT" \
    --workers "${DUO_WORKERS:-4}" \
    --proxy-headers \
    --forwarded-allow-ips '*' \
    service.api:app
elif [ "$DUO_ENV" = "dev" ]
then
  python3 database/initapi.py
  exec uvicorn \
    --host 0.0.0.0 \
    --port "$PORT" \
    --proxy-headers \
    --forwarded-allow-ips '*' \
    --reload \
    --reload-exclude 'venv/*' \
    service.api:app
else
  echo "The environment variable DUO_ENV must be set and have the value 'dev' or 'prod'"
fi
