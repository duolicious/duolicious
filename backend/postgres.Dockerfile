FROM postgres:18-trixie

RUN : \
  && pgversion=$(psql --version | awk '{print $3}' | cut -d'.' -f1) \
  && apt-get update \
  && apt-get install -y \
    postgresql-${pgversion}-postgis-3 \
    postgresql-${pgversion}-pgvector \
    postgresql-contrib \
    postgresql-plpython3-${pgversion}

CMD [ \
  "postgres", \
  "-c", "wal_level=logical", \
  "-c", "shared_buffers=2GB", \
  "-c", "random_page_cost=1.1" \
]
