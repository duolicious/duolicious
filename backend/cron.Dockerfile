# syntax=docker.io/docker/dockerfile:1.7-labs
FROM python:3.11

ENV DUO_USE_VENV=false
ENV PYTHONUNBUFFERED=true

ENV OMP_NUM_THREADS=2
ENV OPENBLAS_NUM_THREADS=2
ENV DUO_FFMPEG_USER=nobody

WORKDIR /app

COPY requirements.txt /app/

RUN : \
  && apt update \
  && apt install -y ffmpeg \
  && pip install --no-cache-dir -r /app/requirements.txt

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
