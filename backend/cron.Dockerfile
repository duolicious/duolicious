# syntax=docker.io/docker/dockerfile:1.7-labs
FROM python:3.11

ENV DUO_USE_VENV=false
ENV PYTHONUNBUFFERED=true

ENV OMP_NUM_THREADS=2
ENV OPENBLAS_NUM_THREADS=2

WORKDIR /app

COPY \
  serviceshared/antiabuse/clipnsfw/download-model.sh \
  /app/serviceshared/antiabuse/clipnsfw/

RUN /app/serviceshared/antiabuse/clipnsfw/download-model.sh

COPY \
  --exclude=serviceshared/antiabuse/clipnsfw/model.safetensors* \
  --exclude=serviceshared/antiabuse/minorconfession \
  --exclude=test \
  --exclude=vm \
  . /app

RUN pip install --no-cache-dir -r /app/requirements.txt

CMD /app/cron.main.sh
