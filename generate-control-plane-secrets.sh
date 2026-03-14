#!/bin/bash
set -euo pipefail

OUTPUT_FILE="${1:-}"

AGENT_TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"

ADMIN_TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"

BODY=$(cat <<EOF
# NAS Warden control plane secrets
# Generated: $(date '+%Y-%m-%d %H:%M:%S %Z')

CONTROL_PLANE_AGENT_TOKEN=$AGENT_TOKEN
ADMIN_API_TOKEN=$ADMIN_TOKEN
EOF
)

if [[ -n "$OUTPUT_FILE" ]]; then
  umask 077
  printf '%s\n' "$BODY" > "$OUTPUT_FILE"
  echo "Wrote secrets to $OUTPUT_FILE"
else
  printf '%s\n' "$BODY"
fi

cat <<'EOF'

Next use:
  1. Put CONTROL_PLANE_AGENT_TOKEN into Cloudflare/GitHub as the worker agent secret
  2. Put ADMIN_API_TOKEN into Cloudflare/GitHub as the admin API secret
  3. Store CONTROL_PLANE_AGENT_TOKEN on the NAS with:

     /usr/bin/security add-generic-password \
       -U \
       -a nasstoragesystem \
       -s nas-warden/control-plane-agent-token \
       -w 'PASTE_AGENT_TOKEN_HERE'
EOF
