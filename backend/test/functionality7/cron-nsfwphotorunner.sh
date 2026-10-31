#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

nsfw_img=$(base64 -w 0 ../fixtures/nsfw.jpg)
sfw_img=$( base64 -w 0 ../fixtures/sfw.jpg)

set -ex

q "delete from photo"
q "delete from undeleted_photo"
q "delete from person"

../util/create-user.sh user1 0 0
assume_role user1

jc PATCH /profile-info \
  -d "{
          \"base64_file\": {
              \"position\": 1,
              \"base64\": \"${nsfw_img}\",
              \"top\": 0,
              \"left\": 0
          }
      }"

jc PATCH /profile-info \
  -d "{
          \"base64_file\": {
              \"position\": 2,
              \"base64\": \"${sfw_img}\",
              \"top\": 0,
              \"left\": 0
          }
      }"

q "
  insert into photo (person_id, position, uuid, blurhash, hash)
  values ($PERSON_ID, 3, 'not-in-object-store', '', random()::text)"

curl -sf -X PUT --data-binary 'not an image' \
  http://localhost:9090/s3-mock-bucket/450-unreadable.jpg

q "
  insert into photo (person_id, position, uuid, blurhash, hash)
  values ($PERSON_ID, 4, 'unreadable', '', random()::text)"


# Maximum number of retries
max_retries=60

# Retry a check every second until it passes, up to max_retries times
retry_until() {
  local count=0

  while ! "$@"; do
    ((count++)) || true
    echo "Attempt $count: Conditions not met. Retrying..."

    if [[ $count -eq $max_retries ]]; then
      echo "Maximum retries reached. Exiting."
      exit 1
    fi

    sleep 1
  done

  echo "Conditions met within $count retries."
}

# Function to perform the query and check conditions
check_conditions() {
  q "select person_id, position, uuid, nsfw_score_v2 from photo"

  local condition1="$(q "select count(*) from photo where position = 1 and abs(nsfw_score_v2 - 0.730) < 0.01")"
  local condition2="$(q "select count(*) from photo where position = 2 and abs(nsfw_score_v2 - 0.016) < 0.01")"
  local condition3="$(q "select count(*) from photo where position = 3 and abs(nsfw_score_v2 + 1.000) < 0.01")"
  local condition4="$(q "select count(*) from photo where position = 4 and abs(nsfw_score_v2 + 1.000) < 0.01")"

  [[ "$condition1" = 1 && "$condition2" = 1 && "$condition3" = 1 &&
     "$condition4" = 1 ]]
}

check_rescored() {
  [[ "$(q "select count(*) from photo where position = 2 and abs(nsfw_score_v2 - 0.730) < 0.01")" = 1 ]]
}

retry_until check_conditions

echo 'A photo which replaces another in the same position is rescanned'
jc PATCH /profile-info \
  -d "{
          \"base64_file\": {
              \"position\": 2,
              \"base64\": \"${nsfw_img}\",
              \"top\": 0,
              \"left\": 0
          }
      }"

retry_until check_rescored

echo 'Photos scored above 0.95 are deleted'
deleted_uuid=$(q "select uuid from photo where position = 1")
q "update photo set nsfw_score_v2 = 0.96 where position = 1"
q "update photo set nsfw_score_v2 = 0.95 where position = 2"

wait_for_deletion_by_uuid "$deleted_uuid"

[[ "$(q "select count(*) from photo where position = 1")" = 0 ]]
[[ "$(q "select count(*) from photo where position = 2")" = 1 ]]
