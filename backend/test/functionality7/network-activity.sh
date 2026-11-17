#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -ex

q "delete from person"
q "delete from network_activity"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0

[[ "$(q "select round(sum(sign_ups)) from network_activity")" = 2 ]]
