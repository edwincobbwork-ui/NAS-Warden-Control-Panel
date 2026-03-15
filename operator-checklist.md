# Control Plane Operator Checklist

Use this after reviewing:

- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/deployment-runbook.md`

This is the short execution version.

## 0. Use A Supported Deployment Machine

Do this from:

- a newer Mac
- Windows 11
- supported Linux
- or CI

Do not deploy Cloudflare Wrangler from this Big Sur NAS host.

If this Big Sur Mac is the only workstation available, skip to:

- `Big Sur-Only Path`

## 1. Copy The Control Plane Scaffold

On the deployment workstation:

```bash
mkdir -p ~/work/nas-warden-control-plane
cd ~/work/nas-warden-control-plane

rsync -av \
  nasstoragesystem@100.67.36.115:/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/ \
  ./control_plane/
```

## 2. Install Wrangler And Log In

```bash
cd ~/work/nas-warden-control-plane/control_plane/worker
npm i -D wrangler@latest
npx wrangler login
npx wrangler --version
```

## 3. Create D1

```bash
cd ~/work/nas-warden-control-plane/control_plane/worker
npx wrangler d1 create nas-warden-control-plane
```

Copy the returned `database_id`.

## 4. Create `wrangler.toml`

```bash
cd ~/work/nas-warden-control-plane/control_plane/worker
cp wrangler.example.toml wrangler.toml
```

Edit `wrangler.toml` and replace:

```toml
database_id = "REPLACE_WITH_REAL_D1_DATABASE_ID"
```

Keep the prepared custom-domain route in place for:

- `control.1537396697323.xyz`

## 5. Apply The Schema

```bash
cd ~/work/nas-warden-control-plane/control_plane/worker

npx wrangler d1 execute nas-warden-control-plane \
  --local \
  --file=../schema-v1.sql

npx wrangler d1 execute nas-warden-control-plane \
  --remote \
  --file=../schema-v1.sql
```

Optional check:

```bash
npx wrangler d1 execute nas-warden-control-plane \
  --remote \
  --command='PRAGMA table_list'
```

## 6. Set Secrets

Generate two long random values:

- `AGENT_TOKEN`
- `ADMIN_TOKEN`

Then run:

```bash
cd ~/work/nas-warden-control-plane/control_plane/worker

printf '%s' 'REPLACE_WITH_LONG_RANDOM_AGENT_TOKEN' | \
  npx wrangler secret put CONTROL_PLANE_AGENT_TOKEN

printf '%s' 'REPLACE_WITH_LONG_RANDOM_ADMIN_TOKEN' | \
  npx wrangler secret put ADMIN_API_TOKEN
```

If you are using the prepared GitHub Actions path instead of a direct Wrangler deploy, add the same two values as GitHub repository secrets. The workflow can provision them into the Worker runtime automatically.

## 7. Deploy The Worker

```bash
cd ~/work/nas-warden-control-plane/control_plane/worker
npx wrangler deploy
```

Record:

- `WORKER_URL`

Example:

- `https://nas-warden-control-plane.<account-subdomain>.workers.dev`
- `https://control.1537396697323.xyz`

## 8. Verify The Worker

```bash
curl -sS "$WORKER_URL/healthz"

curl -sS \
  -H "Authorization: Bearer REPLACE_WITH_LONG_RANDOM_ADMIN_TOKEN" \
  "$WORKER_URL/api/status/summary"

curl -sS https://control.1537396697323.xyz/healthz
```

Do not continue until both the temporary deployment URL and the custom domain are responding.

Before touching the NAS config, put Cloudflare Access in front of:

- `https://control.1537396697323.xyz/api/*`
- future `https://control.1537396697323.xyz/admin/*`

Leave `/agent/*` on token auth so the NAS can post heartbeats without an Access browser flow.

## 9. Store The NAS Agent Token On The NAS

On the NAS:

```bash
/usr/bin/security add-generic-password \
  -U \
  -a nasstoragesystem \
  -s nas-warden/control-plane-agent-token \
  -w 'REPLACE_WITH_LONG_RANDOM_AGENT_TOKEN'
```

## 10. Enable The Control Plane In NAS Warden

Edit:

- `/Users/nasstoragesystem/ops/nas_warden_v2/config.json`

Change:

```json
"control_plane": {
  "enabled": false,
  "base_url": "",
  "heartbeat_endpoint": "/agent/heartbeat",
  "claim_jobs_endpoint": "/agent/jobs/claim",
  "report_job_result_endpoint": "/agent/jobs/{job_id}/result",
  "timeout_seconds": 15,
  "claim_limit": 5,
  "auth_type": "bearer",
  "auth_service": "nas-warden/control-plane-agent-token"
}
```

