#!/usr/bin/env bash
#
# Tests for the `/feed-v2` endpoint (Q_FEED_V2). Unlike v1, the v2 feed:
#
#   * Orders people by when their online session started (came_online_time),
#     not by event time or by when they were last online, so staying online
#     24/7 can't keep someone at the top of the feed
#   * Shows events' own times, unless the event is more than a week old, in
#     which case a 'recently-online-with-*' event is shown at the person's
#     last-online time instead
#   * Only shows people of the viewer's preferred gender and age range, who
#     also prefer the viewer's gender. The age filter is one-way: people
#     appear in the viewer's feed regardless of their own age preference
#     (`age_gap_acceptability_odds` no longer applies)
#   * Includes a `came_online_time` field, which clients use as the `before`
#     cursor for the next page, and an `online_time` field showing when the
#     person was last online
#   * Excludes people whose came_online_time or last_online_time is within
#     the past minute

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

reset_db () {
  q "delete from duo_session"
  q "delete from person"
  q "delete from club"
  q "delete from banned_club where name = 'cats'"
  q "delete from onboardee"
  q "delete from undeleted_photo"
}

redact_feed () {
  jq -S '
    def redact: if . == null then . else "redacted_nonnull_value" end;

    # helper: redact .[$k] only if it exists and is not null
    def redact_if_present($k):
      if has($k) and .[$k] != null       # key exists (and we ignore nulls)
      then .[$k] |= redact
      else .
      end ;

    map(
          . + { "time_equals_online_time": (.time == .online_time) }
        | redact_if_present("added_audio_uuid")
        | redact_if_present("added_photo_uuid")
        | redact_if_present("added_photo_blurhash")
        | redact_if_present("photo_blurhash")
        | redact_if_present("person_uuid")
        | redact_if_present("url_slug")
        | redact_if_present("photo_uuid")
        | redact_if_present("time")
        | redact_if_present("online_time")
        | redact_if_present("came_online_time")
    )
  '
}

