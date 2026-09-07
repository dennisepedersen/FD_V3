'use strict';

async function listIgvaPocProjectsForUser(client, { tenantId, userId }) {
  const sql = `
    WITH current_actor AS (
      SELECT lower(nullif(btrim(username), '')) AS username_ci
      FROM tenant_user
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    ),
    scoped_projects AS (
      SELECT DISTINCT
        pc.tenant_id,
        pc.project_id,
        pc.external_project_ref,
        pc.name,
        pc.status,
        pc.is_closed,
        pc.closed_observed_at,
        pw.is_work_in_progress,
        pw.is_work_in_progress AS financial_wip,
        pw.ready_to_bill,
        pw.margin,
        pw.costs,
        pw.ongoing,
        pw.billed,
        pw.coverage,
        pw.hours_budget,
        pw.hours_expected,
        pw.hours_fitter_hour,
        pw.remaining_hours,
        pm.ek_project_id,
        pm.project_expected_values,
        pm.project_budget,
        pm.total_turn_over_exp,
        pm.source_updated_at,
        pc.responsible_code,
        pc.responsible_name,
        pc.responsible_id,
        pc.team_leader_code,
        pc.team_leader_name,
        pc.team_leader_id,
        imc.completion_percent AS project_manager_completion_percent,
        imc.comment AS project_manager_completion_comment,
        imc.changed_at AS project_manager_completion_changed_at,
        imc.changed_by AS project_manager_completion_changed_by,
        ips.calculated_at AS igva_summary_calculated_at,
        ips.source_synced_at AS igva_summary_source_synced_at,
        ips.freshness_policy_key AS igva_summary_freshness_policy_key,
        ips.budget_completion_percent AS igva_summary_budget_completion_percent,
        ips.expected_completion_percent AS igva_summary_expected_completion_percent,
        ips.manager_completion_percent AS igva_summary_manager_completion_percent,
        ips.labor_completion_percent AS igva_summary_labor_completion_percent,
        ips.material_completion_percent AS igva_summary_material_completion_percent,
        ips.revenue_actual AS igva_summary_revenue_actual,
        ips.revenue_expected AS igva_summary_revenue_expected,
        ips.cost_actual AS igva_summary_cost_actual,
        ips.cost_expected AS igva_summary_cost_expected,
        ips.contribution_margin_expected AS igva_summary_contribution_margin_expected,
        ips.coverage_expected AS igva_summary_coverage_expected,
        ips.quality_status AS igva_summary_quality_status,
        ips.economy_status AS igva_summary_economy_status,
        ips.summary_json AS igva_summary_json,
        ips.source_metadata AS igva_summary_source_metadata,
        ips.last_error AS igva_summary_last_error,
        pc.created_at,
        pc.updated_at
      FROM project_core pc
      CROSS JOIN current_actor cu
      LEFT JOIN project_assignment pa
        ON pa.tenant_id = pc.tenant_id
       AND pa.project_id = pc.project_id
      LEFT JOIN project_wip pw
        ON pw.project_id = pc.project_id
       AND pw.tenant_id = pc.tenant_id
      LEFT JOIN project_masterdata_v4 pm
        ON pm.project_id = pc.project_id
       AND pm.tenant_id = pc.tenant_id
      LEFT JOIN igva_project_manager_completion imc
        ON imc.project_id = pc.project_id
       AND imc.tenant_id = pc.tenant_id
      LEFT JOIN igva_project_summary ips
        ON ips.project_id = pc.project_id
       AND ips.tenant_id = pc.tenant_id
      WHERE pc.tenant_id = $1
        AND (
          (COALESCE(pc.is_closed, false) = false AND pc.has_v4 = true)
          OR (
            pc.is_closed = true
            AND pc.closed_observed_at IS NOT NULL
            AND pc.closed_observed_at > (now() - interval '6 months')
          )
        )
        AND (
          (cu.username_ci IS NOT NULL AND lower(btrim(coalesce(pc.responsible_code, ''))) = cu.username_ci)
          OR
          (cu.username_ci IS NOT NULL AND lower(btrim(coalesce(pc.team_leader_code, ''))) = cu.username_ci)
          OR
          pc.owner_user_id = $2
          OR pa.tenant_user_id = $2
        )
    ),
    ranked_projects AS (
      SELECT
        sp.*,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(nullif(btrim(sp.external_project_ref), ''), sp.project_id::text)
          ORDER BY sp.updated_at DESC, sp.created_at DESC, sp.project_id DESC
        ) AS rn
      FROM scoped_projects sp
    )
    SELECT *
    FROM ranked_projects
    WHERE rn = 1
    ORDER BY updated_at DESC, name ASC
  `;

  const { rows } = await client.query(sql, [tenantId, userId]);
  return rows;
}

