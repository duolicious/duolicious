#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from person"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0

token_of () {
  python3 -c '
import base64, hashlib, hmac, sys
uuid = sys.argv[1]
digest = hmac.digest(b"dev-unsubscribe-secret", uuid.encode(), hashlib.sha256)
print(uuid + "." + base64.urlsafe_b64encode(digest).rstrip(b"=").decode())
' "$1"
}

user1_token=$(token_of "$(q "select uuid from person where email = 'user1@example.com'")")
user2_token=$(token_of "$(q "select uuid from person where email = 'user2@example.com'")")

status () {
  curl -s -o /dev/null -w '%{http_code}' "http://localhost:5000$1"
}

response () {
  curl -s -w ' %{http_code}' "http://localhost:5000$1"
}

notifications () {
  q "select concat_ws(',', chats_notification, intros_notification, visitors_notification)
     from person where email = '$1'"
}

assume_role user1

c GET "/update-notifications?type=Every&token=${user1_token}&frequency=Immediately"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 1 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 1 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 1 and email = 'user1@example.com'")" ]]

c GET "/update-notifications?type=Every&token=${user1_token}&frequency=Daily"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 2 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 2 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 2 and email = 'user1@example.com'")" ]]

c GET "/update-notifications?type=Every&token=${user1_token}&frequency=Every+3+days"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 3 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 3 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 3 and email = 'user1@example.com'")" ]]

c GET "/update-notifications?type=Every&token=${user1_token}&frequency=Weekly"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 4 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 4 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 4 and email = 'user1@example.com'")" ]]

c GET "/update-notifications?type=Every&token=${user1_token}&frequency=Never"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 5 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 5 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 5 and email = 'user1@example.com'")" ]]

c GET "/update-notifications?type=Intros&token=${user1_token}&frequency=Immediately"
[[ 0 -eq "$(q "select count(*) from person where chats_notification  = 1 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where intros_notification = 1 and email = 'user1@example.com'")" ]]
[[ 0 -eq "$(q "select count(*) from person where visitors_notification = 1 and email = 'user1@example.com'")" ]]

c GET "/update-notifications?type=Chats&token=${user1_token}&frequency=Never"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 5 and email = 'user1@example.com'")" ]]
[[ 0 -eq "$(q "select count(*) from person where intros_notification = 5 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 5 and email = 'user1@example.com'")" ]]

c GET "/update-notifications?type=Visitors&token=${user1_token}&frequency=Daily"
[[ 1 -eq "$(q "select count(*) from person where chats_notification  = 5 and email = 'user1@example.com'")" ]]
[[ 0 -eq "$(q "select count(*) from person where intros_notification = 5 and email = 'user1@example.com'")" ]]
[[ 1 -eq "$(q "select count(*) from person where visitors_notification = 2 and email = 'user1@example.com'")" ]]

before=$(notifications user1@example.com)
if [[ "$(date -u +%F)" > 2026-12-15 ]]
then
  # After the cutoff, a link with an email address and no token is rejected, and the settings stay as they were
  [[ "$(status '/update-notifications?type=Every&email=user1@example.com&frequency=Immediately')" = 400 ]]
  [[ "$(notifications user1@example.com)" = "$before" ]]
else
  # Until the cutoff, a link with an email address and no token changes the settings
  [[ "$before" != "1,1,1" ]]
  [[ "$(status '/update-notifications?type=Every&email=user1@example.com&frequency=Immediately')" = 200 ]]
  [[ "$(notifications user1@example.com)" = "1,1,1" ]]

  # Until the cutoff, a link with an email address and no token accepts any frequency in the immediacy table
  q "insert into immediacy (name) values ('Fortnightly')"
  [[ "$(status '/update-notifications?type=Chats&email=nobody@example.com&frequency=Fortnightly')" = 200 ]]
  q "delete from immediacy where name = 'Fortnightly'"
fi

# A link with an email address and no token gets the same answer whether or not the address has an account
[[ "$(response '/update-notifications?type=Every&email=user1@example.com&frequency=Immediately')" = \
   "$(response '/update-notifications?type=Every&email=nobody@example.com&frequency=Immediately')" ]]

# A link with an email address and no token and a frequency that does not exist is rejected, and the settings stay as they were
before=$(notifications user1@example.com)
[[ "$(status '/update-notifications?type=Every&email=user1@example.com&frequency=Hourly')" = 400 ]]
[[ "$(notifications user1@example.com)" = "$before" ]]

# A link with an email address and no token and a type that does not exist is rejected, and the settings stay as they were
[[ "$(status '/update-notifications?type=Monthly&email=user1@example.com&frequency=Immediately')" = 400 ]]
[[ "$(notifications user1@example.com)" = "$before" ]]

# A token with a changed signature is rejected, and the settings stay as they were
[[ "$(status "/update-notifications?type=Every&token=${user1_token}x&frequency=Immediately")" = 400 ]]
[[ "$(notifications user1@example.com)" = "$before" ]]

# A valid token with a frequency that does not exist is rejected, and the settings stay as they were
[[ "$(status "/update-notifications?type=Every&token=${user1_token}&frequency=Hourly")" = 400 ]]
[[ "$(notifications user1@example.com)" = "$before" ]]

# user2's token changes user2 only
user2_before=$(notifications user2@example.com)
[[ "$user2_before" != "4,4,4" ]]
c GET "/update-notifications?type=Every&token=${user2_token}&frequency=Weekly"
[[ "$(notifications user2@example.com)" = "4,4,4" ]]
[[ "$(notifications user1@example.com)" = "$before" ]]