test_json_format () {
  local searcher_uuid
  local before
  local raw_response
  local response
  local expected

  reset_db

  ../util/create-user.sh searcher 0
  ../util/create-user.sh user1 0 1
  ../util/create-user.sh user2 0 1 true
  ../util/create-user.sh user3 0 1
  ../util/create-user.sh user4 0 1
  ../util/create-user.sh user5 0 1
  ../util/create-user.sh user6 0 1
  ../util/create-user.sh user7 0 0
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

  q "update person set privacy_verification_level_id = 1"
  q "update person set background_color = '#aaaaaa'"

  # user1 adds a photo
  assume_role user1
  jc PATCH /profile-info \
    -d "{
            \"base64_file\": {
                \"position\": 1,
                \"base64\": \"$(rand_image)\",
                \"top\": 0,
                \"left\": 0
            }
        }"

  # user2 added a voice bio during onboarding

  # user3 updates their bio
  assume_role user3
  jc PATCH /profile-info -d '{ "about": "You just lost the game" }'

  # user4 updates their bio too; their event is made stale later
  assume_role user4
  jc PATCH /profile-info -d '{ "about": "Bio for the feed" }'

  # user8 skips the searcher
  assume_role user8
  c POST "/skip/by-uuid/${searcher_uuid}"

  # user9 hides from strangers
  assume_role user9
  jc PATCH /profile-info -d '{ "hide_me_from_strangers": "Yes" }'

  # user14 deactivates their account
  assume_role user14
  c POST '/deactivate'

  assume_role searcher

  # user4's, user6's and user7's events happened more than a week ago.
  # user4's ('updated-bio') maps to 'recently-online-with-bio'; user6's
  # ('added-photo') maps to 'recently-online-with-photo'; user7's ('joined')
  # has no content of its own and they have no photos to synthesize an event
  # from, so they're excluded.
  q "update person set last_event_time = now() - interval '8 days'
     where name in ('user4', 'user6', 'user7')"

  # user10 doesn't prefer the searcher's gender
  q "delete from search_preference_gender
     where person_id = (select id from person where name = 'user10')
     and gender_id = (select id from gender where name = 'Other')"

  # user11 has a gender the searcher doesn't prefer
  q "update person
     set gender_id = (select id from gender where name = 'Man')
     where name = 'user11'"
  q "delete from search_preference_gender
     where person_id = (select id from person where name = 'searcher')
     and gender_id = (select id from gender where name = 'Man')"

  # user12's age is outside the searcher's age preference (which defaults to
  # 22-30 for the 26-year-olds which create-user.sh creates)
  q "update person
     set date_of_birth = (now() - interval '50 years')::date
     where name = 'user12'"

  # user13 has an age preference the searcher doesn't meet, but the age
  # filter is one-way, so user13 still appears in the searcher's feed
  q "update search_preference_age set min_age = 30, max_age = 40
     where person_id = (select id from person where name = 'user13')"

  # The feed is ordered by came_online_time, so make the ordering
  # deterministic: user1's online session started most recently. Setting
  # last_online_time in the reverse order proves the feed orders by
  # came_online_time, not by when people were last online.
  for i in $(seq 1 14)
  do
    q "update person
       set came_online_time = now() - interval '${i} minutes',
           last_online_time = now() - interval '$(( 100 - i )) minutes'
       where name = 'user${i}'"
  done

  # user15's online session started within the past minute and user16 was
  # online within the past minute, so both are excluded (from every page)
  # despite being eligible in every other way
  q "update person
     set came_online_time = now() - interval '1 second',
         last_online_time = now() - interval '99 minutes'
     where name = 'user15'"
  q "update person
     set came_online_time = now() - interval '15 minutes',
         last_online_time = now() - interval '1 second'
     where name = 'user16'"

  before=$(q "select iso8601_utc(now()::timestamp)")

  raw_response=$(c GET "/feed-v2?before=${before}")

  response=$(echo "$raw_response" | redact_feed)

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
    "name": "user1",
    "came_online_time": "redacted_nonnull_value",
    "online_time": "redacted_nonnull_value",
    "person_uuid": "redacted_nonnull_value",
    "photo_blurhash": "redacted_nonnull_value",
    "photo_uuid": "redacted_nonnull_value",
    "time": "redacted_nonnull_value",
    "time_equals_online_time": false,
    "type": "added-photo",
    "url_slug": "redacted_nonnull_value"
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
    "name": "user2",
    "came_online_time": "redacted_nonnull_value",
    "online_time": "redacted_nonnull_value",
    "person_uuid": "redacted_nonnull_value",
    "photo_blurhash": "redacted_nonnull_value",
    "photo_uuid": "redacted_nonnull_value",
    "time": "redacted_nonnull_value",
    "time_equals_online_time": false,
    "type": "added-voice-bio",
    "url_slug": "redacted_nonnull_value"
  },
  {
    "added_text": "You just lost the game",
    "advertiser_friendly": false,
    "age": 26,
    "background_color": "#aaaaaa",
    "body_color": "#000000",
    "flair": [
      "gold"
    ],
    "gender": "Other",
    "is_verified": false,
    "location": "New York, New York, United States",
    "match_percentage": 50,
    "name": "user3",
    "came_online_time": "redacted_nonnull_value",
    "online_time": "redacted_nonnull_value",
    "person_uuid": "redacted_nonnull_value",
    "photo_blurhash": "redacted_nonnull_value",
    "photo_uuid": "redacted_nonnull_value",
    "time": "redacted_nonnull_value",
    "time_equals_online_time": false,
    "type": "updated-bio",
    "url_slug": "redacted_nonnull_value"
  },
  {
    "added_text": "Bio for the feed",
    "advertiser_friendly": false,
    "age": 26,
    "background_color": "#aaaaaa",
    "body_color": "#000000",
    "flair": [
      "gold"
    ],
    "gender": "Other",
    "is_verified": false,
    "location": "New York, New York, United States",
    "match_percentage": 50,
    "name": "user4",
    "came_online_time": "redacted_nonnull_value",
    "online_time": "redacted_nonnull_value",
    "person_uuid": "redacted_nonnull_value",
    "photo_blurhash": "redacted_nonnull_value",
    "photo_uuid": "redacted_nonnull_value",
    "time": "redacted_nonnull_value",
    "time_equals_online_time": true,
    "type": "recently-online-with-bio",
    "url_slug": "redacted_nonnull_value"
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
    "name": "user5",
    "came_online_time": "redacted_nonnull_value",
    "online_time": "redacted_nonnull_value",
    "person_uuid": "redacted_nonnull_value",
    "photo_blurhash": "redacted_nonnull_value",
    "photo_uuid": "redacted_nonnull_value",
    "time": "redacted_nonnull_value",
    "time_equals_online_time": false,
    "type": "added-photo",
    "url_slug": "redacted_nonnull_value"
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
    "name": "user6",
    "came_online_time": "redacted_nonnull_value",
    "online_time": "redacted_nonnull_value",
    "person_uuid": "redacted_nonnull_value",
    "photo_blurhash": "redacted_nonnull_value",
    "photo_uuid": "redacted_nonnull_value",
    "time": "redacted_nonnull_value",
    "time_equals_online_time": true,
    "type": "recently-online-with-photo",
    "url_slug": "redacted_nonnull_value"
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
    "name": "user13",
    "came_online_time": "redacted_nonnull_value",
    "online_time": "redacted_nonnull_value",
    "person_uuid": "redacted_nonnull_value",
    "photo_blurhash": "redacted_nonnull_value",
    "photo_uuid": "redacted_nonnull_value",
    "time": "redacted_nonnull_value",
    "time_equals_online_time": false,
    "type": "added-photo",
    "url_slug": "redacted_nonnull_value"
  }
]
EOF
)

  diff -u --color <(echo actual) <(echo expected) || true
  diff -u --color <(echo "$response") <(echo "$expected")

  # Paginating with the third item's came_online_time as the cursor returns
  # the items whose online sessions started strictly earlier
  local before2
  local page2_names

  before2=$(echo "$raw_response" | jq -r '.[2].came_online_time')

  page2_names=$(
    c GET "/feed-v2?before=$(jq -rn --arg t "$before2" '$t | @uri')" \
      | jq -cS '[ .[].name ]'
  )

  [[ "$page2_names" == '["user4","user5","user6","user13"]' ]]
}

