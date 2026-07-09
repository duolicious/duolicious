# Contributing to Duolicious

Thanks for your interest in improving Duolicious! This guide will help you get set up quickly and submit a great pull request.

## Getting started (5 minutes)

1. Install: Docker (with Compose), jq, curl, ffmpeg, zstd
2. Clone and start the dev stack:

```bash
git clone https://github.com/duolicious/duolicious-backend
cd duolicious-backend
docker compose up -d
```

3. Seed data and verify:

```bash
curl -sf http://localhost:5000/health && echo API OK
./test/util/create-user.sh alice 30 1 true
```

- MailHog UI for emails: [http://localhost:8025](http://localhost:8025)
- PgAdmin: [http://localhost:8090](http://localhost:8090)

## Local development

- Easiest: keep everything in Docker (`docker compose up -d`)
- Hot reload from source: follow the "Local development" section in `DEVELOPER.md` to run `./api.main.sh` against Dockerized Postgres/Redis/S3/SMTP.

## Testing

- Run a single test in an ephemeral environment:

```bash
./test/util/with-container.sh ./test/functionality1/status.sh
```

- Run a full suite (e.g. functionality1):

```bash
./test/util/with-container.sh ./test/functionality.sh 1
```

## Type checking

Run mypy before opening a PR:

```bash
./mypy.sh           # core modules
./mypy.sh path.py   # a specific file or directory
```

## Pull request process

1. Fork the repo and create your branch from `main` or the appropriate topic branch
2. Make your change with tests where sensible
3. Ensure `./mypy.sh` passes
4. Add/update docs if behavior changes
5. Open a PR using the template below

### Good first issues

Looking for a place to start? Check the [good first issue](https://github.com/duolicious/duolicious-backend/labels/good%20first%20issue) label.

If you get stuck, open a draft PR early and ask for guidance—happy to help. 
