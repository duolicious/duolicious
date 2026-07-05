#!/usr/bin/env bash
#

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

test_json_format () {
  local searcher_uuid
  local before
  local response
  local expected

  q "delete from duo_session"
  q "delete from person"
  q "delete from club"
  q "delete from onboardee"
  q "delete from undeleted_photo"

  ../util/create-user.sh searcher 0
  ../util/create-user.sh user1 0 1
  ../util/create-user.sh user2 0 1
  ../util/create-user.sh user3 0 0
  ../util/create-user.sh user4 0 1
  ../util/create-user.sh user5 0 1
  ../util/create-user.sh user6 0 1
  ../util/create-user.sh user7 0 1
  ../util/create-user.sh user8 0 1
  ../util/create-user.sh user9 0 1
  ../util/create-user.sh user10 0 1
  ../util/create-user.sh user11 0 1
  ../util/create-user.sh user12 0 1
  ../util/create-user.sh user13 0 1
  ../util/create-user.sh user14 0 1
  ../util/create-user.sh user15 0 1
  ../util/create-user.sh user16 0 1

  searcher_uuid=$(q "select uuid from person where name = 'searcher'")
  user13_uuid=$(q "select uuid from person where name = 'user13'")

  q "update person set privacy_verification_level_id = 1"

  q "update person set verification_required = true where name = 'user15'"
  q "update person set verification_required = true where name = 'user16'"
  q "update person set verification_level_id = 2 where name = 'user16'"
  q "update person set background_color = '#aaaaaa'"

  assume_role searcher
  jc PATCH /profile-info -d '{ "verification_level": "Basics only" }'

  assume_role user1
  jc PATCH /profile-info -d '{ "verification_level": "Basics only" }'

  assume_role user2
  jc PATCH /profile-info -d '{ "verification_level": "Photos" }'

  assume_role user4
  c POST "/skip/by-uuid/${searcher_uuid}"

  assume_role user5
  jc PATCH /profile-info -d '{ "hide_me_from_strangers": "Yes" }'

  assume_role user6
  c POST '/deactivate'

  assume_role user7
  jc PATCH /profile-info -d '{ "about": "You just lost the game" }'

  assume_role user8
  jc PATCH /profile-info \
    -d "{
            \"base64_file\": {
                \"position\": 1,
                \"base64\": \"$(rand_image)\",
                \"top\": 0,
                \"left\": 0
            }
        }"

  assume_role user9
  jc PATCH /profile-info \
    -d "{
            \"base64_file\": {
                \"position\": 1,
                \"base64\": \"$(rand_image)\",
                \"top\": 0,
                \"left\": 0
            }
        }"
  jc DELETE /profile-info -d '{ "files": [1] }'

  assume_role user10
  jc PATCH /profile-info \
    -d "{ \"base64_audio_file\": { \"base64\": \"$(rand_sound)\" } }"

  assume_role user11
  jc PATCH /profile-info \
    -d "{ \"base64_audio_file\": { \"base64\": \"$(rand_sound)\" } }"
  jc DELETE /profile-info -d '{ "audio_files": [-1] }'

  assume_role user1
  jc POST "/skip/by-uuid/${user13_uuid}" -d '{ "report_reason": "12345" }'
  assume_role user2
  jc POST "/skip/by-uuid/${user13_uuid}" -d '{ "report_reason": "12345" }'

  assume_role user14
  jc PATCH /profile-info -d '{ "about": "You just lost thug game" }'
  jc PATCH /profile-info -d '{ "about": "  " }'

  assume_role searcher
  c POST "/skip/by-uuid/$(q "select uuid from person where name = 'user12'")"

  before=$(q "select iso8601_utc(now()::timestamp)")

  response=$(
    c GET "/feed?before=${before}" \
      | jq -S '
        def redact: if . == null then . else "redacted_nonnull_value" end;

        # helper: redact .[$k] only if it exists and is not null
        def redact_if_present($k):
          if has($k) and .[$k] != null       # key exists (and we ignore nulls)
          then .[$k] |= redact
          else .
          end ;

        map(
              redact_if_present("added_audio_uuid")
            | redact_if_present("added_photo_uuid")
            | redact_if_present("added_photo_blurhash")
            | redact_if_present("photo_blurhash")
            | redact_if_present("person_uuid")
            | redact_if_present("url_slug")
            | redact_if_present("photo_uuid")
            | redact_if_present("time")
        )
      '
  )

  expected=$(jq -rS . << EOF
[
  {
    "added_photo_blurhash": "redacted_nonnull_value",
    "added_photo_extra_exts": [],
    "added_photo_uuid": "redacted_nonnull_value",
    "advertiser_friendly": false,
    "age": 26,
    "flair": [
      "gold"
    ],
    "gender": "Other",
    "is_verified": false,
    "location": "New York, New York, United States",
    "match_percentage": 50,
    "name": "user14",
    "url_slug": "redacted_nonnull_value",
    "person_uuid": "redacted_nonnull_value",
    "photo_blurhash": "redacted_nonnull_value",
    "photo_uuid": "redacted_nonnull_value",
    "time": "redacted_nonnull_value",
    "type": "recently-online-with-photo"
  },
  {
    "added_photo_blurhash": "redacted_nonnull_value",
    "added_photo_extra_exts": [],
    "added_photo_uuid": "redacted_nonnull_value",
    "advertiser_friendly": false,
    "age": 26,
    "flair": [
      "gold"
    ],
    "gender": "Other",
    "is_verified": false,
    "location": "New York, New York, United States",
    "match_percentage": 50,
    "name": "user11",
    "url_slug": "redacted_nonnull_value",
    "person_uuid": "redacted_nonnull_value",
    "photo_blurhash": "redacted_nonnull_value",
    "photo_uuid": "redacted_nonnull_value",
    "time": "redacted_nonnull_value",
    "type": "recently-online-with-photo"
  },
  {
    "added_audio_uuid": "redacted_nonnull_value",
    "advertiser_friendly": false,
    "age": 26,
    "flair": [
      "gold",
      "voice-bio"
    ],
    "gender": "Other",
    "is_verified": false,
    "location": "New York, New York, United States",
    "match_percentage": 50,
    "name": "user10",
    "url_slug": "redacted_nonnull_value",
    "person_uuid": "redacted_nonnull_value",
    "photo_blurhash": "redacted_nonnull_value",
    "photo_uuid": "redacted_nonnull_value",
    "time": "redacted_nonnull_value",
    "type": "recently-online-with-voice-bio"
  },
  {
    "added_photo_blurhash": "redacted_nonnull_value",
    "added_photo_extra_exts": [],
    "added_photo_uuid": "redacted_nonnull_value",
    "advertiser_friendly": false,
    "age": 26,
    "flair": [
      "gold"
    ],
    "gender": "Other",
    "is_verified": false,
    "location": "New York, New York, United States",
    "match_percentage": 50,
    "name": "user8",
    "url_slug": "redacted_nonnull_value",
    "person_uuid": "redacted_nonnull_value",
    "photo_blurhash": "redacted_nonnull_value",
    "photo_uuid": "redacted_nonnull_value",
    "time": "redacted_nonnull_value",
    "type": "recently-online-with-photo"
  }
]
EOF
)

  diff -u --color <(echo actual) <(echo expected) || true
  diff -u --color <(echo "$response") <(echo "$expected")
}

