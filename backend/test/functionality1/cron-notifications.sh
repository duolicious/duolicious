#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -ex

setup () {
  q "delete from inbox"
  # Cascades to `visited`
  q "delete from person"

  delete_emails

  ../util/create-user.sh user1 0 0
  ../util/create-user.sh user2 0 0
  ../util/create-user.sh user3 0 0

  q "
  UPDATE person
  SET email = REPLACE(email, '@example.com', '@duolicious.app')
  "

  user1id=$(q "select uuid from person where email = 'user1@duolicious.app'")
  user2id=$(q "select uuid from person where email = 'user2@duolicious.app'")
  user3id=$(q "select uuid from person where email = 'user3@duolicious.app'")

  q "update person set last_online_time = to_timestamp(0) where uuid = '$user1id'"
  q "update person set last_online_time = to_timestamp(0) where uuid = '$user2id'"
  q "update person set last_online_time = to_timestamp(0) where uuid = '$user3id'"
}

db_now () {
  local units=${1:-as-seconds}
  local interval=${2:-'0 minutes'}
  local conversion_factor

  if [[ "$units" = 'as-seconds' ]]; then
    conversion_factor=1
  elif [[ "$units" = 'as-microseconds' ]]; then
    conversion_factor=1000000
  else
    return 1
  fi

  q "select (extract(epoch from now() + interval '${interval}') * ${conversion_factor})::bigint"
}

# Record a visit of one user's profile by another, as though it happened
# `age` ago.
# Example: insert_visit "$user2id" "$user1id" '11 minutes' true
insert_visit () {
  local visitor_uuid=$1
  local visited_uuid=$2
  local age=$3
  local invisible=${4:-false}

  q "
  insert into visited (subject_person_id, object_person_id, updated_at, invisible)
  select
    (select id from person where uuid::text = '$visitor_uuid'),
    (select id from person where uuid::text = '$visited_uuid'),
    now() - interval '${age}',
    ${invisible}
  "
}

# The pushes sent to a token, as a compact JSON array of the fields a test
# cares about.
# Example: [[ "$(pushes_to 'some_token')" = '[{"title":"...",...}]' ]]
pushes_to () {
  local token=$1
  curl -s 'http://localhost:3002/messages' \
    | jq -c "[.[]
        | select(.to == \"${token}\")
        | {title, body, screen: .data.params.screen}]"
}

# Give user1 a reachable push token and put them offline, so the cron pushes to
# them rather than emailing.
give_user1_a_phone () {
  local token=$1

  q "update person set last_online_time = now() - interval '20 minutes' where uuid = '$user1id'"
  q "update duo_session
     set push_token = '$token', last_online_time = now() - interval '20 minutes'
     where signed_in
     and person_id = (select id from person where uuid::text = '$user1id')"
}

test_happy_path_intros () {
  setup

  local time_interval=$(db_now as-microseconds '- 11 minutes')

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]

  q "
  insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  values
    ('$user1id', '', '', 'inbox', ${time_interval}, 42, '', 'I'),
    ('$user2id', '', '', 'inbox', ${time_interval}, 0, '', 'I')
  "

  sleep 2

  [[ "$(q " \
    select count(*) \
    from person \
    where \
    uuid::text = '$user1id' and \
    chat_seconds = 0 and \
    intro_seconds > 0")" = 1 ]]

  diff \
    <(get_emails) \
    ../../test/fixtures/cron-emails-happy-path-intros
}

test_happy_path_chats () {
  setup

  local time_interval=$(db_now as-microseconds '- 11 minutes')

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]

  q "
  insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  values
    ('$user1id', '', '', 'chats', ${time_interval}, 42, '', 'I'),
    ('$user2id', '', '', 'chats', ${time_interval}, 0, '', 'I')
  "

  sleep 2

  [[ "$(q " \
    select count(*) \
    from person \
    where \
    uuid::text = '$user1id' and \
    chat_seconds > 0 and \
    intro_seconds = 0")" = 1 ]]

  diff \
    <(get_emails) \
    ../../test/fixtures/cron-emails-happy-path-chats
}

