#!/usr/bin/env bash
# Dumps the authentik database to /var/backups/authentik. Runs as root, through the shared postgres container. Keeps 7 days, always the newest 3.
set -euo pipefail
dir=/var/backups/authentik
file=$dir/authentik-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
podman exec postgres pg_dump -U postgres authentik | gzip > "$file.tmp"
mv "$file.tmp" "$file"
echo "backup: $file"
ls -1t "$dir"/authentik-*.sql.gz | tail -n +4 | while read -r old; do
  if [[ -n $(find "$old" -mmin +$((7 * 24 * 60))) ]]; then rm -f "$old" && echo "deleted: $old"; fi
done
