const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-nas-warden-agent-token",
};

const DEFAULT_HEARTBEAT_STALE_MINUTES = 120;
const DEFAULT_HEARTBEAT_WARN_MINUTES = 60;
const CLAIMABLE_JOB_STATUSES = ["queued", "waiting_for_nas", "retry_wait"];
const REPORTABLE_JOB_STATUSES = ["completed", "failed", "retry_wait", "cancelled"];

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return json(
        {
          ok: false,
          error: "internal_error",
          message: error instanceof Error ? error.message : String(error),
        },
        typeof error?.status === "number" ? error.status : 500,
      );
    }
  },
};

async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
      },
    });
  }

  if (request.method === "GET" && url.pathname === "/healthz") {
    return json({
      ok: true,
      service: "nas-warden-control-plane",
      ts: new Date().toISOString(),
    });
  }

  if (request.method === "POST" && url.pathname === "/agent/heartbeat") {
    requireAgentAuth(request, env);
    const body = await request.json();
    return json(await acceptHeartbeat(env, body));
  }

  if (request.method === "POST" && url.pathname === "/agent/jobs/claim") {
    requireAgentAuth(request, env);
    const body = await request.json();
    return json(await claimJobs(env, body));
  }

  if (request.method === "POST" && /^\/agent\/jobs\/[^/]+\/result$/.test(url.pathname)) {
    requireAgentAuth(request, env);
    const body = await request.json();
    const jobId = decodeURIComponent(url.pathname.split("/")[3] || "");
    return json(await reportJobResult(env, jobId, body));
  }

  if (request.method === "GET" && url.pathname === "/api/status/summary") {
    requireAdminAuth(request, env);
    return json(await statusSummary(env));
  }

  if (request.method === "POST" && url.pathname === "/api/jobs") {
    requireAdminAuth(request, env);
    const body = await request.json();
    return json(await createJob(env, body), 201);
  }

  if (request.method === "GET" && url.pathname === "/api/jobs") {
    requireAdminAuth(request, env);
    return json(await listJobs(env, url));
  }

  if (request.method === "GET" && url.pathname === "/api/approvals") {
    requireAdminAuth(request, env);
    return json(await listApprovals(env, url));
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
    requireAdminAuth(request, env);
    const jobId = decodeURIComponent(url.pathname.slice("/api/jobs/".length));
    return json(await getJob(env, jobId));
  }

  if (request.method === "POST" && /^\/api\/approvals\/[^/]+\/approve$/.test(url.pathname)) {
    requireAdminAuth(request, env);
    const approvalId = decodeURIComponent(url.pathname.split("/")[3] || "");
    return json(await resolveApproval(env, approvalId, true));
  }

  if (request.method === "POST" && /^\/api\/approvals\/[^/]+\/deny$/.test(url.pathname)) {
    requireAdminAuth(request, env);
    const approvalId = decodeURIComponent(url.pathname.split("/")[3] || "");
    return json(await resolveApproval(env, approvalId, false));
  }

  return json(
    {
      ok: false,
      error: "not_found",
      path: url.pathname,
    },
    404,
  );
}

