#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

set_paypal_mock_subscription () {
  curl -s -X POST "http://localhost:3004/control/subscriptions/$1" \
    -H 'Content-Type: application/json' \
    -d "$2" > /dev/null
}

paypal_mock_resource () {
  curl -s -H 'Authorization: Bearer mock-access-token' \
    "http://localhost:3004/v1/billing/subscriptions/$1"
}

paypal_mock_status () {
  paypal_mock_resource "$1" | jq -r '.status'
}

setup () {
  curl -s -X DELETE 'http://localhost:3004/control' > /dev/null

  q "delete from person"
  q "delete from club"

  ../util/create-user.sh user1 0 0
  ../util/create-user.sh user2 0 0

  set_gold false "true"

  assume_role user1
}

return_location () {
  curl -s -o /dev/null -w '%{redirect_url}' "$1"
}

user_has_gold () {
  has_gold "email = '$1@example.com'"
}

subscription () {
  q "select $1 from gold_subscription where provider = 'paypal'"
}

profile_paypal () {
  c GET /profile-info | jq -c '.paypal_subscription'
}

post_webhook () {
  SESSION_TOKEN="" c POST /paypal/webhook \
    --header "Content-Type: application/json" \
    --header "PAYPAL-AUTH-ALGO: SHA256withRSA" \
    --header "PAYPAL-CERT-URL: https://api.paypal.com/cert" \
    --header "PAYPAL-TRANSMISSION-ID: tx-1" \
    --header "PAYPAL-TRANSMISSION-SIG: ${PAYPAL_SIG-sig}" \
    --header "PAYPAL-TRANSMISSION-TIME: 2026-01-01T00:00:00Z" \
    -d '{ "event_type": "'"$1"'", "resource": '"$2"' }'
}

post_subscription_webhook () {
  post_webhook "$1" "$(paypal_mock_resource "$2")"
}

subscribe () {
  approve_url=$(
    jc POST /paypal/subscribe -d '{ "redirect_target": "'"$1"'" }' \
      | jq -r '.approve_url'
  )

  subscription_id=$(sed 's/.*subscription_id=//' <<< "$approve_url")

  return_url=$(return_location "$approve_url")
}

subscribe_and_approve () {
  subscribe web
  return_location "$return_url" > /dev/null
}

