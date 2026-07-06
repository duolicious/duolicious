#!/usr/bin/env bash
#

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

# TODO: Set search preferences via API calls instead of queries
personality_full='[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]'
personality_half='[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]'

setup () {
  q "delete from duo_session"
  q "delete from person"
  q "delete from club"
  q "delete from onboardee"
  q "delete from undeleted_photo"

  ../util/create-user.sh searcher 0
  ../util/create-user.sh user1 0 1
  ../util/create-user.sh user2 0 1

  q "update photo set blurhash = 'the-blurhash'"
  q "update person set privacy_verification_level_id = 1"
  q "update person set personality = array_full(47, 1e-5)"

  searcher_id=$(q "select id from person where email = 'searcher@example.com'")
  user1_id=$(q "select id from person where email = 'user1@example.com'")
  user2_id=$(q "select id from person where email = 'user2@example.com'")

  searcher_uuid=$(q "select uuid from person where email = 'searcher@example.com'")
  user1_uuid=$(q "select uuid from person where email = 'user1@example.com'")
  user2_uuid=$(q "select uuid from person where email = 'user2@example.com'")

  assume_role searcher
}

set_basic () {
  local user=$1
  local basic_name=$2
  local basic_value=$3
  local enum=${4:-$basic_name}

  local query="
  update person
  set ${basic_name}_id = (select id from $enum where name = '$basic_value')
  where email = '$user@example.com'
  "

  q "$query"
}

exclude_basic () {
  local user=$1
  local basic_name=$2
  local basic_value=$3
  local enum=${4:-$basic_name}

  local query="
  delete from search_preference_${basic_name}
  where
    person_id = (select id from person where email = '${user}@example.com')
  and
    ${basic_name}_id = (select id from $enum where name = '${basic_value}')
  "

  q "$query"
}

search_names () {
  local n=${1:-10}
  local o=${2:-0}
  c GET "/search?n=${n}&o=${o}" | jq -r '[.[].name] | sort | join(" ")'
}

assert_search_names () {
  local names=$1
  local n=${2:-10}
  local o=${3:-0}
  [[ "$(search_names "${n}" "${o}")" = "${names}" ]]
}

test_basic () {
  local basic_name=$1
  local basic_value=$2
  local enum=${3:-$basic_name}

  setup
  assert_search_names 'user1 user2'
  set_basic user1 "$basic_name" "$basic_value" "$enum"
  exclude_basic searcher "$basic_name" "$basic_value" "$enum"
  assert_search_names 'user2'
}

test_range () {
  local basic_name=$1

  # Neither min age nor max age
  assert_search_names 'user1 user2'

  # Min ${basic_name}
  q "
  update search_preference_${basic_name} set min_${basic_name} = 50
  where person_id = (select id from person where email = 'searcher@example.com')"
  assert_search_names 'user1 user2'
  q "
  update search_preference_${basic_name} set min_${basic_name} = 51
  where person_id = (select id from person where email = 'searcher@example.com')"
  assert_search_names 'user2'

  # Unset preferences
  q "update search_preference_${basic_name} set min_${basic_name} = null"

  # Max ${basic_name}
  q "
  update search_preference_${basic_name} set max_${basic_name} = 60
  where person_id = (select id from person where email = 'searcher@example.com')"
  assert_search_names 'user1 user2'
  q "
  update search_preference_${basic_name} set max_${basic_name} = 59
  where person_id = (select id from person where email = 'searcher@example.com')"
  assert_search_names 'user1'

  # Min ${basic_name} and max ${basic_name} together
  q "
  update search_preference_${basic_name} set min_${basic_name} = 50
  where person_id = (select id from person where email = 'searcher@example.com')"
  q "
  update search_preference_${basic_name} set max_${basic_name} = 60
  where person_id = (select id from person where email = 'searcher@example.com')"
  assert_search_names 'user1 user2'

  q "
  update search_preference_${basic_name} set min_${basic_name} = 51
  where person_id = (select id from person where email = 'searcher@example.com')"
  q "
  update search_preference_${basic_name} set max_${basic_name} = 59
  where person_id = (select id from person where email = 'searcher@example.com')"
  assert_search_names ''
}