test_happy_path_chat_not_deferred_by_intro () {
  setup

  # Default drift period for intros (i.e. inbox messages) is 1 day = 86400 s.
  local t1=$(db_now as-microseconds '- 50 minutes') # last intro
  local t2=$(db_now as-seconds      '- 40 minutes') # last notification
  local t3=$(db_now as-microseconds '- 30 minutes') # last chat

  # Insert last notification
  q "update person set intro_seconds = $t2 where uuid::text = '$user1id'"
  local rows=$(
    q "select count(*)
    from person
    where uuid::text = '$user1id'
    and chat_seconds = 0
    and intro_seconds = $t2"
  )
  [[ "$rows" = 1 ]]

  # Insert last message
  q "
  insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  values
    ('$user1id', 'sender1', '', 'chats', ${t3}, 42, '', 'I'),
    ('$user1id', 'sender2', '', 'inbox', ${t1},  0, '', 'I')
  "
  [[ "$(q "select count(*) from inbox")" = 2 ]]

  sleep 2

  # Cron service should still send chat notification
  local rows=$(
    q "select count(*)
    from person
    where uuid::text = '$user1id'
    and chat_seconds != 0
    and intro_seconds = $t2"
  )
  [[ "$rows" = 1 ]]

  diff \
    <(get_emails) \
    ../../test/fixtures/cron-emails-happy-path-chat-not-deffered-by-intro
}

test_sad_sent_9_minutes_ago () {
  setup

  local time_interval=$(db_now as-microseconds '- 9 minutes')

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]
  is_inbox_empty

  q "
  insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  values
    ('$user1id', '', '', 'chats', ${time_interval}, 42, '', 'I'),
    ('$user2id', '', '', 'inbox', ${time_interval}, 43, '', 'I')
  "
  [[ "$(q "select count(*) from inbox")" = 2 ]]

  sleep 2

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]
  is_inbox_empty
}

test_sad_sent_11_days_ago () {
  setup

  local time_interval=$(db_now as-microseconds '- 11 days')

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]
  is_inbox_empty

  q "
  insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  values
    ('$user1id', '', '', 'chats', ${time_interval}, 42, '', 'I'),
    ('$user2id', '', '', 'inbox', ${time_interval}, 43, '', 'I')
  "
  [[ "$(q "select count(*) from inbox")" = 2 ]]

  sleep 2

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]
  is_inbox_empty
}

test_sad_only_read_messages () {
  setup

  local time_interval=$(db_now as-microseconds '- 11 minutes')

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]
  is_inbox_empty

  q "
  insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  values
    ('$user1id', '', '', 'chats', ${time_interval}, 0, '', 'I'),
    ('$user2id', '', '', 'inbox', ${time_interval}, 0, '', 'I')
  "
  [[ "$(q "select count(*) from inbox")" = 2 ]]

  sleep 2

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]
  is_inbox_empty
}

test_sad_still_online_at_poll_time () {
  setup

  local t1=$(db_now as-microseconds '- 11 minutes')

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]

  q "update person set last_online_time = now() - interval '9 minutes' where uuid = '$user1id'"
  q "update person set last_online_time = now() - interval '9 minutes' where uuid = '$user2id'"

  q "
  insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  values
    ('$user1id', '', '', 'chats', ${t1}, 42, '', 'I'),
    ('$user2id', '', '', 'inbox', ${t1}, 43, '', 'I')
  "
  [[ "$(q "select count(*) from inbox")" = 2 ]]

  sleep 2

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]

  is_inbox_empty
}

test_sad_still_online_after_message_time () {
  setup

  local t1=$(db_now as-microseconds '- 13 minutes')

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]

  q "update person set last_online_time = now() - interval '11 minutes' where uuid = '$user1id'"
  q "update person set last_online_time = now() - interval '11 minutes' where uuid = '$user2id'"

  q "
  insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  values
    ('$user1id', '', '', 'chats', ${t1}, 42, '', 'I'),
    ('$user2id', '', '', 'inbox', ${t1}, 43, '', 'I')
  "
  [[ "$(q "select count(*) from inbox")" = 2 ]]

  sleep 2

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]

  is_inbox_empty
}

