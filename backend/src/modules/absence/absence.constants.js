"use strict";

const ABSENCE_MODULE_KEYS = Object.freeze({
  request: "absence_request",
  type: "absence_type",
  specialWindow: "absence_special_window",
  managerRelation: "employee_manager_relation",
});

const ABSENCE_REQUEST_STATUSES = Object.freeze([
  "draft",
  "submitted",
  "ready_for_review",
  "under_review",
  "approved",
  "rejected",
  "change_proposed",
  "cancelled",
]);

const ABSENCE_DURATION_TYPES = Object.freeze([
  "full_days",
  "partial_day",
  "time_range",
]);

const ABSENCE_DAY_PARTS = Object.freeze([
  "morning",
  "afternoon",
]);

const ABSENCE_REQUEST_EVENT_TYPES = Object.freeze([
  "created",
  "draft_updated",
  "submitted",
  "assigned",
  "marked_ready_for_review",
  "review_started",
  "approved",
  "rejected",
  "change_proposed",
  "cancelled",
  "administrative_override",
]);

const ABSENCE_AUDIT_EVENT_TYPES = Object.freeze([
  "absence_type.created",
  "absence_type.updated",
  "absence_type.archived",
  "absence_request.created",
  "absence_request.updated",
  "absence_request.submitted",
  "absence_request.late_submitted",
  "absence_request.cancelled",
  "absence_request.approved",
  "absence_request.rejected",
  "absence_request.change_proposed",
  "absence_special_window.created",
  "absence_special_window.updated",
  "absence_special_window.scope_changed",
  "absence_special_window.archived",
  "employee_manager_relation.created",
  "employee_manager_relation.updated",
  "employee_manager_relation.ended",
]);

module.exports = {
  ABSENCE_AUDIT_EVENT_TYPES,
  ABSENCE_DAY_PARTS,
  ABSENCE_DURATION_TYPES,
  ABSENCE_MODULE_KEYS,
  ABSENCE_REQUEST_EVENT_TYPES,
  ABSENCE_REQUEST_STATUSES,
};
