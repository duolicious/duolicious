#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

printf 1           > ../../test/input/enable-mocking
printf 0           > ../../test/input/disable-ip-rate-limit
printf 0           > ../../test/input/disable-account-rate-limit
printf 256.256.0.0 > ../../test/input/mock-ip-address
sleep 1 # Wait for the TTL caches of the test/input files to expire

set -xe

  jc POST /request-otp -d '{ "email": "user1@example.com" }'
  jc POST /request-otp -d '{ "email": "user1@example.com" }'
  jc POST /request-otp -d '{ "email": "user1@example.com" }'
! jc POST /request-otp -d '{ "email": "user2@example.com" }' || exit 1

printf 1 > ../../test/input/disable-ip-rate-limit
printf 1 > ../../test/input/disable-account-rate-limit
q 'delete from person'
../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0
../util/create-user.sh user3 0 0
../util/create-user.sh user4 0 0
../util/create-user.sh user5 0 0
user2id=$(q "select id from person where name = 'user2'")
user2uuid=$(q "select uuid from person where name = 'user2'")
assume_role user1
printf 0 > ../../test/input/disable-ip-rate-limit
printf 1 > ../../test/input/disable-account-rate-limit

echo Only the global rate limit should apply for regular skips
c POST "/skip/by-uuid/${user2uuid}"
c POST "/unskip/by-uuid/${user2uuid}"
c POST "/skip/by-uuid/${user2uuid}"

echo The stricter rate limit should apply for reports
  jc POST "/skip/by-uuid/${user2uuid}" -d '{ "report_reason": "smells bad" }'
   c POST "/unskip/by-uuid/${user2uuid}"
! jc POST "/skip/by-uuid/${user2uuid}" -d '{ "report_reason": "bad hair" }' || exit 1

echo Uncached search should be heavily rate-limited
for x in {1..15}
do
  c GET '/search?n=1&o=0'
  sleep 0.1 # Avoid hitting the global rate limit
done
! c GET '/search?n=1&o=0' || exit 1

echo "Cached search shouldn't be heavily rate-limited"
c GET '/search?n=1&o=1'
c GET '/search?n=1&o=1'
c GET '/search?n=1&o=1'

echo "Rate limit should apply independently to clubs"
jc POST /join-club -d '{ "name": "Anime" }'
jc POST /join-club -d '{ "name": "Manga" }'
# The cached-search calls above (and these joins) run back-to-back with no
# delay, so they can fill the current 1-second window of the global rate limit.
# Drain it before the club-search burst so this exercises the per-club limit,
# not the global one. (The per-request `sleep 0.1` only keeps us under the
# global limit once the window starts clear.)
sleep 1
for x in {1..15}
do
  c GET '/search?n=1&o=0&club=Anime'
  sleep 0.1 # Avoid hitting the global rate limit
done
! c GET '/search?n=1&o=0&club=Anime' || exit 1
  c GET '/search?n=1&o=0&club=Manga'

echo Account-based rate limit should to search apply even if the IP address changes
printf 1 > ../../test/input/disable-ip-rate-limit
printf 1 > ../../test/input/disable-account-rate-limit
assume_role user3

printf 0 > ../../test/input/disable-ip-rate-limit
printf 0 > ../../test/input/disable-account-rate-limit

for x in {1..15}
do
  printf "256.256.1.${x}" > ../../test/input/mock-ip-address
  c GET '/search?n=1&o=0'
  sleep 0.1 # Avoid hitting the global rate limit
done
! c GET '/search?n=1&o=0' || exit 1

echo "The IP-based rate limit doesn't apply to other accounts"
assume_role user4
c GET '/search?n=1&o=0'

echo Account-based rate limit applies to /verify endpoint when IP changes
printf 1 > ../../test/input/disable-ip-rate-limit
printf 0 > ../../test/input/disable-account-rate-limit
true     > ../../test/input/verification-mock-response-file
for x in {1..8}
do
  printf "256.256.256.${x}" > ../../test/input/mock-ip-address
  c POST /verify
  sleep 0.1 # Avoid hitting the global rate limit
done
! c POST /verify || exit 1

echo "The rate limit doesn't apply to other accounts"
assume_role user5
c POST /verify
