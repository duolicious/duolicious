#!/bin/bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

set -e

export PYTHONUNBUFFERED=true
export PYTHONDONTWRITEBYTECODE=true
export PYTHONPATH=.

if [ "${DUO_USE_VENV:-true}" = true ]
then
  # A venv made by another Python minor version can't load its packages, as
  # after the dev container is rebuilt on another Python, so remake it then.
  venv_version=$(awk -F ' = ' '$1 ~ /^version(_info)?$/ { split($2, v, "."); print v[1] "." v[2]; exit }' venv/mypy/pyvenv.cfg 2>/dev/null || true)
  interpreter_version=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')
  [ "$venv_version" = "$interpreter_version" ] || python3 -m venv --clear venv/mypy/
  export PATH=$(readlink -e venv/mypy/bin):$PATH
  python3 -m pip install -q --disable-pip-version-check -r requirements-dev.txt
fi

if [ -n "$1" ]
then
  python3 -m mypy --python-version "$(< .python-version)" "${1}"
else
  python3 -m mypy --python-version "$(< .python-version)" .
fi
