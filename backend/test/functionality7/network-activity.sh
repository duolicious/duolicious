#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -ex

network_activity () {
  q "
    select network, round(sign_ups::numeric, 2), round(shadow_bans::numeric, 2)
    from network_activity
    order by network
  "
}

q "delete from person"
q "delete from network_activity"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0

[[ "$(q "select round(sum(sign_ups)) from network_activity")" = 2 ]]

counted="$(network_activity)"

seed="$(
  cd ../..
  python3 -c '
from serviceshared.antiabuse.networkactivity import Q_SEED_NETWORK_ACTIVITY
print(Q_SEED_NETWORK_ACTIVITY)'
)"

q "delete from network_activity"
q "$seed"

[[ "$(network_activity)" = "$counted" ]]
