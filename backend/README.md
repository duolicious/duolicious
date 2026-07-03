## Quickstart

Requirements: Docker (with Compose), jq, curl, ffmpeg, zstd

```bash
# 1) Clone and start the full dev stack
git clone https://github.com/duolicious/duolicious-backend
cd duolicious-backend
docker compose up -d

# 2) Wait for the API to be healthy
curl -sf http://localhost:5000/health && echo OK

# 3) Create a test user and seed data (OTP is auto-handled in dev)
./test/util/create-user.sh alice 30 1 true
```

- The command above signs up `alice@example.com`, finishes onboarding, answers questions, adds a photo and an audio bio.
- Use `./test/util/create-user.sh bob 50 2` to create more sample users.

## Run tests

Run one test file in a disposable environment:

```bash
./test/util/with-container.sh ./test/functionality1/status.sh
```

Run an entire test suite (e.g. all tests in functionality1):

```bash
./test/util/with-container.sh ./test/functionality.sh 1
```

## Common local URLs

- API: [http://localhost:5000/health](http://localhost:5000/health)
- Mock S3 UI/endpoint: [http://localhost:9090](http://localhost:9090)
- MailHog (test email UI): [http://localhost:8025](http://localhost:8025)
- Postgres (host port): `localhost:5432`
- Status page: [http://localhost:8080](http://localhost:8080)
- PgAdmin: [http://localhost:8090](http://localhost:8090)

## Local development

Prefer Docker? You already started everything with `docker compose up -d`.

Prefer running the services from source (hot reload)? See the "Local development" section in [DEVELOPER.md](DEVELOPER.md).