joined_club_feed_items () {
  local before

  assume_role searcher

  before=$(q "select iso8601_utc(now()::timestamp)")

  c GET "/feed-v2?before=${before}" \
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
          | redact_if_present("online_time")
          | redact_if_present("came_online_time")
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
      "came_online_time": "redacted_nonnull_value",
      "online_time": "redacted_nonnull_value",
      "person_uuid": "redacted_nonnull_value",
      "photo_blurhash": "redacted_nonnull_value",
      "photo_uuid": "redacted_nonnull_value",
      "time": "redacted_nonnull_value",
      "type": "joined-club",
      "url_slug": "redacted_nonnull_value"
    }
    '
}

set_deterministic_online_times () {
  for i in $(seq 1 3)
  do
    q "update person
       set came_online_time = now() - interval '${i} minutes',
           last_online_time = now() - interval '${i} minutes'
       where name = 'user${i}'"
  done
}

test_joined_club () {
  local response
  local expected
  local event_time_1
  local event_time_2
  local user1_type

  reset_db

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

  set_deterministic_online_times

  # Unlike v1, the v2 feed has no selectivity, so all three members appear,
  # in last-online order. Each facepile now leads with the event's own
  # subject, so all three members (including the subject) show in it
  response=$(joined_club_feed_items)
  expected=$(
    jq -sS . \
      <(expected_joined_club_item user1 3 3) \
      <(expected_joined_club_item user2 3 3) \
      <(expected_joined_club_item user3 3 3)
  )
  diff -u --color <(echo "$response") <(echo "$expected")

  # user3 skips the searcher. The searcher can no longer access user3's
  # profile, so user3's own joined-club item disappears and user3 is dropped
  # from the other members' facepiles. The club's member count is unaffected.
  assume_role user3
  c POST "/skip/by-uuid/$(q "select uuid from person where name = 'searcher'")"

  set_deterministic_online_times

  response=$(joined_club_feed_items)
  expected=$(
    jq -sS . \
      <(expected_joined_club_item user1 3 2) \
      <(expected_joined_club_item user2 3 2)
  )
  diff -u --color <(echo "$response") <(echo "$expected")

  # Undoing the skip restores user3's item and facepile entries
  q "delete from skipped"

  set_deterministic_online_times

  response=$(joined_club_feed_items)
  expected=$(
    jq -sS . \
      <(expected_joined_club_item user1 3 3) \
      <(expected_joined_club_item user2 3 3) \
      <(expected_joined_club_item user3 3 3)
  )
  diff -u --color <(echo "$response") <(echo "$expected")

  # Leaving the club reverts the leaver's event and shrinks the facepiles
  assume_role user3
  jc POST /leave-club -d '{ "name": "cats" }'

  set_deterministic_online_times

  response=$(joined_club_feed_items)
  expected=$(
    jq -sS . \
      <(expected_joined_club_item user1 2 2) \
      <(expected_joined_club_item user2 2 2)
  )
  diff -u --color <(echo "$response") <(echo "$expected")

  # Once user1's event is more than a week old, it's replaced by a
  # 'recently-online-with-photo' event, so only user2's joined-club item
  # remains
  q "update person set last_event_time = now() - interval '8 days'
     where name = 'user1'"

  response=$(joined_club_feed_items)
  expected=$(jq -sS . <(expected_joined_club_item user2 2 2))
  diff -u --color <(echo "$response") <(echo "$expected")

  assume_role searcher
  user1_type=$(
    c GET "/feed-v2?before=$(q "select iso8601_utc(now()::timestamp)")" \
      | jq -r '.[] | select(.name == "user1").type'
  )
  [[ "$user1_type" == recently-online-with-photo ]]

  # Banning the club hides the events
  q "insert into banned_club (name) values ('cats')"

  response=$(joined_club_feed_items)
  diff -u --color <(echo "$response") <(echo "[]")

  q "delete from banned_club where name = 'cats'"
}

