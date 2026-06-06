const fs = require("fs/promises");
const pool = require("../../db/pool");
const { withTransaction } = require("../../db/tx");
const { createHttpError } = require("../../middleware/errorHandler");
const auditService = require("../../services/auditService");
const { analyzeIdea } = require("./labs.analyzer");
const attachments = require("./labs.attachments");
const repository = require("./labs.repository");

const ALLOWED_PRIORITIES = new Set(["low", "normal", "high", "critical"]);
const COMPLETE_IDEA_STATUSES = new Set([
  "ready_for_analysis",
  "analyzing",
  "analysis_failed",
  "analyzed",
  "parked",
  "rejected",
  "approved_for_spec",
]);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeOptionalText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeRequiredText(value, fieldName) {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createHttpError(400, `${fieldName}_required`);
  }
  return normalized;
}

function normalizePriority(value) {
  const normalized = normalizeText(value || "normal").toLowerCase() || "normal";
  if (!ALLOWED_PRIORITIES.has(normalized)) {
    throw createHttpError(400, "invalid_labs_priority");
  }
  return normalized;
}

function normalizeIdeaStatus(input, currentStatus = null) {
  const requestedStatus = normalizeText(input.status).toLowerCase();

  if (requestedStatus === "draft") {
    if (!currentStatus || currentStatus === "draft") {
      return "draft";
    }
    throw createHttpError(409, "labs_status_transition_not_allowed");
  }

  return "ready_for_analysis";
}

function normalizeTags(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 20);
  }

  return String(value)
    .split(",")
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeIdeaInput(input, currentStatus = null) {
  const title = normalizeRequiredText(input.title || input.desired_function, "title");
  const moduleKey = normalizeRequiredText(input.module_key || input.module, "module_key");
  const problem = normalizeRequiredText(input.problem, "problem");
  const desiredFunction = normalizeRequiredText(input.desired_function, "desired_function");
  const priority = normalizePriority(input.priority);
  const description = normalizeRequiredText(input.description, "description");
  const source = normalizeOptionalText(input.source);
  const tags = normalizeTags(input.tags || input.tags_json);

  return {
    title,
    moduleKey,
    problem,
    desiredFunction,
    priority,
    description,
    source,
    tags,
    status: normalizeIdeaStatus(input, currentStatus),
  };
}

function changedFields(before, after) {
  const fields = ["title", "module_key", "problem", "desired_function", "priority", "description", "source", "status"];
  return fields.reduce((acc, field) => {
    if (String(before[field] || "") !== String(after[field] || "")) {
      acc[field] = {
        from: before[field] || null,
        to: after[field] || null,
      };
    }
    return acc;
  }, {});
}

async function logLabsAuditEvent(client, {
  actorId,
  eventType,
  resourceType,
  resourceId,
  outcome = "success",
  reason,
  metadata,
}) {
  await auditService.logAuditEvent({
    client,
    tenantId: null,
    actorId,
    actorType: "global_admin",
    actorScope: "global",
    moduleKey: "labs",
    eventType,
    resourceType,
    resourceId,
    outcome,
    reason,
    metadata,
  });
}

async function listIdeas({ status, limit }) {
  const client = await pool.connect();
  try {
    const normalizedStatus = normalizeOptionalText(status);
    const normalizedLimit = Math.min(Math.max(Number(limit || 100), 1), 250);
    return repository.listIdeas(client, {
      status: normalizedStatus,
      limit: normalizedLimit,
    });
  } finally {
    client.release();
  }
}

async function getIdeaDetail({ ideaId }) {
  const client = await pool.connect();
  try {
    const idea = await repository.findIdeaById(client, { ideaId });
    if (!idea) {
      throw createHttpError(404, "labs_idea_not_found");
    }

    const [analyses, ideaAttachments, history] = await Promise.all([
      repository.listAnalyses(client, { ideaId }),
      repository.listAttachments(client, { ideaId, includeArchived: true }),
      repository.listHistory(client, { ideaId }),
    ]);

    return {
      idea,
      analyses,
      attachments: ideaAttachments,
      history,
    };
  } finally {
    client.release();
  }
}

