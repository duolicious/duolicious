# Notifications

When a user has an unread intro or chat, or somebody has visited their profile,
Duolicious notifies them — by push notification to their phone, or by email as a
fallback.

## When a user is notified

If the user has opted into immediate notifications (for intros and/or chats),
the push is sent the moment a qualifying message arrives.

Otherwise, the user is notified once **all** of these hold:

- the message was sent more than 10 minutes ago,
- the user hasn't been online in the last 10 minutes (if they're online they'd
  see the message themselves),
- the message arrived after the user was last online,
- they haven't already been notified about it, and
- the message is less than 10 days old.

Each user also chooses, separately for intros, chats and visitors, how often
they're willing to be notified: immediately, daily, every 3 days, weekly, or
never. A notification only goes out once that much time has elapsed since the
last one for that type — and "never" means none at all.

## Visitors

Visits are notified about under exactly the rules above, reading the newest
visit a person received in place of the newest message they were sent. Two kinds
of visit are skipped, because neither one appears in the visitors tab and a
notification the user can't act on is worse than none: visits made while
browsing invisibly, and visits by somebody deactivated or shadow banned.

Visitors default to **weekly**, which is deliberately the quietest default of
the three: a profile can be visited far more often than it's messaged. There is
no immediate path for visits either — even "immediately" waits for the periodic
check below, so a visit is never pushed while the visitor is still reading.

Visits are never folded into a message notification. Somebody who was visited
and then messaged gets **two** notifications: one headed "you have a new
message", which opens the inbox, and one headed "someone visited your profile",
which opens the visitors tab. Neither has to share a headline or a destination
with the other, and each is governed by its own frequency setting, so silencing
one leaves the other alone.

## Web push (online users only)

The web app can't rely on its own JavaScript to raise notifications: a
backgrounded browser tab is throttled, so the in-page chat WebSocket can't show
a message promptly (they'd all arrive at once when the tab is refocused).
Instead, the server sends a real **Web Push** (VAPID / RFC 8291), which the
browser's push service delivers to a service worker even while the tab is
throttled or closed.

Web push is deliberately **online-only**: a push is sent to a web session's
subscription only while that user has a connected client (the same
`redis_has_subscribers` check the badge logic uses). An offline web user is left
to the email fallback below — we don't trust web push for offline delivery.

Two consequences of "online-only" fall out of this:

- It sends for **every** received message to a connected web user, regardless of
  their notification-frequency setting — it's the server-side replacement for
  the old in-page notification, not part of the frequency-governed push/email
  system. The service worker suppresses it when a tab is focused, so an actively
  viewed conversation stays quiet.
- It records **nothing** — not the last-notification time, not the unseen badge.
  Because it only fires for online users and the cron only ever emails offline
  users, the two never overlap, and skipping the bookkeeping ensures a web push
  never suppresses the email a user should get once they go offline.

### VAPID keys

Web push needs a VAPID keypair. The backend signs with
`DUO_VAPID_PRIVATE_KEY` (base64url-encoded raw P-256 private key) and
`DUO_VAPID_SUBJECT` (a `mailto:` contact — the `mailto:` prefix is optional and
stripped); the frontend subscribes with the
matching public key in `DUO_WEB_PUSH_VAPID_PUBLIC_KEY`. When the private key is
unset the backend sends no web push, and when the public key is unset the
frontend never subscribes, so the feature is simply off. Generate a matching
pair with `./generate-vapid-keys.sh` (it installs its own dependencies into a
venv on first run), which prints both variables ready to paste into your env:

```
$ ./generate-vapid-keys.sh
DUO_VAPID_PRIVATE_KEY=...
DUO_WEB_PUSH_VAPID_PUBLIC_KEY=...
```

A subscription the push service reports as gone (HTTP 404/410) is cleared from
its `duo_session` row automatically, so dead subscriptions self-heal.

## Which channel

The channel above (mobile push vs. email) is unchanged by web push, which is a
separate, online-only path. The channel depends on where the user was last
active:

- **Mobile** — push to each of their signed-in phones.
- **Web, more recently than any phone** — email as well, even if they have the
  app, since they're unlikely to be watching their phone.
- **No device that can receive a push** (web only, or signed out everywhere) —
  email.
- **Last online more than 8 days ago** — push *and* email; the push token may be
  stale and fail to reach them, so the email is sent as a backstop.

A device that has been signed out is never pushed to.

## Immediate vs. delayed

Immediate notifications are pushed the instant a qualifying message arrives.
Everything else — every other frequency, every visitor notification, the email
fallback, and anyone an immediate push couldn't reach — is handled by a periodic
check that applies all the rules above.

## The app-icon badge

The iOS app icon shows how many notifications were sent since the user last
had the app open, to nudge them into opening it. It's a rough count of
notifications, not unread messages.

The server keeps the count in `person.unseen_notification_count` and stamps it
into every push as an absolute badge value, so all of a user's devices
converge on the same number:

- A push sent while the user has **no connected chat clients** increments the
  count once per notification (not per device) and carries it as the badge, so a
  user due both a message and a visitor notification counts twice. This holds
  for every push the server sends — live chat messages and the periodic check
  alike.
- A push sent while **any client is connected** carries no badge — the user
  can see the message themselves — which leaves each device's badge untouched.
  Pushes from the periodic check always badge, since it only notifies users
  who haven't been online for 10 minutes.
- Connecting any client — web or mobile — zeroes the count. The opened device
  also clears its own badge locally right away; other devices keep a stale
  badge until their next push corrects it.
