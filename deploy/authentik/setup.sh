#!/usr/bin/env bash
# Installs Authentik as Podman Quadlet units on the mini PC. Run once with sudo from this directory.
# Needs: podman, hawk's shared Postgres (podman container "postgres", published on 127.0.0.1:5432), and /etc/authentik/authentik.env (copy authentik.env.example and fill it in).
set -euo pipefail
[[ $EUID == 0 ]] || { echo "run with sudo"; exit 1; }
[[ -f /etc/authentik/authentik.env ]] || { echo "create /etc/authentik/authentik.env first"; exit 1; }
here=$(cd "$(dirname "$0")" && pwd)

pw=$(sed -n 's/^AUTHENTIK_POSTGRESQL__PASSWORD=//p' /etc/authentik/authentik.env)
pg() { podman exec -i postgres "$@"; }
pg pg_isready -q -U postgres || { echo "postgres container is not running (systemctl status postgres)"; exit 1; }
pg psql -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='authentik'" | grep -q 1 \
  && pg psql -U postgres -c "ALTER ROLE authentik LOGIN PASSWORD '$pw'" \
  || pg psql -U postgres -c "CREATE ROLE authentik LOGIN PASSWORD '$pw'"
pg psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='authentik'" | grep -q 1 \
  || pg createdb -U postgres -O authentik authentik

mkdir -p /var/lib/authentik/media /var/lib/authentik/templates /var/backups/authentik /etc/containers/systemd
install -m 644 "$here"/authentik-server.container "$here"/authentik-worker.container /etc/containers/systemd/
install -m 755 "$here"/backup.sh /usr/local/bin/authentik-backup
install -m 644 "$here"/authentik-backup.service "$here"/authentik-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now authentik-server authentik-worker authentik-backup.timer
echo "Authentik starting on 127.0.0.1:9000. Add Caddyfile.snippet to Caddy, then open https://auth.andrewminghanjiang.com/if/flow/initial-setup/"
