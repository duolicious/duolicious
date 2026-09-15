#!/usr/bin/env bash

set -e

: "${DUO_PAYPAL_CLIENT_ID:?}" "${DUO_PAYPAL_CLIENT_SECRET:?}"

api_url="${DUO_PAYPAL_API_URL:-https://api-m.paypal.com}"

access_token=$(
  curl -sf -X POST "$api_url/v1/oauth2/token" \
    -u "$DUO_PAYPAL_CLIENT_ID:$DUO_PAYPAL_CLIENT_SECRET" \
    -d grant_type=client_credentials \
    | jq -r '.access_token'
)

paypal () {
  curl -sf -X "$1" "$api_url$2" \
    -H "Authorization: Bearer $access_token" \
    -H 'Content-Type: application/json' \
    "${@:3}"
}

product_id="${DUO_PAYPAL_PRODUCT_ID:-$(
  paypal GET "/v1/billing/plans/${DUO_PAYPAL_PLAN_ID:?Set DUO_PAYPAL_PRODUCT_ID or the DUO_PAYPAL_PLAN_ID of an existing plan}" \
    | jq -r '.product_id'
)}"

create_plan () {
  paypal POST /v1/billing/plans -d "$(
    jq -n --arg product_id "$product_id" --arg unit "$1" --argjson count "$2" --arg price "$3" '{
      product_id: $product_id,
      name: "Gold",
      description: "Billed every \($count) \($unit | ascii_downcase)s",
      status: "ACTIVE",
      billing_cycles: [{
        sequence: 1,
        tenure_type: "REGULAR",
        total_cycles: 0,
        frequency: { interval_unit: $unit, interval_count: $count },
        pricing_scheme: { fixed_price: { value: $price, currency_code: "USD" } }
      }],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 }
    }'
  )" | jq -r '.id'
}

echo "DUO_PAYPAL_PLAN_IDS=$(create_plan WEEK 1 1.99),$(create_plan MONTH 1 3.99),$(create_plan MONTH 3 9.99)"