test_sad_already_notified_for_particular_message () {
  setup

  local t1=$(db_now as-microseconds '-  5 minutes') # 1st message to user1
  local t2=$(db_now as-seconds      '-  7 minutes') # 1st notification to user1
  local t3=$(db_now as-microseconds '- 11 minutes') # 1st message to user2
  local t4=$(db_now as-microseconds '- 13 minutes') # 1st message to user3

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]
  is_inbox_empty

  q "update person set intro_seconds = $t2 where uuid::text = '$user1id'"
  [[ "$(q "select count(*) from person where uuid::text = '$user1id' and chat_seconds = 0 and intro_seconds = $t2")" = 1 ]]

  q "
  insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  values
    ('$user1id', '', '', 'chats', ${t1}, 42, '', 'I'),
    ('$user2id', '', '', 'inbox', ${t3}, 43, '', 'I'),
    ('$user3id', '', '', 'inbox', ${t4},  0, '', 'I')
  "
  [[ "$(q "select count(*) from inbox")" = 3 ]]

  sleep 2

  [[ "$(q " \
    select count(*) \
    from person \
    where \
    uuid::text = '$user1id' and \
    chat_seconds = 0 and \
    intro_seconds = $t2")" = 1 ]]

  [[ "$(q " \
    select count(*) \
    from person \
    where \
    uuid::text = '$user2id' and \
    chat_seconds = 0 and \
    intro_seconds > 0")" = 1 ]]

  diff \
    <(get_emails) \
    ../../test/fixtures/cron-emails-sad-already-notified-for-particular-message
}

test_sad_already_notified_for_other_intro_in_drift_period () {
  setup

  # Default drift period for intros (i.e. inbox messages) is 1 day = 86400 s.
  local t1=$(db_now as-seconds      '- 40 minutes') # last notification
  local t2=$(db_now as-microseconds '- 30 minutes') # last message

  # Insert last notification
  q "update person set intro_seconds = $t1 where uuid::text = '$user1id'"
  local rows=$(
    q "select count(*)
    from person
    where uuid::text = '$user1id'
    and chat_seconds = 0
    and intro_seconds = $t1"
  )
  [[ "$rows" = 1 ]]

  # Insert last message
  q "
  insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  values
    ('$user1id', '', '', 'inbox', ${t2}, 42, '', 'I'),
    ('$user2id', '', '', 'inbox', ${t2},  0, '', 'I')
  "
  [[ "$(q "select count(*) from inbox")" = 2 ]]

  sleep 2

  # Cron service should prevent 2nd intros notification from being sent
  local rows=$(
    q "select count(*)
    from person
    where uuid::text = '$user1id'
    and chat_seconds = 0
    and intro_seconds = $t1"
  )
  [[ "$rows" = 1 ]]

  is_inbox_empty
}

# The user has already received an intro in the past day and a chat in the past
# 10 minutes. They were notified about both of these. Then the user gets another
# chat within this same 10 minute window. The user should not be notified about
# this chat during this time.
test_sad_intro_within_day_and_chat_within_past_10_minutes () {
  setup

  # Default drift period for intros (i.e. inbox messages) is 1 day = 86400 s.
  local t1=$(db_now as-microseconds '- 13 hours             ') # last intro
  local t2=$(db_now as-seconds      '- 13 minutes + 1 second') # last intro notification
  local t3=$(db_now as-seconds      '-  5 minutes           ') # last chat notification
  local t4=$(db_now as-microseconds '-  3 minutes           ') # last chat

  # Insert last notification
  q "update person set intro_seconds = $t2, chat_seconds = $t3 where uuid::text = '$user1id'"
  local rows=$(
    q "select count(*)
    from person
    where uuid::text = '$user1id'
    and intro_seconds = $t2
    and chat_seconds = $t3"
  )
  [[ "$rows" = 1 ]]

  # Insert intro and chat
  q "
  insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  values
    ('$user1id', 'sender2', '', 'inbox', ${t1}, 42, '', 'I'),
    ('$user1id', 'sender1', '', 'chats', ${t4}, 43, '', 'I')
  "
  [[ "$(q "select count(*) from inbox")" = 2 ]]

  sleep 2

  # Cron service should not send any notifications and duo_last_notification
  # should remain unchanged
  local rows=$(
    q "select count(*)
    from person
    where uuid::text = '$user1id'
    and intro_seconds = $t2
    and chat_seconds = $t3"
  )
  [[ "$rows" = 1 ]]

  is_inbox_empty
}

