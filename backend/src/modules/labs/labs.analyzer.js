const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const env = require("../../config/env");

const SCHEMA_VERSION = "labs_analysis_schema_v0.1";
const PROMPT_VERSION = "labs_v0_1_governance_local_v1";

const GOVERNANCE_DOCS = Object.freeze([
  "docs/PROJECT_RULES.md",
  "docs/UI_UX_PRINCIPLES.md",
  "docs/MODULE_MAP.md",
  "docs/CODEX_WORKFLOW.md",
  "docs/AI_GOVERNANCE.md",
  "docs/DECISIONS.md",
  "docs/ARCHITECTURE.md",
  "docs/SECURITY_MODEL.md",
  "docs/DATA_POLICY.md",
  "docs/IMPLEMENTATION_GATES.md",
  "docs/LABS_ANALYSIS_SCHEMA.md",
]);

const MODULE_ALIASES = Object.freeze({
  projects: "Projects",
  project: "Projects",
  qa: "QA",
  restarbejde: "Restarbejde",
  economy: "Economy",
  økonomi: "Economy",
  documents: "Documents",
  dokumenter: "Documents",
  reports: "Reports",
  rapporter: "Reports",
  co2: "CO2/ESG",
  esg: "CO2/ESG",
  labs: "Labs",
  integrations: "Integrations",
  integrationer: "Integrations",
  admin: "Admin/Settings",
});

const CRITICAL_PATTERNS = Object.freeze([
  { pattern: /\btenant\b|tenant[- ]?isolation|cross[- ]?tenant|kunde[- ]?data/i, question: "Afklar tenant-isolation og adgangsmodel før SPEC." },
  { pattern: /\bauth\b|login|session|token|jwt|global admin|rbac|permission|rolle|rls/i, question: "Afklar auth/RBAC/RLS-konsekvenser før SPEC." },
  { pattern: /secret|credential|api key|token|password|kodeord|nøgle/i, question: "Afklar secret-handling og sikker lagring før SPEC." },
  { pattern: /migration|schema|database|postgres|db\b/i, question: "Afklar datamodel, migration og rollback-risiko før SPEC." },
  { pattern: /deploy|release|preview|sandbox|production|prod\b/i, question: "Afklar gate- og releasegrænser før SPEC." },
  { pattern: /integration|e-komplet|solar|m365|graph|sharepoint|outlook|github|agent/i, question: "Afklar integration og backend-owned boundary før SPEC." },
  { pattern: /file|upload|pdf|image|screenshot|storage|blob|attachment|vedhæft/i, question: "Afklar fil/storage/adgang/audit før SPEC." },
  { pattern: /\bai\b|model|prompt|analyse|agent|automation|automatis/i, question: "Afklar AI-autoritet, usikkerhed og human approval før SPEC." },
]);

function repoRoot() {
  return path.resolve(__dirname, "../../../..");
}

async function readGovernanceDocs() {
  const docs = [];
  for (const relativePath of GOVERNANCE_DOCS) {
    const absolutePath = path.join(repoRoot(), relativePath);
    const content = await fs.readFile(absolutePath, "utf8");
    docs.push({
      path: relativePath,
      bytes: Buffer.byteLength(content, "utf8"),
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
      content,
    });
  }
  return docs;
}

function publicDocMetadata(docs) {
  return docs.map((doc) => ({
    path: doc.path,
    bytes: doc.bytes,
    sha256: doc.sha256,
  }));
}

function checkGovernanceDocContent(docs) {
  const byPath = new Map(docs.map((doc) => [doc.path, doc.content.toLowerCase()]));
  const checks = [
    {
      id: "project_rules_human_approval",
      doc: "docs/PROJECT_RULES.md",
      requiredTerms: ["human approval", "ai"],
    },
    {
      id: "project_rules_tenant_isolation",
      doc: "docs/PROJECT_RULES.md",
      requiredTerms: ["tenant isolation"],
    },
    {
      id: "codex_workflow_ide_to_analyse",
      doc: "docs/CODEX_WORKFLOW.md",
      requiredTerms: ["ide", "analyse", "spec", "build", "preview", "review", "release"],
    },
    {
      id: "implementation_gates_no_skip",
      doc: "docs/IMPLEMENTATION_GATES.md",
      requiredTerms: ["gate", "approved", "release"],
    },
    {
      id: "ai_governance_recommend_never_decide",
      doc: "docs/AI_GOVERNANCE.md",
      requiredTerms: ["recommend", "decide"],
    },
    {
      id: "data_policy_derived_output",
      doc: "docs/DATA_POLICY.md",
      requiredTerms: ["derived", "audit"],
    },
    {
      id: "security_model_global_admin",
      doc: "docs/SECURITY_MODEL.md",
      requiredTerms: ["global", "admin"],
    },
    {
      id: "labs_schema_analysis_score",
      doc: "docs/LABS_ANALYSIS_SCHEMA.md",
      requiredTerms: ["analyse-score", "aabne spoergsmaal"],
    },
  ];

  return checks.map((check) => {
    const content = byPath.get(check.doc) || "";
    const missingTerms = check.requiredTerms.filter((term) => !content.includes(term.toLowerCase()));
    return {
      id: check.id,
      doc: check.doc,
      passed: content.length > 0 && missingTerms.length === 0,
      missing_terms: missingTerms,
    };
  });
}

