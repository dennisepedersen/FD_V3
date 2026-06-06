const express = require("express");
const fs = require("fs");
const pool = require("../../db/pool");
const { createHttpError } = require("../../middleware/errorHandler");
const {
  PORTAL_SESSION_COOKIE_NAME,
  portalSessionCookieOptions,
  getGlobalAdminSession,
} = require("../../middleware/requireGlobalAdminSession");
const auditService = require("../../services/auditService");
const labsService = require("./labs.service");

const router = express.Router();

async function logAccessDenied(req, reason) {
  const client = await pool.connect();
  try {
    await auditService.logAuditEvent({
      client,
      tenantId: null,
      actorId: "anonymous",
      actorType: "unknown",
      actorScope: "global",
      moduleKey: "labs",
      eventType: "labs.access_denied",
      resourceType: "labs",
      resourceId: null,
      outcome: "deny",
      reason,
      metadata: {
        path: req.originalUrl,
        method: req.method,
        ip_address: req.ip,
        user_agent: req.headers["user-agent"] || null,
      },
    });
  } finally {
    client.release();
  }
}

async function requireLabsGlobalAdmin(req, res, next) {
  try {
    const session = await getGlobalAdminSession(req);
    if (!session) {
      await logAccessDenied(req, "labs_global_admin_required");
      res.clearCookie(PORTAL_SESSION_COOKIE_NAME, portalSessionCookieOptions());
      return next(createHttpError(401, "portal_auth_required"));
    }

    req.globalAdmin = {
      actorId: session.user.id,
      username: session.user.username,
      displayName: session.user.display_name,
      authType: "portal_session",
    };
    req.globalAdminSession = session;
    return next();
  } catch (error) {
    return next(error);
  }
}

function actorId(req) {
  return req.globalAdmin.actorId;
}

router.get("/v1/labs/ideas", requireLabsGlobalAdmin, async (req, res, next) => {
  try {
    const ideas = await labsService.listIdeas({
      status: req.query.status,
      limit: req.query.limit,
    });
    res.status(200).json({ success: true, ideas });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/labs/ideas", requireLabsGlobalAdmin, async (req, res, next) => {
  try {
    const idea = await labsService.createIdea({
      input: req.body || {},
      actorId: actorId(req),
    });
    res.status(201).json({ success: true, idea });
  } catch (error) {
    next(error);
  }
});

router.get("/v1/labs/ideas/:ideaId", requireLabsGlobalAdmin, async (req, res, next) => {
  try {
    const detail = await labsService.getIdeaDetail({ ideaId: req.params.ideaId });
    res.status(200).json({ success: true, ...detail });
  } catch (error) {
    next(error);
  }
});

router.patch("/v1/labs/ideas/:ideaId", requireLabsGlobalAdmin, async (req, res, next) => {
  try {
    const idea = await labsService.updateIdea({
      ideaId: req.params.ideaId,
      input: req.body || {},
      actorId: actorId(req),
    });
    res.status(200).json({ success: true, idea });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/labs/ideas/:ideaId/analyze", requireLabsGlobalAdmin, async (req, res, next) => {
  try {
    const analysis = await labsService.runAnalysis({
      ideaId: req.params.ideaId,
      actorId: actorId(req),
    });
    res.status(201).json({ success: true, analysis });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/labs/ideas/:ideaId/reject", requireLabsGlobalAdmin, async (req, res, next) => {
  try {
    const idea = await labsService.transitionIdea({
      ideaId: req.params.ideaId,
      action: "reject",
      reason: req.body?.reason,
      actorId: actorId(req),
    });
    res.status(200).json({ success: true, idea });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/labs/ideas/:ideaId/park", requireLabsGlobalAdmin, async (req, res, next) => {
  try {
    const idea = await labsService.transitionIdea({
      ideaId: req.params.ideaId,
      action: "park",
      reason: req.body?.reason,
      actorId: actorId(req),
    });
    res.status(200).json({ success: true, idea });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/labs/ideas/:ideaId/reopen", requireLabsGlobalAdmin, async (req, res, next) => {
  try {
    const idea = await labsService.transitionIdea({
      ideaId: req.params.ideaId,
      action: "reopen",
      reason: req.body?.reason,
      actorId: actorId(req),
    });
    res.status(200).json({ success: true, idea });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/labs/ideas/:ideaId/approve-for-spec", requireLabsGlobalAdmin, async (req, res, next) => {
  try {
    const idea = await labsService.approveForSpec({
      ideaId: req.params.ideaId,
      actorId: actorId(req),
    });
    res.status(200).json({ success: true, idea });
  } catch (error) {
    next(error);
  }
});

router.post("/v1/labs/ideas/:ideaId/attachments", requireLabsGlobalAdmin, async (req, res, next) => {
  try {
    const attachment = await labsService.addAttachment({
      ideaId: req.params.ideaId,
      req,
      actorId: actorId(req),
    });
    res.status(201).json({ success: true, attachment });
  } catch (error) {
    next(error);
  }
});

router.get("/v1/labs/attachments/:attachmentId/file", requireLabsGlobalAdmin, async (req, res, next) => {
  try {
    const accessType = req.query.view === "1" ? "view" : "download";
    const { attachment, absolutePath } = await labsService.getAttachmentDownload({
      attachmentId: req.params.attachmentId,
      actorId: actorId(req),
      accessType,
    });
    if (!fs.existsSync(absolutePath)) {
      throw createHttpError(404, "labs_attachment_file_missing");
    }

    res.setHeader("Content-Type", attachment.content_type);
    const disposition = accessType === "view" ? "inline" : "attachment";
    res.setHeader("Content-Disposition", `${disposition}; filename="${String(attachment.file_name).replace(/"/g, "")}"`);
    fs.createReadStream(absolutePath).pipe(res);
  } catch (error) {
    next(error);
  }
});

router.delete("/v1/labs/attachments/:attachmentId", requireLabsGlobalAdmin, async (req, res, next) => {
  try {
    const attachment = await labsService.archiveAttachment({
      attachmentId: req.params.attachmentId,
      actorId: actorId(req),
    });
    res.status(200).json({ success: true, attachment });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
