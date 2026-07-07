# Notifications

When a user has an unread intro or chat, Duolicious notifies them — by push
notification to their phone, or by email as a fallback.

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

Each user also chooses, separately for intros and chats, how often they're
willing to be notified: immediately, daily, every 3 days, weekly, or never. A
notification only goes out once that much time has elapsed since the last one for
that type — and "never" means none at all.

## Which channel

The channel depends on where the user was last active:

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
Everything else — every other frequency, the email fallback, and anyone an
immediate push couldn't reach — is handled by a periodic check that applies all
the rules above.

## The app-icon badge

The iOS app icon shows how many notifications were sent since the user last
had the app open, to nudge them into opening it. It's a rough count of
notifications, not unread messages.

The server keeps the count in `person.unseen_notification_count` and stamps it
into every push as an absolute badge value, so all of a user's devices
converge on the same number:

- A push sent while the user has **no connected chat clients** increments the
  count once per user (not per device) and carries it as the badge. This holds
  for every push the server sends — live chat messages, the periodic check,
  and the auto-deactivation notice alike.
- A push sent while **any client is connected** carries no badge — the user
  can see the message themselves — which leaves each device's badge untouched.
  Pushes from the periodic check always badge, since it only notifies users
  who haven't been online for 10 minutes, as does the auto-deactivation
  notice, which only targets users offline for at least 30 days.
- Connecting any client — web or mobile — zeroes the count. The opened device
  also clears its own badge locally right away; other devices keep a stale
  badge until their next push corrects it.
