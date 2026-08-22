# syntax=docker.io/docker/dockerfile:1.7-labs
FROM python:3.11

ENV DUO_USE_VENV=false
ENV PYTHONUNBUFFERED=true

ENV OMP_NUM_THREADS=2
ENV OPENBLAS_NUM_THREADS=2

WORKDIR /app

COPY \
  --exclude=test \
  --exclude=vm \
  . /app

RUN pip install --no-cache-dir -r /app/requirements.txt \
  && python -m spacy download en_core_web_sm

CMD /app/cron.main.sh
