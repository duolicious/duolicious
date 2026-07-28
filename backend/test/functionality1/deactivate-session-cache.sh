#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from duo_session"
q "delete from person"

../util/create-user.sh user1 0 0

assume_role user1
c GET '/search-clubs?q=my-club'
token_a="$SESSION_TOKEN"

assume_role user1
c GET '/search-clubs?q=my-club'
token_b="$SESSION_TOKEN"

[[ "$(q "select count(*) from duo_session where signed_in")" -eq 3 ]]

c POST /deactivate

[[ "$(q "select count(*) from duo_session")" -eq 0 ]]
[[ "$(q "select count(*) from person where activated")" -eq 0 ]]

SESSION_TOKEN="$token_b"
! c GET '/search-clubs?q=my-club' || exit 1

SESSION_TOKEN="$token_a"
! c GET '/search-clubs?q=my-club' || exit 1

assume_role user1

[[ "$(q "select count(*) from person where activated")" -eq 1 ]]

c GET '/search-clubs?q=my-club'
