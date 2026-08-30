# syntax=docker.io/docker/dockerfile:1.7-labs
FROM python:3.11

ENV DUO_USE_VENV=false
ENV PYTHONUNBUFFERED=true
ENV OPENBLAS_NUM_THREADS=1
ENV OMP_NUM_THREADS=1

ARG DUO_COMMIT_HASH=unknown
ENV DUO_COMMIT_HASH=$DUO_COMMIT_HASH

WORKDIR /app

COPY \
  --exclude=serviceshared/antiabuse/antiporn \
  --exclude=test \
  --exclude=vm \
  . /app

RUN : \
  && apt update \
  && apt install -y ffmpeg \
  && pip install --no-cache-dir -r /app/requirements.txt \
  && python -m spacy download en_core_web_sm

CMD /app/api.main.sh
