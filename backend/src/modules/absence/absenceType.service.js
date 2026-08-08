"use strict";

const pool = require("../../db/pool");
const absenceTypeRepository = require("./absenceType.repository");

function mapRequestOption(row) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    comment_policy: row.comment_policy,
    allowed_duration_types: Array.isArray(row.allowed_duration_types) ? row.allowed_duration_types : [],
    special_window_eligible: row.special_window_eligible === true,
    sort_order: row.sort_order,
  };
}

async function listRequestOptions({ tenantId }) {
  const rows = await absenceTypeRepository.listActive(pool, {
    tenantId,
    workflowMode: "request",
  });

  return {
    items: rows.map(mapRequestOption),
  };
}

module.exports = {
  listRequestOptions,
  _test: {
    mapRequestOption,
  },
};