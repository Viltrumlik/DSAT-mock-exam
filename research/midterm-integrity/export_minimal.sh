#!/usr/bin/env bash
# Run export_minimal.sql read-only into an empty directory and pack it.
#
#   DATABASE_URL=postgresql://... bash export_minimal.sh <empty-dir>
#
# On the server, read the URL from the env file without echoing it, e.g.:
#   DATABASE_URL="$(grep -m1 '^DATABASE_URL=' /var/www/satapp/shared/backend.env | cut -d= -f2-)" \
#     bash export_minimal.sh /tmp/midterm-study-export
set -euo pipefail

out=${1:?usage: export_minimal.sh <empty-dir>}
: "${DATABASE_URL:?DATABASE_URL is not set}"
here=$(cd "$(dirname "$0")" && pwd)

umask 077
mkdir -p "$out"
[ -z "$(ls -A "$out")" ] || { echo "Refusing: $out is not empty." >&2; exit 1; }
cd "$out"
PGOPTIONS="-c default_transaction_read_only=on" psql "$DATABASE_URL" -X -q -f "$here/export_minimal.sql"
tar -czf ../"$(basename "$out")".tar.gz -- *.csv
wc -l -- *.csv
echo "packed: $(cd .. && pwd)/$(basename "$out").tar.gz"