# A question's yes/no counts land via a one-second batcher in the API, not in
# the POST /answer transaction, so give it a moment to flush before asserting
# on the feed's counts. (The answered-question event itself is now written in
# the POST /answer transaction, so it needs no wait.)
flush_answer_batchers () {
  sleep 2
}

answered_question_feed_items () {
  local before

  assume_role searcher

  before=$(q "select iso8601_utc(now()::timestamp)")

  c GET "/feed-v2?before=${before}" \
    | jq -S '
      def redact: if . == null then . else "redacted_nonnull_value" end;

      def redact_if_present($k):
        if has($k) and .[$k] != null
        then .[$k] |= redact
        else .
        end ;

      [ .[] | select(.type == "answered-question") ]
      | map(
            redact_if_present("person_uuid")
          | redact_if_present("url_slug")
          | redact_if_present("photo_uuid")
          | redact_if_present("photo_blurhash")
          | redact_if_present("time")
          | redact_if_present("online_time")
          | redact_if_present("came_online_time")
          | .question_yes_members |= map(map_values(redact))
          | .question_no_members |= map(map_values(redact))
          | .question_viewer |= (
                .person_uuid |= redact
              | .url_slug |= redact
            )
      )
    '
}

expected_answered_question_item () {
  local name=$1
  local subject_answer=$2
  local count_yes_members=$3
  local count_no_members=$4
  local count_yes=$5
  local count_no=$6
  local viewer_answer=$7
  local viewer_public=$8
  local match_percentage=$9

  jq -nS \
    --arg name "$name" \
    --argjson subject_answer "$subject_answer" \
    --argjson question_id "$question_id" \
    --arg question_text "$question_text" \
    --arg question_topic "$question_topic" \
    --argjson count_yes_members "$count_yes_members" \
    --argjson count_no_members "$count_no_members" \
    --argjson count_yes "$count_yes" \
    --argjson count_no "$count_no" \
    --argjson viewer_answer "$viewer_answer" \
    --argjson viewer_public "$viewer_public" \
    --argjson match_percentage "$match_percentage" \
    '
    def members($n):
      [ range($n)
        | {
            "person_uuid": "redacted_nonnull_value",
            "photo_blurhash": "redacted_nonnull_value",
            "photo_uuid": "redacted_nonnull_value",
            "url_slug": "redacted_nonnull_value"
          }
      ];

    {
      "advertiser_friendly": false,
      "age": 26,
      "answered_question_id": $question_id,
      "question_text": $question_text,
      "question_topic": $question_topic,
      "question_count_yes": $count_yes,
      "question_count_no": $count_no,
      "question_yes_members": members($count_yes_members),
      "question_no_members": members($count_no_members),
      "question_subject_answer": $subject_answer,
      "question_viewer": {
        "person_uuid": "redacted_nonnull_value",
        "url_slug": "redacted_nonnull_value",
        "photo_uuid": null,
        "photo_blurhash": null,
        "answer": $viewer_answer,
        "public_": $viewer_public
      },
      "flair": ["gold"],
      "gender": "Other",
      "is_verified": false,
      "location": "New York, New York, United States",
      "match_percentage": $match_percentage,
      "name": $name,
      "came_online_time": "redacted_nonnull_value",
      "online_time": "redacted_nonnull_value",
      "person_uuid": "redacted_nonnull_value",
      "photo_blurhash": "redacted_nonnull_value",
      "photo_uuid": "redacted_nonnull_value",
      "time": "redacted_nonnull_value",
      "type": "answered-question",
      "url_slug": "redacted_nonnull_value"
    }
    '
}

