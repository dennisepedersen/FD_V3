const pool = require("../../db/pool");
const { withTransaction } = require("../../db/tx");
const { createHttpError } = require("../../middleware/errorHandler");
const qaRepository = require("./qa.repository");

const ALLOWED_STATUSES = new Set(["NEW", "WAITING", "ANSWERED", "CLOSED"]);
const ALLOWED_PRIORITIES = new Set(["low", "normal", "high"]);

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

    return {
      thread,
      messages,
    };
  } finally {
    client.release();
  }
}

async function createThread({ tenantId, userId, projectId, title, message, priority }) {
  const normalizedTitle = normalizeOptionalText(title);
  const normalizedMessage = normalizeRequiredMessage(message);
  const normalizedPriority = normalizePriority(priority);

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

    const detail = await qaRepository.findThreadForUser(client, {
      tenantId,
      userId,
      threadId: thread.id,
    });

    return {
      thread: detail || thread,
      message: firstMessage,
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

    await qaRepository.touchThread(client, {
      tenantId,
      threadId,
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
  updateStatus,
};