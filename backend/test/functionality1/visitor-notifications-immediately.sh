#!/usr/bin/env bash

# Purpose: coverage for the "Immediately" visitor notification setting, which
# pushes as the visit happens rather than waiting for the cron.
#
# Only a phone is pushed to. Somebody no push can reach keeps their visitor
# clock at zero so the cron picks the visit up once it's ten minutes old and
# emails them instead, which these tests assert by watching the clock rather
# than waiting ten minutes.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -ex

setup () {
  q "delete from person"
  q "delete from duo_session"
  q "delete from visited"
  q "delete from skipped"

  ../util/create-user.sh viewer   0 0
  ../util/create-user.sh prospect 0 0

  viewer_uuid=$(q "select uuid from person where email = 'viewer@example.com'")
  prospect_uuid=$(q "select uuid from person where email = 'prospect@example.com'")

  # Immediate visitor notifications, and nothing to say about messages.
  q "update person set visitors_notification = 1, visitor_seconds = 0
     where uuid::text = '$prospect_uuid'"

  echo 0 > ../../test/input/disable-mobile-notifications
  clear_pushes
}

# Give the prospect a phone the push can reach.
give_prospect_a_phone () {
  q "update duo_session
     set push_token = 'visitor_push_token'
     where signed_in
     and person_id = (select id from person where uuid::text = '$prospect_uuid')"
}

# Put the prospect out of sight of their own visitors tab, so a push to them
# carries an app-icon badge.
put_prospect_offline () {
  q "update person set last_online_time = now() - interval '20 minutes'
     where uuid::text = '$prospect_uuid'"
}

visit_as_viewer () {
  assume_role viewer
  c GET "/prospect-profile/${prospect_uuid}" > /dev/null
  sleep 2 # The push batcher flushes once a second
}

pushes_to () {
  local token=$1
  curl -s 'http://localhost:3002/messages' \
    | jq -c "[.[]
        | select(.to == \"${token}\")
        | {title, body, screen: .data.params.screen}]"
}

visitor_seconds_of_prospect () {
  q "select visitor_seconds from person where uuid::text = '$prospect_uuid'"
}

# The happy path: a visit reaches the prospect's phone straight away, worded and
# routed like every other visitor notification, and their visitor clock is
# stamped so the cron doesn't say it again.
test_pushed_immediately () {
  setup
  give_prospect_a_phone
  put_prospect_offline

  [[ "$(visitor_seconds_of_prospect)" = 0 ]]

  visit_as_viewer

  # Named, since an immediate push knows exactly who visited.
  [[ "$(pushes_to 'visitor_push_token')" = '[{"title":"viewer visited your profile 👀","body":"Open the app to see your visitors","screen":"Visitors"}]' ]]
  [[ "$(visitor_seconds_of_prospect)" != 0 ]]

  # Sent while they had no client open, so it carries the badge.
  [[ "$(badges_of_pushes_to 'visitor_push_token')" = '[1]' ]]
  [[ "$(q "select unseen_notification_count from person where uuid::text = '$prospect_uuid'")" = 1 ]]
}

# A prospect who is currently around sees the visit arrive in their visitors tab
# by themselves, so the push carries no badge.
test_no_badge_while_online () {
  setup
  give_prospect_a_phone

  q "update person set last_online_time = now()
     where uuid::text = '$prospect_uuid'"

  visit_as_viewer

  [[ "$(count_pushes_to 'visitor_push_token')" = 1 ]]
  [[ "$(badges_of_pushes_to 'visitor_push_token')" = '[null]' ]]
  [[ "$(q "select unseen_notification_count from person where uuid::text = '$prospect_uuid'")" = 0 ]]
}

# Every signed-in phone hears about it, once each.
test_pushed_to_each_phone () {
  setup
  give_prospect_a_phone
  put_prospect_offline

  q "insert into duo_session
       (session_token_hash, person_id, email, signed_in, push_token, last_online_time)
     select 'second-phone', id, email, true, 'visitor_push_token_2', now()
     from person where uuid::text = '$prospect_uuid'"

  visit_as_viewer

  [[ "$(count_pushes_to 'visitor_push_token')" = 1 ]]
  [[ "$(count_pushes_to 'visitor_push_token_2')" = 1 ]]

  # The badge counts the notification, not the devices it went to.
  [[ "$(q "select unseen_notification_count from person where uuid::text = '$prospect_uuid'")" = 1 ]]
}

# Anything other than "Immediately" is the cron's business.
test_sad_not_set_to_immediately () {
  setup
  give_prospect_a_phone
  put_prospect_offline

  q "update person set visitors_notification = 4
     where uuid::text = '$prospect_uuid'"

  visit_as_viewer

  [[ "$(count_pushes_to 'visitor_push_token')" = 0 ]]
  [[ "$(visitor_seconds_of_prospect)" = 0 ]]
}

