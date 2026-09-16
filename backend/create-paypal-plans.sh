#!/usr/bin/env bash

set -eo pipefail

usage () {
  cat >&2 <<'USAGE'
Creates the weekly, monthly and three-monthly Gold plans on PayPal and prints
the DUO_PAYPAL_PLAN_IDS line to set on the api container.

Required, and they must be the api container's own values, since PayPal only
lets the app that created a plan use it:
  DUO_PAYPAL_CLIENT_ID      The PayPal REST app's client ID
  DUO_PAYPAL_CLIENT_SECRET  The PayPal REST app's secret

Optional:
  DUO_PAYPAL_API_URL        https://api-m.sandbox.paypal.com to use the sandbox
                            (default: live)
  DUO_PAYPAL_PRODUCT_ID     The PayPal product to attach the plans to. Only
                            needed when the app has several products; its
                            only product is used, or one is created if none.
USAGE
  exit 1
}

[[ -n "$DUO_PAYPAL_CLIENT_ID" && -n "$DUO_PAYPAL_CLIENT_SECRET" ]] || usage

api_url="${DUO_PAYPAL_API_URL:-https://api-m.paypal.com}"

request () {
  local body
  body=$(curl -s --fail-with-body "$@") || { echo "$body" >&2; return 1; }
  echo "$body"
}

access_token=$(
  request -X POST "$api_url/v1/oauth2/token" \
    -u "$DUO_PAYPAL_CLIENT_ID:$DUO_PAYPAL_CLIENT_SECRET" \
    -d grant_type=client_credentials \
    | jq -er '.access_token'
)

paypal () {
  request -X "$1" "$api_url$2" \
    -H "Authorization: Bearer $access_token" \
    -H 'Content-Type: application/json' \
    "${@:3}"
}

find_or_create_product () {
  local products
  products=$(paypal GET '/v1/catalogs/products?page_size=20' | jq -c '[.products[]? | {id, name}]')

  case $(jq length <<< "$products") in
    0) paypal POST /v1/catalogs/products -d '{ "name": "Gold", "type": "SERVICE" }' | jq -er '.id' ;;
    1) jq -er '.[0].id' <<< "$products" ;;
    *) echo "Set DUO_PAYPAL_PRODUCT_ID to one of $products" >&2; return 1 ;;
  esac
}

product_id="${DUO_PAYPAL_PRODUCT_ID:-$(find_or_create_product)}"

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
  )" | jq -er '.id'
}

weekly=$(create_plan WEEK 1 4.99)
monthly=$(create_plan MONTH 1 5.99)
three_monthly=$(create_plan MONTH 3 15.99)

echo "DUO_PAYPAL_PLAN_IDS=$weekly,$monthly,$three_monthly"
