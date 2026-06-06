const pool = require("../../db/pool");
const { withTransaction } = require("../../db/tx");
const { createHttpError } = require("../../middleware/errorHandler");
const auditService = require("../../services/auditService");
const qaRepository = require("./qa.repository");

const ALLOWED_STATUSES = new Set(["NEW", "WAITING", "ANSWERED", "CLOSED"]);
const ALLOWED_PRIORITIES = new Set(["low", "normal", "high"]);

function normalizeUserId(value) {
  const normalized = normalizeOptionalText(value);
  return normalized;
}

function normalizeRecipientUserIds(value) {
  if (value === null || value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw createHttpError(400, "recipient_user_ids_must_be_array");
  }

  return Array.from(new Set(value.map(normalizeUserId).filter(Boolean)));
}

function normalizeOptionalText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeRequiredMessage(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw createHttpError(400, "message_required");
  }
  return normalized;
}

function normalizePriority(value) {
  const normalized = String(value || "normal").trim().toLowerCase() || "normal";
  if (!ALLOWED_PRIORITIES.has(normalized)) {
    throw createHttpError(400, "invalid_qa_priority");
  }
  return normalized;
}

function normalizeStatus(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!ALLOWED_STATUSES.has(normalized)) {
    throw createHttpError(400, "invalid_qa_status");
  }
  return normalized;
}

function mapProjectParticipantSources(projectParticipants) {
  const sourceByUserId = new Map();
  projectParticipants.forEach((participant) => {
    const userId = normalizeUserId(participant.tenant_user_id);
    if (!userId || sourceByUserId.has(userId)) {
      return;
    }
    sourceByUserId.set(userId, participant.visibility_source || "explicit");
  });
  return sourceByUserId;
}

function buildThreadParticipantTargets({
  creatorUserId,
  projectParticipants,
  recipientUserIds,
  firstMessageId,
  explicitRecipients,
}) {
  const sourceByUserId = mapProjectParticipantSources(projectParticipants);
  const projectParticipantIds = new Set(sourceByUserId.keys());

  recipientUserIds.forEach((recipientUserId) => {
    if (recipientUserId === creatorUserId) {
      return;
    }
    if (!projectParticipantIds.has(recipientUserId)) {
      throw createHttpError(400, "qa_recipient_not_project_participant");
    }
  });

  const selectedUserIds = explicitRecipients
    ? recipientUserIds
    : Array.from(projectParticipantIds);

  const targetsByUserId = new Map();
  targetsByUserId.set(creatorUserId, {
    tenantUserId: creatorUserId,
    participantRole: "creator",
    isAssigned: false,
    lastSeenAt: new Date(),
    lastSeenMessageId: firstMessageId,
    visibilitySource: "self",
  });

  selectedUserIds.forEach((tenantUserId) => {
    if (!tenantUserId || tenantUserId === creatorUserId) {
      return;
    }

    targetsByUserId.set(tenantUserId, {
      tenantUserId,
      participantRole: explicitRecipients ? "recipient" : "participant",
      isAssigned: Boolean(explicitRecipients),
      lastSeenAt: null,
      lastSeenMessageId: null,
      visibilitySource: sourceByUserId.get(tenantUserId) || "explicit",
    });
  });

  return Array.from(targetsByUserId.values());
}

async function upsertThreadParticipants(client, {
  tenantId,
  threadId,
  projectId,
  actorUserId,
  targets,
}) {
  const participants = [];
  for (const target of targets) {
    const participant = await qaRepository.upsertThreadParticipant(client, {
      tenantId,
      threadId,
      projectId,
      tenantUserId: target.tenantUserId,
      participantRole: target.participantRole,
      isAssigned: target.isAssigned,
      assignedByUserId: target.isAssigned ? actorUserId : null,
      lastSeenAt: target.lastSeenAt,
      lastSeenMessageId: target.lastSeenMessageId,
      visibilitySource: target.visibilitySource,
    });
    participants.push(participant);
  }
  return participants;
}

async function logQaAuditEvent(client, {
  tenantId,
  userId,
  eventType,
  resourceType,
  resourceId,
  projectId,
  reason,
  metadata,
}) {
  await auditService.logAuditEvent({
    client,
    tenantId,
    actorId: userId,
    actorType: "tenant_user",
    actorScope: "tenant",
    moduleKey: "qa",
    eventType,
    resourceType,
    resourceId,
    projectId,
    outcome: "success",
    reason,
    metadata: {
      actor_user_id: userId,
      ...metadata,
    },
  });
}

