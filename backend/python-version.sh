#!/usr/bin/env bash
#
# Prints the backend's Python version (X.Y) from the base stage's FROM line in
# Dockerfile, its only home, for the tools that need it outside Docker. Fails
# when that line names no python:X.Y image.

set -e

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

version=$(sed -nE 's/^FROM python:([0-9]+\.[0-9]+)[^ ]* AS base$/\1/p' "$script_dir/Dockerfile")

if [ -z "$version" ]
then
  echo "No 'FROM python:X.Y AS base' line in $script_dir/Dockerfile" >&2
  exit 1
fi

echo "$version"
