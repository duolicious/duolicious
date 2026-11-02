#!/usr/bin/env bash
#
# Checks that each FROM line naming a python image in backend/*.Dockerfile and
# .devcontainer/Dockerfile has the X.Y version in .python-version, which the
# CI mypy job reads. A python FROM line with no X.Y tag, such as one taking its
# version from an ARG, or pinning a digest alone, fails: it can't be compared.

set -e

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

expected=$(< .python-version)
status=0

python_from='^FROM( --[^ ]+)* ([^ ]*/)?python([:@ ]|$)'
python_tag='^FROM( --[^ ]+)* ([^ ]*/)?python:([0-9]+\.[0-9]+)([^0-9]|$)'

for dockerfile in *.Dockerfile ../.devcontainer/Dockerfile
do
  while IFS= read -r line
  do
    if ! [[ $line =~ $python_tag ]]
    then
      echo "$dockerfile has no Python X.Y version to check in: $line"
      status=1
    elif [ "${BASH_REMATCH[3]}" != "$expected" ]
    then
      echo "$dockerfile uses Python ${BASH_REMATCH[3]}; .python-version says $expected"
      status=1
    fi
  done < <(grep -E "$python_from" "$dockerfile")
done

exit "$status"
