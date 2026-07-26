#!/usr/bin/env bash

# Run one functionality test repeatedly against a single container, to smoke
# out flakes. On the first failure it prints the test's output and a dump of
# the discovery-related tables, then exits non-zero.
#
# Usage:
#   ./test/util/stress.sh ./functionality1/shadow-banned.sh 20

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir/.."

source ./util/setup.sh

test_path=$1
iterations=${2:-20}

diagnostics () {
  echo '--- person'
  q "select id, name, activated, shadow_banned_at, show_my_online_status,
            last_online_time, now() - last_online_time as online_age
       from person order by id"
  echo '--- person_club'
  q "select person_id, club_name, activated from person_club order by person_id"
  echo '--- club'
  q "select name, count_members from club order by name"
  echo '--- search_preference_club'
  q "select * from search_preference_club order by person_id"
  echo '--- search_cache'
  q "select searcher_person_id, position, prospect_person_id, name
       from search_cache order by searcher_person_id, position"
  echo '--- photo'
  q "select person_id, position, nsfw_score from photo order by person_id, position"
}

for i in $(seq "$iterations")
do
  echo "=== iteration $i/$iterations: $test_path"
  output=$( "$test_path" 2>&1 ) || {
    rc=$?
    echo "$output" | tail -120
    echo "STRESS FAILURE on iteration $i of $test_path"
    diagnostics
    exit "$rc"
  }
done

echo "STRESS PASSED: $iterations/$iterations iterations of $test_path"
