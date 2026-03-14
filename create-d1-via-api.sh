#!/bin/bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  cat <<'EOF' >&2
Usage:
  create-d1-via-api.sh <database-name> [jurisdiction] [primary_location_hint]

Required environment variables:
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID

Example:
  CLOUDFLARE_API_TOKEN=... \
  CLOUDFLARE_ACCOUNT_ID=... \
  ./create-d1-via-api.sh nas-warden-control-plane
EOF
  exit 1
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required." >&2
  exit 1
fi

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "CLOUDFLARE_ACCOUNT_ID is required." >&2
  exit 1
fi

DATABASE_NAME="$1"
JURISDICTION="${2:-}"
PRIMARY_LOCATION_HINT="${3:-}"

python3 - "$DATABASE_NAME" "$JURISDICTION" "$PRIMARY_LOCATION_HINT" <<'PY' | \
curl -sS \
  -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-
import json
import sys

name = sys.argv[1]
jurisdiction = sys.argv[2].strip()
primary_location_hint = sys.argv[3].strip()

payload = {"name": name}
if jurisdiction:
    payload["jurisdiction"] = jurisdiction
if primary_location_hint:
    payload["primary_location_hint"] = primary_location_hint

print(json.dumps(payload))
PY

echo
