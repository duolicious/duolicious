#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

MOCK_DESCRIPTION='A friendly test description for this club.'

# Wait for the crons to populate club_stats / club_seo before hitting the
# API, since get_club's lru_cache would lock in a premature 404 for 5 min.
wait_for () {
  local sql=$1
  for _ in $(seq 1 60); do
    [[ "$(q "$sql")" == "1" ]] && return 0
    sleep 0.5
  done
  echo "wait_for timed out: $sql" >&2
  return 1
}

reset_db () {
  q "delete from person"
  q "delete from person_club"
  q "delete from club_stats"
  q "delete from club_stats_dirty"
  q "delete from club_seo"
  q "delete from club"
}

club_page_is_precomputed_and_served () {
  echo 'An eligible club gets a precomputed, single-row /club/<name> page'

  reset_db

  # create-user.sh onboards every user with gender "Other" and age 26, so
  # demographic cells are deterministic and clear MIN_CLUB_CELL_SIZE = 5.
  for i in $(seq 1 51); do
    ../util/create-user.sh "clubber$i" 0 0
  done
  for i in $(seq 1 51); do
    assume_role "clubber$i"
    jc POST /join-club -d '{ "name": "anime" }'
  done

  # Wait on the exact stored member_count, not just row existence: the cron
  # races the join loop and a tick firing mid-loop writes a stats row with
  # a stale count that lru_cache would lock in for 5 minutes.
  wait_for "select 1 from club_stats where club_name = 'anime' and (stats_json->>'member_count')::int = 51"
  wait_for "select (description is not null)::int from club_seo where club_name = 'anime'"

  result=$(c GET /club/anime)

  [[ "$(jq -r .name         <<< "$result")" == "anime" ]]
  [[ "$(jq -r .member_count <<< "$result")" == "51" ]]
  [[ "$(jq -r .description  <<< "$result")" == "$MOCK_DESCRIPTION" ]]

  [[ "$(jq -r '.demographics.gender[0].label' <<< "$result")" == "Other" ]]
  [[ "$(jq -r '.demographics.gender[0].count' <<< "$result")" == "51" ]]

  [[ "$(jq -r '.demographics.age_buckets[0].label' <<< "$result")" == "25-34" ]]
  [[ "$(jq -r '.demographics.age_buckets[0].count' <<< "$result")" == "51" ]]

  # Empty categories are empty arrays, not null.
  [[ "$(jq -r '.demographics.religion | type' <<< "$result")" == "array" ]]
  [[ "$(jq -r '.personality   | type'        <<< "$result")" == "array" ]]
  [[ "$(jq -r '.related_clubs | type'        <<< "$result")" == "array" ]]
}

leading_slash_club_is_served_via_encoded_path () {
  echo 'A club whose name contains slashes is reachable at /club/%2F...%2F'

  # Club names may legitimately contain (and begin with) slashes, e.g. "/a/".
  # Such a name reaches the API percent-encoded as "/club/%2Fa%2F". This
  # guards the FastAPI/uvicorn path handling that decodes "%2F" back to "/"
  # and feeds it to the {name:path} route param (the job Flask's
  # LeadingSlashPathConverter used to do). A regression there would either
  # 404 (the un-decoded "%2Fa%2F" fails CLUB_PATTERN, which has no "%") or
  # route to the wrong club -- both caught by the assertions below.

  reset_db

  for i in $(seq 1 51); do
    ../util/create-user.sh "slashclubber$i" 0 0
  done
  for i in $(seq 1 51); do
    assume_role "slashclubber$i"
    jc POST /join-club -d '{ "name": "/a/" }'
  done

  wait_for "select 1 from club_stats where club_name = '/a/' and (stats_json->>'member_count')::int = 51"
  wait_for "select (description is not null)::int from club_seo where club_name = '/a/'"

  result=$(c GET '/club/%2Fa%2F')

  [[ "$(jq -r .name         <<< "$result")" == "/a/" ]]
  [[ "$(jq -r .member_count <<< "$result")" == "51" ]]
}

small_club_is_not_a_page () {
  echo 'A club below the member threshold has no precomputed page and 404s'

  reset_db

  for i in $(seq 1 3); do
    ../util/create-user.sh "tiny$i" 0 0
  done
  for i in $(seq 1 3); do
    assume_role "tiny$i"
    jc POST /join-club -d '{ "name": "tinyclub" }'
  done

  # Give the crons a chance to (correctly) skip this ineligible club.
  sleep 3

  [[ "$(q "select count(*) from club_stats where club_name = 'tinyclub'")" == "0" ]]
  ! c GET /club/tinyclub || exit 1
}

missing_club_404s () {
  echo 'A club that does not exist 404s'

  ! c GET /club/this-club-does-not-exist || exit 1
}

related_clubs_are_ranked_by_overlap () {
  echo 'A club lists overlapping clubs as related (via the club_overlap cron)'

  # Fresh club names: get_club memoises per name, so reusing one from an
  # earlier test would return its cached (empty-related) result.
  reset_db

  for i in $(seq 1 52); do
    ../util/create-user.sh "knitter$i" 0 0
  done

  # 52 in "knitting", 51 of those also in "crochet"; both clear
  # MIN_CLUB_PAGE_MEMBERS = 50.
  for i in $(seq 1 52); do
    assume_role "knitter$i"
    jc POST /join-club -d '{ "name": "knitting" }'
  done
  for i in $(seq 1 51); do
    assume_role "knitter$i"
    jc POST /join-club -d '{ "name": "crochet" }'
  done

  # Wait for both the stats cron (all 52 joins) and the overlap rebuild
  # (all 51 shared members) before issuing the GET that will be cached.
  wait_for "select 1 from club_stats where club_name = 'knitting' and (stats_json->>'member_count')::int = 52"
  wait_for "select 1 from club_overlap where club_a = 'knitting' and club_b = 'crochet' and overlap = 51"

  result=$(c GET /club/knitting)
  [[ "$(jq -r '.related_clubs[0].name'          <<< "$result")" == "crochet" ]]
  [[ "$(jq -r '.related_clubs[0].count_members' <<< "$result")" == "51" ]]
}

club_page_is_precomputed_and_served
leading_slash_club_is_served_via_encoded_path
small_club_is_not_a_page
missing_club_404s
related_clubs_are_ranked_by_overlap
