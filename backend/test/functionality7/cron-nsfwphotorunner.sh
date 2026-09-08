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


# Maximum number of retries
max_retries=10
count=0

# Function to perform the query and check conditions
check_conditions() {
  q "select person_id, position, uuid, nsfw_score from photo"

  local condition1="$(q "select count(*) from photo where position = 1 and abs(nsfw_score - 0.236) < 0.01")"
  local condition2="$(q "select count(*) from photo where position = 2 and abs(nsfw_score - 0.061) < 0.01")"
  local condition3="$(q "select count(*) from photo where position = 3 and abs(nsfw_score + 1.000) < 0.01")"

  [[ "$condition1" = 1 && "$condition2" = 1 && "$condition3" = 1 ]]
}

# Loop to retry checking conditions up to max_retries times
while ! check_conditions; do
  ((count++)) || true
  echo "Attempt $count: Conditions not met. Retrying..."

  # Break loop if maximum retries have been reached
  if [[ $count -eq $max_retries ]]; then
    echo "Maximum retries reached. Exiting."
    exit 1
  fi

  # Wait for 1 second before the next retry
  sleep 1
done

echo "Conditions met within $count retries."