test_sad_not_activated () {
  setup

  q "update person set activated = false where uuid = '$user1id'"

  local time_interval=$(db_now as-microseconds '- 11 minutes')

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]

  q "
  insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  values
    ('$user1id', '', '', 'inbox', ${time_interval}, 42, '', 'I'),
    ('$user2id', '', '', 'inbox', ${time_interval}, 0, '', 'I')
  "

  sleep 2

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]
}

# Count emails delivered to a given address by the test SMTP server (MailHog).
count_emails_to () {
  local addr=$1
  curl -s 'http://localhost:8025/api/v1/messages' \
    | jq "[.[] | select(.Content.Headers.To[] | contains(\"${addr}\"))] | length"
}

# A signed-in session with a NULL push_token is a push-less (web) client. If the
# user's most recent session is such a web client, the cron emails them (web
# clients can't receive push) even though they have a push token on a (less
# recently used) mobile session. Conversely, if a mobile session was more
# recent, the push token is used and no email is sent.
test_web_client_also_emailed () {
  setup

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]

  # Person was last online > 10 minutes ago so the notification is eligible.
  q "update person set last_online_time = now() - interval '20 minutes' where uuid = '$user1id'"
  q "update person set last_online_time = now() - interval '20 minutes' where uuid = '$user2id'"

  # user1: mobile session (older) + web session (newer) -> web is most recent.
  q "update duo_session
     set push_token = 'user1_mobile_token',
         last_online_time = now() - interval '20 minutes'
     where session_token_hash = (
       select ds.session_token_hash from duo_session ds
       join person p on p.id = ds.person_id
       where p.uuid::text = '$user1id' and ds.signed_in limit 1)"
  q "insert into duo_session
       (session_token_hash, person_id, email, signed_in, last_online_time)
     select 'web-session-user1', p.id, p.email, true, now() - interval '11 minutes'
     from person p where p.uuid::text = '$user1id'"

  # user2: web session (older) + mobile session (newer) -> mobile is most recent.
  q "update duo_session
     set push_token = 'user2_mobile_token',
         last_online_time = now() - interval '11 minutes'
     where session_token_hash = (
       select ds.session_token_hash from duo_session ds
       join person p on p.id = ds.person_id
       where p.uuid::text = '$user2id' and ds.signed_in limit 1)"
  q "insert into duo_session
       (session_token_hash, person_id, email, signed_in, last_online_time)
     select 'web-session-user2', p.id, p.email, true, now() - interval '20 minutes'
     from person p where p.uuid::text = '$user2id'"

  # Disable push so the test only observes the email side effect. The email
  # path is independent of this flag.
  echo 1 > ../../test/input/disable-mobile-notifications

  local time_interval=$(db_now as-microseconds '- 11 minutes')

  q "
  insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  values
    ('$user1id', '', '', 'inbox', ${time_interval}, 42, '', 'I'),
    ('$user2id', '', '', 'inbox', ${time_interval}, 43, '', 'I')
  "

  sleep 2

  echo 0 > ../../test/input/disable-mobile-notifications

  # Both users were eligible for a notification.
  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 2 ]]

  # user1 (web most recent) is emailed despite having a push token; user2
  # (mobile most recent) is not.
  [[ "$(count_emails_to 'user1@duolicious.app')" = 1 ]]
  [[ "$(count_emails_to 'user2@duolicious.app')" = 0 ]]
}

