#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

reset_db () {
  q "delete from person"
  q "delete from person_club"
  q "delete from club"
  flush_redis
}

members () {
  c GET "/club-card?name=$1" | jq -c .members
}

everyone_sees_the_best_25_members () {
  echo 'Club cards list the best 25 visible members, whether or not you have joined'

  reset_db

  ../util/create-user.sh searcher 0 0
  for i in $(seq 1 26); do
    ../util/create-user.sh "member$i" 0 0
    assume_role "member$i"
    jc POST /join-club -d '{ "name": "chess" }'
  done

  assume_role searcher

  [[ "$(members chess | jq length)" == "25" ]]

  q "update person set hide_me_from_strangers = true where name in ('member1', 'member2')"

  [[ "$(members chess | jq length)" == "24" ]]

  jc POST /join-club -d '{ "name": "chess" }'

  local club_preference=$(q "select club_name from search_preference where person_id = (select id from person where name = 'searcher')")

  q "update person set hide_me_from_strangers = false"

  [[ "$(members chess | jq length)" == "25" ]]

  [[ "$(q "select club_name from search_preference where person_id = (select id from person where name = 'searcher')")" == "$club_preference" ]]
}

preferred_genders_come_first () {
  echo 'Club cards list members of the genders you search for first'

  reset_db

  ../util/create-user.sh searcher 0 0
  for i in $(seq 1 3); do
    ../util/create-user.sh "member$i" 0 0
    assume_role "member$i"
    jc POST /join-club -d '{ "name": "chess" }'
  done

  q "update person set gender_id = (select id from gender where name = 'Man') where name in ('member1', 'member3')"
  q "update person set gender_id = (select id from gender where name = 'Woman') where name = 'member2'"
  q "update search_preference set gender_ids = array[(select id from gender where name = 'Woman')] where person_id = (select id from person where name = 'searcher')"

  assume_role searcher

  [[ "$(members chess | jq -r '.[0].name')" == "member2" ]]
  [[ "$(members chess | jq length)" == "3" ]]
}

people_who_want_your_gender_come_next () {
  echo 'With two-way gender on, members who search for your gender come next'

  reset_db

  ../util/create-user.sh searcher 0 0
  for i in $(seq 1 3); do
    ../util/create-user.sh "member$i" 0 0
    assume_role "member$i"
    jc POST /join-club -d '{ "name": "chess" }'
  done

  q "update person set gender_id = (select id from gender where name = 'Man') where name = 'searcher'"
  q "update person set gender_id = (select id from gender where name = 'Woman') where name like 'member%'"
  q "update search_preference set gender_ids = array[(select id from gender where name = 'Woman')]"
  q "update search_preference set gender_ids = array[(select id from gender where name = 'Man')] where person_id = (select id from person where name = 'member2')"

  assume_role searcher

  q "update search_preference set two_way_gender = true where person_id = (select id from person where name = 'searcher')"
  [[ "$(members chess | jq -r '.[0].name')" == "member2" ]]

  q "update search_preference set two_way_gender = false where person_id = (select id from person where name = 'searcher')"
  [[ "$(members chess | jq length)" == "3" ]]
}

inactive_members_come_after_active_ones () {
  echo 'Members are ordered by gender, then whether they were online in the past month, then distance'

  reset_db

  ../util/create-user.sh searcher 0 0
  for i in $(seq 1 4); do
    ../util/create-user.sh "member$i" 0 0
    assume_role "member$i"
    jc POST /join-club -d '{ "name": "chess" }'
  done

  q "update person set gender_id = (select id from gender where name = 'Man') where name = 'searcher'"
  q "update person set gender_id = (select id from gender where name = 'Woman') where name like 'member%'"
  q "update search_preference set gender_ids = array[(select id from gender where name = 'Woman')] where person_id in (select id from person where name in ('searcher', 'member4'))"
  q "update search_preference set gender_ids = array[(select id from gender where name = 'Man')] where person_id in (select id from person where name in ('member1', 'member2', 'member3'))"

  q "update person set coordinates = 'POINT(0 0)' where name = 'searcher'"
  q "update person set coordinates = 'POINT(20 0)' where name = 'member1'"
  q "update person set coordinates = 'POINT(10 0)' where name = 'member2'"
  q "update person set coordinates = 'POINT(1 0)' where name in ('member3', 'member4')"
  q "update person set last_online_time = now() - interval '31 days' where name = 'member3'"

  assume_role searcher
  [[ "$(members chess | jq -c '[.[].name]')" == '["member2","member1","member3","member4"]' ]]
}

