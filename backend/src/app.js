const express = require("express");
const tenantResolution = require("./middleware/tenantResolution");
const { errorHandler, createHttpError } = require("./middleware/errorHandler");

const rootHealthRoutes = require("./routes/rootHealthRoutes");
const portalAdminRoutes = require("./routes/portalAdminRoutes");
const rootInvitationRoutes = require("./routes/rootInvitationRoutes");
const rootOnboardingRoutes = require("./routes/rootOnboardingRoutes");
const tenantAuthRoutes = require("./routes/tenantAuthRoutes");
const tenantSurfaceRoutes = require("./routes/tenantSurfaceRoutes");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(rootHealthRoutes);
app.use(tenantResolution);

app.use((req, res, next) => {
  if (req.context?.domainScope === "portal") {
    return portalAdminRoutes(req, res, next);
  }
  return next();
});

app.use((req, res, next) => {
  if (req.context?.domainScope === "root") {
    return rootInvitationRoutes(req, res, next);
  }
  return next();
});

app.use((req, res, next) => {
  if (req.context?.domainScope === "root") {
    return rootOnboardingRoutes(req, res, next);
  }
  return next();
});

app.use((req, res, next) => {
  if (req.context?.domainScope === "tenant") {
    return tenantAuthRoutes(req, res, next);
  }
  return next();
});

app.use((req, res, next) => {
  if (req.context?.domainScope === "tenant") {
    return tenantSurfaceRoutes(req, res, next);
  }
  return next();
});

app.use((req, res, next) => {
  next(createHttpError(404, "not_found"));
});

app.use(errorHandler);

module.exports = app;
