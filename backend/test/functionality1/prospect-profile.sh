#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from person"
q "delete from club"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0
../util/create-user.sh user3 0 0
../util/create-user.sh user4 0 0
../util/create-user.sh user5 0 0
../util/create-user.sh user6 0 0

user1_id=$(q "select id from person where name = 'user1'")
user2_id=$(q "select id from person where name = 'user2'")
user3_id=$(q "select id from person where name = 'user3'")
user4_id=$(q "select id from person where name = 'user4'")
user5_id=$(q "select id from person where name = 'user5'")
user6_id=$(q "select id from person where name = 'user6'")

user2_uuid=$(q "select uuid from person where name = 'user2'")

q "update person set privacy_verification_level_id = 1"

assume_role user1

response=$(
  c GET /prospect-profile/$user2_uuid \
    | jq '.seconds_since_last_online = null | .seconds_since_sign_up = null')

expected=$(jq -r . << EOF
{
  "about": "",
  "advertiser_friendly": false,
  "age": 26,
  "age_preference": {
    "max_age": 30,
    "min_age": 22
  },
  "audio_bio_uuid": null,
  "count_answers": 0,
  "drinking": null,
  "drugs": null,
  "education": null,
  "ethnicity": null,
  "exercise": null,
  "flair": [
    "gold"
  ],
  "gender": "Other",
  "gender_preference": [
    "Man",
    "Woman",
    "Agender",
    "Femboy",
    "Intersex",
    "Non-binary",
    "Transgender",
    "Trans woman",
    "Trans man",
    "Other"
  ],
  "gets_reply_percentage": null,
  "gives_reply_percentage": null,
  "has_kids": null,
  "height_cm": null,
  "is_skipped": false,
  "location": "New York, New York, United States",
  "long_distance": null,
  "looking_for": null,
  "match_percentage": 50,
  "mutual_clubs": [],
  "name": "user2",
  "occupation": null,
  "orientation": null,
  "other_clubs": [],
  "person_id": $user2_id,
  "person_uuid": "$user2_uuid",
  "photo_blurhashes": [],
  "photo_extra_exts": [],
  "photo_geometries": [],
  "photo_uuids": [],
  "photo_verifications": [],
  "relationship_status": null,
  "religion": null,
  "seconds_since_last_online": null,
  "seconds_since_sign_up": null,
  "show_my_looking_for": "Yes",
  "smoking": null,
  "star_sign": null,
  "theme": {
    "background_color": "#ffffff",
    "body_color": "#000000",
    "title_color": "#000000"
  },
  "url_slug": "user2",
  "verified_age": false,
  "verified_ethnicity": false,
  "verified_gender": false,
  "wants_kids": null
}
EOF
)

diff <(echo "$response") <(echo "$expected")


assume_role user1
jc POST /join-club -d '{ "name": "my-club-shared-1" }'
jc POST /join-club -d '{ "name": "my-club-shared-2" }'
jc POST /join-club -d '{ "name": "my-club-unshared-10" }'
jc POST /join-club -d '{ "name": "my-club-unshared-20" }'

assume_role user2
jc POST /join-club -d '{ "name": "my-club-shared-1" }'
jc POST /join-club -d '{ "name": "my-club-shared-2" }'
jc POST /join-club -d '{ "name": "my-club-unshared-11" }'
jc POST /join-club -d '{ "name": "my-club-unshared-21" }'

assume_role user1

response=$(
  c GET /prospect-profile/$user2_uuid \
    | jq '.seconds_since_last_online = null | .seconds_since_sign_up = null')

