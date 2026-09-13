#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from person"

! ../util/create-user.sh i_hate_minorities 0 0 || exit 1
  ../util/create-user.sh i_love_minorities 0 0

set_gold true "true"

assume_role i_love_minorities

! jc PATCH /profile-info -d '{ "name": "i hate minorities" }' || exit 1
  jc PATCH /profile-info -d '{ "name": "i love minorities" }'
