# The commands CI runs, so a local run and CI run the same thing.
# `make help` lists the targets.
.PHONY: help install check backend-typecheck backend-unit backend-functionality \
	e2e-backend frontend-lint frontend-typecheck frontend-test frontend-e2e

help:  ## List the targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  %-24s %s\n", $$1, $$2}'

install:  ## Install the frontend's packages and Playwright's Chromium
	cd frontend && npm ci && npx playwright install --with-deps chromium

check: backend-typecheck frontend-lint frontend-typecheck frontend-test  ## Every check that needs no test stack

backend-typecheck:  ## Python version check, then mypy
	cd backend && ./check-python-version.sh && ./mypy.sh

backend-unit:  ## Backend unit tests in a fresh test stack
	cd backend && ./test/util/with-container.sh ./test/unit/unit.sh --no-sudo

backend-functionality:  ## One functionality suite in a fresh test stack, e.g. SUITE=4
	cd backend && ./test/util/with-container.sh ./test/functionality.sh $(or $(SUITE),$(error Set SUITE, e.g. SUITE=4))

e2e-backend:  ## Start the backend test stack Playwright runs against, with rate limits off
	cd backend && mkdir -p test/input \
		&& for f in enable-mocking disable-ip-rate-limit disable-account-rate-limit; do echo 1 > test/input/$$f; done \
		&& docker compose -f docker-compose.test.yml up -d --build api status s3mock smtp redis

frontend-lint:  ## ESLint
	cd frontend && npm run lint

frontend-typecheck:  ## TypeScript type checks
	cd frontend && npm run typecheck

frontend-test:  ## Jest
	cd frontend && npm test

frontend-e2e:  ## Playwright, once e2e-backend is healthy; PROJECTS='desktop phone' picks projects
	curl --silent --fail --retry 300 --retry-delay 1 --retry-all-errors --output /dev/null http://localhost:5000/health \
		|| { echo 'No healthy API at localhost:5000; make e2e-backend starts it' >&2; exit 1; }
	cd frontend && npx playwright test $(foreach p,$(PROJECTS),--project $(p))
