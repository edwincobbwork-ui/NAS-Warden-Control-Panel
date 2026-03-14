# GitHub And Cloudflare Secrets Checklist

Use this with:

- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/operator-checklist.md`
- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/generate-control-plane-secrets.sh`

## GitHub Repository Secrets

Set these in the standalone control-plane GitHub repository:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `CONTROL_PLANE_AGENT_TOKEN`
- `ADMIN_API_TOKEN`

Important:

- The prepared GitHub Actions workflow currently reads these directly:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_D1_DATABASE_ID`
  - `CONTROL_PLANE_AGENT_TOKEN`
  - `ADMIN_API_TOKEN`
- The prepared GitHub Actions workflow now:
  - generates `worker/wrangler.toml`
  - applies the D1 schema remotely
  - upserts the two Worker runtime secrets
  - deploys the Worker
- If you bypass GitHub Actions and deploy manually from a supported workstation, you still need to run `wrangler secret put ...` yourself.

## Cloudflare Worker Runtime Secrets

These two values must exist in the Worker runtime:

- `CONTROL_PLANE_AGENT_TOKEN`
- `ADMIN_API_TOKEN`

If you use the prepared GitHub Actions workflow, it can provision them from the matching GitHub repository secrets during deployment.

If you deploy manually with Wrangler, set them directly in Cloudflare for the Worker project.

## What Each Secret Is For

### `CLOUDFLARE_API_TOKEN`

Used by GitHub Actions to:

- apply the D1 schema with `wrangler d1 execute --remote`
- deploy the Worker with `wrangler deploy`

Recommended permission posture:

- account-scoped custom token
- include `D1 Edit`
- include `Workers Scripts Write`

Inference:

- Cloudflare’s D1 release notes explicitly call out `D1:Edit` for write operations
- Cloudflare Workers API docs show `Workers Scripts Write` for editing/uploading scripts

If the account setup requires it, you may also need one additional read-level account permission. Start minimal and only add the smallest extra permission Cloudflare asks for.

Useful references:

- `https://developers.cloudflare.com/d1/platform/release-notes/`
- `https://developers.cloudflare.com/workers/api/`
- `https://developers.cloudflare.com/fundamentals/api/get-started/create-token/`

### `CLOUDFLARE_ACCOUNT_ID`

Used by GitHub Actions and API helpers to target the correct Cloudflare account.

### `CLOUDFLARE_D1_DATABASE_ID`

This is the UUID returned by D1 creation.

It is used to fill in:

- `worker/wrangler.toml`

### `CONTROL_PLANE_AGENT_TOKEN`

Used by the NAS worker agent when posting:

- `/agent/heartbeat`
- `/agent/jobs/claim`

This same value must exist:

- in Cloudflare Worker runtime secrets
- in NAS Keychain or the NAS local fallback secret store

### `ADMIN_API_TOKEN`

Used by admin/API clients to call:

- `/api/status/summary`
- `/api/jobs`
- `/api/jobs/:jobId`
- `/api/approvals/:approvalId/approve`
- `/api/approvals/:approvalId/deny`

## Generating The Agent/Admin Tokens

Mac-friendly helper:

- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/generate-control-plane-secrets.sh`

Print to terminal:

```bash
cd /Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane
./generate-control-plane-secrets.sh
```

Write to a local file with restricted permissions:

```bash
cd /Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane
./generate-control-plane-secrets.sh /Users/nasstoragesystem/ops/control-plane-secrets.txt
```

## Storing The NAS Agent Token

Preferred:

```bash
/usr/bin/security add-generic-password \
  -U \
  -a nasstoragesystem \
  -s nas-warden/control-plane-agent-token \
  -w 'PASTE_AGENT_TOKEN_HERE'
```

Fallback if Keychain access is unreliable for the running NAS Warden process:

- `/Users/nasstoragesystem/ops/nas_warden_v2/runtime/state/local_secrets.json`

## Order Of Operations

1. Generate `CONTROL_PLANE_AGENT_TOKEN` and `ADMIN_API_TOKEN`.
2. Create or identify `CLOUDFLARE_ACCOUNT_ID`.
3. Create D1 and capture `CLOUDFLARE_D1_DATABASE_ID`.
4. Create the GitHub repository and push the standalone control-plane repo.
5. Add GitHub repo secrets.
6. Let GitHub Actions deploy the Worker and provision Worker runtime secrets.
7. Verify both the temporary `workers.dev` URL and `https://control.1537396697323.xyz/healthz`.
8. Put Cloudflare Access in front of `https://control.1537396697323.xyz/api/*` before NAS enablement.
9. Store `CONTROL_PLANE_AGENT_TOKEN` on the NAS.
10. Enable `control_plane` in NAS `config.json` with `https://control.1537396697323.xyz`.