async function acceptHeartbeat(env, body) {
  const snapshot = body && typeof body === "object" ? body.snapshot : null;
  if (!snapshot || typeof snapshot !== "object") {
    throw httpError(400, "heartbeat payload must include a snapshot object");
  }

  const node = snapshot.node || {};
  const nodeId = safeString(node.node_id);
  if (!nodeId) {
    throw httpError(400, "snapshot.node.node_id is required");
  }

  const now = new Date().toISOString();
  const reportedSeenAt = safeString(snapshot?.presence?.last_seen_at) || now;
  const health = snapshot?.health || {};
  const checks = Array.isArray(snapshot.checks) ? snapshot.checks : [];
  const queue = snapshot?.queue || {};
  const network = node.network || {};

  await env.DB.prepare(
    `INSERT INTO nas_nodes (
       node_id, label, host_name, app_version, status, last_seen_at, tailscale_ip, lan_ip, capabilities_json, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(node_id) DO UPDATE SET
       label = excluded.label,
       host_name = excluded.host_name,
       app_version = excluded.app_version,
       status = excluded.status,
       last_seen_at = excluded.last_seen_at,
       tailscale_ip = excluded.tailscale_ip,
       lan_ip = excluded.lan_ip,
       capabilities_json = excluded.capabilities_json,
       updated_at = excluded.updated_at`
  )
    .bind(
      nodeId,
      safeString(node.label) || nodeId,
      safeString(node.label) || nodeId,
      safeString(body?.app_version),
      safeString(snapshot?.presence?.state) || "online",
      now,
      safeString(network.tailscale_ip),
      safeString(network.lan_ip),
      JSON.stringify(node.capabilities || {}),
      now,
    )
    .run();

  const heartbeatId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO heartbeats (
       id, node_id, ts, summary_status, queue_depth, checks_json, details_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      heartbeatId,
      nodeId,
      safeString(body.generated_at) || now,
      safeString(health.overall) || "WARN",
      totalQueueDepth(queue),
      JSON.stringify(checks),
      JSON.stringify({
        presence: {
          state: safeString(snapshot?.presence?.state) || "online",
          reported_last_seen_at: reportedSeenAt,
          received_at: now,
        },
        queue,
        services: snapshot.services || {},
        storage: snapshot.storage || {},
      }),
    )
    .run();

  const checkStatements = checks.map((item) =>
    env.DB.prepare(
      `INSERT INTO service_checks (
         id, node_id, check_name, status, summary, details_json, recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      nodeId,
      safeString(item.name),
      safeString(item.status),
      safeString(item.summary),
      JSON.stringify(item.details || {}),
      safeString(body.generated_at) || now,
    ),
  );
  if (checkStatements.length) {
    await env.DB.batch(checkStatements);
  }

  return {
    ok: true,
    node_id: nodeId,
    received_at: now,
    heartbeat_id: heartbeatId,
    checks_recorded: checkStatements.length,
  };
}

async function claimJobs(env, body) {
  const nodeId = safeString(body?.node_id);
  if (!nodeId) {
    throw httpError(400, "node_id is required");
  }
  const limit = clampInteger(body?.limit, 1, 25, 5);
  const now = new Date().toISOString();
  const leaseTtlMinutes = clampInteger(env.JOB_LEASE_MINUTES, 1, 120, 20);
  const leaseExpiresAt = new Date(Date.now() + leaseTtlMinutes * 60 * 1000).toISOString();

  const statusPlaceholders = CLAIMABLE_JOB_STATUSES.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(
    `SELECT job_id, job_type, workspace_slug, status, priority, source_object_key, source_local_path, target_path, params_json
     FROM jobs
     WHERE status IN (${statusPlaceholders})
       AND (requires_approval = 0 OR approved_at != '')
       AND (lease_expires_at = '' OR lease_expires_at < ?)
     ORDER BY priority ASC, created_at ASC
     LIMIT ?`
  )
    .bind(...CLAIMABLE_JOB_STATUSES, now, limit)
    .all();

  const claimed = [];
  for (const row of results || []) {
    const update = await env.DB.prepare(
      `UPDATE jobs
       SET status = ?, lease_owner = ?, lease_expires_at = ?, updated_at = ?, attempt_count = attempt_count + 1
       WHERE job_id = ?
         AND status IN (${statusPlaceholders})
         AND (lease_expires_at = '' OR lease_expires_at < ?)`
    )
      .bind(
        "leased",
        nodeId,
        leaseExpiresAt,
        now,
        row.job_id,
        ...CLAIMABLE_JOB_STATUSES,
        now,
      )
      .run();

    const changes = update?.meta?.changes || 0;
    if (!changes) {
      continue;
    }

    await env.DB.prepare(
      `INSERT INTO job_events (
         id, job_id, ts, level, event_type, message, details_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        row.job_id,
        now,
        "INFO",
        "leased",
        `${nodeId} claimed job ${row.job_id}.`,
        JSON.stringify({
          lease_owner: nodeId,
          lease_expires_at: leaseExpiresAt,
        }),
      )
      .run();

    claimed.push({
      job_id: row.job_id,
      job_type: row.job_type,
      workspace_slug: row.workspace_slug,
      status: "leased",
      lease_owner: nodeId,
      lease_expires_at: leaseExpiresAt,
      source_object_key: row.source_object_key,
      source_local_path: row.source_local_path,
      target_path: row.target_path,
      params: parseJson(row.params_json),
    });
  }

  return {
    ok: true,
    node_id: nodeId,
    claimed_count: claimed.length,
    jobs: claimed,
    generated_at: now,
  };
}

async function reportJobResult(env, jobId, body) {
  if (!jobId) {
    throw httpError(400, "job id is required");
  }

  const payload = requireObject(body, "job result payload");
  const nodeId = requiredToken(payload.node_id, "node_id", 128);
  const nextStatus = requiredToken(payload.status, "status", 32).toLowerCase();
  if (!REPORTABLE_JOB_STATUSES.includes(nextStatus)) {
    throw httpError(400, `unsupported job result status: ${nextStatus}`);
  }

  const message = limitedString(payload.message, "message", 1024);
  const errorCode = optionalToken(payload.error_code, "error_code", 128);
  const errorMessage = limitedString(payload.error_message, "error_message", 1024);
  const details = requireObject(payload.details ?? {}, "details");
  const retryDelayMinutes = clampInteger(payload.retry_delay_minutes, 1, 1440, 15);
  const now = new Date().toISOString();

  const existing = await env.DB.prepare(
    `SELECT job_id, status, lease_owner, lease_expires_at, attempt_count
     FROM jobs
     WHERE job_id = ?
     LIMIT 1`
  )
    .bind(jobId)
    .first();
  if (!existing) {
    throw httpError(404, "job not found");
  }
  if (safeString(existing.status) !== "leased") {
    throw httpError(409, `job ${jobId} is ${safeString(existing.status) || "not leased"}`);
  }
  if (safeString(existing.lease_owner) !== nodeId) {
    throw httpError(409, `job ${jobId} is leased to ${safeString(existing.lease_owner) || "another node"}`);
  }

  let completedAt = "";
  let leaseExpiresAt = "";
  let nextErrorCode = errorCode;
  let nextErrorMessage = errorMessage;
  let eventLevel = "INFO";
  let eventType = nextStatus;
  let eventMessage = message;

  if (nextStatus === "completed") {
    completedAt = now;
    nextErrorCode = "";
    nextErrorMessage = "";
    eventMessage = eventMessage || `${nodeId} completed job ${jobId}.`;
  } else if (nextStatus === "failed") {
    completedAt = now;
    nextErrorCode = nextErrorCode || "job_failed";
    nextErrorMessage = nextErrorMessage || eventMessage || `Job ${jobId} failed on ${nodeId}.`;
    eventLevel = "ERROR";
    eventMessage = eventMessage || `${nodeId} reported job ${jobId} as failed.`;
  } else if (nextStatus === "cancelled") {
    completedAt = now;
    nextErrorCode = nextErrorCode || "job_cancelled";
    nextErrorMessage = nextErrorMessage || eventMessage || `Job ${jobId} was cancelled by ${nodeId}.`;
    eventLevel = "WARN";
    eventMessage = eventMessage || `${nodeId} cancelled job ${jobId}.`;
  } else if (nextStatus === "retry_wait") {
    leaseExpiresAt = new Date(Date.now() + retryDelayMinutes * 60 * 1000).toISOString();
    nextErrorCode = nextErrorCode || "retry_wait";
    nextErrorMessage = nextErrorMessage || eventMessage || `Job ${jobId} will retry after backoff.`;
    eventLevel = "WARN";
    eventType = "retry-wait";
    eventMessage = eventMessage || `${nodeId} returned job ${jobId} to retry_wait.`;
  }

  const update = await env.DB.prepare(
    `UPDATE jobs
     SET status = ?, lease_owner = '', lease_expires_at = ?, completed_at = ?, error_code = ?, error_message = ?, updated_at = ?
     WHERE job_id = ?
       AND status = 'leased'
       AND lease_owner = ?`
  )
    .bind(
      nextStatus,
      leaseExpiresAt,
      completedAt,
      nextErrorCode,
      nextErrorMessage,
      now,
      jobId,
      nodeId,
    )
    .run();
  if (!(update?.meta?.changes || 0)) {
    throw httpError(409, `job ${jobId} is no longer leased to ${nodeId}`);
  }

  await env.DB.prepare(
    `INSERT INTO job_events (
       id, job_id, ts, level, event_type, message, details_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      jobId,
      now,
      eventLevel,
      eventType,
      eventMessage,
      JSON.stringify({
        node_id: nodeId,
        prior_status: safeString(existing.status),
        attempt_count: Number(existing.attempt_count || 0),
        retry_delay_minutes: nextStatus === "retry_wait" ? retryDelayMinutes : 0,
        retry_available_at: leaseExpiresAt,
        error_code: nextErrorCode,
        error_message: nextErrorMessage,
        ...details,
      }),
    )
    .run();

  return {
    ok: true,
    job_id: jobId,
    node_id: nodeId,
    status: nextStatus,
    updated_at: now,
    lease_expires_at: leaseExpiresAt,
    completed_at: completedAt,
    error_code: nextErrorCode,
    error_message: nextErrorMessage,
  };
}

async function statusSummary(env) {
  const now = Date.now();
  const staleMs = clampInteger(env.HEARTBEAT_STALE_MINUTES, 1, 120, DEFAULT_HEARTBEAT_STALE_MINUTES) * 60 * 1000;
  const warnMs = clampInteger(env.HEARTBEAT_WARN_MINUTES, 1, 60, DEFAULT_HEARTBEAT_WARN_MINUTES) * 60 * 1000;

  const nodesQuery = await env.DB.prepare(
    `SELECT node_id, label, status, last_seen_at, tailscale_ip, lan_ip
     FROM nas_nodes
     ORDER BY label ASC`
  ).all();
  const jobCountsQuery = await env.DB.prepare(
    `SELECT status, COUNT(*) AS count
     FROM jobs
     GROUP BY status`
  ).all();
  const approvalCountsQuery = await env.DB.prepare(
    `SELECT status, COUNT(*) AS count
     FROM approval_requests
     GROUP BY status`
  ).all();

  const nodes = (nodesQuery.results || []).map((row) => {
    const lastSeen = Date.parse(row.last_seen_at || "");
    let derived = "offline";
    if (!Number.isNaN(lastSeen)) {
      const age = now - lastSeen;
      if (age <= warnMs) {
        derived = "online";
      } else if (age <= staleMs) {
        derived = "stale";
      }
    }
    return {
      node_id: row.node_id,
      label: row.label,
      status: derived,
      last_seen_at: row.last_seen_at,
      tailscale_ip: row.tailscale_ip,
      lan_ip: row.lan_ip,
    };
  });

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    nodes,
    jobs: countRows(jobCountsQuery.results || []),
    approvals: countRows(approvalCountsQuery.results || []),
  };
}

async function createJob(env, body) {
  const payload = requireObject(body, "job payload");
  const now = new Date().toISOString();
  const jobId = optionalToken(payload.job_id, "job_id", 128) || crypto.randomUUID();
  const jobType = requiredToken(payload.job_type, "job_type", 64).toLowerCase();
  const workspaceSlug = optionalToken(payload.workspace_slug, "workspace_slug", 80).toLowerCase();
  const requestedBy = safeString(payload.requested_by) || "admin-api";
  const priority = clampInteger(payload.priority, 1, 1000, 100);
  const requiresApproval = booleanFlag(payload.requires_approval);
  const params = requireObject(payload.params ?? {}, "params");
  const sourceObjectKey = limitedString(payload.source_object_key, "source_object_key", 512);
  const sourceLocalPath = limitedString(payload.source_local_path, "source_local_path", 1024);
  const targetPath = limitedString(payload.target_path, "target_path", 1024);

  const existing = await env.DB.prepare(
    `SELECT job_id
     FROM jobs
     WHERE job_id = ?
     LIMIT 1`
  )
    .bind(jobId)
    .first();
  if (existing) {
    throw httpError(409, `job already exists: ${jobId}`);
  }

  const initialStatus = requiresApproval ? "waiting_for_approval" : "queued";
  await env.DB.prepare(
    `INSERT INTO jobs (
       job_id, job_type, workspace_slug, status, priority, requested_by, source_object_key, source_local_path,
       target_path, attempt_count, lease_owner, lease_expires_at, requires_approval, approved_at, completed_at,
       error_code, error_message, params_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', ?, '', '', '', '', ?, ?, ?)`
  )
    .bind(
      jobId,
      jobType,
      workspaceSlug,
      initialStatus,
      priority,
      requestedBy,
      sourceObjectKey,
      sourceLocalPath,
      targetPath,
      requiresApproval ? 1 : 0,
      JSON.stringify(params),
      now,
      now,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO job_events (
       id, job_id, ts, level, event_type, message, details_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      jobId,
      now,
      "INFO",
      "created",
      `Admin created job ${jobId}.`,
      JSON.stringify({
        job_type: jobType,
        requested_by: requestedBy,
        requires_approval: requiresApproval,
      }),
    )
    .run();

  let approval = null;
  if (requiresApproval) {
    const approvalId = crypto.randomUUID();
    const actionType = optionalToken(payload.approval_action_type, "approval_action_type", 64) || "job_execution";
    const reason = safeString(payload.approval_reason) || `Approval required before ${jobType} can run.`;
    const context = {
      job_id: jobId,
      job_type: jobType,
      workspace_slug: workspaceSlug,
      target_path: targetPath,
      params,
      ...(requireObject(payload.approval_context ?? {}, "approval_context")),
    };

    await env.DB.prepare(
      `INSERT INTO approval_requests (
         approval_id, job_id, action_type, status, requested_at, resolved_at, requested_by, resolved_by, reason, context_json
       ) VALUES (?, ?, ?, ?, ?, '', ?, '', ?, ?)`
    )
      .bind(
        approvalId,
        jobId,
        actionType,
        "pending",
        now,
        requestedBy,
        reason,
        JSON.stringify(context),
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO job_events (
         id, job_id, ts, level, event_type, message, details_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        jobId,
        now,
        "INFO",
        "approval-requested",
        `Approval ${approvalId} is pending for job ${jobId}.`,
        JSON.stringify({
          approval_id: approvalId,
          action_type: actionType,
        }),
      )
      .run();

    approval = {
      approval_id: approvalId,
      action_type: actionType,
      status: "pending",
      requested_at: now,
      reason,
    };
  }

  return {
    ok: true,
    job: {
      job_id: jobId,
      job_type: jobType,
      workspace_slug: workspaceSlug,
      status: initialStatus,
      priority,
      requested_by: requestedBy,
      requires_approval: requiresApproval,
      source_object_key: sourceObjectKey,
      source_local_path: sourceLocalPath,
      target_path: targetPath,
      params,
      created_at: now,
      updated_at: now,
    },
    approval,
  };
}

async function listJobs(env, url) {
  const status = url.searchParams.get("status") || "";
  const limit = clampInteger(url.searchParams.get("limit"), 1, 200, 50);
  const query = status
    ? env.DB.prepare(
        `SELECT job_id, job_type, workspace_slug, status, priority, requested_by, created_at, updated_at, lease_owner, lease_expires_at,
                requires_approval, approved_at
         FROM jobs
         WHERE status = ?
         ORDER BY created_at DESC
         LIMIT ?`
      ).bind(status, limit)
    : env.DB.prepare(
        `SELECT job_id, job_type, workspace_slug, status, priority, requested_by, created_at, updated_at, lease_owner, lease_expires_at,
                requires_approval, approved_at
         FROM jobs
         ORDER BY created_at DESC
         LIMIT ?`
      ).bind(limit);
  const { results } = await query.all();
  return {
    ok: true,
    results: results || [],
  };
}

async function listApprovals(env, url) {
  const status = optionalToken(url.searchParams.get("status"), "status", 64);
  const limit = clampInteger(url.searchParams.get("limit"), 1, 200, 50);
  const query = status
    ? env.DB.prepare(
        `SELECT approval_id, job_id, action_type, status, requested_at, resolved_at, requested_by, resolved_by, reason, context_json
         FROM approval_requests
         WHERE status = ?
         ORDER BY requested_at DESC
         LIMIT ?`
      ).bind(status, limit)
    : env.DB.prepare(
        `SELECT approval_id, job_id, action_type, status, requested_at, resolved_at, requested_by, resolved_by, reason, context_json
         FROM approval_requests
         ORDER BY requested_at DESC
         LIMIT ?`
      ).bind(limit);
  const { results } = await query.all();
  return {
    ok: true,
    results: (results || []).map((item) => ({
      ...item,
      context_json: parseJson(item.context_json),
    })),
  };
}

async function getJob(env, jobId) {
  if (!jobId) {
    throw httpError(400, "job id is required");
  }
  const job = await env.DB.prepare(
    `SELECT *
     FROM jobs
     WHERE job_id = ?
     LIMIT 1`
  )
    .bind(jobId)
    .first();
  if (!job) {
    throw httpError(404, "job not found");
  }

  const { results: events } = await env.DB.prepare(
    `SELECT id, ts, level, event_type, message, details_json
     FROM job_events
     WHERE job_id = ?
     ORDER BY ts DESC
     LIMIT 50`
  )
    .bind(jobId)
    .all();

  return {
    ok: true,
    job: {
      ...job,
      params_json: parseJson(job.params_json),
    },
    events: (events || []).map((event) => ({
      ...event,
      details_json: parseJson(event.details_json),
    })),
  };
}

async function resolveApproval(env, approvalId, approved) {
  if (!approvalId) {
    throw httpError(400, "approval id is required");
  }

  const existing = await env.DB.prepare(
    `SELECT approval_id, job_id, status
     FROM approval_requests
     WHERE approval_id = ?
     LIMIT 1`
  )
    .bind(approvalId)
    .first();
  if (!existing) {
    throw httpError(404, "approval not found");
  }
  if (existing.status !== "pending") {
    throw httpError(409, `approval is already ${existing.status}`);
  }

  const now = new Date().toISOString();
  const nextStatus = approved ? "approved" : "denied";
  await env.DB.prepare(
    `UPDATE approval_requests
     SET status = ?, resolved_at = ?, resolved_by = ?
     WHERE approval_id = ?`
  )
    .bind(nextStatus, now, "admin-api", approvalId)
    .run();

  if (existing.job_id) {
    await env.DB.prepare(
      `UPDATE jobs
       SET status = ?, approved_at = ?, updated_at = ?, error_code = ?, error_message = ?
       WHERE job_id = ?`
    )
      .bind(
        approved ? "queued" : "cancelled",
        approved ? now : "",
        now,
        approved ? "" : "approval_denied",
        approved ? "" : "Approval was denied from the admin API.",
        existing.job_id,
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO job_events (
         id, job_id, ts, level, event_type, message, details_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        existing.job_id,
        now,
        "INFO",
        approved ? "approval-approved" : "approval-denied",
        approved ? `Approval ${approvalId} was approved.` : `Approval ${approvalId} was denied.`,
        JSON.stringify({ approval_id: approvalId }),
      )
      .run();
  }

  return {
    ok: true,
    approval_id: approvalId,
    status: nextStatus,
    resolved_at: now,
  };
}

function requireAgentAuth(request, env) {
  const expected = safeString(env.CONTROL_PLANE_AGENT_TOKEN);
  if (!expected) {
    return;
  }
  const provided =
    bearerToken(request.headers.get("authorization")) ||
    safeString(request.headers.get("x-nas-warden-agent-token"));
  if (!provided || provided !== expected) {
    throw httpError(401, "agent authentication failed");
  }
}

function requireAdminAuth(request, env) {
  const expected = safeString(env.ADMIN_API_TOKEN);
  if (!expected) {
    return;
  }
  const provided = bearerToken(request.headers.get("authorization"));
  if (!provided || provided !== expected) {
    throw httpError(401, "admin authentication failed");
  }
}

function bearerToken(value) {
  const raw = safeString(value);
  if (!raw.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return raw.slice(7).trim();
}

function countRows(rows) {
  const counts = {};
  for (const row of rows) {
    counts[safeString(row.status)] = Number(row.count || 0);
  }
  return counts;
}

function booleanFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }
  const raw = safeString(value).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function totalQueueDepth(queue) {
  return (
    Number(queue.pending_approvals || 0) +
    Number(queue.approved_actions || 0) +
    Number(queue.failed_actions || 0)
  );
}

function parseJson(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw httpError(400, `${fieldName} must be an object`);
  }
  return value;
}

function requiredToken(value, fieldName, maxLength = 64) {
  const raw = optionalToken(value, fieldName, maxLength);
  if (!raw) {
    throw httpError(400, `${fieldName} is required`);
  }
  return raw;
}

function optionalToken(value, fieldName, maxLength = 64) {
  const raw = safeString(value);
  if (!raw) {
    return "";
  }
  if (raw.length > maxLength) {
    throw httpError(400, `${fieldName} is too long`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(raw)) {
    throw httpError(400, `${fieldName} contains unsupported characters`);
  }
  return raw;
}

function limitedString(value, fieldName, maxLength) {
  const raw = safeString(value);
  if (raw.length > maxLength) {
    throw httpError(400, `${fieldName} is too long`);
  }
  return raw;
}

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2) + "\n", {
    status,
    headers: {
      ...JSON_HEADERS,
      ...CORS_HEADERS,
    },
  });
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