test_basic_age () {
  setup
  q "update search_preference_age set min_age = NULL, max_age = NULL"
  q "
  update person set date_of_birth = (now() - interval '50 years')::date
  where email = 'user1@example.com'"
  q "
  update person set date_of_birth = (now() - interval '60 years')::date
  where email = 'user2@example.com'"

  test_range age
}

test_basic_height () {
  setup
  q "update person set height_cm = 50 where email = 'user1@example.com'"
  q "update person set height_cm = 60 where email = 'user2@example.com'"

  test_range height_cm
}

test_basic_furthest_distance () {
  setup

  assume_role user1
  jc PATCH /profile-info -d '{ "location": "Sydney, New South Wales, Australia" }'

  assume_role user2
  jc PATCH /profile-info -d '{ "location": "Timbuktu, Tombouctou, Mali" }'

  assume_role searcher
  jc PATCH /profile-info -d '{ "location": "Sydney Olympic Park, New South Wales, Australia" }'

  jc POST /search-filter -d '{ "furthest_distance": 50 }'
  assert_search_names user1

  jc POST /search-filter -d '{ "furthest_distance": null }'
  assert_search_names 'user1 user2'
}

test_search_cache () {
  setup
  q "delete from search_cache"

  # Ensure `user1` is ranked first in search results
  q "
  update
    person
  set
    personality = array_full(47, 1),
    count_answers = 1
  where
    email IN ('searcher@example.com', 'user1@example.com')"

  assert_search_names ''            10 1
  assert_search_names 'user1 user2' 10 0
  assert_search_names       'user2' 10 1

  set_basic user2 gender Man
  exclude_basic searcher gender Man

  assert_search_names 'user2' 10 1
  assert_search_names 'user1' 10 0
  assert_search_names      '' 10 1
}

test_quiz_search () {
  setup

  q "
  update person set personality = '${personality_full}'
  where id = ${searcher_id}"

  q "
  update person set personality = '${personality_full}'
  where id = ${user1_id}"

  q "
  update person set personality = '${personality_half}'
  where id = ${user2_id}"

  q "update person set personality = l2_normalize(personality)"

  echo Populate the search cache
  c GET '/search?n=1&o=0'

  echo user1 has the higher match percentage
  q "
  update person set personality = '${personality_full}'
  where id = ${searcher_id}"
  q "update person set personality = l2_normalize(personality)"
  local response1=$(c GET /search | jq -r '[.[].prospect_person_id] | join(" ")')
  [[ "$response1" = "$user1_id" ]]

  echo user1 has the lower match percentage
  q "
  update person set personality = '${personality_half}'
  where id = ${searcher_id}"
  q "update person set personality = l2_normalize(personality)"
  local response2=$(c GET /search | jq -r '[.[].prospect_person_id] | join(" ")')
  [[ "$response2" != "$user1_id" ]]

  echo user2 has the highest match percentage but user2 is skipped by searcher
  c POST "/skip/by-uuid/${user2_uuid}"

  local response3=$(c GET /search | jq -r '[.[].prospect_person_id] | join(" ")')
  [[ "$response3" != "${user2_id}" ]]

  echo "Reset searcher's search cache"
  c POST "/unskip/by-uuid/${user2_uuid}"
  c GET '/search?n=1&o=0'

  echo user2 has the highest match percentage but searcher is skipped by user2
  assume_role user2
  c POST "/skip/by-uuid/${searcher_uuid}"
  assume_role searcher

  local response4=$(c GET /search | jq -r '[.[].prospect_person_id] | join(" ")')
  [[ "$response4" != "${user2_id}" ]]

  echo "Reset searcher's search cache"
  assume_role user2
  c POST "/unskip/by-uuid/${searcher_uuid}"
  assume_role searcher
  c GET '/search?n=1&o=0'



  # user2 has the highest match percentage
  local response2=$(c GET /search | jq -r '[.[].prospect_person_id] | join(" ")')
  [[ "$response2" = "$user2_id" ]]

  # user2 has the highest match percentage but user2 is hidden by searcher
  c POST "/skip/by-uuid/${user2_uuid}"

  local response3=$(c GET /search | jq -r '[.[].prospect_person_id] | join(" ")')
  [[ "$response3" != "${user2_id}" ]]
}