To:

```json
"control_plane": {
  "enabled": true,
  "base_url": "https://control.1537396697323.xyz",
  "heartbeat_endpoint": "/agent/heartbeat",
  "claim_jobs_endpoint": "/agent/jobs/claim",
  "report_job_result_endpoint": "/agent/jobs/{job_id}/result",
  "timeout_seconds": 15,
  "claim_limit": 5,
  "auth_type": "bearer",
  "auth_service": "nas-warden/control-plane-agent-token"
}
```

Do not point the NAS at the temporary `workers.dev` URL.

## 11. Verify NAS Connectivity

On the NAS:

```bash
cd /Users/nasstoragesystem/ops/nas_warden_v2

PYTHONPATH=src /usr/local/bin/python3 -m nas_warden_v2.cli control-plane-status

PYTHONPATH=src /usr/local/bin/python3 -m nas_warden_v2.cli send-control-plane-heartbeat --dry-run

PYTHONPATH=src /usr/local/bin/python3 -m nas_warden_v2.cli send-control-plane-heartbeat

PYTHONPATH=src /usr/local/bin/python3 -m nas_warden_v2.cli report-control-plane-job-result test-job \
  --status completed \
  --details-json '{"note":"validation"}' \
  --dry-run

PYTHONPATH=src /usr/local/bin/python3 -m nas_warden_v2.cli run-cycle
```

Expected:

- `enabled: true`
- `configured: true`
- `auth_present: true`

## 12. Verify D1 Rows

Back on the deployment workstation:

```bash
cd ~/work/nas-warden-control-plane/control_plane/worker

npx wrangler d1 execute nas-warden-control-plane \
  --remote \
  --command="SELECT node_id, label, status, last_seen_at FROM nas_nodes ORDER BY updated_at DESC;"

npx wrangler d1 execute nas-warden-control-plane \
  --remote \
  --command="SELECT node_id, summary_status, ts FROM heartbeats ORDER BY ts DESC LIMIT 5;"

npx wrangler d1 execute nas-warden-control-plane \
  --remote \
  --command="SELECT check_name, status, recorded_at FROM service_checks ORDER BY recorded_at DESC LIMIT 20;"
```

## 13. Recheck The Existing Front End

On the NAS:

```bash
for url in \
  'http://127.0.0.1:8787/login' \
  'http://127.0.0.1:8787/summary.txt' \
  'http://127.0.0.1:8787/handoff.md' \
  'http://127.0.0.1:8787/team-workspace.html' \
  'http://127.0.0.1:8787/files/' \
  'http://100.67.36.115:8787/login' \
  'http://192.168.1.234:8787/login' \
  'http://127.0.0.1:8790/team/' \
  'https://team.1537396697323.xyz/team/' \
  'https://f005.backblazeb2.com/file/OTC-Team-Cloud/index.html'
do
  code=$(curl --max-time 8 -L -s -o /dev/null -w '%{http_code}' "$url")
  printf '%s %s\n' "$code" "$url"
done
```

Expected: all current routes remain `200`.

## 14. Roll Back If Needed

If the NAS-side integration misbehaves:

1. set `"control_plane.enabled": false` again in `config.json`
2. run:

```bash
cd /Users/nasstoragesystem/ops/nas_warden_v2
PYTHONPATH=src /usr/local/bin/python3 -m nas_warden_v2.cli run-cycle
```

## After This Works

The next implementation target is:

1. `POST /api/uploads/create`
2. `POST /api/uploads/complete`
3. `POST /api/archive/create`

## Big Sur-Only Path

If this Mac is the only machine available, use GitHub-hosted CI instead of local Wrangler.

Prepared workflow:

- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/.github/workflows/deploy-worker.yml`

Minimal sequence:

1. Copy `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/` into a standalone GitHub repo.
2. Add GitHub repo secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_D1_DATABASE_ID`
   Reference:
   `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/github-secrets-checklist.md`
3. Create the D1 database once from Cloudflare dashboard or API.
   Mac-friendly helper scripts:
   `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/create-d1-via-api.sh`
   `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/list-d1-via-api.sh`
   Token generator:
   `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/generate-control-plane-secrets.sh`
4. Push to `main`.
5. Let GitHub Actions deploy the Worker from `ubuntu-latest`.
6. Resume at step `9` above on the NAS.
