#!/usr/bin/env bash
# One-time (idempotent) preparation of the Ladybug production host.
#
# Generates every secret locally and prints them ONCE. Nothing here is ever committed:
# the repository and the container images are both public.
#
# Safe to re-run: existing secrets are preserved, so this doubles as the first step of
# the disaster-recovery path (docs/DEPLOYMENT.md) on a freshly provisioned VPS.
set -euo pipefail

ROOT=/web/online-trash.com
REPO_DEPLOY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Swap"
# The box has 960 MiB and shipped with no swap, which turns any transient spike --
# a large image decode in GD, a MySQL query burst -- into an OOM kill instead of a
# slowdown. 2 GiB with a low swappiness: present as a safety net, not as routine paging.
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
grep -q '^vm.swappiness' /etc/sysctl.conf || {
    echo 'vm.swappiness=10' >> /etc/sysctl.conf
    sysctl -p >/dev/null
}

echo "==> Docker log rotation"
# Unbounded json-file logs are the classic way to fill a 20 GiB disk.
if [ ! -f /etc/docker/daemon.json ]; then
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
    systemctl restart docker
fi

echo "==> Packages"
# lftp does incremental FTPS mirroring for the media backup; curl alone cannot.
command -v lftp >/dev/null || { apt-get update -qq && apt-get install -y -qq lftp; }

echo "==> Directories"
mkdir -p "$ROOT"/data/{mysql,storage/app/public,backups}
# php-fpm runs as www-data (uid 33) inside the container.
chown -R 33:33 "$ROOT/data/storage"

echo "==> Stack files"
cp "$REPO_DEPLOY/docker-compose.prod.yml" "$ROOT/docker-compose.yml"
cp "$REPO_DEPLOY/deploy.sh" "$REPO_DEPLOY/backup.sh" "$REPO_DEPLOY/restore.sh" "$ROOT/"
chmod +x "$ROOT"/{deploy,backup,restore}.sh

# A generator, not a chooser: 32 alphanumerics avoids quoting hazards in .env, MySQL
# and shell alike, while staying far beyond guessable.
gen() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32; }

echo "==> Secrets"
if [ ! -f "$ROOT/.env" ]; then
    cat > "$ROOT/.env" <<ENV
LADYBUG_TAG=latest
MYSQL_ROOT_PASSWORD=$(gen)
MYSQL_PASSWORD=$(gen)
ENV
    chmod 600 "$ROOT/.env"
    echo "    generated $ROOT/.env"
else
    echo "    $ROOT/.env exists, left untouched"
fi

if [ ! -f "$ROOT/backend.env" ]; then
    cp "$REPO_DEPLOY/backend.env.example" "$ROOT/backend.env"
    APP_KEY="base64:$(openssl rand -base64 32)"
    DB_PASSWORD="$(grep '^MYSQL_PASSWORD=' "$ROOT/.env" | cut -d= -f2-)"
    sed -i "s|^APP_KEY=.*|APP_KEY=${APP_KEY}|" "$ROOT/backend.env"
    sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" "$ROOT/backend.env"
    chmod 600 "$ROOT/backend.env"
    echo "    generated $ROOT/backend.env"
    echo "    !! MAIL_PASSWORD is still empty -- copy it from the dev backend/.env"
else
    echo "    $ROOT/backend.env exists, left untouched"
fi

if [ ! -f /root/.ladybug-backup-pass ]; then
    gen > /root/.ladybug-backup-pass
    chmod 600 /root/.ladybug-backup-pass
    echo "    generated /root/.ladybug-backup-pass"
fi

if [ ! -f /root/.ladybug-ftp ]; then
    cat > /root/.ladybug-ftp <<'ENV'
# Dedicated Zone.eu FTPS user for off-box backups, chrooted to its own root.
# Connect by HOSTNAME: the certificate is *.tll07.zoneas.eu and the bare IP fails
# verification. SINGLE-QUOTE the password -- it contains / = ? and + characters.
FTP_HOST=sn-69-18.tll07.zoneas.eu
FTP_USER=
FTP_PASS=''
ENV
    chmod 600 /root/.ladybug-ftp
    echo "    created /root/.ladybug-ftp -- fill in FTP_USER and FTP_PASS"
fi

cat <<SUMMARY

==================== SAVE THESE NOW ====================
MySQL root password : $(grep '^MYSQL_ROOT_PASSWORD=' "$ROOT/.env" | cut -d= -f2-)
MySQL app password  : $(grep '^MYSQL_PASSWORD=' "$ROOT/.env" | cut -d= -f2-)
Backup passphrase   : $(cat /root/.ladybug-backup-pass)

The backup passphrase is the one secret that CANNOT be recovered from the
backups -- it is what decrypts them. Put it in a password manager now.
========================================================

Remaining manual steps:
  1. Fill MAIL_PASSWORD in $ROOT/backend.env (from the dev backend/.env)
  2. Fill FTP_USER and FTP_PASS in /root/.ladybug-ftp
SUMMARY
