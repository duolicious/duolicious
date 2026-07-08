#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

img1=$(rand_image)
img2=$(rand_image)

setup () {
  local num_photos=${1:-0}
  local make_bystander=${2:-false}

  q "delete from duo_session"
  q "delete from person"
  q "delete from onboardee"
  q "delete from banned_person"
  q "delete from banned_person_admin_token"
  q "delete from deleted_photo_admin_token"
  q "delete from banned_photo_hash"

  ../util/create-user.sh 'reporter@gmail.com' 0 0
  assume_role 'reporter@gmail.com'
  add_photos "${num_photos}"

  ../util/create-user.sh 'accuse.d+1@gmail.com' 0 0
  assume_role 'accuse.d+1@gmail.com'
  add_photos "${num_photos}"

  if [[ "${make_bystander}" == true ]]
  then
    ../util/create-user.sh 'bystander@gmail.com' 0 "${num_photos}"
  fi

  accused_id=$(
    q "select id from person where email = 'accuse.d+1@gmail.com'")

  accused_uuid=$(
    q "select uuid from person where email = 'accuse.d+1@gmail.com'")

  bystander_uuid=$(
    q "select uuid from person where email = 'bystander@gmail.com'")
}

tear_down () {
  q "delete from banned_person"
  q "delete from banned_person_admin_token"
  q "delete from deleted_photo_admin_token"
}

ban_token () {
  q "select token from banned_person_admin_token where person_id = ${accused_id}"
}

deleted_photo_token () {
  q "
  select token
  from deleted_photo_admin_token
  join photo
  on photo.uuid = deleted_photo_admin_token.photo_uuid
  where person_id = ${accused_id}
  "
}

set -xe

# A banned email can't get an OTP
no_otp_when_email_banned () {
  setup

  assume_role 'reporter@gmail.com'

  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "n/a" }'

  c GET "/admin/ban/$(ban_token)"

  q "update banned_person set ip_address = '255.255.255.255'"

  ! ../util/create-user.sh 'accused@gmail.com' 0 0
}

# A banned ip can't get an OTP
no_otp_when_ip_banned () {
  setup

  assume_role 'reporter@gmail.com'

  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "n/a" }'

  c GET "/admin/ban/$(ban_token)"

  q "update banned_person set normalized_email = 'nobody@example.com'"

  ! ../util/create-user.sh 'accused@gmail.com' 0 0
}

# Banning one user doesn't ban everyone
otp_when_others_are_banned () {
  setup

  assume_role 'reporter@gmail.com'

  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "n/a" }'

  c GET "/admin/ban/$(ban_token)"

  q "update banned_person set ip_address = '255.255.255.255'"
  q "update banned_person set normalized_email = 'nobody@example.com'"

  ../util/create-user.sh 'bystander@gmail.com' 0 0
}

# Ban expiry is respected
ban_expiry () {
  setup

  assume_role 'reporter@gmail.com'

  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "n/a" }'

  c GET "/admin/ban/$(ban_token)"

  q "update banned_person set expires_at = NOW() + interval '1 day'"
  ! ../util/create-user.sh 'accused@gmail.com' 0 0 || exit 1

  q "update banned_person set expires_at = NOW() - interval '1 day'"
  ../util/create-user.sh 'accused@gmail.com' 0 0
}

# token expiry is respected for bans
ban_token_expiry () {
  setup

  assume_role 'reporter@gmail.com'

  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "n/a" }'

  q "update banned_person_admin_token set expires_at = NOW() - interval '1 day'"
  ! c GET "/admin/ban/$(ban_token)"
}

# token expiry is respected for photos
photo_token_expiry () {
  setup

  assume_role 'reporter@gmail.com'

  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "n/a" }'

  q "update deleted_photo_admin_token set expires_at = NOW() - interval '1 day'"
  ! c GET "/admin/delete-photo/$(deleted_photo_token)"
}

