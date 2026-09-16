#!/usr/bin/env bash

set -eo pipefail

usage () {
  cat >&2 <<'USAGE'
Makes sure the current RevenueCat offering has the $rc_weekly, $rc_monthly and
$rc_three_month packages the mobile apps sell Gold through, and attaches the
store products you name to them. Prices live in the stores. Safe to rerun.

Required:
  DUO_REVENUECAT_API_KEY     A RevenueCat v2 secret key with write access to
                             project configuration

Optional:
  DUO_REVENUECAT_PROJECT_ID  Only needed when the key can see several projects
  APP_STORE_WEEKLY           App Store Connect product IDs to attach
  APP_STORE_MONTHLY
  APP_STORE_THREE_MONTH
  PLAY_STORE_WEEKLY          Play Console products as productId:basePlanId
  PLAY_STORE_MONTHLY
  PLAY_STORE_THREE_MONTH

Leave a store variable unset to skip that product, e.g. when the existing
weekly product has merely had its store price changed. RevenueCat's API can't
create Web Billing products, so those stay in the dashboard.
USAGE
  exit 1
}

[[ -n "$DUO_REVENUECAT_API_KEY" ]] || usage

request () {
  local body
  body=$(curl -s --fail-with-body "$@") || { echo "$body" >&2; return 1; }
  echo "$body"
}

revenuecat () {
  request -X "$1" "https://api.revenuecat.com/v2$2" \
    -H "Authorization: Bearer $DUO_REVENUECAT_API_KEY" \
    -H 'Content-Type: application/json' \
    "${@:3}"
}

only_project () {
  local projects
  projects=$(revenuecat GET /projects | jq -c '[.items[] | {id, name}]')

  case $(jq length <<< "$projects") in
    1) jq -er '.[0].id' <<< "$projects" ;;
    *) echo "Set DUO_REVENUECAT_PROJECT_ID to one of $projects" >&2; return 1 ;;
  esac
}

project="/projects/${DUO_REVENUECAT_PROJECT_ID:-$(only_project)}"

offering_id=$(
  revenuecat GET "$project/offerings" \
    | jq -er '.items[] | select(.is_current) | .id'
)

apps=$(revenuecat GET "$project/apps")

package_id () {
  local existing
  existing=$(
    revenuecat GET "$project/offerings/$offering_id/packages" \
      | jq -r --arg key "$1" '.items[] | select(.lookup_key == $key) | .id'
  )
  [[ -n "$existing" ]] && echo "$existing" && return

  revenuecat POST "$project/offerings/$offering_id/packages" -d "$(
    jq -n --arg key "$1" --arg name "$2" '{ lookup_key: $key, display_name: $name }'
  )" | jq -er '.id'
}

product_id () {
  local existing
  existing=$(
    revenuecat GET "$project/products" \
      | jq -r --arg app_id "$1" --arg store_identifier "$2" \
        '.items[] | select(.app_id == $app_id and .store_identifier == $store_identifier) | .id'
  )
  [[ -n "$existing" ]] && echo "$existing" && return

  revenuecat POST "$project/products" -d "$(
    jq -n --arg app_id "$1" --arg store_identifier "$2" --arg name "$3" \
      '{ app_id: $app_id, store_identifier: $store_identifier, type: "subscription", display_name: $name }'
  )" | jq -er '.id'
}

for cycle in WEEKLY MONTHLY THREE_MONTH
do
  name="Gold $(tr 'A-Z_' 'a-z ' <<< "$cycle")"
  package=$(package_id '$rc_'"$(tr A-Z a-z <<< "$cycle")" "$name")

  for store in APP_STORE PLAY_STORE
  do
    store_identifier="${store}_${cycle}"
    [[ -n "${!store_identifier}" ]] || continue

    app_id=$(
      jq -er --arg type "$(tr A-Z a-z <<< "$store")" \
        '.items[] | select(.type == $type) | .id' <<< "$apps"
    )
    product=$(product_id "$app_id" "${!store_identifier}" "$name")

    revenuecat POST "$project/packages/$package/actions/attach_products" -d "$(
      jq -n --arg product_id "$product" \
        '{ products: [{ product_id: $product_id, eligibility_criteria: "all" }] }'
    )" > /dev/null

    echo "Attached ${!store_identifier} to $name as product $product"
  done
done