test_deactivated () {
  setup

  assert_search_names 'user1 user2' 10 0

  q "
  update person
  set activated = FALSE
  where email = 'user1@example.com'"

  assert_search_names 'user2' 10 0

  q "
  update person
  set activated = TRUE
  where email = 'user1@example.com'"

  assert_search_names 'user1 user2' 10 0
}

test_verification_required () {
  setup

  assert_search_names 'user1 user2' 10 0

  q "
  update person
  set verification_required = TRUE
  where name in ('user1', 'user2')"

  q "
  update person
  set verification_level_id = 2
  where name = 'user2'"

  assert_search_names 'user2' 10 0
}

test_photos_promoted () {
  setup
  ../util/create-user.sh user3 0
  ../util/create-user.sh user4 0
  q "update person set personality = array_full(47, 1e-5)"

  assert_search_names 'user1 user2 user3 user4' 10 0

  q "
  update person
  set personality = array_full(47, 9e-2)
  where email IN ('searcher@example.com', 'user4@example.com')"
  q "
  update person
  set personality = array_full(47, 8e-2)
  where email IN ('user3@example.com')"
  q "
  update person
  set personality = array_full(47, 7e-2)
  where email IN ('user2@example.com')"
  q "
  update person
  set personality = array_full(47, 6e-2)
  where email IN ('user1@example.com')"

  local response1=$(c GET '/search?n=10&o=0' | jq -r '[.[].name] | join(" ")')

  q "delete from photo"

  local response2=$(c GET '/search?n=10&o=0' | jq -r '[.[].name] | join(" ")')

  [[ "$response1" = "user2 user1 user4 user3" ]]
  [[ "$response2" = "user4 user3 user2 user1" ]]
}

test_verified_promoted () {
  setup

  seq 250 \
    | xargs \
      -P8 \
      -I {} \
      sh -c 'sleep 0.1 ; ../util/create-user.sh "extrauser{}" 0 1'

  q "update person set verification_level_id = 1"

  assume_role searcher

  q "
  update person
  set count_answers = 1
  where name = 'searcher'"
  q "
  update person
  set personality = array_full(47, 1e-3)"
  q "
  update person
  set personality = array_full(47, 9e-2)
  where email IN ('searcher@example.com', 'user1@example.com')"
  q "
  update person
  set personality = array_full(47, 8e-2)
  where email IN ('user2@example.com')"
  q "
  update person
  set personality = array_full(47, 7e-2)
  where email IN ('extrauser1@example.com')"
  q "
  update person
  set personality = array_full(47, 6e-2)
  where email IN ('extrauser2@example.com')"
  q "
  update person
  set personality = array_full(47, 5e-2)
  where email IN ('extrauser3@example.com')"
  q "
  update person
  set personality = array_full(47, 4e-2)
  where email IN ('extrauser4@example.com')"
  q "
  update person
  set personality = array_full(47, 3e-2)
  where email IN ('extrauser5@example.com')"

  local response=$(c GET '/search?n=5&o=0' | jq -r '[.[].name] | join(" ")')
  [[ "$response" = 'user1 user2 extrauser1 extrauser2 extrauser3' ]]

  q "
  update
    person
  set
    verification_level_id = 2
  where
    name = 'extrauser1'
  "

  local response=$(c GET '/search?n=5&o=0' | jq -r '[.[].name] | join(" ")')
  [[ "$response" = 'user1 user2 extrauser1 extrauser2 extrauser3' ]]

  q "
  update
    person
  set
    verification_level_id = 2
  where
    name <> 'user1'
  and
    name <> 'extrauser3'
  "

  local response=$(c GET '/search?n=5&o=0' | jq -r '[.[].name] | join(" ")')
  [[ "$response" = 'user2 extrauser1 extrauser2 extrauser4 extrauser5' ]]
}