# A visit made while browsing invisibly never reaches the visitors tab, so it
# mustn't be announced either.
test_sad_invisible_visit () {
  setup
  give_prospect_a_phone
  put_prospect_offline

  q "update person set browse_invisibly = true
     where uuid::text = '$viewer_uuid'"

  visit_as_viewer

  [[ "$(count_pushes_to 'visitor_push_token')" = 0 ]]
  [[ "$(visitor_seconds_of_prospect)" = 0 ]]
}

# A shadow-banned visitor doesn't exist from anyone else's perspective.
test_sad_shadow_banned_viewer () {
  setup
  give_prospect_a_phone
  put_prospect_offline

  q "update person set shadow_banned_at = now()
     where uuid::text = '$viewer_uuid'"

  visit_as_viewer

  [[ "$(count_pushes_to 'visitor_push_token')" = 0 ]]
  [[ "$(visitor_seconds_of_prospect)" = 0 ]]
}

# Somebody who has skipped the viewer has no profile from the viewer's side at
# all: `/prospect-profile` 404s, so the visit is never recorded and there is
# nothing for any of this to act on.
test_sad_prospect_skipped_the_viewer () {
  setup
  give_prospect_a_phone
  put_prospect_offline

  q "insert into skipped (subject_person_id, object_person_id)
     select
       (select id from person where uuid::text = '$prospect_uuid'),
       (select id from person where uuid::text = '$viewer_uuid')"

  assume_role viewer
  ! c GET "/prospect-profile/${prospect_uuid}" > /dev/null
  sleep 2

  [[ "$(q "select count(*) from visited")" = 0 ]]
  [[ "$(count_pushes_to 'visitor_push_token')" = 0 ]]
  [[ "$(visitor_seconds_of_prospect)" = 0 ]]
}

# The other direction does record a visit -- the viewer can still see somebody
# they skipped -- but the visitors tab hides it from the person visited, so
# there is nobody to name.
test_sad_viewer_skipped_the_prospect () {
  setup
  give_prospect_a_phone
  put_prospect_offline

  q "insert into skipped (subject_person_id, object_person_id)
     select
       (select id from person where uuid::text = '$viewer_uuid'),
       (select id from person where uuid::text = '$prospect_uuid')"

  visit_as_viewer

  [[ "$(count_pushes_to 'visitor_push_token')" = 0 ]]
  [[ "$(visitor_seconds_of_prospect)" = 0 ]]
}

# Nobody's phone is reachable, so the visit is left to the cron: no push now,
# and crucially the visitor clock stays at zero so the cron still finds it.
test_sad_no_phone_defers_to_the_cron () {
  setup
  put_prospect_offline

  q "update duo_session set push_token = NULL
     where person_id = (select id from person where uuid::text = '$prospect_uuid')"

  visit_as_viewer

  [[ "$(q "select count(*) from person where uuid::text = '$prospect_uuid' and visitor_seconds = 0")" = 1 ]]
  [[ "$(curl -s 'http://localhost:3002/messages' | jq 'length')" = 0 ]]
}

# The prospect has a phone, but was last seen on the web, so the cron owns the
# notification: it pushes *and* emails, which pushing here would suppress.
test_sad_web_more_recent_than_phone_defers_to_the_cron () {
  setup
  give_prospect_a_phone
  put_prospect_offline

  q "update duo_session
     set last_online_time = now() - interval '20 minutes'
     where signed_in
     and person_id = (select id from person where uuid::text = '$prospect_uuid')"
  q "insert into duo_session
       (session_token_hash, person_id, email, signed_in, last_online_time)
     select 'web-session', id, email, true, now()
     from person where uuid::text = '$prospect_uuid'"

  visit_as_viewer

  [[ "$(count_pushes_to 'visitor_push_token')" = 0 ]]
  [[ "$(visitor_seconds_of_prospect)" = 0 ]]
}

# Visiting your own profile isn't a visit.
test_sad_self_visit () {
  setup
  give_prospect_a_phone
  put_prospect_offline

  assume_role prospect
  c GET "/prospect-profile/${prospect_uuid}" > /dev/null
  sleep 2

  [[ "$(count_pushes_to 'visitor_push_token')" = 0 ]]
  [[ "$(visitor_seconds_of_prospect)" = 0 ]]
}

test_pushed_immediately
test_no_badge_while_online
test_pushed_to_each_phone

test_sad_not_set_to_immediately
test_sad_invisible_visit
test_sad_shadow_banned_viewer
test_sad_prospect_skipped_the_viewer
test_sad_viewer_skipped_the_prospect
test_sad_no_phone_defers_to_the_cron
test_sad_web_more_recent_than_phone_defers_to_the_cron
test_sad_self_visit