async function createIdea({ input, actorId }) {
  const normalized = normalizeIdeaInput(input || {});

  return withTransaction(async (client) => {
    const idea = await repository.createIdea(client, {
      ...normalized,
      actorId,
    });

    await repository.createHistory(client, {
      ideaId: idea.id,
      eventType: "created",
      fromStatus: null,
      toStatus: idea.status,
      changedFields: { created: true },
      actorId,
    });

    await logLabsAuditEvent(client, {
      actorId,
      eventType: "labs.idea_created",
      resourceType: "labs_idea",
      resourceId: idea.id,
      reason: "labs_idea_created",
      metadata: {
        idea_id: idea.id,
        module_key: idea.module_key,
        priority: idea.priority,
        status: idea.status,
      },
    });

    return idea;
  });
}

async function updateIdea({ ideaId, input, actorId }) {
  return withTransaction(async (client) => {
    const current = await repository.findIdeaById(client, { ideaId });
    if (!current) {
      throw createHttpError(404, "labs_idea_not_found");
    }
    if (current.status === "approved_for_spec") {
      throw createHttpError(409, "labs_idea_approved_for_spec_is_locked");
    }
    if (current.status === "rejected") {
      throw createHttpError(409, "labs_rejected_idea_must_be_reopened_before_edit");
    }

    const normalized = normalizeIdeaInput(input || {}, current.status);
    const status = COMPLETE_IDEA_STATUSES.has(current.status) && current.status !== "draft"
      ? "ready_for_analysis"
      : normalized.status;
    const updated = await repository.updateIdea(client, {
      ideaId,
      ...normalized,
      status,
      actorId,
    });

    await repository.createHistory(client, {
      ideaId,
      eventType: "updated",
      fromStatus: current.status,
      toStatus: updated.status,
      changedFields: changedFields(current, updated),
      actorId,
    });

    await logLabsAuditEvent(client, {
      actorId,
      eventType: "labs.idea_updated",
      resourceType: "labs_idea",
      resourceId: ideaId,
      reason: "labs_idea_updated",
      metadata: {
        idea_id: ideaId,
        from_status: current.status,
        to_status: updated.status,
      },
    });

    return updated;
  });
}

async function transitionIdea({ ideaId, action, reason, actorId }) {
  const normalizedReason = normalizeOptionalText(reason);

  return withTransaction(async (client) => {
    const current = await repository.findIdeaById(client, { ideaId });
    if (!current) {
      throw createHttpError(404, "labs_idea_not_found");
    }

    let updated;
    let eventType;
    let historyType;
    let status;
    let transitionOptions = {};

    if (action === "reject") {
      if (!normalizedReason) {
        throw createHttpError(400, "labs_reject_reason_required");
      }
      status = "rejected";
      eventType = "labs.idea_rejected";
      historyType = "rejected";
      transitionOptions = {
        reasonField: "rejected_reason",
        timestampField: "rejected_at",
        actorField: "rejected_by",
      };
    } else if (action === "park") {
      status = "parked";
      eventType = "labs.idea_parked";
      historyType = "parked";
      transitionOptions = {
        reasonField: "parked_reason",
        timestampField: "parked_at",
        actorField: "parked_by",
      };
    } else if (action === "reopen") {
      if (current.status !== "rejected") {
        throw createHttpError(409, "labs_only_rejected_ideas_can_be_reopened");
      }
      if (!normalizedReason) {
        throw createHttpError(400, "labs_reopen_reason_required");
      }
      status = "ready_for_analysis";
      eventType = "labs.idea_reopened";
      historyType = "reopened";
      transitionOptions = {
        reasonField: "reopened_reason",
        timestampField: "reopened_at",
        actorField: "reopened_by",
      };
    } else {
      throw createHttpError(400, "invalid_labs_status_action");
    }

    updated = await repository.updateIdeaStatus(client, {
      ideaId,
      status,
      actorId,
      reason: normalizedReason,
      ...transitionOptions,
    });

    await repository.createHistory(client, {
      ideaId,
      eventType: historyType,
      fromStatus: current.status,
      toStatus: updated.status,
      changedFields: { status: { from: current.status, to: updated.status } },
      reason: normalizedReason,
      actorId,
    });

    await logLabsAuditEvent(client, {
      actorId,
      eventType,
      resourceType: "labs_idea",
      resourceId: ideaId,
      reason: historyType,
      metadata: {
        idea_id: ideaId,
        from_status: current.status,
        to_status: updated.status,
        reason_provided: Boolean(normalizedReason),
      },
    });

    return updated;
  });
}