test_quiz_filters () {
  setup
  ../util/create-user.sh user3 2
  q "update person set personality = array_full(47, 1e-5)"

  # Gotta set answers to something non-null; ../util/create-user.sh sometimes gives
  # null answers
  q "update answer set answer = false"

  q "
  insert into search_preference_answer (
    person_id,
    question_id,
    answer,
    accept_unanswered
  )
  select
    (select id from person where email = 'searcher@example.com'),
    (select question_id from answer order by question_id limit 1 offset 0),
    (select answer      from answer order by question_id limit 1 offset 0),
    false
  "
  q "
  insert into search_preference_answer (
    person_id,
    question_id,
    answer,
    accept_unanswered
  )
  select
    (select id from person where email = 'searcher@example.com'),
    (select question_id from answer order by question_id limit 1 offset 1),
    (select answer      from answer order by question_id limit 1 offset 1),
    false
  "

  q "update search_preference_answer set accept_unanswered = true"
  assume_role searcher
  assert_search_names 'user1 user2 user3'
  assume_role user1
  assert_search_names 'searcher user2 user3'

  q "update search_preference_answer set accept_unanswered = false"
  assume_role searcher
  assert_search_names 'user3'
  assume_role user1
  assert_search_names 'searcher user2 user3'
}

test_interaction_in_standard_search_skipped () {
  setup

  # searcher skipped user1
  c POST "/skip/by-uuid/${user1_uuid}"

  q "
  update search_preference_skipped
  set
    skipped_id = 1
  where
    person_id = (select id from person where email = 'searcher@example.com')"

  assert_search_names 'user1 user2'

  q "
  update search_preference_skipped
  set
    skipped_id = 2
  where
    person_id = (select id from person where email = 'searcher@example.com')"

  assert_search_names 'user2'

  c POST "/unskip/by-uuid/${user1_uuid}"

  assert_search_names 'user1 user2'
}

test_hide_me_from_strangers () {
  setup

  q "update person set has_profile_picture_id = 1"

  # user1 asks to be hidden from strangers
  q "
  update person
  set hide_me_from_strangers = true
  where id = (select id from person where email = 'user1@example.com')
  "

  # searcher (a stranger to user1) can only see user2 in standard searches
  assert_search_names 'user2'
  # searcher (a stranger to user1) can only see user2 in quiz searches
  assert_search_names 'user2' ''

  # searcher (a stranger to user1) can only see user2 in standard searches
  # user1 messaged the searcher
  q "
  insert into messaged (subject_person_id, object_person_id)
  values (
    (select id from person where email = 'user1@example.com'),
    (select id from person where email = 'searcher@example.com')
  )
  "

  # user1 is no longer a stranger to searcher
  assert_search_names 'user1 user2'
}

test_verified_privacy () {
  setup

  q "update person set privacy_verification_level_id = 2 where name = 'user1'"
  q "update person set privacy_verification_level_id = 3 where name = 'user2'"

  # Ensure `user1` is ranked first in search results
  q "
  update
    person
  set
    personality = array_full(47, 1),
    count_answers = 1
  where
    email IN ('searcher@example.com', 'user1@example.com')"

  # Q_UNCACHED_SEARCH_2 yields the right format
  local response=$(c GET "/search?n=10&o=0")
  local expected=$(jq -r . << EOF
[
  {
    "age": 26,
    "match_percentage": 99,
    "name": "user1",
    "person_messaged_prospect": false,
    "profile_photo_blurhash": "the-blurhash",
    "profile_photo_uuid": null,
    "prospect_messaged_person": false,
    "prospect_person_id": null,
    "prospect_uuid": null,
    "url_slug": null,
    "verification_required_to_view": "basics",
    "verified": false
  },
  {
    "age": 26,
    "match_percentage": 50,
    "name": "user2",
    "person_messaged_prospect": false,
    "profile_photo_blurhash": "the-blurhash",
    "profile_photo_uuid": null,
    "prospect_messaged_person": false,
    "prospect_person_id": null,
    "prospect_uuid": null,
    "url_slug": null,
    "verification_required_to_view": "photos",
    "verified": false
  }
]
EOF
)
  diff <(echo "$response") <(echo "$expected")

  # Q_CACHED_SEARCH yields the right format
  local response=$(c GET "/search?n=10&o=1")
  local expected=$(jq -r . << EOF
[
  {
    "age": 26,
    "match_percentage": 50,
    "name": "user2",
    "person_messaged_prospect": false,
    "profile_photo_blurhash": "the-blurhash",
    "profile_photo_uuid": null,
    "prospect_messaged_person": false,
    "prospect_person_id": null,
    "prospect_uuid": null,
    "url_slug": null,
    "verification_required_to_view": "photos",
    "verified": false
  }
]
EOF
)
  diff <(echo "$response") <(echo "$expected")

  # Q_QUIZ_SEARCH yields the right format
  local response=$(c GET '/search')
  local expected=$(jq -r . << EOF
[
  {
    "age": 26,
    "match_percentage": 99,
    "name": "user1",
    "profile_photo_blurhash": "the-blurhash",
    "profile_photo_uuid": null,
    "prospect_person_id": null,
    "prospect_uuid": null,
    "url_slug": null,
    "verification_required_to_view": "basics"
  }
]
EOF
)
  diff <(echo "$response") <(echo "$expected")
}

