#!/usr/bin/env bash

# Regression test for the session cache on the admin-ban path (see
# service/api/sessioncache/ and `delete_or_ban_account` in service/api/person/__init__.py).
#
# Banning a user runs through `delete_or_ban_account(s=None, ...)` — there is no
# calling session, so eviction relies entirely on looking the banned person's
# session tokens up by `person_id`. This test confirms a banned user's cached
# session stops authenticating immediately rather than lingering until the TTL.
#
# See delete-account-session-cache.sh for why `/search-clubs` (not
# `/check-session-token`) is the probe endpoint.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from banned_person"
q "delete from banned_person_admin_token"
q "delete from skipped"
q "delete from duo_session"
q "delete from person"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0

# Sign in as the victim and cache the session.
assume_role user1
user1id="$PERSON_ID"
user1uuid="$USER_UUID"
c GET '/search-clubs?q=my-club'
token1="$SESSION_TOKEN"

# user2 reports user1, which mints an admin ban token for user1.
assume_role user2
jc POST "/skip/by-uuid/${user1uuid}" -d '{ "report_reason": "spam" }'

ban_token=$(q "select token from banned_person_admin_token where person_id = $user1id")
[[ -n "$ban_token" ]]

# Follow the ban link, which deletes/bans user1's account and must evict their
# cached session even though no session of theirs initiated the request.
SESSION_TOKEN=""
c GET "/admin/ban/${ban_token}"

[[ "$(q "select count(*) from duo_session where person_id = $user1id")" -eq 0 ]]

# user1's token must now be rejected at `require_auth` rather than served from
# a stale cache entry.
SESSION_TOKEN="$token1"
! c GET '/search-clubs?q=my-club' || exit 1

# Banning user1 inserts a `banned_person` row carrying their session IP
# (see Q_ADMIN_BAN). Every test shares the same source IP, and `_check_banned`
# rejects `request-otp` when *either* the email or the IP is banned, so leaving
# this row would make `create-user.sh` fail for every later test in the suite
# (e.g. banned-display-names.sh). Clear it so we don't poison them.
q "delete from banned_person"
