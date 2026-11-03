# syntax=docker.io/docker/dockerfile:1.7-labs

# The backend's Python version lives on this line only: compose, Backend
# Publish and the CI mypy job (through python-version.sh) all read it here.
FROM python:3.11 AS base

ENV PYTHONUNBUFFERED=true

WORKDIR /app

COPY requirements.txt /app/

RUN pip install --no-cache-dir -r /app/requirements.txt


FROM base AS api

ENV DUO_USE_VENV=false
ENV OPENBLAS_NUM_THREADS=1
ENV OMP_NUM_THREADS=1

RUN : \
  && apt update \
  && apt install -y ffmpeg

ARG DUO_COMMIT_HASH=unknown
ENV DUO_COMMIT_HASH=$DUO_COMMIT_HASH

COPY \
  --exclude=serviceshared/antiabuse/clipnsfw \
  --exclude=test \
  --exclude=vm \
  . /app

CMD /app/api.main.sh


FROM base AS cron

ENV DUO_USE_VENV=false
ENV OMP_NUM_THREADS=2
ENV OPENBLAS_NUM_THREADS=2

COPY \
  serviceshared/antiabuse/clipnsfw/download-model.sh \
  serviceshared/antiabuse/clipnsfw/build_onnx.py \
  /app/serviceshared/antiabuse/clipnsfw/

RUN /app/serviceshared/antiabuse/clipnsfw/download-model.sh

COPY \
  --exclude=serviceshared/antiabuse/clipnsfw/model.* \
  --exclude=serviceshared/antiabuse/minorconfession \
  --exclude=test \
  --exclude=vm \
  . /app

CMD /app/cron.main.sh


# The server only needs `pytricia` and the standard library, but the shared
# base installs all of requirements.txt, which keeps one requirements file.
FROM base AS firehol

ENV PYTHONDONTWRITEBYTECODE=true
ENV PYTHONPATH=/app

COPY service/firehol /app/service/firehol

CMD ["python3", "service/firehol/__init__.py"]