joined_club_feed_items () {
  local before

  assume_role searcher

  before=$(q "select iso8601_utc(now()::timestamp)")

  c GET "/feed?before=${before}" \
    | jq -S '
      def redact: if . == null then . else "redacted_nonnull_value" end;

      def redact_if_present($k):
        if has($k) and .[$k] != null
        then .[$k] |= redact
        else .
        end ;

      [ .[] | select(.type == "joined-club") ]
      | map(
            redact_if_present("person_uuid")
          | redact_if_present("url_slug")
          | redact_if_present("photo_uuid")
          | redact_if_present("photo_blurhash")
          | redact_if_present("time")
          | .club_sample_members |= map(map_values(redact))
          | .club_viewer |= map_values(redact)
      )
    '
}

expected_joined_club_item () {
  local name=$1
  local count_members=$2
  local count_sample_members=$3

  jq -nS \
    --arg name "$name" \
    --argjson count_members "$count_members" \
    --argjson count_sample_members "$count_sample_members" \
    '
    {
      "advertiser_friendly": false,
      "age": 26,
      "club_count_members": $count_members,
      "club_sample_members": [
        range($count_sample_members)
        | {
            "person_uuid": "redacted_nonnull_value",
            "photo_blurhash": "redacted_nonnull_value",
            "photo_uuid": "redacted_nonnull_value",
            "url_slug": "redacted_nonnull_value"
          }
      ],
      "club_viewer": {
        "person_uuid": "redacted_nonnull_value",
        "photo_blurhash": null,
        "photo_uuid": null,
        "url_slug": "redacted_nonnull_value"
      },
      "flair": ["gold"],
      "gender": "Other",
      "is_verified": false,
      "joined_club_name": "cats",
      "location": "New York, New York, United States",
      "match_percentage": 50,
      "name": $name,
      "person_uuid": "redacted_nonnull_value",
      "photo_blurhash": "redacted_nonnull_value",
      "photo_uuid": "redacted_nonnull_value",
      "time": "redacted_nonnull_value",
      "type": "joined-club",
      "url_slug": "redacted_nonnull_value"
    }
    '
}