# Only the person who should have been banned is deleted
specific_person_is_banned () {
  setup 0 true

  assume_role 'reporter@gmail.com'

  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "my target" }'
  jc POST "/skip/by-uuid/${bystander_uuid}" -d '{ "report_reason": "collateral damage" }'

  [[ "$(q "select count(*) from person")" -eq 3 ]]

  c GET "/admin/ban/$(ban_token)"

  [[ "$(q "select count(*) from person")" -eq 2 ]]

  [[ "$(q "select count(*) from person where id = ${accused_id}")" -eq 0 ]]

  [[ "$(q "select report_reasons \
    from banned_person \
    where normalized_email = 'accused@gmail.com'")" == '{"my target"}' ]]
}

# Only the photo which should have been deleted is delete
specific_photo_is_banned () {
  setup 1 true

  assume_role 'accuse.d+1@gmail.com'

  jc PATCH /profile-info \
    -d "{
            \"base64_file\": {
                \"position\": 1,
                \"base64\": \"${img1}\",
                \"top\": 0,
                \"left\": 0
            }
        }"

  assume_role 'reporter@gmail.com'

  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "n/a" }'

  [[ "$(q "select count(*) from photo")" -eq 3 ]]
  [[ "$(q "select count(*) from banned_photo_hash")" -eq 0 ]]
  # The reporter, the accused and the bystander all have added-photo events
  [[ "$(q "select count(*) from person where last_event_name = 'added-photo'")" -eq 3 ]]

  c GET "/admin/delete-photo/$(deleted_photo_token)"

  [[ "$(q "select count(*) from photo")" -eq 2 ]]
  [[ "$(q "select count(*) from banned_photo_hash where hash <> ''")" -eq 1 ]]
  # Deleting the accused's photo reverts their added-photo event
  [[ "$(q "select count(*) from person where last_event_name = 'added-photo'")" -eq 2 ]]

  assume_role 'accuse.d+1@gmail.com'

  ! jc PATCH /profile-info \
    -d "{
            \"base64_file\": {
                \"position\": 2,
                \"base64\": \"${img1}\",
                \"top\": 0,
                \"left\": 0
            }
        }" || exit 1

  jc PATCH /profile-info \
    -d "{
            \"base64_file\": {
                \"position\": 3,
                \"base64\": \"${img2}\",
                \"top\": 0,
                \"left\": 0
            }
        }"

  [[ "$(q "select count(*) from photo")" -eq 3 ]]
}

bans_work_despite_no_active_sessions () {
  setup 0 true

  assume_role 'reporter@gmail.com'

  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "my target" }'
  jc POST "/skip/by-uuid/${bystander_uuid}" -d '{ "report_reason": "collateral damage" }'

  q "delete from duo_session"

  [[ "$(q "select count(*) from person")" -eq 3 ]]

  c GET "/admin/ban/$(ban_token)"

  [[ "$(q "select count(*) from person")" -eq 2 ]]

  [[ "$(q "select count(*) from person where id = ${accused_id}")" -eq 0 ]]

  [[ "$(q "select report_reasons \
    from banned_person \
    where normalized_email = 'accused@gmail.com'")" == '{"my target"}' ]]
}

# Make the existing reporter plus a second reporter fully trustworthy: 30+ days
# old, not shadow banned, a 10+ character bio, 10+ answered questions and 5+
# people messaged. Their bot reports then count toward the automod. The accused
# is given has_gold = false so the automod can apply to them (every user created
# by create-user.sh starts with has_gold = true).
setup_trustworthy_reporters () {
  setup

  ../util/create-user.sh 'reporter2@gmail.com' 0 0

  # Five distinct people for the reporters to have messaged
  local i
  for i in 1 2 3 4 5
  do
    ../util/create-user.sh "filler${i}@gmail.com" 0 0
  done

  q "insert into messaged (subject_person_id, object_person_id)
     select reporter.id, filler.id
     from person as reporter
     cross join person as filler
     where reporter.email in ('reporter@gmail.com', 'reporter2@gmail.com')
       and filler.email like 'filler%@gmail.com'
     on conflict do nothing"

  q "update person
     set sign_up_time = now() - interval '31 days',
         about = 'A genuine human bio',
         count_answers = 10
     where email in ('reporter@gmail.com', 'reporter2@gmail.com')"

  q "update person set has_gold = false where id = ${accused_id}"
}

