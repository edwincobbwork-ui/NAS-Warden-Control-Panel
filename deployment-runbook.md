# Control Plane Deployment Runbook

As of Friday, March 13, 2026 in `America/Denver`.

This runbook deploys the first NAS Warden always-on control plane using the scaffold already staged in:

- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/schema-v1.sql`
- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/worker/src/index.js`
- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/worker/wrangler.example.toml`

It assumes the NAS-side agent scaffolding is already present in:

- `/Users/nasstoragesystem/ops/nas_warden_v2/src/nas_warden_v2/control_plane.py`
- `/Users/nasstoragesystem/ops/nas_warden_v2/src/nas_warden_v2/control_plane_agent.py`

## Important Constraint

Do not plan to deploy the Cloudflare Worker from this Mac Pro host.

Cloudflare’s current Wrangler docs say:

- Wrangler requires Node.js and npm
- Wrangler is only supported on macOS `13.5+`, Windows 11, or supported Linux distributions

This NAS host is running macOS `11.7.10 Big Sur`, so Cloudflare deployment should happen from:

- a newer Mac
- a Windows 11 workstation
- a supported Linux box
- or CI/CD

Reference:

- `https://developers.cloudflare.com/workers/wrangler/install-and-update/`

## Big Sur-Only Alternative

If this Big Sur Mac is the only computer available, the practical path is:

- author and commit the Worker files from this Mac
- push them to GitHub from this Mac
- let GitHub Actions or Cloudflare Workers Builds do the actual deployment on supported cloud runners

That avoids the unsupported local Wrangler environment while still allowing this Mac to remain the primary workstation.

Prepared CI scaffold:

- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/.github/workflows/deploy-worker.yml`

Official references:

- `https://developers.cloudflare.com/workers/ci-cd/`
- `https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/`
- `https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/`

## Goal

At the end of this runbook, you should have:

- a deployed Cloudflare Worker control plane
- a remote D1 database with the v1 schema applied
- agent/admin tokens stored on the Worker
- the custom domain `https://control.1537396697323.xyz` answering the Worker
- Cloudflare Access protecting `https://control.1537396697323.xyz/api/*`
- NAS Warden configured to send heartbeats to the Worker
- the current front end still working during the cutover

If using the Big Sur-only path, Phases 1 through 5 below can be replaced by the GitHub Actions path in the appendix.

## Phase 1. Prepare A Supported Deployment Workstation

On a supported workstation:

1. Install Node.js and npm.
2. Clone or copy the Worker scaffold directory.
3. Install Wrangler locally in the Worker project.
4. Authenticate Wrangler to Cloudflare.

Suggested commands:

```bash
mkdir -p ~/work/nas-warden-control-plane
cd ~/work/nas-warden-control-plane

# Copy from the NAS. Adjust the source transport as needed.
rsync -av \
  nasstoragesystem@100.67.36.115:/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/ \
  ./control_plane/

cd ./control_plane/worker
npm i -D wrangler@latest
npx wrangler login
npx wrangler --version
```

Reference:

- `https://developers.cloudflare.com/workers/wrangler/install-and-update/`

## Phase 2. Create The D1 Database

From the Worker directory on the supported workstation:

```bash
cd ~/work/nas-warden-control-plane/control_plane/worker
npx wrangler@latest d1 create nas-warden-control-plane
```

Cloudflare’s D1 docs show that `wrangler d1 create` returns the binding block containing:

- `binding`
- `database_name`
- `database_id`

Take the returned `database_id` and place it into `wrangler.toml`.

Commands:

```bash
cp wrangler.example.toml wrangler.toml
```

Then edit:

```toml
name = "nas-warden-control-plane"
main = "src/index.js"
compatibility_date = "2026-03-13"

[vars]
HEARTBEAT_WARN_MINUTES = "2"
HEARTBEAT_STALE_MINUTES = "10"
JOB_LEASE_MINUTES = "20"

[[d1_databases]]
binding = "DB"
database_name = "nas-warden-control-plane"
database_id = "PASTE_THE_REAL_DATABASE_ID_HERE"
```

Keep the prepared custom-domain route in place for:

- `control.1537396697323.xyz`

Reference:

- `https://developers.cloudflare.com/d1/get-started/`

## Phase 3. Apply The Schema

Cloudflare’s D1 docs note that `wrangler d1 execute` runs locally by default unless you add `--remote`.

Run both local and remote applies from the Worker directory:

```bash
cd ~/work/nas-warden-control-plane/control_plane/worker

npx wrangler d1 execute nas-warden-control-plane \
  --local \
  --file=../schema-v1.sql

npx wrangler d1 execute nas-warden-control-plane \
  --remote \
  --file=../schema-v1.sql
```

Optional verification:

```bash
npx wrangler d1 execute nas-warden-control-plane \
  --remote \
  --command='PRAGMA table_list'
```

