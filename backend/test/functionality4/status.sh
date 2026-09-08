#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

[[
  "$(jq '.status_index'      < ../../service/status/index.html)" -lt \
  "$(jq '.statuses | length' < ../../service/status/index.html)"
]]

c GET 'http://localhost:8080'