test_answered_question () {
  local response
  local expected
  local user_type
  local match_user1
  local match_user2
  local match_user3

  reset_db

  ../util/create-user.sh searcher 0
  ../util/create-user.sh user1 0 1
  ../util/create-user.sh user2 0 1
  ../util/create-user.sh user3 0 1

  q "update person set privacy_verification_level_id = 1"
  q "update person set background_color = '#aaaaaa'"

  question_id=10
  question_text=$(q "select question from question where id = ${question_id}")
  question_topic=$(q "select topic from question where id = ${question_id}")

  # The yes/no counts include private answers and survive `reset_db`, so zero
  # them for determinism. They're only ever incremented, even on re-answers,
  # so the expectations below track every POST, public or private.
  q "update question set count_yes = 0, count_no = 0
     where id = ${question_id}"

  # user2 and user3 answer publicly
  assume_role user2
  jc POST /answer \
    -d "{ \"question_id\": ${question_id}, \"answer\": true, \"public\": true }"

  assume_role user3
  jc POST /answer \
    -d "{ \"question_id\": ${question_id}, \"answer\": false, \"public\": true }"

  # user1 answers privately, which mustn't be advertised in the feed
  assume_role user1
  jc POST /answer \
    -d "{ \"question_id\": ${question_id}, \"answer\": true, \"public\": false }"

  flush_answer_batchers

  user_type=$(q "select last_event_name from person where name = 'user1'")
  [[ "$user_type" != answered-question ]]

  set_deterministic_online_times

  # user1's private answer doesn't appear as an event or in the piles. The
  # searcher hasn't answered, so `question_viewer.answer` is null.
  # question_count_yes is 2: user1's private answer counts, like on the quiz
  # screen, despite being hidden from the piles. Each pile now includes the
  # event's own subject, so user2 (public yes) shows in their yes pile and
  # user3 (public no) shows in their no pile
  response=$(answered_question_feed_items)
  expected=$(
    jq -sS . \
      <(expected_answered_question_item user2 true 1 1 2 1 null null 50) \
      <(expected_answered_question_item user3 false 1 1 2 1 null null 50)
  )
  diff -u --color <(echo "$response") <(echo "$expected")

  # user1 re-answers publicly; their event appears and they join the piles
  assume_role user1
  jc POST /answer \
    -d "{ \"question_id\": ${question_id}, \"answer\": true, \"public\": true }"

  flush_answer_batchers

  set_deterministic_online_times

  # Re-answering increments question_count_yes again; the counts only ever
  # grow. Every event shows the same public answerers (user1, user2 in "yes";
  # user3 in "no"), each led by its own subject
  response=$(answered_question_feed_items)
  expected=$(
    jq -sS . \
      <(expected_answered_question_item user1 true 2 1 3 1 null null 50) \
      <(expected_answered_question_item user2 true 2 1 3 1 null null 50) \
      <(expected_answered_question_item user3 false 2 1 3 1 null null 50)
  )
  diff -u --color <(echo "$response") <(echo "$expected")

  # The subject leads their own pile so the frontend can seat their face
  # closest to the card's centre: user1 (public yes) is first in their own
  # "yes" pile, and user3 (public no) is first in their own "no" pile
  assume_role searcher
  before=$(q "select iso8601_utc(now()::timestamp)")
  feed=$(c GET "/feed-v2?before=${before}")

  user1_uuid=$(q "select uuid from person where name = 'user1'")
  user1_first_yes=$(echo "$feed" | jq -r \
    --arg u "$user1_uuid" \
    '.[] | select(.type == "answered-question" and .person_uuid == $u)
     | .question_yes_members[0].person_uuid')
  [[ "$user1_first_yes" == "$user1_uuid" ]]

  user3_uuid=$(q "select uuid from person where name = 'user3'")
  user3_first_no=$(echo "$feed" | jq -r \
    --arg u "$user3_uuid" \
    '.[] | select(.type == "answered-question" and .person_uuid == $u)
     | .question_no_members[0].person_uuid')
  [[ "$user3_first_no" == "$user3_uuid" ]]

  # A subject who hides from strangers still leads their own pile. Their feed
  # item is already on screen (they messaged the searcher, so they're not a
  # stranger), so re-applying the pile's visibility checks mustn't drop them.
  q "update person set hide_me_from_strangers = true where name = 'user1'"
  q "insert into messaged (subject_person_id, object_person_id) values (
       (select id from person where name = 'user1'),
       (select id from person where name = 'searcher'))"

  feed=$(c GET "/feed-v2?before=${before}")
  user1_first_yes=$(echo "$feed" | jq -r \
    --arg u "$user1_uuid" \
    '.[] | select(.type == "answered-question" and .person_uuid == $u)
     | .question_yes_members[0].person_uuid')
  [[ "$user1_first_yes" == "$user1_uuid" ]]

  # Restore the pre-scenario state so the assertions below are unaffected
  q "update person set hide_me_from_strangers = false where name = 'user1'"
  q "delete from messaged"

  # The searcher answers publicly. Their answer appears in question_viewer,
  # but they never appear among the sample members. Answering shifts the
  # searcher's personality, and with it the match percentages.
  assume_role searcher
  jc POST /answer \
    -d "{ \"question_id\": ${question_id}, \"answer\": false, \"public\": true }"

  flush_answer_batchers

  match_user1=$(q "
    select clamp(
      0, 99,
      100 * (1 - (a.personality <#> b.personality)) / 2
    )::smallint
    from person a, person b
    where a.name = 'searcher' and b.name = 'user1'")
  match_user2=$(q "
    select clamp(
      0, 99,
      100 * (1 - (a.personality <#> b.personality)) / 2
    )::smallint
    from person a, person b
    where a.name = 'searcher' and b.name = 'user2'")
  match_user3=$(q "
    select clamp(
      0, 99,
      100 * (1 - (a.personality <#> b.personality)) / 2
    )::smallint
    from person a, person b
    where a.name = 'searcher' and b.name = 'user3'")

  set_deterministic_online_times

  response=$(answered_question_feed_items)
  expected=$(
    jq -sS . \
      <(expected_answered_question_item user1 true 2 1 3 2 false true "$match_user1") \
      <(expected_answered_question_item user2 true 2 1 3 2 false true "$match_user2") \
      <(expected_answered_question_item user3 false 2 1 3 2 false true "$match_user3")
  )
  diff -u --color <(echo "$response") <(echo "$expected")

  # The searcher makes their answer private. It's their own answer, so it's
  # still sent to them -- flagged private -- or answering from the feed could
  # mistake it for unanswered and silently re-publish it
  jc POST /answer \
    -d "{ \"question_id\": ${question_id}, \"answer\": false, \"public\": false }"

  flush_answer_batchers

  set_deterministic_online_times

  response=$(answered_question_feed_items)
  expected=$(
    jq -sS . \
      <(expected_answered_question_item user1 true 2 1 3 3 false false "$match_user1") \
      <(expected_answered_question_item user2 true 2 1 3 3 false false "$match_user2") \
      <(expected_answered_question_item user3 false 2 1 3 3 false false "$match_user3")
  )
  diff -u --color <(echo "$response") <(echo "$expected")

  # Making an answer private reverts the answerer's event and removes them
  # from the piles
  assume_role user3
  jc POST /answer \
    -d "{ \"question_id\": ${question_id}, \"answer\": false, \"public\": false }"

  flush_answer_batchers

  user_type=$(q "select last_event_name from person where name = 'user3'")
  [[ "$user_type" == joined ]]

  set_deterministic_online_times

  response=$(answered_question_feed_items)
  expected=$(
    jq -sS . \
      <(expected_answered_question_item user1 true 2 0 3 4 false false "$match_user1") \
      <(expected_answered_question_item user2 true 2 0 3 4 false false "$match_user2")
  )
  diff -u --color <(echo "$response") <(echo "$expected")

  # Deleting an answer reverts the deleter's event and removes them from the
  # piles
  assume_role user2
  jc DELETE /answer -d "{ \"question_id\": ${question_id} }"

  flush_answer_batchers

  user_type=$(q "select last_event_name from person where name = 'user2'")
  [[ "$user_type" == joined ]]

  set_deterministic_online_times

  response=$(answered_question_feed_items)
  expected=$(
    jq -sS . \
      <(expected_answered_question_item user1 true 1 0 3 4 false false "$match_user1")
  )
  diff -u --color <(echo "$response") <(echo "$expected")

  # Skipping the question (a null answer) reverts the event too
  assume_role user1
  jc POST /answer \
    -d "{ \"question_id\": ${question_id}, \"answer\": null, \"public\": true }"

  flush_answer_batchers

  user_type=$(q "select last_event_name from person where name = 'user1'")
  [[ "$user_type" == joined ]]

  set_deterministic_online_times

  response=$(answered_question_feed_items)
  diff -u --color <(echo "$response") <(echo "[]")
}

test_json_format
test_joined_club
test_answered_question
