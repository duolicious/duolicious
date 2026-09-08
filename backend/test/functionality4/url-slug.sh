#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from duo_session"
q "delete from person"
q "delete from onboardee"

# Begin onboarding for the given email and set the display name, leaving the
# session authenticated mid-onboarding. Sets two globals (not stdout, so it must
# be called directly rather than in $(...), whose subshell would discard the
# session): SESSION_TOKEN and PREVIEW (the name PATCH's {url_slug, is_random}).
start_onboarding () {
  local email=$1
  local name=$2

  local response=$(jc POST /request-otp -d '{ "email": "'"$email"'" }')
  SESSION_TOKEN=$(echo "$response" | jq -r '.session_token')

  jc POST /check-otp -d '{ "otp": "000000" }' > /dev/null
  PREVIEW=$(jc PATCH /onboardee-info -d '{ "name": "'"$name"'" }')
}

# Finish onboarding for the current session (name already set), printing the
# finish-onboarding response.
finish_onboarding () {
  jc PATCH /onboardee-info -d '{ "date_of_birth": "1997-05-30" }' > /dev/null
  jc PATCH /onboardee-info -d '{ "location": "New York, New York, United States" }' > /dev/null
  jc PATCH /onboardee-info -d '{ "gender": "Other" }' > /dev/null
  jc PATCH /onboardee-info -d '{ "other_peoples_genders": ["Man", "Woman"] }' > /dev/null
  c POST /finish-onboarding
}

# Onboard a user with an explicit email and display name (create-user.sh derives
# the name from the username, so it can't produce a deliberate collision).
onboard () {
  start_onboarding "$1" "$2"
  finish_onboarding > /dev/null
}

# --- Onboardee preview: a free name previews the bare slug -------------------
start_onboarding preview@example.com "Zelda"
[[ "$(jq -r .url_slug  <<< "$PREVIEW")" = zelda ]]
[[ "$(jq -r .is_random <<< "$PREVIEW")" = false ]]

# --- First user gets the bare slug -------------------------------------------
onboard alice@example.com "Alice"
[[ "$(q "select url_slug from person where email='alice@example.com'")" = alice ]]

# --- A second distinct name gets its own bare slug ---------------------------
onboard bob@example.com "Bob"
[[ "$(q "select url_slug from person where email='bob@example.com'")" = bob ]]

# --- Spaces become underscores (spec step 2), other junk is stripped ---------
onboard spaced@example.com "John   Smith!"
[[ "$(q "select url_slug from person where email='spaced@example.com'")" = john___smith ]]

# --- Collision: a second "Alice" gets a random numeric suffix ----------------
onboard alice2@example.com "Alice"
slug2=$(q "select url_slug from person where email='alice2@example.com'")
[[ "$slug2" =~ ^alice[0-9]+$ ]]

# --- Onboardee preview of a taken name is carried through verbatim -----------
# The previewed (suffixed) slug must be exactly what finish-onboarding mints,
# not a freshly-rolled random number.
start_onboarding preview2@example.com "Alice"
[[ "$(jq -r .is_random <<< "$PREVIEW")" = true ]]
previewed_slug=$(jq -r .url_slug <<< "$PREVIEW")
[[ "$previewed_slug" =~ ^alice[0-9]+$ ]]

finish=$(finish_onboarding)
[[ "$(jq -r .url_slug <<< "$finish")" = "$previewed_slug" ]]
[[ "$(q "select url_slug from person where email='preview2@example.com'")" = "$previewed_slug" ]]

# --- A reserved slug can't be stolen out from under an in-flight onboardee ---
# X reserves the bare slug "mallory" (free when previewed)...
start_onboarding mallory-x@example.com "Mallory"
[[ "$(jq -r .url_slug <<< "$PREVIEW")" = mallory ]]
session_x=$SESSION_TOKEN

# ...so Y, previewing the same name, is bumped onto a suffixed slug...
start_onboarding mallory-y@example.com "Mallory"
[[ "$(jq -r .url_slug <<< "$PREVIEW")" =~ ^mallory[0-9]+$ ]]

# ...and X still gets the bare slug when they finish.
SESSION_TOKEN=$session_x
finish_x=$(finish_onboarding)
[[ "$(jq -r .url_slug <<< "$finish_x")" = mallory ]]

