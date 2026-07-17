#!/usr/bin/env bash

#
# VM provisioning script for Debian Bookworm in GCP
#

sudo sed \
  -i \
  's/^Components: main/Components: main contrib/' \
  /etc/apt/sources.list.d/debian.sources

sudo sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'

wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -


sudo apt update
sudo apt upgrade

sudo apt install -y \
  dpkg-dev \
  linux-headers-cloud-amd64 \
  linux-image-cloud-amd64 \
  postgresql-16 \
  postgresql-16-pgvector \
  postgresql-16-postgis-3 \
  postgresql-contrib \
  postgresql-plpython3-16 \
  python3-numpy \
  tmux \
  zfs-initramfs \
  zfsutils-linux \
  zsh

sudo /sbin/modprobe zfs

sudo zpool create \
  -o ashift=12 \
  -o autotrim=on \
  -O acltype=posixacl \
  -O xattr=sa \
  -O dnodesize=auto \
  -O compression=off \
  -O normalization=formD \
  -O relatime=on \
  -O canmount=on \
  -O mountpoint=/var/lib/pgsql/data \
  -O autoexpand=on \
  dbpool \
  mirror \
  /dev/disk/by-id/google-instance-1a \
  /dev/disk/by-id/google-instance-1b

sudo chown -R postgres:postgres /var/lib/pgsql/data
sudo chmod 700 /var/lib/pgsql/data

sudo -u postgres /usr/lib/postgresql/16/bin/initdb -D /var/lib/pgsql/data

sudo sed \
  -iE \
  "s|^data_directory =.*|data_directory = '/var/lib/pgsql/data'|" \
  /etc/postgresql/16/main/postgresql.conf

sudo sed \
  -iE \
  "s|^# *listen_addresses =.*|listen_addresses = '*'|" \
  /etc/postgresql/16/main/postgresql.conf

sudo sed \
  -iE \
  "s|^max_connections =.*|max_connections = 800|" \
  /etc/postgresql/16/main/postgresql.conf

sudo sed \
  -iE \
  "s|^# *idle_in_transaction_session_timeout =.*|idle_in_transaction_session_timeout = '5min'|" \
  /etc/postgresql/16/main/postgresql.conf

sudo sed \
  -iE \
  "s|^# *random_page_cost =.*|random_page_cost = 1.1|" \
  /etc/postgresql/16/main/postgresql.conf

sudo bash -c \
  "echo 'host    all             all             0.0.0.0/0               scram-sha-256' >> /etc/postgresql/16/main/pg_hba.conf"

sudo systemctl restart postgresql


# Useful commands
#
# ALTER USER postgres WITH PASSWORD 'password';
# zfs list -t snapshot
# zfs list -t snapshot -o name -s creation -H | grep '^dbpool@' | head -n -3 | xargs -n1 zfs destroy
# zfs snapshot dbpool@pr42
# zfs destroy dbpool@pr42
