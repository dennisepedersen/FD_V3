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

module.exports = {
  listIgvaPocProjectsForUser,
};