Reference:

- `https://developers.cloudflare.com/d1/get-started/`
- `https://developers.cloudflare.com/d1/sql-api/sql-statements/`

## Phase 4. Set Worker Secrets

Create two secrets:

- `CONTROL_PLANE_AGENT_TOKEN`
- `ADMIN_API_TOKEN`

Cloudflare’s Workers secrets docs say `wrangler secret put <KEY>` creates a new version and deploys it immediately.

Commands:

```bash
cd ~/work/nas-warden-control-plane/control_plane/worker

printf '%s' 'REPLACE_WITH_LONG_RANDOM_AGENT_TOKEN' | \
  npx wrangler secret put CONTROL_PLANE_AGENT_TOKEN

printf '%s' 'REPLACE_WITH_LONG_RANDOM_ADMIN_TOKEN' | \
  npx wrangler secret put ADMIN_API_TOKEN
```

If you also want local development secrets later, use a `.dev.vars` file in the Worker directory instead of putting secrets in source.

If you are using the Big Sur-only GitHub Actions path in the appendix, store the same values as GitHub repository secrets. The prepared workflow can provision them into the Worker runtime during deployment.

Reference:

- `https://developers.cloudflare.com/workers/configuration/secrets/`
- `https://developers.cloudflare.com/workers/configuration/environment-variables/`

## Phase 5. Deploy The Worker

From the Worker directory:

```bash
cd ~/work/nas-warden-control-plane/control_plane/worker
npx wrangler deploy
```

Record the resulting Worker base URL, for example:

- `https://nas-warden-control-plane.<account-subdomain>.workers.dev`

Also verify the configured custom domain:

- `https://control.1537396697323.xyz`

Reference:

- `https://developers.cloudflare.com/workers/wrangler/configuration/`

## Phase 6. Verify The Worker Before Touching The NAS

Health check:

```bash
curl -sS https://YOUR-WORKER-URL/healthz
```

Expected shape:

```json
{
  "ok": true,
  "service": "nas-warden-control-plane",
  "ts": "..."
}
```

Admin summary check:

```bash
curl -sS \
  -H 'Authorization: Bearer REPLACE_WITH_LONG_RANDOM_ADMIN_TOKEN' \
  https://YOUR-WORKER-URL/api/status/summary
```

At this point it should return an empty summary or zero-node state, which is fine before the NAS starts heartbeating.

Custom-domain check:

```bash
curl -sS https://control.1537396697323.xyz/healthz
```

Before proceeding to Phase 7, configure Cloudflare Access for:

- `https://control.1537396697323.xyz/api/*`
- future `https://control.1537396697323.xyz/admin/*`

Leave `/agent/*` on token auth so the NAS can post heartbeats without an Access browser flow.

## Phase 7. Store The NAS Agent Token On The NAS

On the NAS, store the same `CONTROL_PLANE_AGENT_TOKEN` value locally.

Preferred path: macOS Keychain.

Command:

```bash
/usr/bin/security add-generic-password \
  -U \
  -a nasstoragesystem \
  -s nas-warden/control-plane-agent-token \
  -w 'REPLACE_WITH_LONG_RANDOM_AGENT_TOKEN'
```

If Keychain access is not reliable for the running Warden process on this host, the existing local fallback file can also hold it:

- `/Users/nasstoragesystem/ops/nas_warden_v2/runtime/state/local_secrets.json`

But Keychain is the intended first choice.

## Phase 8. Enable The Control Plane In NAS Warden

Edit:

- `/Users/nasstoragesystem/ops/nas_warden_v2/config.json`

Change:

```json
"control_plane": {
  "enabled": false,
  "base_url": "",
  "heartbeat_endpoint": "/agent/heartbeat",
  "claim_jobs_endpoint": "/agent/jobs/claim",
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
  "timeout_seconds": 15,
  "claim_limit": 5,
  "auth_type": "bearer",
  "auth_service": "nas-warden/control-plane-agent-token"
}
```

Do not point the NAS at the temporary `workers.dev` deployment URL.

## Phase 9. Verify NAS Agent Connectivity

On the NAS:

Check config state:

```bash
cd /Users/nasstoragesystem/ops/nas_warden_v2
PYTHONPATH=src /usr/local/bin/python3 -m nas_warden_v2.cli control-plane-status
```

Expected:

- `enabled: true`
- `configured: true`
- `auth_present: true`

Dry-run heartbeat:

```bash
cd /Users/nasstoragesystem/ops/nas_warden_v2
PYTHONPATH=src /usr/local/bin/python3 -m nas_warden_v2.cli send-control-plane-heartbeat --dry-run
```

Live heartbeat:

```bash
cd /Users/nasstoragesystem/ops/nas_warden_v2
PYTHONPATH=src /usr/local/bin/python3 -m nas_warden_v2.cli send-control-plane-heartbeat
```

