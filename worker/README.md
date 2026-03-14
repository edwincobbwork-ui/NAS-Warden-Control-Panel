# NAS Warden Control Plane Worker

This directory contains the first cloud-side scaffold for the always-on NAS Warden control plane.

It is intentionally dependency-light:

- plain Cloudflare Worker module
- D1 binding for durable state
- no framework requirement

## Purpose

This Worker is the counterpart to the NAS-side files already added in:

- `src/nas_warden_v2/control_plane.py`
- `src/nas_warden_v2/control_plane_agent.py`

The NAS can now:

- generate a normalized control-plane snapshot
- send a heartbeat payload
- ask for claimable jobs

This Worker accepts those contracts and persists them in D1.

## Files

- `src/index.js`
  - Worker routes and D1 persistence logic
- `wrangler.example.toml`
  - example Wrangler configuration
- `../schema-v1.sql`
  - D1 schema to apply before deployment
- `../deployment-runbook.md`
  - step-by-step deployment checklist for a supported workstation plus NAS cutover

## Routes

### Public / operational

- `GET /healthz`
  - simple liveness probe

### Agent routes

- `POST /agent/heartbeat`
  - accepts the NAS snapshot envelope
  - upserts `nas_nodes`
  - appends a `heartbeats` row
  - appends `service_checks`

- `POST /agent/jobs/claim`
  - returns claimable jobs
  - marks them `leased`
  - writes `job_events`

### Admin API routes

- `GET /api/status/summary`
- `GET /api/jobs`
- `GET /api/jobs/:jobId`
- `POST /api/approvals/:approvalId/approve`
- `POST /api/approvals/:approvalId/deny`

## Auth Model

Two independent secrets are expected:

- `CONTROL_PLANE_AGENT_TOKEN`
  - used by the NAS worker agent
- `ADMIN_API_TOKEN`
  - used by admin/API clients

If either secret is absent, that auth layer is effectively open. That makes local bootstrapping easier, but production should always set both.

## Deployment Notes

1. Create the D1 database.
2. Copy `wrangler.example.toml` to `wrangler.toml` and fill in the real D1 database ID.
3. Keep the custom domain route for:
   - `control.1537396697323.xyz`
4. Apply `schema-v1.sql`.
5. Add secrets with Wrangler or GitHub Actions:
   - `CONTROL_PLANE_AGENT_TOKEN`
   - `ADMIN_API_TOKEN`
6. Deploy the Worker and verify both:
   - the temporary `workers.dev` URL
   - `https://control.1537396697323.xyz/healthz`
7. Put Cloudflare Access in front of:
   - `https://control.1537396697323.xyz/api/*`
   - future `https://control.1537396697323.xyz/admin/*`
8. Update NAS Warden `config.json`:
   - set `control_plane.enabled` to `true`
   - set `control_plane.base_url` to `https://control.1537396697323.xyz`
   - store the matching NAS agent token in Keychain or `local_secrets.json`

## Current Limits

This is a v1 scaffold, not the finished control plane.

Current intentional simplifications:

- no browser auth or UI yet
- no upload-intent endpoint yet
- no write-side admin UI yet
- no queue dead-letter handling yet
- job leasing is optimistic rather than full transactionally locked orchestration

Those are acceptable for the current milestone because the goal here is to establish:

- the route contract
- the persistence model
- the node heartbeat path
- the claimable-job API shape

## Expected Next Step

The next implementation step should be one of:

- add `POST /api/uploads/create` and `POST /api/uploads/complete`
- add `POST /api/archive/create`
- add a small admin front end on top of the existing routes
