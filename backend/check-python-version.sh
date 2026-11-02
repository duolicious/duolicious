#!/usr/bin/env bash
#
# Checks that every Dockerfile built on Python uses the version in
# .python-version, which the CI mypy job reads.

set -e

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

expected=$(< .python-version)
status=0

for dockerfile in *.Dockerfile ../.devcontainer/Dockerfile
do
  for version in $(sed -nE 's/^FROM [^ ]*python:([0-9]+\.[0-9]+).*/\1/p' "$dockerfile")
  do
    if [ "$version" != "$expected" ]
    then
      echo "$dockerfile uses Python $version; .python-version says $expected"
      status=1
    fi
  done
done

exit "$status"