function normalizeText(value) {
  return String(value || "").trim();
}

function ideaText(idea) {
  return [
    idea.title,
    idea.module_key,
    idea.problem,
    idea.desired_function,
    idea.description,
    idea.source,
  ].map(normalizeText).join("\n");
}

function classifyModules(idea) {
  const raw = normalizeText(idea.module_key).toLowerCase();
  const text = ideaText(idea).toLowerCase();
  const found = new Map();

  if (raw) {
    found.set(MODULE_ALIASES[raw] || idea.module_key, {
      impact: "high",
      reason: "Ideaen er eksplicit knyttet til dette modul.",
      owner_approval_needed: true,
    });
  }

  Object.entries(MODULE_ALIASES).forEach(([key, name]) => {
    if (text.includes(key) && !found.has(name)) {
      found.set(name, {
        impact: name === "Labs" ? "high" : "medium",
        reason: `Ideaen nævner ${name} eller relaterede begreber.`,
        owner_approval_needed: name !== "Labs",
      });
    }
  });

  if (!found.size) {
    found.set("Unclassified", {
      impact: "medium",
      reason: "Modulet kunne ikke klassificeres sikkert ud fra idefelterne.",
      owner_approval_needed: true,
    });
  }

  return Array.from(found.entries()).map(([module, details]) => ({
    module,
    ...details,
  }));
}

function uniqueQuestions(questions) {
  return Array.from(new Set(questions.filter(Boolean)));
}

function classifyQuestions(idea, attachments, governanceContentChecks) {
  const text = ideaText(idea);
  const critical = [];
  const nonCritical = [];

  CRITICAL_PATTERNS.forEach(({ pattern, question }) => {
    if (pattern.test(text)) {
      critical.push(question);
    }
  });

  if (normalizeText(idea.description).length < 80) {
    nonCritical.push("Uddyb brugerflow og acceptkriterier i næste SPEC-fase.");
  }

  if (attachments.length > 0) {
    nonCritical.push("Gennemgå vedhæftninger manuelt; de er ikke brugt som AI-kontekst i v0.1.");
  }

  if (normalizeText(idea.priority) === "critical") {
    critical.push("Afklar hvorfor prioritet er critical, og hvilken risiko der kræver hastebehandling.");
  }

  if (governanceContentChecks.some((check) => !check.passed)) {
    critical.push("Afklar governance-dokumentgrundlaget; en eller flere paakraevede lokale content-checks fejlede.");
  }

  return {
    critical: uniqueQuestions(critical),
    nonCritical: uniqueQuestions(nonCritical),
  };
}

function computeScores({ criticalQuestions, nonCriticalQuestions, attachments }) {
  const securityClarity = criticalQuestions.length ? 45 : 85;
  const dataRbacClarity = criticalQuestions.some((q) => /data|RBAC|RLS|datamodel|fil|storage/i.test(q)) ? 45 : 80;
  const uxClarity = nonCriticalQuestions.some((q) => /brugerflow|acceptkriterier/i.test(q)) ? 65 : 80;
  const dependencyReadiness = criticalQuestions.length ? 50 : 82;
  const technicalReadiness = criticalQuestions.length ? 55 : 78;
  const businessValue = attachments.length ? 78 : 72;
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round((businessValue + securityClarity + dataRbacClarity + uxClarity + technicalReadiness + dependencyReadiness) / 6)
    )
  );

  return {
    score,
    subscores: {
      business_value: businessValue,
      security_clarity: securityClarity,
      data_rbac_clarity: dataRbacClarity,
      ux_clarity: uxClarity,
      technical_readiness: technicalReadiness,
      dependency_readiness: dependencyReadiness,
    },
  };
}

function recommendationFor({ criticalQuestions, score }) {
  if (criticalQuestions.length > 0) {
    return "needs_clarification";
  }
  if (score >= 70) {
    return "ready_for_spec";
  }
  if (score >= 45) {
    return "needs_clarification";
  }
  return "park";
}

function riskLevel(criticalQuestions) {
  if (criticalQuestions.length >= 3) {
    return "high";
  }
  if (criticalQuestions.length > 0) {
    return "medium";
  }
  return "low";
}

