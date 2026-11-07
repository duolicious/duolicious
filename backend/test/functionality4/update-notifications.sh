#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from person"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0

assume_role user1

c GET '/update-notifications?type=Every&email=user1@example.com&frequency=Immediately'
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 1 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 1 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 1 and email = 'user1@example.com'")" ]]

c GET '/update-notifications?type=Every&email=user1@example.com&frequency=Daily'
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 2 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 2 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 2 and email = 'user1@example.com'")" ]]

c GET '/update-notifications?type=Every&email=user1@example.com&frequency=Every+3+days'
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 3 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 3 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 3 and email = 'user1@example.com'")" ]]

c GET '/update-notifications?type=Every&email=user1@example.com&frequency=Weekly'
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 4 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 4 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 4 and email = 'user1@example.com'")" ]]

c GET '/update-notifications?type=Every&email=user1@example.com&frequency=Never'
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 5 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 5 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 5 and email = 'user1@example.com'")" ]]

c GET '/update-notifications?type=Intros&email=user1@example.com&frequency=Immediately'
[[ 0 -eq "$(q "select count(*) from person where chats_notification  = 1 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 1 and email = 'user1@example.com'")" ]]
[[ 0 -eq "$(q "select count(*) from person where visitors_notification = 1 and email = 'user1@example.com'")" ]]

c GET '/update-notifications?type=Chats&email=user1@example.com&frequency=Never'
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 5 and email = 'user1@example.com'")" ]]
[[ 0 -eq "$(q "select count(*) from person where intros_notification = 5 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 5 and email = 'user1@example.com'")" ]]

c GET '/update-notifications?type=Visitors&email=user1@example.com&frequency=Daily'
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 5 and email = 'user1@example.com'")" ]]
[[ 0 -eq "$(q "select count(*) from person where intros_notification = 5 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 2 and email = 'user1@example.com'")" ]]

token=$(python3 -c '
import base64, hashlib, hmac, sys
uuid = sys.argv[1]
digest = hmac.digest(b"dev-unsubscribe-secret", uuid.encode(), hashlib.sha256)
print(uuid + "." + base64.urlsafe_b64encode(digest).rstrip(b"=").decode())
' "$(q "select uuid from person where email = 'user1@example.com'")")

c GET "/update-notifications?type=Chats&token=${token}&frequency=Weekly"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 4 and email = 'user1@example.com'")" ]]

! c GET "/update-notifications?type=Chats&token=${token}x&frequency=Daily"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 4 and email = 'user1@example.com'")" ]]

user1_id=$(q "select id from person where email = 'user1@example.com'")

chat_due_in_minutes () {
  q "select round(extract(epoch from due_at - now()) / 60)
     from notification_due
     where kind = 'chat'
     and person_id = $user1_id"
}

q "update person
   set chat_seconds = extract(epoch from now() - interval '1 day')::int
   where id = $user1_id"
q "insert into notification_due (person_id, kind, event_at, due_at)
   values ($user1_id, 'chat', now() - interval '1 minute', now() + interval '9 minutes')"

c GET "/update-notifications?type=Every&token=${token}&frequency=Weekly"
[[ "$(chat_due_in_minutes)" = $((6 * 24 * 60)) ]]

c GET "/update-notifications?type=Chats&token=${token}&frequency=Immediately"
[[ "$(chat_due_in_minutes)" = 9 ]]