# --- Emoji-only name → numeric-only random slug ------------------------------
onboard emoji@example.com "🎉🎉"
slug_emoji=$(q "select url_slug from person where email='emoji@example.com'")
[[ "$slug_emoji" =~ ^[0-9]+$ ]]

# --- Reserved words are never minted bare ------------------------------------
# (profiles live at the top level, so a slug must not shadow an app route)
onboard settings@example.com "settings"
slug_settings=$(q "select url_slug from person where email='settings@example.com'")
[[ "$slug_settings" =~ ^settings[0-9]+$ ]]

onboard feed@example.com "Feed"
slug_feed=$(q "select url_slug from person where email='feed@example.com'")
[[ "$slug_feed" =~ ^feed[0-9]+$ ]]

# The Google OAuth redirect path (`app.duolicious:/oauthredirect`) reaches the
# Android app as a deep link, so it's reserved too — a bare "oauthredirect" slug
# would be shadowed by it.
onboard oauthredirect@example.com "oauthredirect"
slug_oauthredirect=$(q "select url_slug from person where email='oauthredirect@example.com'")
[[ "$slug_oauthredirect" =~ ^oauthredirect[0-9]+$ ]]

# --- Lookup resolves by slug and by uuid -------------------------------------
alice_uuid=$(q "select uuid from person where email='alice@example.com'")
alice_id=$(q "select id from person where email='alice@example.com'")
q "update person set privacy_verification_level_id = 1"

assume_role alice

[[ "$(c GET /prospect-profile/alice           | jq -r .person_id)" = "$alice_id" ]]
[[ "$(c GET "/prospect-profile/$alice_uuid"   | jq -r .person_id)" = "$alice_id" ]]
[[ "$(c GET /prospect-profile/alice           | jq -r .url_slug)"  = alice ]]

# Slugs are lower-case only: a mixed-case slug must NOT resolve (it would only
# match as a uuid, which "ALICE" isn't), so the lookup 404s.
! c GET /prospect-profile/ALICE > /dev/null

# --- /profile-info exposes the viewer's own slug -----------------------------
[[ "$(c GET /profile-info | jq -r .url_slug)" = alice ]]

# --- Name change (gold) regenerates the slug and reports is_random -----------
q "update person set has_gold = true where email='bob@example.com'"
assume_role bob

# A free name → bare slug, not random.
resp=$(jc PATCH /profile-info -d '{ "name": "Carol" }')
[[ "$(jq -r .url_slug  <<< "$resp")" = carol ]]
[[ "$(jq -r .is_random <<< "$resp")" = false ]]

# Re-saving the same name keeps the slug: the person's own row must not be
# mistaken for a collision and bump the suffix.
resp=$(jc PATCH /profile-info -d '{ "name": "Carol" }')
[[ "$(jq -r .url_slug  <<< "$resp")" = carol ]]
[[ "$(jq -r .is_random <<< "$resp")" = false ]]

# A taken name (Alice is held by alice@example.com) → random suffix.
resp=$(jc PATCH /profile-info -d '{ "name": "Alice" }')
renamed_slug=$(jq -r .url_slug <<< "$resp")
[[ "$(jq -r .is_random <<< "$resp")" = true ]]
[[ "$renamed_slug" =~ ^alice[0-9]+$ ]]

# The original uuid URL still resolves after the rename.
[[ "$(c GET "/prospect-profile/$alice_uuid" | jq -r .person_id)" = "$alice_id" ]]

# --- A name that *is* a UUID can't shadow that uuid's owner -------------------
# slug_base leaves a uuid string intact, so without a guard the slug would equal
# alice's uuid and /prospect-profile/<alice_uuid> would match two rows.
onboard uuidname@example.com "$alice_uuid"
slug_uuid=$(q "select url_slug from person where email='uuidname@example.com'")
# Minted with a numeric suffix, so it's no longer uuid-shaped.
[[ "$slug_uuid" =~ ^${alice_uuid}[0-9]+$ ]]
# alice's canonical uuid URL still resolves to alice, not the impersonator.
[[ "$(c GET "/prospect-profile/$alice_uuid" | jq -r .person_id)" = "$alice_id" ]]
