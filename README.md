# NAS Warden Control Plane

This directory is the standalone control-plane scaffold for the always-on NAS Warden rollout.

It is intentionally structured so it can be copied into its own Git repository and deployed independently of the main NAS Warden app repo.

## Contents

- `.github/workflows/deploy-worker.yml`
  - GitHub Actions deployment path for Big Sur-only environments
- `schema-v1.sql`
  - D1 schema for the control plane
- `worker/`
  - Cloudflare Worker scaffold
- `deployment-runbook.md`
  - full deployment instructions
- `operator-checklist.md`
  - short execution checklist

## Primary Paths

- Worker entry:
  - `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/worker/src/index.js`
- D1 schema:
  - `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/schema-v1.sql`
- GitHub Actions workflow:
  - `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/.github/workflows/deploy-worker.yml`

## Current Deployment Posture

- the Wrangler template now includes the planned custom domain:
  - `control.1537396697323.xyz`
- the prepared GitHub Actions workflow now expects five repository secrets:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_D1_DATABASE_ID`
  - `CONTROL_PLANE_AGENT_TOKEN`
  - `ADMIN_API_TOKEN`
- when those GitHub secrets are present, CI can:
  - apply the D1 schema
  - upsert the two Worker runtime secrets
  - deploy the Worker
- Cloudflare Access for `control.1537396697323.xyz/api/*` still needs to be configured before NAS enablement

## Big Sur Workflow

Because this NAS host is on Big Sur and cannot reliably run the current supported Wrangler toolchain, the intended deployment path is:

1. author and review from this Mac
2. export this directory into its own Git repository
3. push that repository to GitHub
4. let GitHub-hosted CI deploy the Worker

## Helper

To generate a standalone GitHub-ready export from this folder, use:

- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/prepare-github-export.sh`

To create or inspect the D1 database directly from this Mac via Cloudflare API, use:

- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/create-d1-via-api.sh`
- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/list-d1-via-api.sh`

To generate the agent/admin runtime secrets from this Mac, use:

- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/generate-control-plane-secrets.sh`

For the exact GitHub and Cloudflare secret names and their purposes, use:

- `/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane/github-secrets-checklist.md`
