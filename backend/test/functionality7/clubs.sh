#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

club_idempotence () {
  echo 'Joining a club twice is the same as joining it once'

  q "delete from person"
  q "delete from person_club"
  q "delete from club"

  ../util/create-user.sh user1 0 0
  ../util/create-user.sh user2 0 0

  assume_role user1
  jc POST /join-club -d '{ "name": "my-club-1" }'
  jc POST /join-club -d '{ "name": "my-club-1" }'

  assume_role user2
  expected=$(
    jq -r . <<< "[ \
      {\"count_members\": 1, \"name\": \"my-club-1\"}, \
      {\"count_members\": 0, \"name\": \"my-club\"}
    ]"
  )
  assert_eventually "$expected" c GET '/search-clubs?q=my-club'
}

club_quota_without_gold () {
  echo 'You can join no more than 50 clubs without gold'

  q "delete from person"
  q "delete from person_club"
  q "delete from club"

  ../util/create-user.sh user1 0 0
  ../util/create-user.sh user2 0 0

  q "update person set has_gold = false"

  assume_role user1
  for i in {1..50}
  do
    jc POST /join-club -d '{ "name": "my-club-'$i'" }'
  done
  ! jc POST /join-club -d '{ "name": "my-club-101" }' || exit 1

  assume_role user2
  jc POST /join-club -d '{ "name": "my-club-1" }'
}

club_quota_with_gold () {
  echo 'You can join no more than 100 clubs with gold'

  q "delete from person"
  q "delete from person_club"
  q "delete from club"

  ../util/create-user.sh user1 0 0
  ../util/create-user.sh user2 0 0

  assume_role user1
  for i in {1..100}
  do
    jc POST /join-club -d '{ "name": "my-club-'$i'" }'
  done
  ! jc POST /join-club -d '{ "name": "my-club-101" }' || exit 1

  assume_role user2
  jc POST /join-club -d '{ "name": "my-club-1" }'
}

club_count_when_deleted () {
  echo 'Club count(s) decrement when member deletes their account'

  q "delete from person"
  q "delete from person_club"
  q "delete from club"

  ../util/create-user.sh user1 0 0
  ../util/create-user.sh user2 0 0
  ../util/create-user.sh user3 0 0
  ../util/create-user.sh user4 0 0

  assume_role user1
  jc POST /join-club -d '{ "name": "my-club-1" }'
  jc POST /join-club -d '{ "name": "my-club-2" }'
  jc POST /join-club -d '{ "name": "my-club-3" }'
  jc POST /join-club -d '{ "name": "my-club-4" }'

  assume_role user2
  jc POST /join-club -d '{ "name": "my-club-1" }'
  jc POST /join-club -d '{ "name": "my-club-2" }'

  assume_role user3
  jc POST /join-club -d '{ "name": "my-club-2" }'
  jc POST /join-club -d '{ "name": "my-club-3" }'

  assume_role user4
  expected=$(
    jq -r . <<< "[ \
      {\"count_members\": 3, \"name\": \"my-club-2\"}, \
      {\"count_members\": 2, \"name\": \"my-club-1\"}, \
      {\"count_members\": 2, \"name\": \"my-club-3\"}, \
      {\"count_members\": 1, \"name\": \"my-club-4\"}, \
      {\"count_members\": 0, \"name\": \"my-club\"} \
    ]"
  )
  assert_eventually "$expected" c GET '/search-clubs?q=my-club'

  assume_role user3
  c DELETE /account

  assume_role user4

  expected=$(
    jq -r . <<< "[ \
      {\"count_members\": 2, \"name\": \"my-club-1\"}, \
      {\"count_members\": 2, \"name\": \"my-club-2\"}, \
      {\"count_members\": 1, \"name\": \"my-club-3\"}, \
      {\"count_members\": 1, \"name\": \"my-club-4\"}, \
      {\"count_members\": 0, \"name\": \"my-club\"} \
    ]"
  )
  assert_eventually "$expected" c GET '/search-clubs?q=my-club'
}