async function approveForSpec({ ideaId, actorId }) {
  return withTransaction(async (client) => {
    const current = await repository.findIdeaById(client, { ideaId });
    if (!current) {
      throw createHttpError(404, "labs_idea_not_found");
    }

    const analyses = await repository.listAnalyses(client, { ideaId });
    const latest = analyses.find((analysis) => analysis.status === "completed");
    if (!latest) {
      throw createHttpError(409, "labs_current_analysis_required");
    }

    const criticalQuestions = Array.isArray(latest.critical_open_questions_json)
      ? latest.critical_open_questions_json
      : [];
    if (criticalQuestions.length > 0) {
      throw createHttpError(409, "labs_critical_open_questions_must_be_resolved", {
        critical_open_question_count: criticalQuestions.length,
      });
    }

    const updated = await repository.updateIdeaStatus(client, {
      ideaId,
      status: "approved_for_spec",
      actorId,
      timestampField: "approved_for_spec_at",
      actorField: "approved_for_spec_by",
    });

    await repository.createHistory(client, {
      ideaId,
      eventType: "approved_for_spec",
      fromStatus: current.status,
      toStatus: updated.status,
      changedFields: { status: { from: current.status, to: updated.status } },
      actorId,
    });

    await logLabsAuditEvent(client, {
      actorId,
      eventType: "labs.idea_approved_for_spec",
      resourceType: "labs_idea",
      resourceId: ideaId,
      reason: "labs_idea_approved_for_spec",
      metadata: {
        idea_id: ideaId,
        analysis_id: latest.id,
        analysis_version: latest.analysis_version,
        score: latest.score,
        recommendation: latest.recommendation,
        noncritical_open_question_count: Array.isArray(latest.noncritical_open_questions_json)
          ? latest.noncritical_open_questions_json.length
          : 0,
      },
    });

    return updated;
  });
}

