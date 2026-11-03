#!/bin/bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

set -e

# Assign on its own line: inside a larger command, python-version.sh's exit status is lost.
python_version=$(./python-version.sh)

export PYTHONUNBUFFERED=true
export PYTHONDONTWRITEBYTECODE=true
export PYTHONPATH=.

if [ "${DUO_USE_VENV:-true}" = true ] && [ -d venv/mypy/ ]
then
  export PATH=$(readlink -e venv/mypy/bin):$PATH
fi

if [ "${DUO_USE_VENV:-true}" = true ] && [ ! -d venv/mypy/ ]
then
  python3 -m venv venv/mypy/
  export PATH=$(readlink -e venv/mypy/bin):$PATH
  python3 -m pip install -r requirements-dev.txt
fi

if [ -n "$1" ]
then
  python3 -m mypy --python-version "$python_version" "${1}"
else
  python3 -m mypy --python-version "$python_version" .
fi