club_count_when_activated_or_deactivated () {
  echo 'Club count(s) decrement when member (de)activates their account'

  q "delete from person"
  q "delete from person_club"
  q "delete from club"

  ../util/create-user.sh user1 0 0
  ../util/create-user.sh user2 0 0
  ../util/create-user.sh user3 0 0
  ../util/create-user.sh user4 0 0

  assume_role user1
  jc POST /join-club -d '{ "name": "my-club-1" }'
  jc POST /join-club -d '{ "name": "my-club-2" }'
  jc POST /join-club -d '{ "name": "my-club-3" }'
  jc POST /join-club -d '{ "name": "my-club-4" }'

  assume_role user2
  jc POST /join-club -d '{ "name": "my-club-1" }'
  jc POST /join-club -d '{ "name": "my-club-2" }'

  assume_role user3
  jc POST /join-club -d '{ "name": "my-club-2" }'
  jc POST /join-club -d '{ "name": "my-club-3" }'

  assume_role user4
  expected=$(
    jq -r . <<< "[ \
      {\"count_members\": 3, \"name\": \"my-club-2\"}, \
      {\"count_members\": 2, \"name\": \"my-club-1\"}, \
      {\"count_members\": 2, \"name\": \"my-club-3\"}, \
      {\"count_members\": 1, \"name\": \"my-club-4\"}, \
      {\"count_members\": 0, \"name\": \"my-club\"} \
    ]"
  )
  assert_eventually "$expected" c GET '/search-clubs?q=my-club'

  assume_role user3
  c POST /deactivate

  assume_role user4

  expected=$(
    jq -r . <<< "[ \
      {\"count_members\": 2, \"name\": \"my-club-1\"}, \
      {\"count_members\": 2, \"name\": \"my-club-2\"}, \
      {\"count_members\": 1, \"name\": \"my-club-3\"}, \
      {\"count_members\": 1, \"name\": \"my-club-4\"}, \
      {\"count_members\": 0, \"name\": \"my-club\"} \
    ]"
  )
  assert_eventually "$expected" c GET '/search-clubs?q=my-club'

  assume_role user3 # Activate account again

  assume_role user4
  expected=$(
    jq -r . <<< "[ \
      {\"count_members\": 3, \"name\": \"my-club-2\"}, \
      {\"count_members\": 2, \"name\": \"my-club-1\"}, \
      {\"count_members\": 2, \"name\": \"my-club-3\"}, \
      {\"count_members\": 1, \"name\": \"my-club-4\"}, \
      {\"count_members\": 0, \"name\": \"my-club\"} \
    ]"
  )
  assert_eventually "$expected" c GET '/search-clubs?q=my-club'
}

banned_clubs () {
  echo "banned clubs aren't displayed and are unjoinable"

  q "delete from person"
  q "delete from person_club"
  q "delete from club"

  ../util/create-user.sh user1 0 0

  assume_role user1

  results=$(c GET '/search-clubs?q=I+HATE+MINORITIES')
  expected='[]'
  [[ "$results" == "$expected" ]]

  results=$(c GET '/search-clubs?q=did+you+know+I+HATE+MINORITIES')
  expected='[]'
  [[ "$results" == "$expected" ]]

  ! jc POST /join-club -d '{ "name": "I HATE MINORITIES" }' || exit 1
  ! jc POST /join-club -d '{ "name": "did you know I HATE MINORITIES" }' || exit 1
}

deleting_populated_banned_club () {
  echo "A populated club whose name gets banned is deleted without a FK violation"

  q "delete from person"
  q "delete from person_club"
  q "delete from club_stats_dirty"
  q "delete from club"

  ../util/create-user.sh user1 0 0
  ../util/create-user.sh user2 0 0

  assume_role user1
  jc POST /join-club -d '{ "name": "soon-banned-club" }'

  assume_role user2
  jc POST /join-club -d '{ "name": "soon-banned-club" }'

  [[ "$(q "select count(*) from club where name = 'soon-banned-club'")" == "1" ]]

  q "insert into banned_club (name) values ('soon-banned-club') on conflict do nothing"

  # Mirrors the cleanup at the end of banned-club.sql. Deleting the club
  # cascades to its person_club rows, firing trigger_mark_club_stats_dirty;
  # the trigger must not re-reference the club row being deleted in the same
  # statement, or this raises a foreign key violation.
  out=$(q "delete from club using banned_club where club.name = banned_club.name" 2>&1)
  ! grep -qiE 'error|violat' <<< "$out" || { echo "$out"; exit 1; }

  [[ "$(q "select count(*) from club where name = 'soon-banned-club'")" == "0" ]]
  [[ "$(q "select count(*) from club_stats_dirty where club_name = 'soon-banned-club'")" == "0" ]]

  q "delete from banned_club where name = 'soon-banned-club'"
}

