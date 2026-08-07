<p align="center">
<img src="https://avatars.githubusercontent.com/u/134650848?s=100&v=4" alt="Duolicious Hearts Logo" >
<h3 align="center">Duolicious</h3>
<p align="center">
The world's most popular open-source dating app.</p>
</p>

<p align="center">
<a href="https://duolicious.app/"><img src="https://img.shields.io/badge/web-duolicious.app-7700ff" alt="Duolicious on the web"/></a>
<a href="https://play.google.com/store/apps/details?id=app.duolicious"><img src="https://img.shields.io/badge/Google%20Play-app.duolicious-7700ff?logo=googleplay&logoColor=white" alt="Duolicious on Google Play"/></a>
<a href="https://apps.apple.com/us/app/duolicious-dating-app/id6499066647"><img src="https://img.shields.io/badge/App%20Store-Duolicious-7700ff?logo=appstore&logoColor=white" alt="Duolicious on the App Store"/></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-7700ff" alt="AGPL-3.0 licensed"/></a>
<a href="https://x.com/duoliciousapp"><img src="https://img.shields.io/twitter/follow/duoliciousapp" alt="Duolicious Twitter"/></a>
<a href="https://www.reddit.com/r/duolicious/"><img src="https://img.shields.io/reddit/subreddit-subscribers/duolicious" alt="Duolicious Reddit"/></a>
</p>

Duolicious is a personality-based dating app for meeting like-minded people.
There's no swiping; people connect by starting a conversation. The client and the
servers behind it both live in this repo under the AGPL-3.0, so you're welcome to
read how it works, run your own copy, or send a patch.

Try it now in your browser at **[duolicious.app](https://duolicious.app/)**,
or grab it on
**[Google Play](https://play.google.com/store/apps/details?id=app.duolicious)**
and the
**[App Store](https://apps.apple.com/us/app/duolicious-dating-app/id6499066647)**.

<p align="center">
<img src=".github/images/01-join.png" width="22%" alt="Join or sign in">
<img src=".github/images/03-qanda.png" width="22%" alt="Answer questions to improve your matches">
<img src=".github/images/02-clubs.png" width="22%" alt="Search and browse matches">
<img src=".github/images/04-feed.png" width="22%" alt="Community feed">
</p>
<p align="center">
<img src=".github/images/05-inbox.png" width="22%" alt="Chat inbox">
<img src=".github/images/06-visitors.png" width="22%" alt="See who visited your profile">
<img src=".github/images/07-profile.png" width="22%" alt="Your profile and verification">
<img src=".github/images/08-chat.png" width="22%" alt="A conversation">
</p>

## How it works

- **Matching on answers, not just photos.** The question bank has over 2,000
  questions covering values, faith, politics, sexual compatibility and more. You
  don't have to answer them all — Duolicious surfaces matches after your first
  answer, and refines them as you answer more.
- **Psychometric traits.** Alongside familiar frameworks like the MBTI,
  Duolicious shows how you compare to others on traits such as attachment style
  and thriftiness.
- **No swiping.** There's no liking or swiping. People introduce themselves by
  sending a message, and the app discourages low-effort openers like "hey" and
  "sup".
- **Open source.** The app, API, chat, and infrastructure are all in this repo.
  Anyone can read the code, run their own instance, file an issue, or send a fix.
- **Funding.** Duolicious runs on an optional subscription that covers the
  servers and keeps the project going. The core experience is free to use.

## What's in this repo

This monorepo contains both halves of Duolicious:

| Directory | What it is |
| --- | --- |
| [`backend/`](backend/) | The API, chat, cron and supporting services (Python + Postgres). See its [README](backend/README.md) and [DEVELOPER.md](backend/DEVELOPER.md). |
| [`frontend/`](frontend/) | The cross-platform app (Expo / React Native, with a web build). See its [README](frontend/README.md) and [DEVELOPER.md](frontend/DEVELOPER.md). |

## Run the whole app in one command

Requirements: Docker (with Compose v2.20+).

```bash
git clone https://github.com/duolicious/duolicious
cd duolicious
docker compose up
```

That single command builds and starts the entire backend stack **and** the
frontend web app. Once it's up:

- **Frontend (web):** http://localhost:8081
- **API health:** http://localhost:5000/health
- **MailHog (test email UI):** http://localhost:8025
- **Mock S3:** http://localhost:9090
- **Status page:** http://localhost:8080

The frontend's default API URLs already point at the backend's published
localhost ports, so the web app talks to your local backend with no extra
configuration.

The local `docker compose up` stack runs without any secrets — it mocks the
OpenAI-backed features (account verification and club SEO descriptions), so you
don't need a key for development.

A real deployment **requires** `OPENAI_API_KEY`: the cron container won't start
without it, so a misconfigured deploy fails fast instead of silently shipping
broken verification. See [`backend/DEVELOPER.md`](backend/DEVELOPER.md) for the
full list of environment variables.

To seed a test user once the API is healthy:

```bash
(cd backend && ./test/util/create-user.sh alice 30 1 true)
```

### Working on just one half

You can develop each side on its own — see the per-directory READMEs and
`DEVELOPER.md` files linked in the table above. The root `docker compose up` is
still the easiest way to get everything running at once.

## Tests

CI runs the full test suite for both halves on every push and pull request to
`main` (see [`.github/workflows/`](.github/workflows/)):

- **Backend:** mypy, unit tests, and functionality suites 1–6.
- **Frontend:** ESLint, Jest, Playwright, and TypeScript type checks.

## Contributing

There are a few ways to help:

1. **Send a pull request.** Pick up an [open issue](https://github.com/duolicious/duolicious/issues)
   or fix something that bugs you. `docker compose up` gets you a full local
   environment in one step, and developer instructions live in each half's
   `DEVELOPER.md`.
2. **Read the `CONTRIBUTING.md`**
   ([backend](backend/CONTRIBUTING.md) ·
   [frontend](frontend/CONTRIBUTING.md)) for coding standards, how to run the
   tests, and what makes a good PR.
3. **Spread the word.** Telling people and sharing Duolicious helps the app grow.
4. **Subscribe.** A subscription helps cover the servers and keep the project
   sustainable.

New contributors are welcome. If you're not sure where to start, open an issue
and say hello.
