FROM mcr.microsoft.com/devcontainers/python:3.12-trixie
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-common \
    && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
    && apt-get install -y --no-install-recommends ffmpeg jq postgresql-client-18 zstd \
    && rm -rf /var/lib/apt/lists/*
