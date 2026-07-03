#!/usr/bin/env bash

set -ex

export DUO_STATUS_URL=${DUO_STATUS_URL:-https://status.duolicious.app}
export DUO_API_URL=${DUO_API_URL:-https://api.duolicious.app}
export DUO_CHAT_URL=${DUO_CHAT_URL:-wss://api.duolicious.app/chat}
export DUO_IMAGES_URL=${DUO_IMAGES_URL:-https://user-images.duolicious.app}
export DUO_AUDIO_URL=${DUO_AUDIO_URL:-https://user-audio.duolicious.app}
export DUO_INVITE_URL=${DUO_INVITE_URL:-https://duolicious.gg}
export DUO_PARTNER_URL=${DUO_AD_URL:-https://partner.duolicious.app}
export DUO_GOOGLE_ANDROID_CLIENT_ID=${DUO_GOOGLE_ANDROID_CLIENT_ID:-443037492722-p7h1kdi7ssk33b2n7d7reonnnv3gdtv1.apps.googleusercontent.com}

rm -rf android ios

EXPO_NO_GIT_STATUS=1 npx expo prebuild --clean

EAS_LOCAL_BUILD_SKIP_CLEANUP=1 eas build --platform android --local "$@"
