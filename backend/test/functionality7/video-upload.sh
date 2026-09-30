#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

video=../fixtures/video.mp4
video_md5=$(md5sum < "$video" | cut -d ' ' -f 1)
not_a_video=$(mktemp)
echo 'not a video' > "$not_a_video"

request_upload () {
  jc POST /video-upload -d "{
    \"position\": $1,
    \"byte_size\": $2,
    \"content_type\": \"${3:-video/mp4}\"
  }"
}

put_file () {
  curl -sSf -X PUT \
    -H 'Content-Type: video/mp4' \
    --data-binary "@$2" \
    "$(jq -r .upload_url <<< "$1")"
}

upload_video () {
  local response=$(request_upload "$1" "$(stat -c %s "$2")")
  local uuid=$(jq -r .uuid <<< "$response")
  put_file "$response" "$2"
  jc POST "/video-upload/$uuid/done" > /dev/null
  echo "$uuid"
}

wait_for_status () {
  for _ in $(seq 1 120)
  do
    [[ "$(c GET "/video-upload/$1" | jq -r .status)" = "$2" ]] && return 0
    sleep 0.5
  done
  c GET "/video-upload/$1"
  return 1
}

q "delete from video_job"
q "delete from banned_photo_hash"
q "delete from person"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0

assume_role user1

echo A video is transcoded and published as a photo with an MP4 rendition
uuid=$(upload_video 1 "$video")

[[ "$(c GET /profile-info | jq -c '.video_job | [.uuid, .position, .status]')" \
  =~ ^\[\"$uuid\",1,\"(queued|running)\"\]$ ]]

wait_for_status "$uuid" success

photo_uuid=$(c GET "/video-upload/$uuid" | jq -r .photo_uuid)

[[ "$(q "
  select extra_exts || hash || (nsfw_score between 0 and 0.2)::text
  from photo
  where person_id = $PERSON_ID and position = 1 and uuid = '$photo_uuid'")" \
  = "{mp4,$video_md5,true}" ]]

for key in "$photo_uuid.mp4" {original,900,450}"-$photo_uuid.jpg"
do
  c GET "http://localhost:9090/s3-mock-bucket/$key" > /dev/null
done

curl -sSf -I -H 'Authorization: Bearer x' \
  "http://localhost:9090/s3-mock-bucket/$photo_uuid.mp4" \
  | grep -qi '^content-type: video/mp4'

assert_eventually 404 curl -s -o /dev/null -w '%{http_code}' \
  -H 'Authorization: Bearer x' \
  "http://localhost:9090/s3-mock-video-upload-bucket/$uuid"

[[ "$(c GET /profile-info | jq -c '[.video_job, .photo_extra_exts["1"]]')" \
  = '[null,["mp4"]]' ]]

echo Reporting a finished upload again is harmless
jc POST "/video-upload/$uuid/done"

echo Only the uploader can see their upload
assume_role user2
! c GET "/video-upload/$uuid" || exit 1
! jc POST "/video-upload/$uuid/done" || exit 1
assume_role user1

echo Declared sizes over 100 MB and non-video types are refused
! request_upload 2 100000001 || exit 1
! request_upload 2 1000 image/png || exit 1

echo Done is refused when the upload is missing or has the wrong size
response=$(request_upload 2 1000)
! jc POST "/video-upload/$(jq -r .uuid <<< "$response")/done" || exit 1
put_file "$response" "$video"
! jc POST "/video-upload/$(jq -r .uuid <<< "$response")/done" || exit 1

echo A person can have only one video in progress
q "
  insert into video_job (uuid, person_id, position, byte_size, status)
  values ('in-progress', $PERSON_ID, 3, 1, 'running')"
! request_upload 2 1000 || exit 1
q "delete from video_job where uuid = 'in-progress'"

echo Uploads are refused while the queue is full
PGPASSWORD="${DUO_DB_PASS:-password}" psql \
  -U "${DUO_DB_USER:-postgres}" \
  -h "${DUO_DB_HOST:-localhost}" \
  -p "${DUO_DB_PORT:-5432}" \
  -d duo_api \
  -c "
    insert into video_job (uuid, person_id, position, byte_size, status)
    values ('queued', $(get_id user2@example.com), 1, 1, 'queued')" \
  -c "begin" \
  -c "select 1 from video_job where uuid = 'queued' for update" \
  -c "select pg_sleep(5)" \
  -c "commit" &
held_lock=$!
sleep 1
! request_upload 2 1000 || exit 1
wait "$held_lock"
q "delete from video_job where uuid = 'queued'"

echo A file that is not a video fails with a message
uuid=$(upload_video 2 "$not_a_video")
wait_for_status "$uuid" failure
[[ "$(c GET "/video-upload/$uuid" | jq -r .message)" \
  = "That file isn't a video we can use" ]]
[[ "$(c GET /profile-info | jq -r .video_job.message)" \
  = "That file isn't a video we can use" ]]
[[ "$(q "select count(*) from photo where person_id = $PERSON_ID")" = 1 ]]

echo A banned video fails
q "insert into banned_photo_hash (hash) values ('$video_md5')"
uuid=$(upload_video 2 "$video")
wait_for_status "$uuid" failure
[[ "$(c GET "/video-upload/$uuid" | jq -r .message)" \
  = 'That video breaks the rules' ]]
q "delete from banned_photo_hash"

echo Each person can request ten uploads a day
flush_redis
write_input_file disable-ip-rate-limit 0
write_input_file disable-account-rate-limit 0
for _ in $(seq 1 10)
do
  request_upload 2 1000 > /dev/null
done
! request_upload 2 1000 || exit 1
write_input_file disable-ip-rate-limit 1
write_input_file disable-account-rate-limit 1
flush_redis