test_interaction_in_standard_search_skipped_symmetry() {
  setup

  # Everyone wants to see people they skipped
  q "update search_preference_skipped set skipped_id = 1"

  # Searcher can see everyone
  assert_search_names 'user1 user2'

  # But then... user1 skips searcher :'(
  q "
  insert into skipped (subject_person_id, object_person_id)
  values (
    (select id from person where email = 'user1@example.com'),
    (select id from person where email = 'searcher@example.com')
  )
  "

  # Searcher can no longer see user1 </3
  assert_search_names 'user2'
}

test_json_format () {
  setup

  # Ensure `user1` is ranked first in search results
  q "
  update
    person
  set
    personality = array_full(47, 1),
    count_answers = 1
  where
    email IN ('searcher@example.com', 'user1@example.com')"

  q "delete from photo"

  # Q_UNCACHED_SEARCH_2 yields the right format
  local response=$(c GET '/search?n=1&o=0')
  local expected=$(jq -r . << EOF
[
  {
    "age": 26,
    "match_percentage": 99,
    "name": "user1",
    "person_messaged_prospect": false,
    "profile_photo_blurhash": null,
    "profile_photo_uuid": null,
    "prospect_messaged_person": false,
    "prospect_person_id": ${user1_id},
    "prospect_uuid": "${user1_uuid}",
    "url_slug": "user1",
    "verification_required_to_view": null,
    "verified": false
  }
]
EOF
)
  diff <(echo "$response") <(echo "$expected")

  # Q_CACHED_SEARCH yields the right format
  local response=$(c GET '/search?n=1&o=1')
  local expected=$(jq -r . << EOF
[
  {
    "age": 26,
    "match_percentage": 50,
    "name": "user2",
    "person_messaged_prospect": false,
    "profile_photo_blurhash": null,
    "profile_photo_uuid": null,
    "prospect_messaged_person": false,
    "prospect_person_id": ${user2_id},
    "prospect_uuid": "${user2_uuid}",
    "url_slug": "user2",
    "verification_required_to_view": null,
    "verified": false
  }
]
EOF
)
  diff <(echo "$response") <(echo "$expected")

  # Q_QUIZ_SEARCH yields the right format
  local response=$(c GET '/search')
  local expected=$(jq -r . << EOF
[
  {
    "age": 26,
    "match_percentage": 99,
    "name": "user1",
    "profile_photo_blurhash": null,
    "profile_photo_uuid": null,
    "prospect_person_id": ${user1_id},
    "prospect_uuid": "${user1_uuid}",
    "url_slug": "user1",
    "verification_required_to_view": null
  }
]
EOF
)
  diff <(echo "$response") <(echo "$expected")
}

# The gender filter is two-way for all searchers: a searcher only sees
# prospects whose own gender filters accept the searcher. The other basics
# filters (distance, age) are one-way: a searcher sees a prospect regardless
# of the prospect's distance and age filters.

test_bidirectional_gender_filter () {
  setup

  assume_role user1
  jc PATCH /profile-info  -d '{ "gender": "Man" }'
  jc POST  /search-filter -d '{ "gender": ["Woman"] }'

  assume_role user2
  jc PATCH /profile-info  -d '{ "gender": "Non-binary" }'
  jc POST  /search-filter -d '{ "gender": ["Woman"] }'

  assume_role searcher
  jc PATCH /profile-info  -d '{ "gender": "Woman" }'
  jc POST  /search-filter -d '{ "gender": ["Man"] }'

  assume_role user1
  assert_search_names "searcher"

  assume_role user2
  assert_search_names ""

  assume_role searcher
  assert_search_names "user1"
}

