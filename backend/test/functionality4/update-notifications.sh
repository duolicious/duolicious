#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from person"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0

assume_role user1

token=$(python3 -c '
import base64, hashlib, hmac, sys
uuid = sys.argv[1]
digest = hmac.digest(b"dev-unsubscribe-secret", uuid.encode(), hashlib.sha256)
print(uuid + "." + base64.urlsafe_b64encode(digest).rstrip(b"=").decode())
' "$(q "select uuid from person where email = 'user1@example.com'")")

c GET "/update-notifications?type=Every&token=${token}&frequency=Immediately"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 1 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 1 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 1 and email = 'user1@example.com'")" ]]

c GET "/update-notifications?type=Every&token=${token}&frequency=Daily"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 2 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 2 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 2 and email = 'user1@example.com'")" ]]

c GET "/update-notifications?type=Every&token=${token}&frequency=Every+3+days"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 3 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 3 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 3 and email = 'user1@example.com'")" ]]

c GET "/update-notifications?type=Every&token=${token}&frequency=Weekly"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 4 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 4 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 4 and email = 'user1@example.com'")" ]]

c GET "/update-notifications?type=Every&token=${token}&frequency=Never"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 5 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 5 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 5 and email = 'user1@example.com'")" ]]

c GET "/update-notifications?type=Intros&token=${token}&frequency=Immediately"
[[ 0 -eq "$(q "select count(*) from person where chats_notification  = 1 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 1 and email = 'user1@example.com'")" ]]
[[ 0 -eq "$(q "select count(*) from person where visitors_notification = 1 and email = 'user1@example.com'")" ]]

c GET "/update-notifications?type=Chats&token=${token}&frequency=Never"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 5 and email = 'user1@example.com'")" ]]
[[ 0 -eq "$(q "select count(*) from person where intros_notification = 5 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 5 and email = 'user1@example.com'")" ]]

c GET "/update-notifications?type=Visitors&token=${token}&frequency=Daily"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 5 and email = 'user1@example.com'")" ]]
[[ 0 -eq "$(q "select count(*) from person where intros_notification = 5 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 2 and email = 'user1@example.com'")" ]]

! c GET "/update-notifications?type=Chats&token=${token}x&frequency=Daily"
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 2 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 5 and email = 'user1@example.com'")" ]]

! c GET '/update-notifications?type=Chats&email=user1@example.com&frequency=Daily'
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 5 and email = 'user1@example.com'")" ]]
