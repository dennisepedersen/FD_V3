async function claimNextSyncJob(client) {
  const selectSql = `
    SELECT id, tenant_id, type, status, retry_count
    FROM sync_job
    WHERE type IN ('bootstrap', 'delta')
      AND status = 'queued'
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    ORDER BY
      CASE type WHEN 'bootstrap' THEN 0 ELSE 1 END,
      created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `;

  const selected = await client.query(selectSql);
  const job = selected.rows[0] || null;
  if (!job) {
    return null;
  }

  const updateSql = `
    UPDATE sync_job
    SET
      status = 'running',
      started_at = now(),
      finished_at = NULL,
      error_message = NULL,
      error = NULL,
      last_run = now(),
      retry_count = COALESCE(retry_count, 0),
      updated_at = now()
    WHERE id = $1
    RETURNING id, tenant_id, type, status, retry_count
  `;

  const updated = await client.query(updateSql, [job.id]);
  return updated.rows[0] || null;
}

async function markJobHeartbeat(client, { jobId }) {
  await client.query(
    `
      UPDATE sync_job
      SET updated_at = now()
      WHERE id = $1
    `,
    [jobId]
  );
}

async function markJobProgress(client, { jobId, rowsProcessed, pagesProcessed }) {
  await client.query(
    `
      UPDATE sync_job
      SET
        rows_processed = $2,
        pages_processed = $3,
        updated_at = now()
      WHERE id = $1
    `,
    [jobId, rowsProcessed, pagesProcessed]
  );
}

async function markJobSuccess(client, { jobId, rowsProcessed, pagesProcessed }) {
  await client.query(
    `
      UPDATE sync_job
      SET
        status = 'success',
        finished_at = now(),
        last_run = now(),
        rows_processed = $2,
        pages_processed = $3,
        error_message = NULL,
        error = NULL,
        next_retry_at = NULL,
        updated_at = now()
      WHERE id = $1
    `,
    [jobId, rowsProcessed, pagesProcessed]
  );
}

async function markJobFailure(client, { jobId, errorMessage, nextStatus, nextRetryAt, nextRetryCount }) {
  await client.query(
    `
      UPDATE sync_job
      SET
        status = $2,
        error_message = $3,
        error = $3,
        retry_count = $4,
        next_retry_at = $5,
        last_run = now(),
        finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE finished_at END,
        updated_at = now()
      WHERE id = $1
    `,
    [jobId, nextStatus, errorMessage, nextRetryCount, nextRetryAt]
  );
}

module.exports = {
  claimNextSyncJob,
  markJobHeartbeat,
  markJobProgress,
  markJobSuccess,
  markJobFailure,
};