async function runAnalysis({ ideaId, actorId }) {
  await withTransaction(async (client) => {
    const current = await repository.findIdeaById(client, { ideaId });
    if (!current) {
      throw createHttpError(404, "labs_idea_not_found");
    }
    if (current.status === "approved_for_spec") {
      throw createHttpError(409, "labs_idea_approved_for_spec_is_locked");
    }

    await repository.updateIdeaStatus(client, {
      ideaId,
      status: "analyzing",
      actorId,
    });
    await repository.createHistory(client, {
      ideaId,
      eventType: "analysis_requested",
      fromStatus: current.status,
      toStatus: "analyzing",
      changedFields: { status: { from: current.status, to: "analyzing" } },
      actorId,
    });
    await logLabsAuditEvent(client, {
      actorId,
      eventType: "labs.analysis_requested",
      resourceType: "labs_idea",
      resourceId: ideaId,
      reason: "labs_analysis_requested",
      metadata: { idea_id: ideaId },
    });
  });

  const client = await pool.connect();
  let idea;
  let ideaAttachments;
  try {
    idea = await repository.findIdeaById(client, { ideaId });
    ideaAttachments = await repository.listAttachments(client, {
      ideaId,
      includeArchived: false,
    });
  } finally {
    client.release();
  }

  let analysisResult;
  try {
    analysisResult = await analyzeIdea({ idea, attachments: ideaAttachments });
  } catch (error) {
    return withTransaction(async (txClient) => {
        const version = await repository.nextAnalysisVersion(txClient, { ideaId });
        const failed = await repository.createAnalysis(txClient, {
          ideaId,
          analysisVersion: version,
          status: "failed",
          schemaVersion: "labs_analysis_schema_v0.1",
          analysisJson: { error: "analysis_failed" },
          summary: "Analysis failed safely.",
          recommendation: "needs_clarification",
          score: 0,
          subscores: {},
          openQuestions: [{ severity: "critical", question: "Analysis engine failed; retry or inspect server logs." }],
          criticalOpenQuestions: [{ severity: "critical", question: "Analysis engine failed; retry or inspect server logs." }],
          noncriticalOpenQuestions: [],
          conflicts: [],
          docsRead: [],
          evidenceLevel: "unclear",
          modelProvider: null,
          modelName: null,
          promptVersion: "labs_v0_1_governance_local_v1",
          inputSnapshot: { idea_id: ideaId },
          attachmentMetadataSnapshot: [],
          actorId,
          failureCode: "analysis_failed",
          failureSummary: error.message,
        });
        await repository.updateIdeaStatus(txClient, {
          ideaId,
          status: "analysis_failed",
          actorId,
        });
        await repository.createHistory(txClient, {
          ideaId,
          eventType: "analysis_failed",
          fromStatus: "analyzing",
          toStatus: "analysis_failed",
          changedFields: { analysis_id: failed.id },
          reason: "analysis_failed",
          actorId,
        });
        await logLabsAuditEvent(txClient, {
          actorId,
          eventType: "labs.analysis_failed",
          resourceType: "labs_analysis",
          resourceId: failed.id,
          outcome: "fail",
          reason: "labs_analysis_failed",
          metadata: {
            idea_id: ideaId,
            failure_code: "analysis_failed",
          },
        });
        return failed;
    });
  }

  return withTransaction(async (txClient) => {
      const version = await repository.nextAnalysisVersion(txClient, { ideaId });
      const analysis = await repository.createAnalysis(txClient, {
        ideaId,
        analysisVersion: version,
        status: "completed",
        schemaVersion: analysisResult.schemaVersion,
        analysisJson: analysisResult.analysisJson,
        summary: analysisResult.summary,
        recommendation: analysisResult.recommendation,
        score: analysisResult.score,
        subscores: analysisResult.subscores,
        openQuestions: analysisResult.openQuestions,
        criticalOpenQuestions: analysisResult.criticalOpenQuestions,
        noncriticalOpenQuestions: analysisResult.noncriticalOpenQuestions,
        conflicts: analysisResult.conflicts,
        docsRead: analysisResult.docsRead,
        evidenceLevel: analysisResult.evidenceLevel,
        modelProvider: analysisResult.modelProvider,
        modelName: analysisResult.modelName,
        promptVersion: analysisResult.promptVersion,
        inputSnapshot: analysisResult.inputSnapshot,
        attachmentMetadataSnapshot: analysisResult.attachmentMetadataSnapshot,
        actorId,
      });

      await repository.updateIdeaStatus(txClient, {
        ideaId,
        status: "analyzed",
        actorId,
      });
      await repository.createHistory(txClient, {
        ideaId,
        eventType: "analysis_completed",
        fromStatus: "analyzing",
        toStatus: "analyzed",
        changedFields: {
          analysis_id: analysis.id,
          score: analysis.score,
          recommendation: analysis.recommendation,
        },
        actorId,
      });
      await logLabsAuditEvent(txClient, {
        actorId,
        eventType: "labs.analysis_completed",
        resourceType: "labs_analysis",
        resourceId: analysis.id,
        reason: "labs_analysis_completed",
        metadata: {
          idea_id: ideaId,
          analysis_id: analysis.id,
          analysis_version: analysis.analysis_version,
          score: analysis.score,
          recommendation: analysis.recommendation,
          critical_open_question_count: analysisResult.criticalOpenQuestions.length,
          noncritical_open_question_count: analysisResult.noncriticalOpenQuestions.length,
        },
      });

    return analysis;
  });
}