async function listIgvaProjectsForSummaryRefresh(client, { tenantId, projectIds = null, limit = 10 }) {
  const normalizedProjectIds = Array.isArray(projectIds) && projectIds.length ? projectIds : null;
  const sql = `
    SELECT
      pc.tenant_id,
      pc.project_id,
      pc.external_project_ref,
      pc.name,
      pc.status,
      pc.is_closed,
      pc.closed_observed_at,
      pw.is_work_in_progress,
      pw.is_work_in_progress AS financial_wip,
      pw.ready_to_bill,
      pw.margin,
      pw.costs,
      pw.ongoing,
      pw.billed,
      pw.coverage,
      pw.hours_budget,
      pw.hours_expected,
      pw.hours_fitter_hour,
      pw.remaining_hours,
      pm.ek_project_id,
      pm.project_expected_values,
      pm.project_budget,
      pm.total_turn_over_exp,
      pm.source_updated_at,
      pc.responsible_code,
      pc.responsible_name,
      pc.responsible_id,
      pc.team_leader_code,
      pc.team_leader_name,
      pc.team_leader_id,
      imc.completion_percent AS project_manager_completion_percent,
      imc.comment AS project_manager_completion_comment,
      imc.changed_at AS project_manager_completion_changed_at,
      imc.changed_by AS project_manager_completion_changed_by,
      pc.created_at,
      pc.updated_at
    FROM project_core pc
    INNER JOIN project_masterdata_v4 pm
      ON pm.project_id = pc.project_id
     AND pm.tenant_id = pc.tenant_id
    LEFT JOIN project_wip pw
      ON pw.project_id = pc.project_id
     AND pw.tenant_id = pc.tenant_id
    LEFT JOIN igva_project_manager_completion imc
      ON imc.project_id = pc.project_id
     AND imc.tenant_id = pc.tenant_id
    LEFT JOIN igva_project_summary ips
      ON ips.project_id = pc.project_id
     AND ips.tenant_id = pc.tenant_id
    WHERE pc.tenant_id = $1
      AND pm.ek_project_id IS NOT NULL
      AND ($3::uuid[] IS NULL OR pc.project_id = ANY($3::uuid[]))
      AND (
        (COALESCE(pc.is_closed, false) = false AND pc.has_v4 = true)
        OR (
          pc.is_closed = true
          AND pc.closed_observed_at IS NOT NULL
          AND pc.closed_observed_at > (now() - interval '6 months')
        )
      )
    ORDER BY COALESCE(ips.source_synced_at, to_timestamp(0)) ASC, pc.updated_at DESC, pc.project_id ASC
    LIMIT $2
  `;
  const { rows } = await client.query(sql, [tenantId, Math.max(1, Number(limit) || 10), normalizedProjectIds]);
  return rows;
}

async function getProjectManagerCompletionForUpdate(client, { tenantId, projectId }) {
  const { rows } = await client.query(
    `
      SELECT tenant_id, project_id, completion_percent, comment, changed_at, changed_by
      FROM igva_project_manager_completion
      WHERE tenant_id = $1 AND project_id = $2
      FOR UPDATE
    `,
    [tenantId, projectId]
  );
  return rows[0] || null;
}

async function upsertProjectManagerCompletion(client, { tenantId, projectId, completionPercent, comment, changedBy }) {
  const { rows } = await client.query(
    `
      INSERT INTO igva_project_manager_completion (
        tenant_id, project_id, completion_percent, comment, changed_at, changed_by
      ) VALUES ($1, $2, $3, $4, now(), $5)
      ON CONFLICT (tenant_id, project_id) DO UPDATE SET
        completion_percent = EXCLUDED.completion_percent,
        comment = EXCLUDED.comment,
        changed_at = EXCLUDED.changed_at,
        changed_by = EXCLUDED.changed_by,
        updated_at = now()
      RETURNING tenant_id, project_id, completion_percent, comment, changed_at, changed_by
    `,
    [tenantId, projectId, completionPercent, comment || null, changedBy]
  );
  return rows[0] || null;
}

async function insertProjectManagerCompletionEvent(client, { tenantId, projectId, previousCompletionPercent, completionPercent, comment, changedBy, metadata = {} }) {
  const { rows } = await client.query(
    `
      INSERT INTO igva_project_manager_completion_event (
        tenant_id, project_id, previous_completion_percent, completion_percent, comment, changed_by, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING id, tenant_id, project_id, previous_completion_percent, completion_percent, comment, changed_at, changed_by, metadata
    `,
    [tenantId, projectId, previousCompletionPercent, completionPercent, comment || null, changedBy, JSON.stringify(metadata || {})]
  );
  return rows[0] || null;
}

