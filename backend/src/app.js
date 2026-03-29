const express = require("express");
const tenantResolution = require("./middleware/tenantResolution");
const { errorHandler, createHttpError } = require("./middleware/errorHandler");

const rootHealthRoutes = require("./routes/rootHealthRoutes");
const rootInvitationRoutes = require("./routes/rootInvitationRoutes");
const rootOnboardingRoutes = require("./routes/rootOnboardingRoutes");
const tenantAuthRoutes = require("./routes/tenantAuthRoutes");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(rootHealthRoutes);
app.use(tenantResolution);

app.use(rootInvitationRoutes);
app.use(rootOnboardingRoutes);
app.use(tenantAuthRoutes);

app.use((req, res, next) => {
  next(createHttpError(404, "not_found"));
});

app.use(errorHandler);

module.exports = app;