Optional claim dry-run:

```bash
cd /Users/nasstoragesystem/ops/nas_warden_v2
PYTHONPATH=src /usr/local/bin/python3 -m nas_warden_v2.cli claim-control-plane-jobs --dry-run
```

Then run one real cycle:

```bash
cd /Users/nasstoragesystem/ops/nas_warden_v2
PYTHONPATH=src /usr/local/bin/python3 -m nas_warden_v2.cli run-cycle
```

## Phase 10. Verify Remote D1 State

From the supported deployment workstation:

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

Expected:

- one `nas_nodes` row for `mac-pro-5-1`
- one or more `heartbeats` rows
- recent `service_checks` rows

## Phase 11. Re-Verify Existing Front-End Surfaces

After enabling the control plane, confirm the current front end still behaves exactly as before:

```bash
curl --max-time 8 -L -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/login
curl --max-time 8 -L -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/summary.txt
curl --max-time 8 -L -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/handoff.md
curl --max-time 8 -L -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/team-workspace.html
curl --max-time 8 -L -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/files/
curl --max-time 8 -L -s -o /dev/null -w '%{http_code}\n' http://100.67.36.115:8787/login
curl --max-time 8 -L -s -o /dev/null -w '%{http_code}\n' http://192.168.1.234:8787/login
curl --max-time 8 -L -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8790/team/
curl --max-time 8 -L -s -o /dev/null -w '%{http_code}\n' https://team.1537396697323.xyz/team/
curl --max-time 8 -L -s -o /dev/null -w '%{http_code}\n' https://f005.backblazeb2.com/file/OTC-Team-Cloud/index.html
```

The control-plane rollout should not break those existing routes.

## Rollback

If the Worker deployment succeeds but the NAS-side integration misbehaves:

1. set `control_plane.enabled` back to `false` in `config.json`
2. run one fresh cycle:

```bash
cd /Users/nasstoragesystem/ops/nas_warden_v2
PYTHONPATH=src /usr/local/bin/python3 -m nas_warden_v2.cli run-cycle
```

That returns the NAS to the current local-only behavior while preserving the deployed Worker for later use.

## Recommended Next Step After Successful Heartbeats

Once heartbeats are landing cleanly, the next implementation target should be:

1. `POST /api/uploads/create`
2. `POST /api/uploads/complete`
3. `POST /api/archive/create`

## Appendix: Big Sur-Only Deployment Via GitHub Actions

This path assumes:

- this Big Sur Mac is your only workstation
- you have a GitHub account
- Cloudflare API access is available through repository secrets

### A. Create A GitHub Repo For `control_plane`

From this Mac:

```bash
mkdir -p ~/work
cd ~/work
rsync -av /Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/ ./control_plane_repo/
cd ./control_plane_repo
git init
git add .
git commit -m "Initial NAS Warden control plane scaffold"
```

Create an empty GitHub repository, then:

```bash
git remote add origin git@github.com:YOUR-ACCOUNT/nas-warden-control-plane.git
git branch -M main
git push -u origin main
```

### B. Add GitHub Repository Secrets

In the GitHub repository settings, add:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `CONTROL_PLANE_AGENT_TOKEN`
- `ADMIN_API_TOKEN`

If you want the workflow to run the Worker immediately after D1 creation, create the D1 database once from Cloudflare dashboard or API first, then paste its `database_id` into the GitHub secret.

### C. Create D1 Before First Workflow Run

Because the workflow expects an existing D1 database ID, create the database once by either:

- Cloudflare dashboard
- Cloudflare API
- or a one-time Wrangler run from another supported environment if one becomes available

For a no-Wrangler path, the Cloudflare API create-database endpoint is documented here:

- `https://developers.cloudflare.com/api/operations/cloudflare-d1-create-database`

Prepared helper scripts on this Mac:

- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/create-d1-via-api.sh`
- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/list-d1-via-api.sh`

Example from this Mac:

```bash
cd /Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane

export CLOUDFLARE_API_TOKEN='REPLACE_WITH_API_TOKEN'
export CLOUDFLARE_ACCOUNT_ID='REPLACE_WITH_ACCOUNT_ID'

./create-d1-via-api.sh nas-warden-control-plane
./list-d1-via-api.sh
```

The create response includes the D1 `uuid`, which becomes the `database_id` GitHub secret.

### D. Let GitHub Actions Deploy

Push to `main`, or trigger the workflow manually in GitHub Actions.

The prepared workflow will:

- install Wrangler on `ubuntu-latest`
- generate `worker/wrangler.toml`
- apply `schema-v1.sql` remotely
- provision the Worker runtime secrets from GitHub repository secrets
- deploy the Worker

### E. Continue With NAS Enablement

After the Worker URL is live, resume at:

- Phase 6. Verify The Worker Before Touching The NAS

That is the next milestone that starts making the front end truly useful while the NAS is off.