active_members_of_the_best_rank_fill_the_card () {
  echo '25 active members of the best rank leave no place for inactive ones'

  reset_db

  ../util/create-user.sh searcher 0 0
  for i in $(seq 1 26); do
    ../util/create-user.sh "member$i" 0 0
    assume_role "member$i"
    jc POST /join-club -d '{ "name": "chess" }'
  done

  q "update person set gender_id = (select id from gender where name = 'Man') where name = 'searcher'"
  q "update person set gender_id = (select id from gender where name = 'Woman') where name like 'member%'"
  q "update search_preference set gender_ids = array[(select id from gender where name = 'Woman')] where person_id = (select id from person where name = 'searcher')"
  q "update search_preference set gender_ids = array[(select id from gender where name = 'Man')] where person_id in (select id from person where name like 'member%')"

  q "update person set coordinates = 'POINT(0 0)' where name = 'searcher'"
  q "update person set coordinates = 'POINT(10 0)' where name like 'member%'"
  q "update person set coordinates = 'POINT(1 0)' where name = 'member1'"
  q "update person set coordinates = 'POINT(20 0)' where name = 'member2'"
  q "update person set last_online_time = now() - interval '31 days' where name = 'member1'"

  assume_role searcher
  local names=$(members chess | jq -c '[.[].name]')
  [[ "$(jq length <<< "$names")" == "25" ]]
  [[ "$(jq -r '.[-1]' <<< "$names")" == "member2" ]]
  [[ "$(jq 'index("member1")' <<< "$names")" == "null" ]]
}

club_card_shows_count_and_related_clubs () {
  echo 'A club card has a member count and related clubs, even for new clubs'

  reset_db

  ../util/create-user.sh user1 0 0

  q "insert into club (name, count_members, embedding) values
    ('knitting', 0, l2_normalize(array_fill(1, array[64])::vector(64))),
    ('crochet', 60, l2_normalize(array_fill(1, array[64])::vector(64))),
    ('weaving', 70, l2_normalize((array_fill(1, array[32]) || array_fill(-1, array[32]))::vector(64))),
    ('tiny', 3, l2_normalize(array_fill(1, array[64])::vector(64)))"

  assume_role user1

  result=$(c GET '/club-card?name=knitting')
  [[ "$(jq -r .count_members <<< "$result")" == "0" ]]
  [[ "$(jq -c '[.related_clubs[].name]' <<< "$result")" == '["crochet","weaving"]' ]]

  result=$(c GET '/club-card?name=leeds%20night%20swimmers')
  [[ "$(jq -cS . <<< "$result")" == '{"count_members":0,"members":[],"related_clubs":[]}' ]]

  ! c GET '/club-card?name=' || exit 1
}

suggested_clubs_are_popular_clubs_you_have_not_joined () {
  echo 'An empty club search suggests popular clubs you have not joined'

  reset_db

  ../util/create-user.sh user1 0 0

  q "insert into club (name, count_members) values
    ('crochet', 60), ('weaving', 900), ('quilting', 80), ('tiny', 3)"

  assume_role user1

  [[ "$(c GET '/search-clubs?q=' | jq -c '[.[].name]')" == '["weaving","quilting","crochet"]' ]]

  jc POST /join-club -d '{ "name": "crochet" }'

  [[ "$(c GET '/search-clubs?q=' | jq -c '[.[].name]')" == '["weaving","quilting"]' ]]
}

joining_or_leaving_returns_suggestions_from_ten_clubs () {
  echo 'Joining or leaving a club returns suggestions once you are in 10 clubs'

  reset_db

  ../util/create-user.sh user1 0 0

  q "insert into club (name, count_members) values ('weaving', 900)"

  assume_role user1

  for i in $(seq 1 9)
  do
    [[ "$(jc POST /join-club -d "{ \"name\": \"club$i\" }" | jq -c .)" == \
      '{"suggested_clubs":null}' ]]
  done

  [[ "$(jc POST /join-club -d '{ "name": "club10" }' | jq -c .)" == \
    '{"suggested_clubs":[{"count_members":900,"name":"weaving"}]}' ]]

  [[ "$(jc POST /leave-club -d '{ "name": "club10" }' | jq -c .)" == \
    '{"suggested_clubs":null}' ]]
}

everyone_sees_the_best_25_members
preferred_genders_come_first
people_who_want_your_gender_come_next
inactive_members_come_after_active_ones
active_members_of_the_best_rank_fill_the_card
club_card_shows_count_and_related_clubs
suggested_clubs_are_popular_clubs_you_have_not_joined
joining_or_leaving_returns_suggestions_from_ten_clubs
