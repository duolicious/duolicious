# Dev image for the Duolicious frontend (Expo web dev server).
#
# This serves the web build of the app with hot reload so new contributors
# can `docker compose up` from the repo root and get a working frontend that
# talks to the backend services on their published localhost ports. Browser
# requests originate on the host, so the frontend's default API URLs
# (http://localhost:5000 etc.) resolve to the published backend containers
# without any extra configuration.
FROM node:22-bookworm

WORKDIR /app

# Install dependencies first so this layer is cached across source changes.
# patch-package needs the patches/ directory present at install time.
COPY package.json package-lock.json ./
COPY patches ./patches
RUN npm ci

# Copy the rest of the source. At runtime docker-compose bind-mounts the
# host source over /app (with an anonymous volume preserving node_modules),
# so edits hot-reload; this COPY keeps the image usable on its own too.
COPY . .

# Expo/Metro web dev server.
EXPOSE 8081

# BROWSER=none stops Expo from trying to launch a browser inside the
# container; contributors open http://localhost:8081 on the host instead.
ENV BROWSER=none \
    EXPO_NO_TELEMETRY=1

CMD ["npx", "expo", "start", "--web", "--port", "8081"]
