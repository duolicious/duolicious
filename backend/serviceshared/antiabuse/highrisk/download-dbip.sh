#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

for kind in city asn
do
  [[ -f dbip-${kind}-lite.mmdb ]] && continue

  for months_ago in 0 1 2
  do
    month=$(date -u -d "$(date -u +%Y-%m-15) -${months_ago} month" +%Y-%m)
    url=https://download.db-ip.com/free/dbip-${kind}-lite-${month}.mmdb.gz

    if curl -fsSL "$url" | gunzip > dbip-${kind}-lite.mmdb.part
    then
      mv dbip-${kind}-lite.mmdb.part dbip-${kind}-lite.mmdb
      break
    fi
  done

  [[ -f dbip-${kind}-lite.mmdb ]]
done