accused_is_shadow_banned () {
  q "select shadow_banned_at is not null from person where id = ${accused_id}"
}

# Two trustworthy bot reports automatically shadow ban a non-gold user
automod_shadow_bans_after_two_bot_reports () {
  setup_trustworthy_reporters

  # One bot report isn't enough
  assume_role 'reporter@gmail.com'
  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "this is a scammer" }'
  [[ "$(accused_is_shadow_banned)" == f ]]

  # A second one from another trustworthy reporter trips the automod
  assume_role 'reporter2@gmail.com'
  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "obviously a bot" }'
  [[ "$(accused_is_shadow_banned)" == t ]]
}

# Gold users are never automatically shadow banned
automod_spares_gold_users () {
  setup_trustworthy_reporters

  q "update person set has_gold = true where id = ${accused_id}"

  assume_role 'reporter@gmail.com'
  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "scammer" }'
  assume_role 'reporter2@gmail.com'
  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "bot" }'

  [[ "$(accused_is_shadow_banned)" == f ]]
}

# Reports from untrustworthy reporters don't count toward the automod
automod_ignores_untrustworthy_reporters () {
  setup_trustworthy_reporters

  # The first reporter is brand new; the second is shadow banned
  q "update person
     set sign_up_time = now()
     where email = 'reporter@gmail.com'"
  q "update person
     set shadow_banned_at = now()
     where email = 'reporter2@gmail.com'"

  assume_role 'reporter@gmail.com'
  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "scammer" }'
  assume_role 'reporter2@gmail.com'
  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "bot" }'

  [[ "$(accused_is_shadow_banned)" == f ]]
}

# Reports whose reasons don't match the bot regex don't count toward the automod
automod_ignores_non_bot_reports () {
  setup_trustworthy_reporters

  assume_role 'reporter@gmail.com'
  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "rude to me" }'
  assume_role 'reporter2@gmail.com'
  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "bad vibes" }'

  [[ "$(accused_is_shadow_banned)" == f ]]
}

# A reporter with too short a bio isn't trustworthy
automod_ignores_reporters_with_short_bio () {
  setup_trustworthy_reporters

  q "update person set about = 'short' where email = 'reporter2@gmail.com'"

  assume_role 'reporter@gmail.com'
  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "scammer" }'
  assume_role 'reporter2@gmail.com'
  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "bot" }'

  [[ "$(accused_is_shadow_banned)" == f ]]
}

# A reporter who's messaged too few people isn't trustworthy
automod_ignores_reporters_who_messaged_few_people () {
  setup_trustworthy_reporters

  q "delete from messaged
     where subject_person_id =
       (select id from person where email = 'reporter2@gmail.com')"

  assume_role 'reporter@gmail.com'
  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "scammer" }'
  assume_role 'reporter2@gmail.com'
  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "bot" }'

  [[ "$(accused_is_shadow_banned)" == f ]]
}

# A reporter who's answered too few questions isn't trustworthy
automod_ignores_reporters_who_answered_few_questions () {
  setup_trustworthy_reporters

  q "update person set count_answers = 9 where email = 'reporter2@gmail.com'"

  assume_role 'reporter@gmail.com'
  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "scammer" }'
  assume_role 'reporter2@gmail.com'
  jc POST "/skip/by-uuid/${accused_uuid}" -d '{ "report_reason": "bot" }'

  [[ "$(accused_is_shadow_banned)" == f ]]
}

# Execute tests
automod_shadow_bans_after_two_bot_reports
automod_spares_gold_users
automod_ignores_untrustworthy_reporters
automod_ignores_non_bot_reports
automod_ignores_reporters_with_short_bio
automod_ignores_reporters_who_messaged_few_people
automod_ignores_reporters_who_answered_few_questions
bans_work_despite_no_active_sessions
no_otp_when_email_banned
no_otp_when_ip_banned
otp_when_others_are_banned
ban_expiry
ban_token_expiry
photo_token_expiry
specific_person_is_banned
specific_photo_is_banned

tear_down