# A notifiable user with no signed-in sessions at all (e.g. they logged out on
# every device) still gets emailed: the LEFT JOIN to the session summary yields
# no row, so the LATERAL falls back to a NULL token, which the cron sends as an
# email rather than a push.
test_no_sessions_emailed () {
  setup

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]

  echo 0 > ../../test/input/disable-mobile-notifications
  clear_pushes

  # Remove every session for user1 so they have no signed-in device.
  q "delete from duo_session
     where person_id = (select id from person where uuid::text = '$user1id')"
  [[ "$(q "select count(*) from duo_session ds
           join person p on p.id = ds.person_id
           where p.uuid::text = '$user1id'")" = 0 ]]

  local time_interval=$(db_now as-microseconds '- 11 minutes')

  q "insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction) values ('$user1id', '', '', 'inbox', ${time_interval}, 42, '', 'I')"

  sleep 2

  # The notification was recorded and delivered as an email, with no push.
  [[ "$(q "select count(*) from person where uuid::text = '$user1id' and intro_seconds > 0")" = 1 ]]
  [[ "$(count_emails_to 'user1@duolicious.app')" = 1 ]]
  [[ "$(curl -s 'http://localhost:3002/messages' | jq 'length')" = 0 ]]

  # Emails don't badge an app icon, so the unseen-notification count is
  # untouched.
  [[ "$(q "select unseen_notification_count from person where uuid::text = '$user1id'")" = 0 ]]
}

test_low_active_users_notified_via_email () {
  setup

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]

  q "update person set last_online_time = now() - interval '7 days' where uuid = '$user1id'"
  q "update person set last_online_time = now() - interval '9 days' where uuid = '$user2id'"

  q "update duo_session set push_token = 'token_1' where session_token_hash = (
      select ds.session_token_hash from duo_session ds
      join person p on p.id = ds.person_id
      where p.uuid::text = '$user1id' and ds.signed_in limit 1)"
  q "update duo_session set push_token = 'token_2' where session_token_hash = (
      select ds.session_token_hash from duo_session ds
      join person p on p.id = ds.person_id
      where p.uuid::text = '$user2id' and ds.signed_in limit 1)"

  local time_interval=$(db_now as-microseconds '- 11 minutes')

  echo 1 > ../../test/input/disable-mobile-notifications

  q "
  INSERT INTO
    inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  VALUES
    ('$user1id', '', '', 'inbox', ${time_interval}, 42, '', 'I'),
    ('$user2id', '', '', 'inbox', ${time_interval}, 43, '', 'I')
  "

  sleep 2

  echo 0 > ../../test/input/disable-mobile-notifications

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 2 ]]

  diff \
    <(get_emails) \
    ../../test/fixtures/cron-emails-active-users-notified-via-email
}

# A user last online more than 8 days ago still gets their push token tried (it
# may be stale and fail to deliver), and is *also* emailed as a backstop. So a
# single unread intro produces both a push and an email.
test_inactive_over_8_days_pushed_and_emailed () {
  setup

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]

  # Pushes must actually be sent (an earlier test may have disabled them).
  echo 0 > ../../test/input/disable-mobile-notifications
  clear_pushes

  # user1: last online 9 days ago, on a signed-in mobile (push) session.
  q "update person set last_online_time = now() - interval '9 days' where uuid = '$user1id'"
  q "update duo_session
     set push_token = 'token_9d', last_online_time = now() - interval '9 days'
     where signed_in
     and person_id = (select id from person where uuid::text = '$user1id')"

  local time_interval=$(db_now as-microseconds '- 11 minutes')

  q "insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction) values ('$user1id', '', '', 'inbox', ${time_interval}, 42, '', 'I')"

  sleep 4

  # The notification was recorded ...
  [[ "$(q "select count(*) from person where uuid::text = '$user1id' and intro_seconds > 0")" = 1 ]]

  # ... and delivered as both a push (to the possibly-stale token) and an email.
  [[ "$(count_pushes_to 'token_9d')" = 1 ]]
  [[ "$(count_emails_to 'user1@duolicious.app')" = 1 ]]
}