empty_club_search_string () {
  echo 'An empty search string returns the most popular clubs'

  q "delete from person"
  q "delete from person_club"
  q "delete from club"

  ../util/create-user.sh user1 0 0
  ../util/create-user.sh user2 0 0
  ../util/create-user.sh user3 0 0
  ../util/create-user.sh user4 0 0

  assume_role user1
  jc POST /join-club -d '{ "name": "my-club-1" }'
  jc POST /join-club -d '{ "name": "my-club-2" }'
  jc POST /join-club -d '{ "name": "my-club-3" }'

  assume_role user2
  jc POST /join-club -d '{ "name": "my-club-1" }'
  jc POST /join-club -d '{ "name": "my-club-2" }'

  assume_role user3
  jc POST /join-club -d '{ "name": "my-club-1" }'

  assume_role user4

  expected=$(
    jq -r . <<< "[ \
      {\"count_members\": 3, \"name\": \"my-club-1\"}, \
      {\"count_members\": 2, \"name\": \"my-club-2\"}, \
      {\"count_members\": 1, \"name\": \"my-club-3\"} \
    ]"
  )
  public_clubs () {
    SESSION_TOKEN='' c GET '/search-public-clubs'
  }
  assert_eventually "$expected" public_clubs
}

club_name_with_colon () {
  echo 'A club name may contain a colon (e.g. a bible verse)'

  q "delete from person"
  q "delete from person_club"
  q "delete from club"

  ../util/create-user.sh user1 0 0
  ../util/create-user.sh user2 0 0

  assume_role user1
  jc POST /join-club -d '{ "name": "John 3:16" }'

  # Stored in normalized (lower-cased) form, with the colon preserved.
  [[ "$(q "select name from club")" == "john 3:16" ]]

  # The colon survives the round-trip through the search query string too
  # (curl -G --data-urlencode encodes the colon and space as %3A / %20).
  # Search as a non-member, since a user's own clubs are excluded from results.
  assume_role user2
  colon_club_count () {
    c GET /search-clubs -G --data-urlencode 'q=John 3:16' \
      | jq -r '[.[] | select(.name == "john 3:16" and .count_members == 1)] | length'
  }
  assert_eventually "1" colon_club_count
}

public_club_search () {
  echo 'Public club search returns something'

  q "delete from person"
  q "delete from person_club"
  q "delete from club"

  ../util/create-user.sh user1 0 0
  ../util/create-user.sh user2 0 0
  ../util/create-user.sh user3 0 0
  ../util/create-user.sh user4 0 0

  assume_role user1
  jc POST /join-club -d '{ "name": "my-club-1" }'
  jc POST /join-club -d '{ "name": "my-club-2" }'
  jc POST /join-club -d '{ "name": "my-club-3" }'

  assume_role user2
  jc POST /join-club -d '{ "name": "my-club-1" }'
  jc POST /join-club -d '{ "name": "my-club-2" }'

  assume_role user3
  jc POST /join-club -d '{ "name": "my-club-1" }'

  assume_role user4

  expected=$(
    jq -r . <<< "[ \
      {\"count_members\": 1, \"name\": \"my-club-3\"}, \
      {\"count_members\": 3, \"name\": \"my-club-1\"}, \
      {\"count_members\": 2, \"name\": \"my-club-2\"} \
    ]"
  )

  assert_eventually "$expected" c GET '/search-clubs?q=my-club-3'
  public_clubs () {
    SESSION_TOKEN='' c GET '/search-public-clubs?q=my-club-3'
  }
  assert_eventually "$expected" public_clubs
}

public_club_search
empty_club_search_string
club_idempotence
club_quota_without_gold
club_quota_with_gold
club_count_when_deleted
club_count_when_activated_or_deactivated
banned_clubs
deleting_populated_banned_club
club_name_with_colon
