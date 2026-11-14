# syntax=docker.io/docker/dockerfile:1.7-labs

FROM debian:trixie-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /usr/local/bin/uv

# build-essential compiles pytricia, which is published only as source.
RUN : \
  && apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV UV_PYTHON_INSTALL_DIR=/opt/python
ENV UV_PYTHON_PREFERENCE=only-managed
ENV VIRTUAL_ENV=/opt/venv

WORKDIR /app

# uv installs the Python that .python-version names; that file is the
# version's only home, which setup-python and mypy.sh also read.
COPY .python-version requirements.txt /app/

RUN : \
  && uv venv /opt/venv \
  && uv pip install --no-cache --compile-bytecode -r requirements.txt


FROM debian:trixie-slim AS base

# curl runs api's health check and downloads cron's model.
RUN : \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/python /opt/python
COPY --from=builder /opt/venv /opt/venv

ENV PATH=/opt/venv/bin:$PATH

ENV DUO_USE_VENV=false
ENV PYTHONUNBUFFERED=true
ENV PYTHONDONTWRITEBYTECODE=true
ENV PYTHONPATH=/app
ENV OPENBLAS_NUM_THREADS=1
ENV OMP_NUM_THREADS=1

WORKDIR /app


FROM base AS api

RUN : \
  && apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

ARG DUO_COMMIT_HASH=unknown
ENV DUO_COMMIT_HASH=$DUO_COMMIT_HASH

COPY \
  --exclude=serviceshared/antiabuse/clipnsfw \
  --exclude=serviceshared/antiabuse/highrisk/dbip-* \
  --exclude=serviceshared/antiabuse/highrisk/encoder.onnx \
  --exclude=serviceshared/antiabuse/highrisk/model.npz \
  --exclude=test \
  --exclude=vm \
  . /app

CMD ["/app/api.main.sh"]


FROM base AS cron

COPY \
  serviceshared/antiabuse/clipnsfw/download-model.sh \
  serviceshared/antiabuse/clipnsfw/build_onnx.py \
  /app/serviceshared/antiabuse/clipnsfw/

RUN /app/serviceshared/antiabuse/clipnsfw/download-model.sh

COPY \
  serviceshared/antiabuse/highrisk/download-dbip.sh \
  /app/serviceshared/antiabuse/highrisk/

RUN /app/serviceshared/antiabuse/highrisk/download-dbip.sh

COPY \
  --exclude=serviceshared/antiabuse/clipnsfw/model.* \
  --exclude=serviceshared/antiabuse/highrisk/dbip-* \
  --exclude=serviceshared/antiabuse/minorconfession \
  --exclude=test \
  --exclude=vm \
  . /app

CMD ["/app/cron.main.sh"]


# The server only needs `pytricia` and the standard library, but the shared
# base installs all of requirements.txt, so the images can't drift onto
# different package versions.
FROM base AS firehol

COPY service/firehol /app/service/firehol

CMD ["python3", "service/firehol/__init__.py"]
