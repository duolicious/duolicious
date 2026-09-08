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
