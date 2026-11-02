#!/usr/bin/env bash
#
# Checks that each FROM line naming a python image in backend/*.Dockerfile has
# the X.Y version in .python-version, which the CI mypy job reads. A python FROM line with no X.Y tag, such as one taking its
# version from an ARG, or pinning a digest alone, fails: it can't be compared.
# So does a python_dockerfiles entry with no python FROM line, as after a move
# to FROM ${BASE_IMAGE}, which would otherwise drop out of the check.

set -e

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

expected=$(< .python-version)
status=0

python_dockerfiles='api.Dockerfile cron.Dockerfile firehol.Dockerfile'

# Docker reads FROM in any case, after leading whitespace, with tabs as well as
# spaces between its words.
python_from='^[[:space:]]*FROM([[:space:]]+--[^[:space:]]+)*[[:space:]]+([^[:space:]]*/)?python([@:[:space:]]|$)'
python_tag='^[[:space:]]*FROM([[:space:]]+--[^[:space:]]+)*[[:space:]]+([^[:space:]]*/)?python:([0-9]+\.[0-9]+)([^0-9]|$)'
shopt -s nocasematch

for dockerfile in $python_dockerfiles
do
  if ! grep -Eiq "$python_from" "$dockerfile"
  then
    echo "$dockerfile has no python FROM line to check"
    status=1
  fi
done

for dockerfile in *.Dockerfile
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
  done < <(grep -Ei "$python_from" "$dockerfile")
done

exit "$status"