expected=$(jq -r . << EOF
{
  "about": "",
  "advertiser_friendly": false,
  "age": 26,
  "age_preference": {
    "max_age": 30,
    "min_age": 22
  },
  "audio_bio_uuid": null,
  "count_answers": 0,
  "drinking": null,
  "drugs": null,
  "education": null,
  "ethnicity": null,
  "exercise": null,
  "flair": [
    "gold"
  ],
  "gender": "Other",
  "gender_preference": [
    "Man",
    "Woman",
    "Agender",
    "Femboy",
    "Intersex",
    "Non-binary",
    "Transgender",
    "Trans woman",
    "Trans man",
    "Other"
  ],
  "gets_reply_percentage": null,
  "gives_reply_percentage": null,
  "has_kids": null,
  "height_cm": null,
  "is_skipped": false,
  "location": "New York, New York, United States",
  "long_distance": null,
  "looking_for": null,
  "match_percentage": 50,
  "mutual_clubs": ["my-club-shared-1", "my-club-shared-2"],
  "name": "user2",
  "occupation": null,
  "orientation": null,
  "other_clubs": ["my-club-unshared-11", "my-club-unshared-21"],
  "person_id": $user2_id,
  "person_uuid": "$user2_uuid",
  "photo_blurhashes": [],
  "photo_extra_exts": [],
  "photo_geometries": [],
  "photo_uuids": [],
  "photo_verifications": [],
  "relationship_status": null,
  "religion": null,
  "seconds_since_last_online": null,
  "seconds_since_sign_up": null,
  "show_my_looking_for": "Yes",
  "smoking": null,
  "star_sign": null,
  "theme": {
    "background_color": "#ffffff",
    "body_color": "#000000",
    "title_color": "#000000"
  },
  "url_slug": "user2",
  "verified_age": false,
  "verified_ethnicity": false,
  "verified_gender": false,
  "wants_kids": null
}
EOF
)

diff <(echo "$response") <(echo "$expected")



q "update person set sign_up_time = now() - interval '4 days'"

q "delete from messaged"
q "
insert into messaged (subject_person_id, object_person_id, created_at)
values
  -- User 2 messaged 5 people and got one reply
  ($user2_id, $user1_id, now() - interval '3 days'),
  ($user2_id, $user3_id, now() - interval '3 days'),
  ($user2_id, $user4_id, now() - interval '3 days'),
  ($user2_id, $user5_id, now() - interval '3 days'),
  ($user2_id, $user6_id, now() - interval '3 days'),

  ($user1_id, $user2_id, now() - interval '2 days')
"

gets_reply_percentage=$(
  c GET /prospect-profile/$user2_uuid \
    | jq '.gets_reply_percentage')

gives_reply_percentage=$(
  c GET /prospect-profile/$user2_uuid \
    | jq '.gives_reply_percentage')

[[ "$gets_reply_percentage" = '20.0' ]]

[[ "$gives_reply_percentage" = 'null' ]]



# When user2 hides their "Looking For" section, the dating-preference fields are
# withheld from the profile and the `show_my_looking_for` flag flips to "No".
q "update person set show_my_looking_for = false where name = 'user2'"

hidden_looking_for=$(
  c GET /prospect-profile/$user2_uuid \
    | jq -c '{
        show_my_looking_for,
        gender_preference,
        age_preference,
        looking_for,
        long_distance
      }')

[[ "$hidden_looking_for" = '{"show_my_looking_for":"No","gender_preference":[],"age_preference":null,"looking_for":null,"long_distance":null}' ]]



q "delete from messaged"
q "
insert into messaged (subject_person_id, object_person_id, created_at)
values
  -- User 2 get 5 messages and replied to one
  ($user1_id, $user2_id, now() - interval '3 days'),
  ($user3_id, $user2_id, now() - interval '3 days'),
  ($user4_id, $user2_id, now() - interval '3 days'),
  ($user5_id, $user2_id, now() - interval '3 days'),
  ($user6_id, $user2_id, now() - interval '3 days'),

  ($user2_id, $user1_id, now() - interval '2 days')
"

gets_reply_percentage=$(
  c GET /prospect-profile/$user2_uuid \
    | jq '.gets_reply_percentage')

gives_reply_percentage=$(
  c GET /prospect-profile/$user2_uuid \
    | jq '.gives_reply_percentage')

[[ "$gets_reply_percentage" = 'null' ]]

[[ "$gives_reply_percentage" = '20.0' ]]

# The expand animation can't run without the photo's geometry, and the field
# going missing from the response is invisible to the client: it just quietly
# stops animating. `rand_image` uploads a 100x100 square, so the crop is the
# whole photo.
../util/create-user.sh user7 0 1

user7_uuid=$(q "select uuid from person where name = 'user7'")

assume_role user1

photo_geometries=$(
  c GET /prospect-profile/$user7_uuid \
    | jq -c '.photo_geometries | map({width, height, crop_top, crop_left})')

[[ "$photo_geometries" = '[{"width":100,"height":100,"crop_top":0,"crop_left":0}]' ]]