async function listThreadsForProject({ tenantId, userId, projectId }) {
  const client = await pool.connect();
  try {
    const projectScope = await qaRepository.getProjectScopeForUser(client, {
      tenantId,
      userId,
      projectId,
    });

    if (!projectScope) {
      throw createHttpError(404, "project_not_found");
    }

    const [summary, threads] = await Promise.all([
      qaRepository.getThreadSummaryForProjects(client, {
        tenantId,
        projectIds: projectScope.projectIds,
      }),
      qaRepository.listThreadsForProjects(client, {
        tenantId,
        userId,
        projectIds: projectScope.projectIds,
      }),
    ]);

    return {
      project: projectScope.project,
      projectIds: projectScope.projectIds,
      summary,
      threads,
    };
  } finally {
    client.release();
  }
}

async function getThreadDetail({ tenantId, userId, threadId }) {
  const client = await pool.connect();
  try {
    const thread = await qaRepository.findThreadForUser(client, {
      tenantId,
      userId,
      threadId,
    });

    if (!thread) {
      throw createHttpError(404, "qa_thread_not_found");
    }

    const messages = await qaRepository.listMessagesForThread(client, {
      tenantId,
      threadId,
    });

    const participants = await qaRepository.listParticipantsForThread(client, {
      tenantId,
      threadId,
    });

    return {
      thread,
      messages,
      participants,
    };
  } finally {
    client.release();
  }
}

async function createThread({ tenantId, userId, projectId, title, message, priority, recipientUserIds }) {
  const normalizedTitle = normalizeOptionalText(title);
  const normalizedMessage = normalizeRequiredMessage(message);
  const normalizedPriority = normalizePriority(priority);
  const normalizedRecipientUserIds = normalizeRecipientUserIds(recipientUserIds);
  const hasExplicitRecipients = normalizedRecipientUserIds.length > 0;

  return withTransaction(async (client) => {
    const projectScope = await qaRepository.getProjectScopeForUser(client, {
      tenantId,
      userId,
      projectId,
    });

    if (!projectScope) {
      throw createHttpError(404, "project_not_found");
    }

    const thread = await qaRepository.createThread(client, {
      tenantId,
      projectId,
      title: normalizedTitle,
      priority: normalizedPriority,
      createdByUserId: userId,
    });

    const firstMessage = await qaRepository.createMessage(client, {
      tenantId,
      threadId: thread.id,
      projectId,
      userId,
      message: normalizedMessage,
    });

    const projectParticipants = await qaRepository.listProjectParticipants(client, {
      tenantId,
      projectId,
    });

    const participantTargets = buildThreadParticipantTargets({
      creatorUserId: userId,
      projectParticipants,
      recipientUserIds: normalizedRecipientUserIds,
      firstMessageId: firstMessage.id,
      explicitRecipients: hasExplicitRecipients,
    });

    const participants = await upsertThreadParticipants(client, {
      tenantId,
      threadId: thread.id,
      projectId,
      actorUserId: userId,
      targets: participantTargets,
    });

    await logQaAuditEvent(client, {
      tenantId,
      userId,
      eventType: "qa_thread_created",
      resourceType: "qa_thread",
      resourceId: thread.id,
      projectId,
      reason: "qa_thread_created",
      metadata: {
        thread_id: thread.id,
        status: thread.status,
        priority: thread.priority,
        has_title: Boolean(thread.title),
      },
    });

    await logQaAuditEvent(client, {
      tenantId,
      userId,
      eventType: "qa_message_created",
      resourceType: "qa_message",
      resourceId: firstMessage.id,
      projectId,
      reason: "qa_message_created",
      metadata: {
        thread_id: thread.id,
        message_id: firstMessage.id,
        status: thread.status,
        priority: thread.priority,
      },
    });

    await logQaAuditEvent(client, {
      tenantId,
      userId,
      eventType: "qa_thread_participant_added",
      resourceType: "qa_thread",
      resourceId: thread.id,
      projectId,
      reason: "qa_thread_participant_added",
      metadata: {
        thread_id: thread.id,
        participant_count: participants.length,
        explicit_recipient_count: normalizedRecipientUserIds.length,
        default_project_participants: !hasExplicitRecipients,
      },
    });

    const detail = await qaRepository.findThreadForUser(client, {
      tenantId,
      userId,
      threadId: thread.id,
    });

    return {
      thread: detail || thread,
      message: firstMessage,
      participants,
    };
  });
}

