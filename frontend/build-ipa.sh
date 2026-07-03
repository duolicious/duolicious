#!/usr/bin/env bash

set -ex

export DUO_STATUS_URL=${DUO_STATUS_URL:-https://status.duolicious.app}
export DUO_API_URL=${DUO_API_URL:-https://api.duolicious.app}
export DUO_CHAT_URL=${DUO_CHAT_URL:-wss://api.duolicious.app/chat}
export DUO_IMAGES_URL=${DUO_IMAGES_URL:-https://user-images.duolicious.app}
export DUO_AUDIO_URL=${DUO_AUDIO_URL:-https://user-audio.duolicious.app}
export DUO_PARTNER_URL=${DUO_PARTNER_URL:-https://partner.duolicious.app}
export DUO_GOOGLE_IOS_CLIENT_ID=${DUO_GOOGLE_IOS_CLIENT_ID:-443037492722-dfm47adn6tji055au1pftg782ue94oaq.apps.googleusercontent.com}

rm -rf android ios

EXPO_NO_GIT_STATUS=1 npx expo prebuild --clean

cat <<EOF >> ios/.xcode.env.local
export DUO_STATUS_URL=${DUO_STATUS_URL}
export DUO_API_URL=${DUO_API_URL}
export DUO_CHAT_URL=${DUO_CHAT_URL}
export DUO_IMAGES_URL=${DUO_IMAGES_URL}
export DUO_AUDIO_URL=${DUO_AUDIO_URL}
export DUO_PARTNER_URL=${DUO_PARTNER_URL}
export DUO_GOOGLE_IOS_CLIENT_ID=${DUO_GOOGLE_IOS_CLIENT_ID}
EOF


EAS_LOCAL_BUILD_SKIP_CLEANUP=1 eas build --platform ios --local "$@"
