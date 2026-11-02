#!/bin/bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

set -e

export PYTHONUNBUFFERED=true
export PYTHONDONTWRITEBYTECODE=true
export PYTHONPATH=.

if [ "${DUO_USE_VENV:-true}" = true ]
then
  [ -d venv/mypy/ ] || python3 -m venv venv/mypy/
  export PATH=$(readlink -e venv/mypy/bin):$PATH
  python3 -m pip install -q --disable-pip-version-check -r requirements-dev.txt
fi

if [ -n "$1" ]
then
  python3 -m mypy "${1}"
else
  python3 -m mypy .
fi
