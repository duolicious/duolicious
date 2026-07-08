#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

img1=$(rand_image)

set -xe

echo Create a user who added two photos
q "delete from banned_person"
q "delete from duo_session"
q "delete from person"
q "delete from onboardee"
q "delete from undeleted_photo"
../util/create-user.sh unchanged 0 2
../util/create-user.sh user1 0 2

[[ "$(q "select count(*) from photo")" == "4" ]]
[[ "$(q "select count(*) from person where has_profile_picture_id = 1")" == "2" ]]
[[ "$(q "select count(*) from undeleted_photo")" == "0" ]]

assume_role user1

echo Change the first photo
jc PATCH /profile-info \
  -d "{
          \"base64_file\": {
              \"position\": 1,
              \"base64\": \"${img1}\",
              \"top\": 0,
              \"left\": 0
          }
      }"

[[ "$(q "select count(*) from photo")" == "4" ]]
[[ "$(q "select count(*) from person where has_profile_picture_id = 1")" == "2" ]]
[[ "$(q "select count(*) from undeleted_photo")" == "1" ]]

echo Self-deleted account
q "delete from banned_person"
q "delete from duo_session"
q "delete from person"
q "delete from onboardee"
q "delete from undeleted_photo"
../util/create-user.sh unchanged 0 2
../util/create-user.sh user1 0 2

assume_role user1
c DELETE /account

[[ "$(q "select count(*) from photo")" == "2" ]]
[[ "$(q "select count(*) from person where has_profile_picture_id = 1")" == "1" ]]
[[ "$(q "select count(*) from undeleted_photo")" == "2" ]]

echo Admin-deleted account
q "delete from banned_person"
q "delete from duo_session"
q "delete from person"
q "delete from onboardee"
q "delete from undeleted_photo"
../util/create-user.sh unchanged 0 2
../util/create-user.sh user1 0 2

uuid=$(q "select gen_random_uuid()")
user1id=$(q "select id from person where name = 'user1'")

q "insert into banned_person_admin_token values (
  '${uuid}', ${user1id}, now(), now() + interval '1 year')"

c GET "/admin/ban/${uuid}"

[[ "$(q "select count(*) from photo")" == "2" ]]
[[ "$(q "select count(*) from person where has_profile_picture_id = 1")" == "1" ]]
[[ "$(q "select count(*) from undeleted_photo")" == "2" ]]

echo Admin-deleted photo
q "delete from banned_person"
q "delete from duo_session"
q "delete from person"
q "delete from onboardee"
q "delete from undeleted_photo"
../util/create-user.sh unchanged 0 2
../util/create-user.sh user1 0 2

uuid=$(q "select gen_random_uuid()")
user1id=$(q "select id from person where name = 'user1'")
photo_uuid=$(q "select uuid from photo where position = 1 and person_id = $user1id")

q "update person verification_level_id = 3 where name = 'user1'"

q "insert into deleted_photo_admin_token values (
  '${uuid}', '${photo_uuid}', now(), now() + interval '1 year')"

c GET "/admin/delete-photo/${uuid}"

[[ "$(q "select count(*) from photo")" == "3" ]]
[[ "$(q "select count(*) from person where has_profile_picture_id = 1")" == "2" ]]
[[ "$(q "select count(*) from person where verification_level_id = 3")" == "0" ]]
[[ "$(q "select count(*) from undeleted_photo")" == "1" ]]

echo Verification photos are deleted when the job expires
q "delete from verification_job"
q "delete from person"
q "delete from undeleted_photo"

../util/create-user.sh user1 0 0
assume_role user1

cat /dev/null > ../../test/input/verification-mock-response-file

jc POST /verification-selfie \
  -d "{
          \"base64_file\": {
              \"position\": 1,
              \"base64\": \"${img1}\",
              \"top\": 0,
              \"left\": 0
          }
      }"

[[ "$(q "select count(*) from undeleted_photo")" == "0" ]]

q "update verification_job set expires_at = now()"

sleep 2

[[ "$(q "select count(*) from undeleted_photo")" == "1" ]]
