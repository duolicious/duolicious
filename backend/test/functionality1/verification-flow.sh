#!/usr/bin/env bash

# This test is mostly intended to verify that the `verificationjobrunner` runs
# the jobs. The unit tests for the `verification` Python module are much
# more in-depth.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

img1=$(rand_image)
img2=$(rand_image)

wait_for_verification_result () {
  local expected_response=$1

  local elapsed=0

  while (( elapsed < 5 ))
  do
    local response=$(jc GET /check-verification)

    if diff <(echo "$response") <(echo "$expected_response")
    then
      return 0
    fi

    sleep 1

    (( elapsed += 1 )) || true
  done

  return 1
}

test_uniqueness () {
  q "delete from person"
  q "delete from verification_job"
  q "delete from verification_photo_hash"

  ../util/create-user.sh user1 0 3
  assume_role user1

  cat > ../../test/input/verification-mock-response-file <<EOF
{
  "image_1_was_not_edited": 1.0,
  "image_1_is_photograph": 1.0,
  "image_1_is_not_screenshot": 1.0,
  "image_1_has_at_least_one_person": 1.0,
  "image_1_has_exactly_one_person": 1.0,
  "image_1_has_45_degree_angle": 1.0,
  "image_1_has_claimed_gender": 1.0,
  "image_1_has_claimed_age": 1.0,
  "image_1_has_claimed_minimum_age": 1.0,
  "image_1_has_claimed_ethnicity": 1.0,
  "image_1_has_smiling_person": 1.0,
  "image_1_has_eyebrow_touch": 1.0,
  "image_1_has_downward_thumb": 1.0,
  "image_1_has_person_from_image_2": 1.0,
  "image_1_has_person_from_image_3": 0.0,
  "image_1_has_person_from_image_4": 1.0
}
EOF

  local expected_end_user_response_1=$(cat <<EOF
{
  "message": "",
  "status": "success",
  "verified_age": true,
  "verified_ethnicity": true,
  "verified_gender": true,
  "verified_photos": {
    "1": true,
    "2": false,
    "3": true
  }
}
EOF
)

  jc POST /verification-selfie \
    -d "{
            \"base64_file\": {
                \"position\": 1,
                \"base64\": \"${img1:0:200}\",
                \"top\": 0,
                \"left\": 0
            }
        }" \
    | grep -q 'Image invalid'

  [[ "$(q "select COUNT(*) from verification_job")" -eq 0 ]]

  jc POST /verification-selfie \
    -d "{
            \"base64_file\": {
                \"position\": 1,
                \"base64\": \"${img1}\",
                \"top\": 0,
                \"left\": 0
            }
        }"

  jc POST /verify

  wait_for_verification_result "$expected_end_user_response_1"

  local expected_end_user_response_2=$(cat <<EOF
{
  "message": "You can\u2019t submit the same selfie more than once.",
  "status": "failure",
  "verified_age": true,
  "verified_ethnicity": true,
  "verified_gender": true,
  "verified_photos": {
    "1": true,
    "2": false,
    "3": true
  }
}
EOF
)

  jc POST /verification-selfie \
    -d "{
            \"base64_file\": {
                \"position\": 1,
                \"base64\": \"${img1}\",
                \"top\": 0,
                \"left\": 0
            }
        }"

  jc POST /verify

  wait_for_verification_result "$expected_end_user_response_2"

  local expected_end_user_response_3=$(cat <<EOF
{
  "message": "",
  "status": "success",
  "verified_age": true,
  "verified_ethnicity": true,
  "verified_gender": true,
  "verified_photos": {
    "1": true,
    "2": false,
    "3": true
  }
}
EOF
)

  jc POST /verification-selfie \
    -d "{
            \"base64_file\": {
                \"position\": 1,
                \"base64\": \"${img2}\",
                \"top\": 0,
                \"left\": 0
            }
        }"

  jc POST /verify

  wait_for_verification_result "$expected_end_user_response_3"
}

test_success () {
  q "delete from person"
  q "delete from verification_job"
  q "delete from verification_photo_hash"

  ../util/create-user.sh user1 0 3
  assume_role user1

  cat > ../../test/input/verification-mock-response-file <<EOF
{
  "image_1_was_not_edited": 1.0,
  "image_1_is_photograph": 1.0,
  "image_1_is_not_screenshot": 1.0,
  "image_1_has_at_least_one_person": 1.0,
  "image_1_has_exactly_one_person": 1.0,
  "image_1_has_45_degree_angle": 1.0,
  "image_1_has_claimed_gender": 1.0,
  "image_1_has_claimed_age": 1.0,
  "image_1_has_claimed_minimum_age": 1.0,
  "image_1_has_claimed_ethnicity": 1.0,
  "image_1_has_smiling_person": 1.0,
  "image_1_has_eyebrow_touch": 1.0,
  "image_1_has_downward_thumb": 1.0,
  "image_1_has_person_from_image_2": 1.0,
  "image_1_has_person_from_image_3": 0.0,
  "image_1_has_person_from_image_4": 1.0
}
EOF

  local expected_end_user_response=$(cat <<EOF
{
  "message": "",
  "status": "success",
  "verified_age": true,
  "verified_ethnicity": true,
  "verified_gender": true,
  "verified_photos": {
    "1": true,
    "2": false,
    "3": true
  }
}
EOF
)

  jc POST /verification-selfie \
    -d "{
            \"base64_file\": {
                \"position\": 1,
                \"base64\": \"${img1}\",
                \"top\": 0,
                \"left\": 0
            }
        }"

  jc POST /verify

  wait_for_verification_result "$expected_end_user_response"
}

test_failure () {
  q "delete from person"
  q "delete from verification_job"
  q "delete from verification_photo_hash"

  ../util/create-user.sh user1 0 3
  assume_role user1

  cat > ../../test/input/verification-mock-response-file <<EOF
{
  "image_1_was_not_edited": 1.0,
  "image_1_is_photograph": 1.0,
  "image_1_is_not_screenshot": 1.0,
  "image_1_has_at_least_one_person": 1.0,
  "image_1_has_exactly_one_person": 1.0,
  "image_1_has_45_degree_angle": 1.0,
  "image_1_has_claimed_gender": 0.0,
  "image_1_has_claimed_age": 1.0,
  "image_1_has_claimed_minimum_age": 1.0,
  "image_1_has_smiling_person": 1.0,
  "image_1_has_eyebrow_touch": 1.0,
  "image_1_has_downward_thumb": 1.0,
  "image_1_has_person_from_image_2": 1.0,
  "image_1_has_person_from_image_3": 0.0,
  "image_1_has_person_from_image_4": 1.0
}
EOF

  local expected_end_user_response=$(cat <<EOF
{
  "message": "Our AI couldn\\u2019t verify your gender.",
  "status": "failure",
  "verified_age": false,
  "verified_ethnicity": false,
  "verified_gender": false,
  "verified_photos": {
    "1": false,
    "2": false,
    "3": false
  }
}
EOF
)

  jc POST /verification-selfie \
    -d "{
            \"base64_file\": {
                \"position\": 1,
                \"base64\": \"${img1}\",
                \"top\": 0,
                \"left\": 0
            }
        }"

  jc POST /verify

  wait_for_verification_result "$expected_end_user_response"
}

test_uniqueness
test_success
test_failure