async function runLocalAnalysis({ idea, attachments }) {
  const governanceDocs = await readGovernanceDocs();
  const docsRead = publicDocMetadata(governanceDocs);
  const governanceContentChecks = checkGovernanceDocContent(governanceDocs);
  const modules = classifyModules(idea);
  const { critical, nonCritical } = classifyQuestions(idea, attachments, governanceContentChecks);
  const { score, subscores } = computeScores({
    criticalQuestions: critical,
    nonCriticalQuestions: nonCritical,
    attachments,
  });
  const recommendation = recommendationFor({ criticalQuestions: critical, score });
  const attachmentMetadata = attachments.map((attachment) => ({
    id: attachment.id,
    file_name: attachment.file_name,
    content_type: attachment.content_type,
    file_extension: attachment.file_extension,
    size_bytes: Number(attachment.size_bytes || 0),
    attachment_type: attachment.attachment_type,
    description: attachment.description || null,
  }));
  const attachmentNote = attachments.length
    ? "Vedhæftninger er registreret som menneskelig review-kontekst og er ikke analyseret af AI i v0.1."
    : "Ingen vedhæftninger registreret.";
  const criticalOpenQuestions = critical.map((question) => ({ severity: "critical", question }));
  const noncriticalOpenQuestions = nonCritical.map((question) => ({ severity: "non-critical", question }));
  const openQuestions = [...criticalOpenQuestions, ...noncriticalOpenQuestions];
  const risk = riskLevel(critical);
  const summary = critical.length
    ? `${idea.title} kræver afklaring før SPEC på grund af ${critical.length} critical open question(s).`
    : `${idea.title} er analyseret som kandidat til SPEC med ${score}/100 i readiness-score.`;

  const analysisJson = {
    resume: summary,
    problem: {
      proven: idea.problem,
      assumed: "Labs v0.1 har ikke brugt vedhæftningsindhold eller tenantdata i analysen.",
      unknowns: openQuestions,
    },
    forretningsvaerdi: {
      summary: "Ideen kan vurderes videre som del af Fielddesk udviklingsplatformens IDE -> ANALYSE flow.",
      value_drivers: ["governance", "scope control", "risk visibility"],
    },
    beroerte_moduler: modules,
    risiko: {
      level: risk,
      notes: critical.length
        ? "Critical open questions skal løses før approved_for_spec."
        : "Ingen critical open questions fundet i v0.1-analysen.",
    },
    sikkerhed: {
      tenant_isolation: "Ingen tenantdata er brugt. Labs er Platform Tooling.",
      auth: "Kun global_admin må handle på Labs-data.",
      attachments: attachmentNote,
      blockers: critical.filter((question) => /auth|tenant|secret|fil|storage|AI/i.test(question)),
    },
    data_rbac: {
      ownership: "Platform-internal Labs data; analysis output is derived advisory data.",
      rbac: "global_admin only",
      attachment_context: "metadata only",
      blockers: critical.filter((question) => /data|RBAC|RLS|datamodel|fil|storage/i.test(question)),
    },
    ui_ux_paavirkning: {
      mobile_first: "Future SPEC should preserve card-first analysis display and explicit status actions.",
      notes: nonCritical,
    },
    teknisk_kompleksitet: {
      size: critical.length ? "M" : "S",
      reason: critical.length
        ? "Critical governance questions may affect implementation shape."
        : "No critical governance blockers identified by v0.1 analyzer.",
    },
    afhaengigheder: {
      docs: docsRead.map((doc) => doc.path),
      attachments: attachmentMetadata,
      human_approvals: critical.length ? ["Resolve critical open questions"] : ["Global admin approval to SPEC"],
    },
    anbefaling: recommendation,
    analyse_score: {
      score,
      subscores,
    },
    aabne_spoergsmaal: openQuestions,
    metadata: {
      analyst: "labs-local-governance-analyzer",
      evidence_level: "observed",
      docs_read: docsRead,
      governance_docs_available: docsRead.map((doc) => doc.path),
      governance_doc_usage: "full text loaded locally for deterministic keyword checks; no external semantic model",
      governance_content_checks: governanceContentChecks,
      gate_recommendation: recommendation === "ready_for_spec" ? "Gate 1 candidate" : "Clarification required",
      attachment_policy: "attachment metadata only; contents excluded from AI context",
    },
  };

  return {
    analysisJson,
    summary,
    recommendation,
    score,
    subscores,
    openQuestions,
    criticalOpenQuestions,
    noncriticalOpenQuestions,
    conflicts: [],
    docsRead,
    evidenceLevel: "observed",
    schemaVersion: SCHEMA_VERSION,
    promptVersion: PROMPT_VERSION,
    modelProvider: env.LABS_AI_PROVIDER,
    modelName: env.LABS_AI_MODEL,
    inputSnapshot: {
      title: idea.title,
      module_key: idea.module_key,
      problem: idea.problem,
      desired_function: idea.desired_function,
      priority: idea.priority,
      description: idea.description,
      source: idea.source,
      tags: idea.tags_json || [],
    },
    attachmentMetadataSnapshot: attachmentMetadata,
  };
}

async function analyzeIdea({ idea, attachments }) {
  // v0.1 defaults to the local deterministic provider so no secrets or external
  // integrations are required for the approved IDE -> ANALYSE scope.
  return runLocalAnalysis({ idea, attachments });
}

module.exports = {
  GOVERNANCE_DOCS,
  SCHEMA_VERSION,
  analyzeIdea,
};
