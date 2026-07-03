#!/usr/bin/env bash

# Purpose: the chat WebSocket handler is now also served at `/chat` on the API
# service (so modern clients can use a single origin), alongside the standalone
# chat service at `ws://chat:5443` that older clients still connect to. This is a
# minimal smoke test that the handler is reachable via the API endpoint: connect
# to `ws://api:5000/chat` and confirm a `duo_ping` is answered with a `duo_pong`.
#
# Ping is handled before the authentication gate, so no user/session set-up is
# needed -- which keeps this test fast.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

# Point the JSON chat client at the API service's `/chat` endpoint rather than
# the standalone chat service.
curl -sX POST http://localhost:3001/config \
  -H "Content-Type: application/json" \
  -d '{ "server": "ws://api:5000/chat" }' > /dev/null

sleep 0.5

# Discard anything received on connect.
curl -sX GET http://localhost:3001/pop > /dev/null

curl -sX POST http://localhost:3001/send \
  -H "Content-Type: application/json" \
  -d '{ "duo_ping": null }' > /dev/null

sleep 0.5

curl -sX GET http://localhost:3001/pop | grep -q duo_pong
