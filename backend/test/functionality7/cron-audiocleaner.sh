#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -ex

do_test () {
  q "delete from person"
  q "delete from duo_session"
  q "delete from undeleted_audio"

  ../util/create-user.sh user1 0 0 true
  ../util/create-user.sh user2 0 0 true

  user1id=$(get_id 'user1@example.com')
  user2id=$(get_id 'user2@example.com')

  # We'll delete audio with these uuids
  local uuid1=$(q "select uuid from audio where person_id = ${user1id}")
  local uuid2=$(q "select uuid from audio where person_id = ${user2id}")



  echo "Delete user1's audio"
  wait_for_audio_creation_by_uuid "${uuid1}"

  assume_role user1; jc DELETE /profile-info -d '{ "audio_files": [-1] }'

  wait_for_audio_deletion_by_uuid "${uuid1}"



  echo "Check that all the other audio files still exist"

  local uuids=( $(q "select uuid from audio") )
  [[ "${#uuids[@]}" -eq 1 ]]
  wait_for_audio_creation_by_uuid "${uuid2}"



  echo "Delete user2's audio"
  wait_for_audio_creation_by_uuid "${uuid2}"

  assume_role user2; jc DELETE /profile-info -d '{ "audio_files": [-1] }'

  wait_for_audio_deletion_by_uuid "${uuid2}"

  echo "Check that all the other audio files still exist again"
  local uuids=( $(q "select uuid from audio") )

  [[ "${#uuids[@]}" -eq 0 ]]
}

do_test
