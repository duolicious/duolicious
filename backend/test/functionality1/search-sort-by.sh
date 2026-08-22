#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from duo_session"
q "delete from person"
q "delete from onboardee"
q "delete from person_club"
q "delete from club"

../util/create-user.sh searcher 0 0
../util/create-user.sh matchy 0 0
../util/create-user.sh clubby 0 0

assume_role searcher
jc POST /answer -d '{ "question_id": 1001, "answer": true, "public": false }'
jc POST /answer -d '{ "question_id": 1002, "answer": true, "public": false }'
jc POST /join-club -d '{ "name": "tiny club" }'
jc POST /join-club -d '{ "name": "tinier club" }'

assume_role matchy
jc POST /answer -d '{ "question_id": 1001, "answer": true, "public": false }'
jc POST /answer -d '{ "question_id": 1002, "answer": true, "public": false }'

assume_role clubby
jc POST /answer -d '{ "question_id": 1001, "answer": false, "public": false }'
jc POST /answer -d '{ "question_id": 1002, "answer": false, "public": false }'
jc POST /join-club -d '{ "name": "tiny club" }'
jc POST /join-club -d '{ "name": "tinier club" }'

embeddings_exist () {
  [[ "$(q "
    select count(*) from club
    where embedding != array_full(64, 0)::vector(64)
  ")" = 2 ]]
}

count=0
max_retries=60
while ! embeddings_exist; do
  ((count++)) || true

  if [[ $count -eq $max_retries ]]; then
    echo "Embeddings cron didn't run. Exiting."
    exit 1
  fi

  sleep 1
done

echo 'Signing in re-pools the club vector against the fresh embeddings'
assume_role clubby
assume_role searcher
nonzero_vectors () {
  q "
    select count(*) from person
    where club_vector != array_full(64, 0)::vector(64)
  "
}
assert_eventually "2" nonzero_vectors

search_names_in_order () {
  c GET "/search?n=10&o=0" | jq -r '[.[].name] | join(" ")'
}

assume_role searcher

echo 'The default ordering is by match percentage'
response=$(c GET /search-filters | jq -r '.sort_by')
[[ "$response" = 'Match percentage' ]]
[[ "$(search_names_in_order)" = 'matchy clubby' ]]

echo 'Invalid sort_by values are rejected'
! jc POST /search-filter -d '{ "sort_by": "Dart throws" }' || exit 1

echo 'Ordering by Similar clubs puts club-sharers first'
jc POST /search-filter -d '{ "sort_by": "Similar clubs" }'
response=$(c GET /search-filters | jq -r '.sort_by')
[[ "$response" = 'Similar clubs' ]]
[[ "$(search_names_in_order)" = 'clubby matchy' ]]

echo 'Cached pages preserve the club ordering'
[[ "$(c GET '/search?n=1&o=0' | jq -r '.[0].name')" = 'clubby' ]]
[[ "$(c GET '/search?n=1&o=1' | jq -r '.[0].name')" = 'matchy' ]]

echo 'Leaving the shared clubs reverts the ordering via the live searcher vector'
jc POST /leave-club -d '{ "name": "tiny club" }'
jc POST /leave-club -d '{ "name": "tinier club" }'
[[ "$(search_names_in_order)" = 'matchy clubby' ]]

echo 'A searcher with no clubs still gets match-ordered results in clubs mode'
assume_role matchy
jc POST /search-filter -d '{ "sort_by": "Similar clubs" }'
results=$(c GET '/search?n=10&o=0' | jq -r '[.[].name] | join(" ")')
[[ "$results" = 'searcher clubby' ]]

echo 'Switching back to match percentage restores the default ordering'
assume_role searcher
jc POST /search-filter -d '{ "sort_by": "Match percentage" }'
[[ "$(search_names_in_order)" = 'matchy clubby' ]]