approve_flow_grants_gold () {
  echo 'The plan endpoint exposes the offering'

  setup

  [[ "$(c GET /paypal/plan | jq -cS .)" == '{"currency":"USD","cycle":{"unit":"month","units":1},"description":"Dark mode, custom themes and more","price":"4.99","product_name":"Gold","trial":{"unit":"day","units":7}}' ]]

  echo 'Pressing cancel on the PayPal page returns without gold'

  subscribe web

  for query in "?subscription_id=$subscription_id" ''
  do
    [[ "$(return_location "http://localhost:5000/paypal/return/web$query")" == 'http://test-web.example/?paypal=cancelled' ]]
  done

  [[ "$(user_has_gold user1)" == f ]]
  [[ "$(subscription 'count(*)')" == "0" ]]

  echo 'Approving a PayPal subscription grants gold and returns to the host that started it'

  subscribe apex

  [[ "$(return_location "$return_url")" == 'http://test-apex.example/?paypal=subscribed' ]]

  [[ "$(user_has_gold user1)" == t ]]
  [[ "$(user_has_gold user2)" == f ]]
  [[ "$(subscription 'count(*)')" == "1" ]]
  [[ "$(subscription expires_at)" == "infinity" ]]

  echo 'Subscribing again while gold is refused'

  ! jc POST /paypal/subscribe -d '{ "redirect_target": "web" }' || exit 1
}

cancellation_keeps_gold_until_paid_through () {
  echo 'A person without a PayPal subscription cannot cancel'

  setup

  [[ "$(profile_paypal)" == 'null' ]]

  ! jc POST /paypal/cancel || exit 1

  echo 'A verified webhook applies the subscription it carries'

  subscribe_and_approve

  set_paypal_mock_subscription "$subscription_id" '{ "status": "CANCELLED" }'

  [[ "$(post_subscription_webhook BILLING.SUBSCRIPTION.CANCELLED "$subscription_id" | jq -r '.ignored')" == 'false' ]]

  echo 'A subscription cancelled during its trial keeps gold until the trial ends'

  [[ "$(user_has_gold user1)" == t ]]
  [[ "$(subscription expires_at)" == "$(q "select ('$(paypal_mock_resource "$subscription_id" | jq -r '.start_time')'::timestamptz at time zone 'utc' + interval '7 days')::timestamp")" ]]

  echo 'A re-activation webhook restores the unbounded expiry'

  set_paypal_mock_subscription "$subscription_id" '{ "status": "ACTIVE" }'

  [[ "$(post_subscription_webhook BILLING.SUBSCRIPTION.RE-ACTIVATED "$subscription_id" | jq -r '.ignored')" == 'false' ]]
  [[ "$(subscription expires_at)" == "infinity" ]]

  echo 'Cancelling in the app keeps gold for a billing cycle after the last payment'

  [[ "$(profile_paypal | jq -r '.can_cancel')" == 'true' ]]

  set_paypal_mock_subscription "$subscription_id" '{ "last_payment_time": "2099-01-31T00:00:00Z" }'

  jc POST /paypal/cancel

  [[ "$(user_has_gold user1)" == t ]]
  [[ "$(subscription expires_at)" == "2099-02-28 00:00:00" ]]
  [[ "$(paypal_mock_status "$subscription_id")" == 'CANCELLED' ]]
  [[ "$(profile_paypal | jq -r '.can_cancel')" == 'false' ]]
  [[ "$(profile_paypal | jq -r '.paid_until')" == "$(q "select iso8601_utc('2099-02-28'::timestamp)")" ]]

  echo 'An activation webhook grants gold even if the return never arrives'

  set_paypal_mock_subscription I-HOOK \
    '{ "custom_id": "'"$(get_uuid 'user2@example.com')"'" }'

  post_subscription_webhook BILLING.SUBSCRIPTION.ACTIVATED I-HOOK > /dev/null

  [[ "$(user_has_gold user2)" == t ]]

  echo 'Unverified, malformed and unknown-status webhooks change nothing'

  set_paypal_mock_subscription "$subscription_id" '{ "status": "ACTIVE" }'

  ! PAYPAL_SIG=invalid post_subscription_webhook BILLING.SUBSCRIPTION.RE-ACTIVATED "$subscription_id" || exit 1

  ! PAYPAL_SIG= post_subscription_webhook BILLING.SUBSCRIPTION.RE-ACTIVATED "$subscription_id" || exit 1

  ! post_webhook CHECKOUT.ORDER.APPROVED '{ "id": "x" }' || exit 1

  set_paypal_mock_subscription "$subscription_id" '{ "status": "PAUSED" }'

  ! post_subscription_webhook BILLING.SUBSCRIPTION.UPDATED "$subscription_id" || exit 1

  set_paypal_mock_subscription I-PENDING \
    '{ "status": "APPROVAL_PENDING", "custom_id": "'"$(get_uuid 'user2@example.com')"'" }'

  [[ "$(post_subscription_webhook BILLING.SUBSCRIPTION.CREATED I-PENDING | jq -r '.ignored')" == 'true' ]]

  [[ "$(q "select expires_at from gold_subscription where person_id = (select id from person where email = 'user1@example.com')")" == "2099-02-28 00:00:00" ]]
  [[ "$(subscription 'count(*)')" == "2" ]]
}

expiry_revokes_gold_and_frees_the_person () {
  echo 'The cron revokes gold once the paid period ends'

  setup

  subscribe_and_approve

  jc PATCH /profile-info -d '{ "browse_invisibly": "Yes" }'

  set_paypal_mock_subscription "$subscription_id" '{ "status": "SUSPENDED", "last_payment_time": "2000-01-01T00:00:00Z" }'

  post_subscription_webhook BILLING.SUBSCRIPTION.SUSPENDED "$subscription_id" > /dev/null

  assert_eventually f user_has_gold user1
  assert_eventually 0 subscription 'count(*)'

  [[ "$(q "select browse_invisibly from person where email = 'user1@example.com'")" == f ]]

  echo 'A lapsed subscription no longer blocks a new one'

  subscribe_and_approve

  [[ "$(user_has_gold user1)" == t ]]
}

deleting_an_account_cancels_at_paypal () {
  echo 'An approved subscription whose first payment is still settling stores nothing'

  setup

  subscribe web

  set_paypal_mock_subscription "$subscription_id" '{ "status": "APPROVED" }'

  [[ "$(return_location "$return_url")" == 'http://test-web.example/?paypal=pending' ]]
  [[ "$(user_has_gold user1)" == f ]]
  [[ "$(subscription 'count(*)')" == "0" ]]

  echo 'If the account is deleted before it activates, activation cancels it'

  c DELETE /account

  set_paypal_mock_subscription "$subscription_id" '{ "status": "ACTIVE" }'

  [[ "$(post_subscription_webhook BILLING.SUBSCRIPTION.ACTIVATED "$subscription_id" | jq -r '.ignored')" == 'true' ]]
  [[ "$(paypal_mock_status "$subscription_id")" == 'CANCELLED' ]]
  [[ "$(subscription 'count(*)')" == "0" ]]

  echo 'Deleting an account cancels its live subscription at PayPal'

  assume_role user2

  subscribe_and_approve

  c DELETE /account

  [[ "$(subscription 'count(*)')" == "0" ]]
  [[ "$(paypal_mock_status "$subscription_id")" == 'CANCELLED' ]]

  echo 'A subscription PayPal already stopped does not block deletion'

  ../util/create-user.sh user3 0 0
  set_gold false "true"
  assume_role user3

  subscribe_and_approve

  set_paypal_mock_subscription "$subscription_id" '{ "status": "EXPIRED" }'

  c DELETE /account

  [[ "$(q "select count(*) from person where email = 'user3@example.com'")" == "0" ]]
}

clean_up () {
  q "select setval(pg_get_serial_sequence('person','id'), 1, true)"
}

approve_flow_grants_gold
cancellation_keeps_gold_until_paid_through
expiry_revokes_gold_and_frees_the_person
deleting_an_account_cancels_at_paypal

clean_up
