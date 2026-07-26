#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

write_input_file enable-mocking 1
sleep 1 # Wait for the TTL caches of the test/input files to expire

set -xe

# $1/$2 disable the IP-keyed/account-keyed rate limits ('1' to disable).
disable_rate_limits () {
  write_input_file disable-ip-rate-limit "$1"
  write_input_file disable-account-rate-limit "$2"
}

mock_ip () {
  write_input_file mock-ip-address "$1"
}

request_otp () {
  jc POST /request-otp -d '{ "email": "'"$1"'" }'
}

otp_limit_by_ip () {
  echo One IP address gets a limited number of OTPs
  disable_rate_limits 0 0
  mock_ip 256.256.0.0

    request_otp user1@example.com
    request_otp user1@example.com
    request_otp user1@example.com
  ! request_otp user2@example.com || exit 1
}

otp_limit_by_email () {
  echo The email-keyed OTP limit applies even when the IP address changes
  disable_rate_limits 1 0

  for x in {1..3}
  do
    mock_ip "256.256.3.${x}"
    request_otp user6@example.com
  done
  mock_ip 256.256.3.99
  ! request_otp user6@example.com || exit 1

  echo "The email-keyed limit doesn't affect other email addresses"
  request_otp user7@example.com
}

otp_limit_by_normalized_email () {
  echo Email aliases share one OTP allowance
  disable_rate_limits 1 0

  mock_ip 256.256.4.1
  request_otp otpvictim@gmail.com
  mock_ip 256.256.4.2
  request_otp otp.victim+a@gmail.com
  mock_ip 256.256.4.3
  request_otp OtpVictim+b@gmail.com
  mock_ip 256.256.4.4
  ! request_otp otpvictim@gmail.com || exit 1
}

otp_limit_shared_with_resend () {
  echo /resend-otp draws from the same per-email allowance
  disable_rate_limits 1 0

  mock_ip 256.256.5.1
  response=$(request_otp user8@example.com)
  SESSION_TOKEN=$(echo "$response" | jq -r '.session_token')
  mock_ip 256.256.5.2
  jc POST /resend-otp
  mock_ip 256.256.5.3
  jc POST /resend-otp
  mock_ip 256.256.5.4
  ! jc POST /resend-otp || exit 1
  SESSION_TOKEN=""
}

create_users () {
  disable_rate_limits 1 1
  q 'delete from person'
  ../util/create-user.sh user1 0 0
  ../util/create-user.sh user2 0 0
  ../util/create-user.sh user3 0 0
  ../util/create-user.sh user4 0 0
  ../util/create-user.sh user5 0 0
}

report_limit () {
  disable_rate_limits 1 1
  mock_ip 256.256.2.1
  assume_role user1
  user2uuid=$(get_uuid 'user2@example.com')
  disable_rate_limits 0 1

  echo Only the global rate limit should apply for regular skips
  c POST "/skip/by-uuid/${user2uuid}"
  c POST "/unskip/by-uuid/${user2uuid}"
  c POST "/skip/by-uuid/${user2uuid}"

  echo The stricter rate limit should apply for reports
    jc POST "/skip/by-uuid/${user2uuid}" -d '{ "report_reason": "smells bad" }'
     c POST "/unskip/by-uuid/${user2uuid}"
  ! jc POST "/skip/by-uuid/${user2uuid}" -d '{ "report_reason": "bad hair" }' || exit 1
}

search_limit_uncached () {
  echo Uncached search should be heavily rate-limited
  disable_rate_limits 1 1
  mock_ip 256.256.2.2
  assume_role user1
  disable_rate_limits 0 1

  for x in {1..15}
  do
    c GET '/search?n=1&o=0'
    sleep 0.1 # Avoid hitting the global rate limit
  done
  ! c GET '/search?n=1&o=0' || exit 1
}

search_limit_cached () {
  echo "Cached search shouldn't be heavily rate-limited"
  disable_rate_limits 1 1
  mock_ip 256.256.2.3
  assume_role user1
  disable_rate_limits 0 1

  c GET '/search?n=1&o=1'
  c GET '/search?n=1&o=1'
  c GET '/search?n=1&o=1'
}

search_limit_per_club () {
  echo "Rate limit should apply independently to clubs"
  disable_rate_limits 1 1
  mock_ip 256.256.2.4
  assume_role user1
  disable_rate_limits 0 1

  jc POST /join-club -d '{ "name": "Anime" }'
  jc POST /join-club -d '{ "name": "Manga" }'
  for x in {1..15}
  do
    c GET '/search?n=1&o=0&club=Anime'
    sleep 0.1 # Avoid hitting the global rate limit
  done
  ! c GET '/search?n=1&o=0&club=Anime' || exit 1
    c GET '/search?n=1&o=0&club=Manga'
}

search_limit_by_account () {
  echo Account-based rate limit should apply to search even if the IP address changes
  disable_rate_limits 1 1
  assume_role user3
  disable_rate_limits 0 0

  for x in {1..15}
  do
    mock_ip "256.256.1.${x}"
    c GET '/search?n=1&o=0'
    sleep 0.1 # Avoid hitting the global rate limit
  done
  ! c GET '/search?n=1&o=0' || exit 1

  echo "The IP-based rate limit doesn't apply to other accounts"
  assume_role user4
  c GET '/search?n=1&o=0'
}

verify_limit_by_account () {
  echo Account-based rate limit applies to /verify endpoint when IP changes
  disable_rate_limits 1 1
  assume_role user1
  disable_rate_limits 1 0
  true > ../../test/input/verification-mock-response-file

  for x in {1..8}
  do
    mock_ip "256.256.256.${x}"
    c POST /verify
    sleep 0.1 # Avoid hitting the global rate limit
  done
  ! c POST /verify || exit 1

  echo "The rate limit doesn't apply to other accounts"
  assume_role user5
  c POST /verify
}

otp_limit_by_ip
otp_limit_by_email
otp_limit_by_normalized_email
otp_limit_shared_with_resend
create_users
report_limit
search_limit_uncached
search_limit_cached
search_limit_per_club
search_limit_by_account
verify_limit_by_account