async function addMessage({ tenantId, userId, threadId, message }) {
  const normalizedMessage = normalizeRequiredMessage(message);

  return withTransaction(async (client) => {
    const thread = await qaRepository.findThreadForUser(client, {
      tenantId,
      userId,
      threadId,
    });

    if (!thread) {
      throw createHttpError(404, "qa_thread_not_found");
    }

    const createdMessage = await qaRepository.createMessage(client, {
      tenantId,
      threadId,
      projectId: thread.project_id,
      userId,
      message: normalizedMessage,
    });

    await qaRepository.upsertThreadParticipant(client, {
      tenantId,
      threadId,
      projectId: thread.project_id,
      tenantUserId: userId,
      participantRole: "participant",
      isAssigned: false,
      assignedByUserId: null,
      lastSeenAt: new Date(),
      lastSeenMessageId: createdMessage.id,
      visibilitySource: "self",
    });

    await qaRepository.touchThread(client, {
      tenantId,
      threadId,
    });

    await logQaAuditEvent(client, {
      tenantId,
      userId,
      eventType: "qa_message_created",
      resourceType: "qa_message",
      resourceId: createdMessage.id,
      projectId: thread.project_id,
      reason: "qa_message_created",
      metadata: {
        thread_id: threadId,
        message_id: createdMessage.id,
        status: thread.status,
        priority: thread.priority,
      },
    });

    return {
      thread: await qaRepository.findThreadForUser(client, {
        tenantId,
        userId,
        threadId,
      }),
      message: createdMessage,
    };
  });
}

async function markThreadSeen({ tenantId, userId, threadId }) {
  return withTransaction(async (client) => {
    const thread = await qaRepository.findThreadForUser(client, {
      tenantId,
      userId,
      threadId,
    });

    if (!thread) {
      throw createHttpError(404, "qa_thread_not_found");
    }

    const latestMessage = await qaRepository.getLatestMessageForThread(client, {
      tenantId,
      threadId,
    });

    const participant = await qaRepository.upsertThreadParticipant(client, {
      tenantId,
      threadId,
      projectId: thread.project_id,
      tenantUserId: userId,
      participantRole: "participant",
      isAssigned: false,
      assignedByUserId: null,
      lastSeenAt: new Date(),
      lastSeenMessageId: latestMessage ? latestMessage.id : null,
      visibilitySource: "self",
    });

    await logQaAuditEvent(client, {
      tenantId,
      userId,
      eventType: "qa_thread_seen",
      resourceType: "qa_thread",
      resourceId: threadId,
      projectId: thread.project_id,
      reason: "qa_thread_seen",
      metadata: {
        thread_id: threadId,
        latest_message_id: latestMessage ? latestMessage.id : null,
      },
    });

    return {
      thread: await qaRepository.findThreadForUser(client, {
        tenantId,
        userId,
        threadId,
      }),
      participant,
    };
  });
}

async function updateStatus({ tenantId, userId, threadId, status }) {
  const normalizedStatus = normalizeStatus(status);

  return withTransaction(async (client) => {
    const thread = await qaRepository.findThreadForUser(client, {
      tenantId,
      userId,
      threadId,
    });

    if (!thread) {
      throw createHttpError(404, "qa_thread_not_found");
    }

    const updatedThread = await qaRepository.updateThreadStatus(client, {
      tenantId,
      threadId,
      status: normalizedStatus,
    });

    await logQaAuditEvent(client, {
      tenantId,
      userId,
      eventType: "qa_thread_status_changed",
      resourceType: "qa_thread",
      resourceId: threadId,
      projectId: thread.project_id,
      reason: "qa_thread_status_changed",
      metadata: {
        thread_id: threadId,
        status: updatedThread.status,
        priority: updatedThread.priority,
        previous_status: thread.status,
        new_status: updatedThread.status,
      },
    });

    return {
      thread: updatedThread,
    };
  });
}

module.exports = {
  addMessage,
  createThread,
  getThreadDetail,
  listThreadsForProject,
  markThreadSeen,
  updateStatus,
};