test_joined_club () {
  local response
  local expected
  local event_time_1
  local event_time_2

  q "delete from duo_session"
  q "delete from person"
  q "delete from club"
  q "delete from banned_club where name = 'cats'"
  q "delete from onboardee"
  q "delete from undeleted_photo"

  ../util/create-user.sh searcher 0
  ../util/create-user.sh user1 0 1
  ../util/create-user.sh user2 0 1
  ../util/create-user.sh user3 0 1

  q "update person set privacy_verification_level_id = 1"
  q "update person set background_color = '#aaaaaa'"

  assume_role user2
  jc POST /join-club -d '{ "name": "cats" }'

  assume_role user3
  jc POST /join-club -d '{ "name": "cats" }'

  assume_role user1
  jc POST /join-club -d '{ "name": "cats" }'

  # Re-joining a club mustn't refresh the event
  event_time_1=$(q "select last_event_time from person where name = 'user1'")
  jc POST /join-club -d '{ "name": "cats" }'
  event_time_2=$(q "select last_event_time from person where name = 'user1'")
  [[ "$event_time_1" == "$event_time_2" ]]

  # Members appear in the feed with the other members in their facepiles.
  # (The feed's selectivity keeps round(3 / 2) = 2 of the 3 candidates, in
  # last-event-time order: user1 and user3.)
  response=$(joined_club_feed_items)
  expected=$(
    jq -sS . \
      <(expected_joined_club_item user1 3 2) \
      <(expected_joined_club_item user3 3 2)
  )
  diff -u --color <(echo "$response") <(echo "$expected")

  # Leaving the club reverts the leaver's event and shrinks the facepiles.
  # (user3's event reverts to 'joined'; being recently online with a photo,
  # they map to 'recently-online-with-photo' and outrank user2, so user1 is
  # the only joined-club item that survives selectivity.)
  assume_role user3
  jc POST /leave-club -d '{ "name": "cats" }'

  response=$(joined_club_feed_items)
  expected=$(jq -sS . <(expected_joined_club_item user1 2 1))
  diff -u --color <(echo "$response") <(echo "$expected")

  # Banning the club hides the events
  q "insert into banned_club (name) values ('cats')"

  response=$(joined_club_feed_items)
  diff -u --color <(echo "$response") <(echo "[]")

  q "delete from banned_club where name = 'cats'"
}

test_json_format
test_joined_club