async function addAttachment({ ideaId, req, actorId }) {
  const upload = await attachments.parseSingleAttachmentUpload(req);

  return withTransaction(async (client) => {
    const idea = await repository.findIdeaById(client, { ideaId });
    if (!idea) {
      throw createHttpError(404, "labs_idea_not_found");
    }
    if (idea.status === "approved_for_spec") {
      throw createHttpError(409, "labs_idea_approved_for_spec_is_locked");
    }

    const activeCount = await repository.countActiveAttachments(client, { ideaId });
    if (activeCount >= 5) {
      throw createHttpError(400, "labs_attachment_limit_reached", {
        max_files: 5,
      });
    }

    const saved = await attachments.saveAttachmentBuffer({
      ideaId,
      fileExtension: upload.fileExtension,
      buffer: upload.buffer,
    });

    const attachment = await repository.createAttachment(client, {
      ideaId,
      storageObjectId: saved.storageObjectId,
      fileName: upload.fileName,
      contentType: upload.contentType,
      fileExtension: upload.fileExtension,
      sizeBytes: upload.sizeBytes,
      attachmentType: upload.attachmentType,
      description: upload.description,
      actorId,
    });

    await repository.createHistory(client, {
      ideaId,
      eventType: "attachment_added",
      fromStatus: idea.status,
      toStatus: idea.status,
      changedFields: {
        attachment_id: attachment.id,
        file_name: attachment.file_name,
      },
      actorId,
    });

    await logLabsAuditEvent(client, {
      actorId,
      eventType: "labs.attachment_added",
      resourceType: "labs_attachment",
      resourceId: attachment.id,
      reason: "labs_attachment_added",
      metadata: {
        idea_id: ideaId,
        attachment_id: attachment.id,
        file_name: attachment.file_name,
        content_type: attachment.content_type,
        file_extension: attachment.file_extension,
        size_bytes: Number(attachment.size_bytes || 0),
      },
    });

    return attachment;
  });
}

async function getAttachmentDownload({ attachmentId, actorId, accessType }) {
  const client = await pool.connect();
  try {
    const attachment = await repository.findAttachmentById(client, { attachmentId });
    if (!attachment || attachment.archived_at) {
      throw createHttpError(404, "labs_attachment_not_found");
    }

    await logLabsAuditEvent(client, {
      actorId,
      eventType: accessType === "view" ? "labs.attachment_viewed" : "labs.attachment_downloaded",
      resourceType: "labs_attachment",
      resourceId: attachment.id,
      reason: accessType === "view" ? "labs_attachment_viewed" : "labs_attachment_downloaded",
      metadata: {
        idea_id: attachment.idea_id,
        attachment_id: attachment.id,
        file_name: attachment.file_name,
      },
    });

    return {
      attachment,
      absolutePath: attachments.attachmentPath({
        ideaId: attachment.idea_id,
        storageObjectId: attachment.storage_object_id,
      }),
    };
  } finally {
    client.release();
  }
}

async function archiveAttachment({ attachmentId, actorId }) {
  return withTransaction(async (client) => {
    const current = await repository.findAttachmentById(client, { attachmentId });
    if (!current || current.archived_at) {
      throw createHttpError(404, "labs_attachment_not_found");
    }

    const archived = await repository.archiveAttachment(client, {
      attachmentId,
      actorId,
    });

    await repository.createHistory(client, {
      ideaId: archived.idea_id,
      eventType: "attachment_archived",
      fromStatus: null,
      toStatus: null,
      changedFields: {
        attachment_id: archived.id,
        archived: true,
      },
      actorId,
    });

    await logLabsAuditEvent(client, {
      actorId,
      eventType: "labs.attachment_archived",
      resourceType: "labs_attachment",
      resourceId: archived.id,
      reason: "labs_attachment_archived",
      metadata: {
        idea_id: archived.idea_id,
        attachment_id: archived.id,
        file_name: archived.file_name,
      },
    });

    try {
      await fs.unlink(attachments.attachmentPath({
        ideaId: archived.idea_id,
        storageObjectId: archived.storage_object_id,
      }));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    return archived;
  });
}

module.exports = {
  addAttachment,
  approveForSpec,
  archiveAttachment,
  createIdea,
  getAttachmentDownload,
  getIdeaDetail,
  listIdeas,
  runAnalysis,
  transitionIdea,
  updateIdea,
};