async function listProjectManagerCompletionEvents(client, { tenantId, projectId, limit = 20 }) {
  const { rows } = await client.query(
    `
      SELECT
        evt.id,
        evt.tenant_id,
        evt.project_id,
        evt.previous_completion_percent,
        evt.completion_percent,
        evt.comment,
        evt.changed_at,
        evt.changed_by,
        tu.username AS changed_by_username,
        tu.name AS changed_by_name
      FROM igva_project_manager_completion_event evt
      LEFT JOIN tenant_user tu
        ON tu.id = evt.changed_by
       AND tu.tenant_id = evt.tenant_id
      WHERE evt.tenant_id = $1
        AND evt.project_id = $2
      ORDER BY evt.changed_at DESC
      LIMIT $3
    `,
    [tenantId, projectId, Math.max(1, Math.min(Number(limit) || 20, 100))]
  );
  return rows;
}

async function upsertIgvaProjectSummary(client, { tenantId, projectId, summary }) {
  const { rows } = await client.query(
    `
      INSERT INTO igva_project_summary (
        tenant_id,
        project_id,
        calculated_at,
        source_synced_at,
        freshness_policy_key,
        budget_completion_percent,
        expected_completion_percent,
        manager_completion_percent,
        labor_completion_percent,
        material_completion_percent,
        revenue_actual,
        revenue_expected,
        cost_actual,
        cost_expected,
        contribution_margin_expected,
        coverage_expected,
        quality_status,
        economy_status,
        summary_json,
        source_metadata,
        last_error
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb, $21
      )
      ON CONFLICT (tenant_id, project_id) DO UPDATE SET
        calculated_at = EXCLUDED.calculated_at,
        source_synced_at = EXCLUDED.source_synced_at,
        freshness_policy_key = EXCLUDED.freshness_policy_key,
        budget_completion_percent = EXCLUDED.budget_completion_percent,
        expected_completion_percent = EXCLUDED.expected_completion_percent,
        manager_completion_percent = EXCLUDED.manager_completion_percent,
        labor_completion_percent = EXCLUDED.labor_completion_percent,
        material_completion_percent = EXCLUDED.material_completion_percent,
        revenue_actual = EXCLUDED.revenue_actual,
        revenue_expected = EXCLUDED.revenue_expected,
        cost_actual = EXCLUDED.cost_actual,
        cost_expected = EXCLUDED.cost_expected,
        contribution_margin_expected = EXCLUDED.contribution_margin_expected,
        coverage_expected = EXCLUDED.coverage_expected,
        quality_status = EXCLUDED.quality_status,
        economy_status = EXCLUDED.economy_status,
        summary_json = EXCLUDED.summary_json,
        source_metadata = EXCLUDED.source_metadata,
        last_error = EXCLUDED.last_error,
        updated_at = now()
      RETURNING *
    `,
    [
      tenantId,
      projectId,
      summary.calculated_at,
      summary.source_synced_at,
      summary.freshness_policy_key || 'sync_worker_cadence',
      summary.budget_completion_percent,
      summary.expected_completion_percent,
      summary.manager_completion_percent,
      summary.labor_completion_percent,
      summary.material_completion_percent,
      summary.revenue_actual,
      summary.revenue_expected,
      summary.cost_actual,
      summary.cost_expected,
      summary.contribution_margin_expected,
      summary.coverage_expected,
      summary.quality_status,
      summary.economy_status || 'calculated',
      JSON.stringify(summary.summary_json || {}),
      JSON.stringify(summary.source_metadata || {}),
      summary.last_error || null,
    ]
  );
  return rows[0] || null;
}

async function markIgvaProjectSummaryFailed(client, { tenantId, projectId, calculatedAt, errorMessage }) {
  const { rows } = await client.query(
    `
      INSERT INTO igva_project_summary (
        tenant_id, project_id, calculated_at, economy_status, summary_json, source_metadata, last_error
      ) VALUES ($1, $2, $3, 'failed', '{}'::jsonb, '{}'::jsonb, $4)
      ON CONFLICT (tenant_id, project_id) DO UPDATE SET
        calculated_at = EXCLUDED.calculated_at,
        economy_status = 'failed',
        last_error = EXCLUDED.last_error,
        updated_at = now()
      RETURNING *
    `,
    [tenantId, projectId, calculatedAt, String(errorMessage || 'igva_summary_refresh_failed').slice(0, 2000)]
  );
  return rows[0] || null;
}

async function updateSummaryManagerCompletion(client, { tenantId, projectId, completionPercent }) {
  await client.query(
    `
      UPDATE igva_project_summary
      SET manager_completion_percent = $3, updated_at = now()
      WHERE tenant_id = $1 AND project_id = $2
    `,
    [tenantId, projectId, completionPercent]
  );
}

module.exports = {
  listIgvaPocProjectsForUser,
  listIgvaProjectsForSummaryRefresh,
  getProjectManagerCompletionForUpdate,
  upsertProjectManagerCompletion,
  insertProjectManagerCompletionEvent,
  listProjectManagerCompletionEvents,
  upsertIgvaProjectSummary,
  markIgvaProjectSummaryFailed,
  updateSummaryManagerCompletion,
};