# Happy path: a recently-active user whose most recent session is a reachable
# mobile device gets a push, and no email.
test_recently_active_mobile_user_pushed () {
  setup

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]

  echo 0 > ../../test/input/disable-mobile-notifications
  clear_pushes

  q "update person set last_online_time = now() - interval '20 minutes' where uuid = '$user1id'"
  q "update duo_session
     set push_token = 'token_recent', last_online_time = now() - interval '20 minutes'
     where signed_in
     and person_id = (select id from person where uuid::text = '$user1id')"

  local time_interval=$(db_now as-microseconds '- 11 minutes')

  q "insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction) values ('$user1id', '', '', 'inbox', ${time_interval}, 42, '', 'I')"

  sleep 4

  [[ "$(q "select count(*) from person where uuid::text = '$user1id' and intro_seconds > 0")" = 1 ]]
  [[ "$(count_pushes_to 'token_recent')" = 1 ]]
  [[ "$(count_emails_to 'user1@duolicious.app')" = 0 ]]

  # The push carries the unseen-notification count as the app-icon badge.
  [[ "$(q "select unseen_notification_count from person where uuid::text = '$user1id'")" = 1 ]]
  [[ "$(badges_of_pushes_to 'token_recent')" = '[1]' ]]
}

# Happy path: a person signed in on several mobile devices gets one push per
# distinct device token.
test_pushed_to_each_signed_in_device () {
  setup

  [[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]

  echo 0 > ../../test/input/disable-mobile-notifications
  clear_pushes

  q "update person set last_online_time = now() - interval '20 minutes' where uuid = '$user1id'"
  q "update duo_session
     set push_token = 'token_dev_a', last_online_time = now() - interval '20 minutes'
     where signed_in
     and person_id = (select id from person where uuid::text = '$user1id')"
  q "insert into duo_session
       (session_token_hash, person_id, email, signed_in, push_token, last_online_time)
     select 'device-b-session', p.id, p.email, true, 'token_dev_b', now() - interval '21 minutes'
     from person p where p.uuid::text = '$user1id'"

  local time_interval=$(db_now as-microseconds '- 11 minutes')

  q "insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction) values ('$user1id', '', '', 'inbox', ${time_interval}, 42, '', 'I')"

  sleep 4

  [[ "$(q "select count(*) from person where uuid::text = '$user1id' and intro_seconds > 0")" = 1 ]]
  [[ "$(count_pushes_to 'token_dev_a')" = 1 ]]
  [[ "$(count_pushes_to 'token_dev_b')" = 1 ]]
  [[ "$(count_emails_to 'user1@duolicious.app')" = 0 ]]

  # The unseen-notification count incremented once for the person, not once
  # per device, so both devices show the same badge.
  [[ "$(q "select unseen_notification_count from person where uuid::text = '$user1id'")" = 1 ]]
  [[ "$(badges_of_pushes_to 'token_dev_a')" = '[1]' ]]
  [[ "$(badges_of_pushes_to 'token_dev_b')" = '[1]' ]]
}

# One notification covers the whole inbox. When a chat is due while an unread
# intro is still inside its own (weekly) frequency cap, the notification names
# both kinds and resets both clocks, rather than leaving the intro to a second
# notification later on. Keeping the two together is what stops the cron being
# noisy: the user hears about everything unread at once, and the intro's cap
# then runs from the moment they were told.
test_chat_notification_also_covers_a_capped_intro () {
  setup

  echo 0 > ../../test/input/disable-mobile-notifications
  clear_pushes

  give_user1_a_phone 'token_capped_intro'

  # Both messages must land after the user was last online.
  q "update person set last_online_time = now() - interval '60 minutes'
     where uuid = '$user1id'"

  # Weekly intros, immediate chats.
  q "update person set intros_notification = 4, chats_notification = 1
     where uuid = '$user1id'"

  # An intro notification 40 minutes ago leaves the intro below well inside the
  # weekly cap, so the intro alone would send nothing.
  local last_intro_notification=$(db_now as-seconds '- 40 minutes')
  q "update person set intro_seconds = $last_intro_notification
     where uuid::text = '$user1id'"

  q "
  insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  values
    ('$user1id', 'sender1', '', 'inbox', $(db_now as-microseconds '- 30 minutes'), 42, '', 'I'),
    ('$user1id', 'sender2', '', 'chats', $(db_now as-microseconds '- 20 minutes'), 43, '', 'I')
  "

  sleep 4

  # A single notification, naming both the chat and the capped intro.
  [[ "$(pushes_to 'token_capped_intro')" = '[{"title":"You have a new message 😍","body":"You have new messages in your chats and intros!","screen":"Inbox"}]' ]]

  # Both clocks were reset, so neither kind sends a follow-up ...
  [[ "$(q " \
    select count(*) \
    from person \
    where \
    uuid::text = '$user1id' and \
    intro_seconds > $last_intro_notification and \
    chat_seconds > 0")" = 1 ]]

  # ... on this poll or any later one.
  sleep 4
  [[ "$(count_pushes_to 'token_capped_intro')" = 1 ]]
}

# A visit is worth notifying about all on its own, even when the inbox is
# empty, and it sends the user to the visitors tab rather than the inbox. The
# default frequency is weekly, and nobody has been notified about visitors
# before, so the visit is due immediately.
test_happy_path_visitors () {
  setup

  echo 0 > ../../test/input/disable-mobile-notifications
  clear_pushes

  give_user1_a_phone 'token_visitors'

  [[ "$(q "select count(*) from person where visitor_seconds > 0")" = 0 ]]
  is_inbox_empty

  insert_visit "$user2id" "$user1id" '11 minutes'

  sleep 4

  # Only the visitor notification was recorded; there were no messages.
  [[ "$(q " \
    select count(*) \
    from person \
    where \
    uuid::text = '$user1id' and \
    visitor_seconds > 0 and \
    intro_seconds = 0 and \
    chat_seconds = 0")" = 1 ]]

  [[ "$(pushes_to 'token_visitors')" = '[{"title":"Someone visited your profile 👀","body":"Someone visited your profile!","screen":"Visitors"}]' ]]

  # The visit is announced once; the next poll finds nothing new to say.
  sleep 4
  [[ "$(count_pushes_to 'token_visitors')" = 1 ]]
}

# When more than one person visited since the user was last online, the
# notification says how many.
test_happy_path_multiple_visitors () {
  setup

  echo 0 > ../../test/input/disable-mobile-notifications
  clear_pushes

  give_user1_a_phone 'token_multi'

  insert_visit "$user2id" "$user1id" '11 minutes'
  insert_visit "$user3id" "$user1id" '12 minutes'

  sleep 4

  [[ "$(pushes_to 'token_multi')" = '[{"title":"2 people visited your profile 👀","body":"2 people visited your profile!","screen":"Visitors"}]' ]]
}

# A message and a visit arriving in the same window are announced separately:
# two notifications, each with its own headline and destination, and each
# counting towards the app-icon badge.
test_happy_path_visitor_and_intro_are_separate () {
  setup

  echo 0 > ../../test/input/disable-mobile-notifications
  clear_pushes

  give_user1_a_phone 'token_both'

  q "
  insert into inbox (luser, remote_bare_jid, msg_id, box, timestamp, unread_count, body, direction)
  values ('$user1id', '', '', 'inbox', $(db_now as-microseconds '- 11 minutes'), 42, '', 'I')
  "
  insert_visit "$user2id" "$user1id" '11 minutes'

  sleep 4

  [[ "$(q " \
    select count(*) \
    from person \
    where \
    uuid::text = '$user1id' and \
    visitor_seconds > 0 and \
    intro_seconds > 0")" = 1 ]]

  [[ "$(count_pushes_to 'token_both')" = 2 ]]
  [[ "$(pushes_to 'token_both' | jq -c 'sort_by(.title)')" = '[{"title":"Someone visited your profile 👀","body":"Someone visited your profile!","screen":"Visitors"},{"title":"You have a new message 😍","body":"You have a new message in your intros!","screen":"Inbox"}]' ]]
  [[ "$(badges_of_pushes_to 'token_both' | jq -c 'sort')" = '[1,2]' ]]
  [[ "$(q "select unseen_notification_count from person where uuid::text = '$user1id'")" = 2 ]]
}

# A visit made while browsing invisibly never shows up in the visitors tab, so
# it must not produce a notification either.
test_sad_invisible_visit () {
  setup

  echo 0 > ../../test/input/disable-mobile-notifications
  clear_pushes

  give_user1_a_phone 'token_invisible'

  insert_visit "$user2id" "$user1id" '11 minutes' true

  sleep 4

  [[ "$(q "select count(*) from person where visitor_seconds > 0")" = 0 ]]
  [[ "$(count_pushes_to 'token_invisible')" = 0 ]]
  is_inbox_empty
}

# A shadow-banned visitor doesn't exist from anyone else's perspective, so their
# visit isn't notified about.
test_sad_shadow_banned_visitor () {
  setup

  echo 0 > ../../test/input/disable-mobile-notifications
  clear_pushes

  give_user1_a_phone 'token_shadow_banned'

  q "update person set shadow_banned_at = now() where uuid = '$user2id'"

  insert_visit "$user2id" "$user1id" '11 minutes'

  sleep 4

  [[ "$(q "select count(*) from person where visitor_seconds > 0")" = 0 ]]
  [[ "$(count_pushes_to 'token_shadow_banned')" = 0 ]]
}

# "Never" means no visitor notifications at all.
test_sad_visitors_notification_never () {
  setup

  echo 0 > ../../test/input/disable-mobile-notifications
  clear_pushes

  give_user1_a_phone 'token_never'

  q "update person set visitors_notification = 5 where uuid = '$user1id'"

  insert_visit "$user2id" "$user1id" '11 minutes'

  sleep 4

  [[ "$(q "select count(*) from person where visitor_seconds > 0")" = 0 ]]
  [[ "$(count_pushes_to 'token_never')" = 0 ]]
}

# Like messages, a visit is left alone for ten minutes: the user may still be
# looking at their visitors tab.
test_sad_visited_9_minutes_ago () {
  setup

  echo 0 > ../../test/input/disable-mobile-notifications
  clear_pushes

  give_user1_a_phone 'token_too_recent'

  insert_visit "$user2id" "$user1id" '9 minutes'

  sleep 4

  [[ "$(q "select count(*) from person where visitor_seconds > 0")" = 0 ]]
  [[ "$(count_pushes_to 'token_too_recent')" = 0 ]]
}

# A user who was online after the visit has already seen it in their visitors
# tab.
test_sad_online_after_visit () {
  setup

  echo 0 > ../../test/input/disable-mobile-notifications
  clear_pushes

  # The helper leaves user1 last online twenty minutes ago, after the visit.
  give_user1_a_phone 'token_seen_it'

  insert_visit "$user2id" "$user1id" '30 minutes'

  sleep 4

  [[ "$(q "select count(*) from person where visitor_seconds > 0")" = 0 ]]
  [[ "$(count_pushes_to 'token_seen_it')" = 0 ]]
}

# A user with no push device is emailed about their visitors instead, and the
# email points at the visitors page.
test_visitors_emailed_when_no_phone () {
  setup

  q "delete from duo_session
     where person_id = (select id from person where uuid::text = '$user1id')"
  q "update person set last_online_time = now() - interval '20 minutes' where uuid = '$user1id'"

  insert_visit "$user2id" "$user1id" '11 minutes'

  sleep 4

  [[ "$(q "select count(*) from person where uuid::text = '$user1id' and visitor_seconds > 0")" = 1 ]]
  [[ "$(count_emails_to 'user1@duolicious.app')" = 1 ]]

  get_emails | grep -q 'Someone visited your profile!'
  get_emails | grep -q 'get.duolicious.app/visitors'
}

test_happy_path_intros
test_happy_path_chats
test_happy_path_chat_not_deferred_by_intro

test_chat_notification_also_covers_a_capped_intro

test_happy_path_visitors
test_happy_path_multiple_visitors
test_happy_path_visitor_and_intro_are_separate
test_sad_invisible_visit
test_sad_shadow_banned_visitor
test_sad_visitors_notification_never
test_sad_visited_9_minutes_ago
test_sad_online_after_visit
test_visitors_emailed_when_no_phone

test_recently_active_mobile_user_pushed
test_pushed_to_each_signed_in_device

test_sad_sent_9_minutes_ago
test_sad_sent_11_days_ago
test_sad_only_read_messages
test_sad_still_online_at_poll_time
test_sad_still_online_after_message_time

test_sad_already_notified_for_particular_message
test_sad_already_notified_for_other_intro_in_drift_period

test_sad_intro_within_day_and_chat_within_past_10_minutes

test_sad_not_activated

test_web_client_also_emailed

test_no_sessions_emailed

test_low_active_users_notified_via_email

test_inactive_over_8_days_pushed_and_emailed
