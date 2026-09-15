#!/usr/bin/env bash

set -e

: "${DUO_REVENUECAT_API_KEY:?}" "${DUO_REVENUECAT_PROJECT_ID:?}"

api_url="https://api.revenuecat.com/v2/projects/$DUO_REVENUECAT_PROJECT_ID"

revenuecat () {
  curl -sf -X "$1" "$api_url$2" \
    -H "Authorization: Bearer $DUO_REVENUECAT_API_KEY" \
    -H 'Content-Type: application/json' \
    "${@:3}"
}

offering_id=$(revenuecat GET /offerings | jq -er '.items[] | select(.is_current) | .id')

package_id () {
  revenuecat GET "/offerings/$offering_id/packages" \
    | jq -er --arg key "$1" '.items[] | select(.lookup_key == $key) | .id' \
  || revenuecat POST "/offerings/$offering_id/packages" \
    -d "$(jq -n --arg key "$1" --arg name "$2" '{ lookup_key: $key, display_name: $name }')" \
    | jq -r '.id'
}

attach_product () {
  app_id=$(revenuecat GET /apps | jq -er --arg type "$2" '.items[] | select(.type == $type) | .id')

  product_id=$(
    revenuecat POST /products -d "$(
      jq -n --arg app_id "$app_id" --arg store_identifier "$3" --arg name "$4" \
        '{ app_id: $app_id, store_identifier: $store_identifier, type: "subscription", display_name: $name }'
    )" | jq -r '.id'
  )

  revenuecat POST "/packages/$1/actions/attach_products" -d "$(
    jq -n --arg product_id "$product_id" \
      '{ products: [{ product_id: $product_id, eligibility_criteria: "all" }] }'
  )" > /dev/null

  echo "Attached $3 ($2) to $5 as product $product_id"
}

for cycle in WEEKLY MONTHLY THREE_MONTH
do
  lookup_key='$rc_'"$(tr A-Z a-z <<< "$cycle")"
  package=$(package_id "$lookup_key" "Gold $(tr 'A-Z_' 'a-z ' <<< "$cycle")")

  for store in APP_STORE PLAY_STORE
  do
    store_identifier="${store}_${cycle}"

    if [[ -n "${!store_identifier}" ]]
    then
      attach_product "$package" "$(tr A-Z a-z <<< "$store")" "${!store_identifier}" "Gold $(tr 'A-Z_' 'a-z ' <<< "$cycle")" "$lookup_key"
    fi
  done
done