test_one_way_location_filter () {
  setup

  # user1's distance filter excludes searcher's location
  assume_role user1
  jc PATCH /profile-info  -d '{ "location": "Brisbane, Queensland, Australia" }'
  jc POST  /search-filter -d '{ "furthest_distance": 100 }'

  assume_role searcher
  jc POST  /search-filter -d '{ "furthest_distance": null }'

  # searcher's search is one-way: they see user1 despite user1's 100km filter
  # (searcher is far from Brisbane). searcher's own filter is unlimited, so
  # they also see user2.
  assert_search_names 'user1 user2'
}

test_one_way_age_filter () {
  setup

  # user1's age filter excludes searcher's age
  assume_role user1
  jc POST  /search-filter -d '{ "age": { "min_age": 40, "max_age": 60 }}'

  assume_role searcher
  jc POST  /search-filter -d '{ "age": { "min_age": null, "max_age": null }}'

  # searcher's search is one-way: they see user1 despite user1's 40-60 age
  # filter (searcher is ~26). searcher's own filter is unbounded, so they also
  # see user2.
  assert_search_names 'user1 user2'
}

test_search_page_size_limit () {
  setup

  ! search_names 11 || exit 1
  search_names 10
}

test_clubs () {
  setup

  assume_role user1
  jc POST /join-club -d '{ "name": "Anime" }'
  jc POST /join-club -d '{ "name": "K-pop" }'

  assume_role user2
  jc POST /join-club -d '{ "name": "Manga" }'
  jc POST /join-club -d '{ "name": "J-pop" }'

  assume_role searcher

  echo Search for Anime
  local response=$(
    c GET "/search?n=10&o=0&club=Anime" | jq -r '[.[].name] | sort | join(" ")'
  )
  [[ "$response" = "user1" ]]

  echo Anime club setting is remembered
  local response=$(
    c GET "/search?n=10&o=0" | jq -r '[.[].name] | sort | join(" ")'
  )
  [[ "$response" = "user1" ]]

  echo Search for Manga
  local response=$(
    c GET "/search?n=10&o=0&club=Manga" | jq -r '[.[].name] | sort | join(" ")'
  )
  [[ "$response" = "user2" ]]

  echo Manga club setting is remembered
  local response=$(
    c GET "/search?n=10&o=0" | jq -r '[.[].name] | sort | join(" ")'
  )
  [[ "$response" = "user2" ]]

  echo Everyone is included again when the club setting is cleared
  local response=$(
    c GET "/search?n=10&o=0&club=%00" | jq -r '[.[].name] | sort | join(" ")'
  )
  [[ "$response" = "user1 user2" ]]
}

test_pending_club_cleared () {
  setup

  jc POST /join-club -d '{ "name": "my-club" }'

  q "update search_preference_club set club_name = 'my-club'"

  search_names

  local num_matches=$(
    q "select count(*) \
      from search_preference_club \
      where person_id = '$searcher_id'"
  )

  [[ "$num_matches" = 0 ]]
}

test_pending_club_cleared

test_clubs

test_quiz_search

test_hide_me_from_strangers
test_verified_privacy

test_interaction_in_standard_search_skipped
test_interaction_in_standard_search_skipped_symmetry

test_quiz_filters

test_photos_promoted

test_verified_promoted

test_deactivated

test_verification_required

test_search_cache

test_basic gender Man
test_basic orientation Straight
test_basic ethnicity 'Middle Eastern'
test_basic_age
test_basic_furthest_distance
test_basic_height
test_basic has_profile_picture 'No' yes_no
test_basic looking_for 'Long-term dating'
test_basic smoking 'Yes' yes_no_optional
test_basic drinking 'Often' frequency
test_basic drugs 'No' yes_no_optional
test_basic long_distance 'Yes' yes_no_optional
test_basic relationship_status 'Seeing someone'
test_basic has_kids 'Yes' yes_no_optional
test_basic wants_kids 'No' yes_no_optional
test_basic exercise 'Never' frequency
test_basic religion 'Buddhist'
test_basic star_sign 'Leo'

test_bidirectional_gender_filter
test_one_way_location_filter
test_one_way_age_filter

test_json_format

test_search_page_size_limit
