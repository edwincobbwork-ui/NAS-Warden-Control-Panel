-- NAS Warden always-on control plane schema v1
-- Designed for Cloudflare D1 as the durable system-of-record.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS nas_nodes (
    node_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    host_name TEXT NOT NULL DEFAULT '',
    app_version TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_boot_at TEXT NOT NULL DEFAULT '',
    tailscale_ip TEXT NOT NULL DEFAULT '',
    lan_ip TEXT NOT NULL DEFAULT '',
    capabilities_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS heartbeats (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    summary_status TEXT NOT NULL,
    queue_depth INTEGER NOT NULL DEFAULT 0,
    checks_json TEXT NOT NULL DEFAULT '[]',
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (node_id) REFERENCES nas_nodes(node_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_node_ts
ON heartbeats(node_id, ts DESC);

CREATE TABLE IF NOT EXISTS jobs (
    job_id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    workspace_slug TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    requested_by TEXT NOT NULL DEFAULT '',
    source_object_key TEXT NOT NULL DEFAULT '',
    source_local_path TEXT NOT NULL DEFAULT '',
    target_path TEXT NOT NULL DEFAULT '',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT NOT NULL DEFAULT '',
    lease_expires_at TEXT NOT NULL DEFAULT '',
    requires_approval INTEGER NOT NULL DEFAULT 0,
    approved_at TEXT NOT NULL DEFAULT '',
    completed_at TEXT NOT NULL DEFAULT '',
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    params_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_priority
ON jobs(status, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_jobs_workspace_status
ON jobs(workspace_slug, status, created_at);

CREATE TABLE IF NOT EXISTS job_events (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    level TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_events_job_ts
ON job_events(job_id, ts DESC);

CREATE TABLE IF NOT EXISTS approval_requests (
    approval_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL DEFAULT '',
    action_type TEXT NOT NULL,
    status TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    resolved_at TEXT NOT NULL DEFAULT '',
    requested_by TEXT NOT NULL DEFAULT '',
    resolved_by TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    context_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_approval_status_requested
ON approval_requests(status, requested_at DESC);

CREATE TABLE IF NOT EXISTS uploads (
    upload_id TEXT PRIMARY KEY,
    workspace_slug TEXT NOT NULL,
    object_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    uploader_identity TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_uploads_workspace_created
ON uploads(workspace_slug, created_at DESC);

CREATE TABLE IF NOT EXISTS service_checks (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    check_name TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    recorded_at TEXT NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nas_nodes(node_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_service_checks_node_recorded
ON service_checks(node_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_notifications_created
ON notifications(created_at DESC);
