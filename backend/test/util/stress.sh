#!/usr/bin/env bash

# Run one functionality test repeatedly against a single container, to smoke
# out flakes. On the first failure it prints the test's output and a dump of
# the discovery-related tables, then exits non-zero.
#
# Usage:
#   ./test/util/stress.sh ./functionality1/shadow-banned.sh 20

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
test_dir="$( readlink -m "$script_dir/.." )"

test_path="$( readlink -m "$test_dir/$1" )"
iterations=${2:-20}

source "$script_dir/setup.sh"

cd "$test_dir"

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
  echo '--- live people passing the search-only filters'
  q "select id, name from person
      where activated
        and shadow_banned_at is null
        and 'bot' <> all(roles)
        and not hide_me_from_strangers
        and show_my_online_status
        and last_online_time > now() - interval '480 seconds'
      order by id"
  echo '--- person rows total (dead tuples build up in the hnsw index)'
  q "select count(*) from person"
  echo '--- hnsw index size'
  q "select pg_size_pretty(pg_relation_size('idx__person__personality'))"
  echo '--- distinct personality vectors among live people'
  q "select count(distinct personality::text), count(*) from person"

  # Is the vector ORDER BY dropping rows the filters accept? Re-run the same
  # search with and without the hnsw index available to the planner.
  for email in searcher@example.com user1@example.com user2@example.com
  do
    sign_in "$email" > /dev/null 2>&1 || continue
    echo "--- /search as $email, hnsw index present"
    c GET '/search?n=10&o=0' | jq -r '[.[].name] | sort | join(" ")'
  done

  q "drop index idx__person__personality"

  for email in searcher@example.com user1@example.com user2@example.com
  do
    sign_in "$email" > /dev/null 2>&1 || continue
    echo "--- /search as $email, hnsw index dropped"
    c GET '/search?n=10&o=0' | jq -r '[.[].name] | sort | join(" ")'
  done
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
