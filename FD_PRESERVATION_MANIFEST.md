# FD Preservation Manifest

Status: preservation manifest before branch cleanup  
Created: 2026-06-08  
Scope: local `main` divergence, untracked files, and dirty worktree in `C:\Users\dep\Projekter\Fielddesk_V3`

This document records local work that must be preserved before any branch cleanup.

No merge, rebase, force push, branch deletion, or code change is implied by this manifest.

## 1. Current Git Situation

Local branch:

- `main`
- Tracking: `origin/main`
- Divergence observed: local `main` is ahead 27 and behind 29.

Remote:

- `origin`: `https://github.com/dennisepedersen/FD_V3.git`

Observed divergence count:

```text
git rev-list --left-right --count HEAD...origin/main
27  29
```

Interpretation:

- 27 commits exist only on local `main`.
- 29 commits exist only on `origin/main`.
- Most local-only commits are patch-duplicates of remote commits with different SHAs.
- `origin/main` contains PR merge history and remote-only QA foundation work.

Merge base:

```text
134d563d0b3c1fc84adba5d87aa11661fb057f0c
```

## 2. Rebuild Goal

Target cleanup strategy:

- Start a new clean branch from `origin/main`.
- Do not merge old local `main`.
- Do not rebase old local `main`.
- Do not force push.
- Do not delete branches until all preservation items have been recovered or explicitly rejected.
- Move only selected preserved work into the clean branch in small topic groups.

## 3. Reelt Unikke Lokale Commits

The following commits were reported as `+` by:

```text
git cherry -v origin/main HEAD
```

`+` means the patch is not found on `origin/main`.

### 3.1 Hager PDF Evidence Review POC

Commit:

```text
4d537de70ba7583527c078d5931084975d4abe2e
docs/scripts: add Hager PDF evidence review POC
```

Files:

```text
backend/docs/integrations/solar/solar_hager_pdf_evidence_review_poc.md
backend/scripts/solar_hager_pdf_evidence_review_poc.py
```

Why preserve:

- Contains research/tooling for Hager PDF evidence review.
- Relevant to Solar, CO2, EPD/PEP, and evidence-based product data.

Recommended recovery:

- Prefer separate research/tooling branch or separate commit.
- Can be cherry-picked if desired.
- Manual copy is also safe if the clean branch should avoid old local history.

Risk:

- Medium.
- It includes a script, not only documentation.
- Should be reviewed before landing on main.

Classification:

- Hager POC
- Solar
- Experimental tooling

### 3.2 Solar Integration Handbook

Commit:

```text
b9fdfd5d865147caf59a7f4031b3103fdc1e1aab
docs: add Solar integration handbook
```

Files:

```text
docs/integrations/FD_SOLAR.md
docs/DOC_INDEX.md
```

Why preserve:

- Contains consolidated Solar integration knowledge.
- Relevant to procurement, product lookup, ATP/lagerstatus, prices, order flow, CO2/EPD/PEP, and backend-only credential handling.

Recommended recovery:

- Preserve.
- Can be cherry-picked.
- Manual copy may be cleaner because `docs/DOC_INDEX.md` is also changed elsewhere and may conflict.

Risk:

- Low to medium.
- Documentation only, but integration guidance must be checked for currency and secret safety.

Classification:

- Solar
- Docs/Governance

### 3.3 Ignore Local Caches And Generated Artifacts

Commit:

```text
5c104ec41e110bad9839935ad5cbfaae39f3f7c8
chore: ignore local caches and generated artifacts
```

Files:

```text
.gitignore
```

Why preserve:

- May prevent accidental commit of local generated files, caches, and diagnostics.

Recommended recovery:

- Do not blindly cherry-pick.
- Review `.gitignore` additions together with `ec4526c`.
- Manually copy only patterns that are clearly safe.

Risk:

- Low to medium.
- Bad ignore patterns can hide files that should be tracked.

Classification:

- Local artifacts
- FD Core hygiene

### 3.4 EK Fitterhours Retention Documentation

Commit:

```text
1847d710bc366cac8170c119d995df91cbb4dd37
docs: document EK fitterhours retention model
```

Files:

```text
backend/docs/audits/current_state_audit.md
backend/docs/audits/missing_business_semantics.md
backend/docs/decisions/data_retention_and_filtering_decision.md
backend/docs/integrations/ek/fitterhours.md
backend/docs/integrations/ek/fitterhours_retention_model.md
backend/docs/integrations/ek/project_status_model.md
backend/docs/integrations/ek/projects_v4_masterdata.md
backend/docs/mappings/fitterhours_mapping.md
backend/docs/mappings/project_core_mapping.md
docs/ARCHITECTURE.md
docs/DECISIONS.md
docs/DOC_INDEX.md
```

Why preserve:

- Important EK retention and project status documentation.

Remote overlap:

- `origin/main` has a similar remote commit:

```text
ee70dcebf4f0adbf944fc34913f0cd8a3cf4f3a9
docs: document EK fitterhours retention model
```

- The remote commit appears to contain the same core EK documentation.
- The local commit is not patch-identical because local unique commits around Solar/Hager/.gitignore alter the comparison context.

Recommended recovery:

- Do not cherry-pick as-is.
- Compare local and remote text before deciding.
- Preserve only any genuinely missing local text.

Risk:

- Medium.
- Could duplicate or regress remote governance docs if blindly applied.

Classification:

- FD Core
- Docs/Governance
- EK integration

### 3.5 Ignore Local Diagnostics And Workspace Files

Commit:

```text
ec4526cc37bf1255a99256a99d748ae2b764b376
chore: ignore local diagnostics and workspace files
```

Files:

```text
.gitignore
```

Why preserve:

- May prevent accidental commit of local diagnostic files and workspace files.

Recommended recovery:

- Do not blindly cherry-pick.
- Review manually with `5c104ec`.
- Copy only safe ignore rules.

Risk:

- Low to medium.
- Ignore rules can hide useful files or mask accidental local state.

Classification:

- Local artifacts
- FD Core hygiene

## 4. Patch-Duplicates Already On Origin/Main

The following local commits should not be moved to a clean branch, because their patches already exist on `origin/main` with different SHAs:

```text
c9af91c polish: align project page with FD dark shell
9f10dfc feat: add Fielddesk dashboard landing foundation
c61ff4d fix: apply EK project lifecycle status model
9f2ecab chore: add database migration runner
825a24d fix: correct fitterhour project matching
fbfd4c6 perf: reduce project fitterhour query duplication
a87c1bd perf: add resolved project relation to fitter hours
a97ecf1 fix: clarify synced project hours definition
02779e7 perf: use resolved project relation for project hour summaries
542a130 feat: persist project internal status from EK
d6c8f46 chore: add project v4 is_internal resync tool
fe76f7e fix: match project v4 resync by EK project id
8267c8b chore: add Render maintenance job trigger
a1be82f fix: run Render maintenance jobs from service workdir
3e92be3 chore: add targeted fitterhours backfill dry run
819f2d7 chore: add targeted fitterhours backfill apply
88c15b0 chore: add fitterhours candidate analysis mode
db763f6 fix: correct fitterhours analysis excluded row ordering
9751816 fix: allow project leaders to update QA status
cdcaaac docs: document tenant admin access model
3c189f6 docs: document QA status model v1
eb8471a feat: add project QA right panel layout
```

Recovery rule:

- Do not cherry-pick these commits.
- Let the clean branch inherit their remote versions from `origin/main`.

## 5. Remote Work That Must Not Be Lost

Because the clean branch should start from `origin/main`, these remote-only commits are automatically preserved:

```text
4df6916 fix: repair baselined QA schema objects
52b2924 feat: add QA participant read state foundation
```

Remote PR merge commits are also preserved by basing on `origin/main`.

## 6. Untracked Files To Preserve Or Review

These files/directories are untracked in the current working tree and do not appear in tracked local history.

They must be copied, added, or intentionally excluded before the old local `main` is discarded.

### 6.1 API Info

```text
API info/EK_best_practice.md
API info/Solar_Full_Category_Fetch.postman_collection.json
API info/Solar_Procurement.postman_environment.example.json
API info/Solar_Procurement_Export.postman_collection.json
API info/solar_authenticate.md
API info/solar_best_practice.md
API info/solar_create_order.md
API info/solar_get_categories.md
API info/solar_get_category.md
API info/solar_get_deliveryaddresses.md
API info/solar_get_product.md
API info/solar_get_products.md
API info/solar_get_projectaccounts.md
API info/solar_post_atp.md
API info/solar_post_product_prices.md
API info/solar_product_catalog_dump.ps1
API info/solar_product_dump_notes.md
API info/solar_products_flow_probe.ps1
```

Why preserve:

- Solar/EK integration source material.

Recovery:

- Manual copy/add after secret review.

Risk:

- Medium to high.
- Postman collections/environments and API docs must be checked for credentials, subscription keys, tokens, account IDs, or sensitive tenant data.

Classification:

- Solar
- FD Core integrations
- Experimental/reference material

### 6.2 Solar/Hager POC Docs

```text
backend/docs/integrations/solar/solar_hager_pdf_layout_extraction_poc.md
backend/docs/integrations/solar/solar_hager_verified_extraction_poc.md
```

Why preserve:

- Additional Hager PDF/CO2 evidence research.

Recovery:

- Manual copy/add, likely in same topic as Hager POC.

Risk:

- Low to medium.

Classification:

- Hager POC
- Solar
- Docs/Governance

### 6.3 Fitterhours Rebuild Script

```text
backend/scripts/queue_fitterhours_rebuild.js
```

Why preserve:

- Possible operational tooling for fitterhours rebuild.

Recovery:

- Manual review before add.

Risk:

- Medium to high.
- Operational scripts may affect sync jobs or data.

Classification:

- FD Core
- Experimental work

### 6.4 Labs V0.1 Platform Tooling

```text
backend/src/modules/labs/labs.analyzer.js
backend/src/modules/labs/labs.attachments.js
backend/src/modules/labs/labs.repository.js
backend/src/modules/labs/labs.routes.js
backend/src/modules/labs/labs.service.js
backend/src/ui/portal-labs.html
docs/labs/LABS_V0_1_IMPLEMENTATION.md
docs/labs/LABS_V0_1_SPEC.md
migrations/0023_labs_v0_1.sql
```

Why preserve:

- Represents Labs v0.1 backend/UI/docs/migration work.

Recovery:

- Do not mix into branch cleanup.
- Move to a dedicated Labs branch from `origin/main`.
- Review against branch `wip/labs-v0.1-platform-tooling` if needed.

Risk:

- High.
- Contains backend module code, UI, docs, and migration.

Classification:

- Experimental work
- FD Core/platform tooling

### 6.5 Governance And Module Docs

```text
docs/CODEX_WORKFLOW.md
docs/DATA_POLICY.md
docs/EP_description_Projects.txt
docs/IMPLEMENTATION_GATES.md
docs/LABS_ANALYSIS_SCHEMA.md
docs/MODULE_MAP.md
docs/PROJECT_RULES.md
docs/UI_UX_PRINCIPLES.md
docs/modules/restarbejde/MODULE_DEFINITION.md
```

Why preserve:

- Important Fielddesk governance, module, workflow, data, UI/UX, and Restarbejde documentation.

Recovery:

- Manual add/copy in one or more docs/governance commits.
- Check `docs/DOC_INDEX.md` after recovery.

Risk:

- Low to medium.
- Documentation only, but it defines product/architecture governance.

Classification:

- Docs/Governance
- MODULE_MAP
- Experimental/spec material

### 6.6 IDE Bank

```text
docs/IDE_BANK.md
```

Why preserve:

- Contains IDE bank and IDE-0027 insertion.
- IDE_COUNTER currently points to `IDE-0028`.

Recovery:

- Manual copy/add on clean branch.
- This should be one of the first preservation commits if IDE-0027 is still desired.

Risk:

- Low.

Classification:

- IDE_BANK
- Docs/Governance

## 7. Dirty Worktree Changes To Preserve Or Review

The following tracked files have uncommitted changes:

```text
backend/.env.example
backend/docs/decisions/projects_endpoint_decision.md
backend/docs/integrations/ek/projects_v3_wip.md
backend/docs/mappings/project_wip_mapping.md
backend/src/config/env.js
backend/src/public/tenant/app.html
backend/src/public/tenant/auth.js
backend/src/public/tenant/login.html
backend/src/public/tenant/project.html
backend/src/routes/portalAdminRoutes.js
backend/src/routes/tenantSurfaceRoutes.js
backend/src/services/auditService.js
docs/00_MASTER.md
docs/AI_GOVERNANCE.md
docs/ARCHITECTURE.md
docs/DECISIONS.md
docs/DOC_INDEX.md
docs/MODULE_CONTRACT.md
docs/SECURITY_MODEL.md
schema.sql
workspace.code-workspace
```

Observed dirty diff stat:

```text
21 files changed, 869 insertions(+), 154 deletions(-)
```

Important note:

- `workspace.code-workspace` is deleted in the worktree.
- Do not carry that deletion unless explicitly desired.

Risk:

- High as a group.
- Includes backend config, auth/frontend surfaces, routes, audit, docs, and `schema.sql`.

Recovery:

- Do not move as one large patch.
- Split into topic groups:
  - FD Core/auth/config
  - frontend tenant UI
  - portal admin/routes
  - audit/schema
  - docs/governance
  - workspace deletion

Classification:

- FD Core
- Docs/Governance
- Frontend
- Backend
- Database
- Local artifact

## 8. Preservation Priority

Recommended preservation order:

1. `docs/IDE_BANK.md`
2. `docs/MODULE_MAP.md`
3. governance docs:
   - `docs/CODEX_WORKFLOW.md`
   - `docs/DATA_POLICY.md`
   - `docs/IMPLEMENTATION_GATES.md`
   - `docs/PROJECT_RULES.md`
   - `docs/UI_UX_PRINCIPLES.md`
   - `docs/LABS_ANALYSIS_SCHEMA.md`
   - `docs/modules/restarbejde/MODULE_DEFINITION.md`
4. Solar handbook:
   - `b9fdfd5`
   - `docs/integrations/FD_SOLAR.md`
5. API info, after secret review
6. Hager POC docs/scripts
7. Labs v0.1 on separate branch
8. Dirty worktree patches split by topic
9. `.gitignore` changes after manual review

## 9. What Should Not Be Moved

Do not move:

- Patch-duplicate commits already present on `origin/main`.
- Old release/safe/backup branches as commits.
- Local caches.
- Generated artifacts.
- Secret-bearing API/Postman files without review.
- `workspace.code-workspace` deletion unless explicitly desired.
- `1847d71` as a blind cherry-pick, because remote has `ee70dce` for the same EK retention topic.
- Labs code/migration mixed into docs cleanup.
- Dirty backend/schema work as one monolithic patch.

## 10. Suggested Recovery Plan

TRIN 1:

- Create a safety snapshot of current state before checkout.
- The snapshot should include:
  - tracked dirty diff
  - untracked files
  - current local `main` commit list
  - this manifest

TRIN 2:

- Create a clean branch from `origin/main`.
- Do not merge or rebase old local `main`.

TRIN 3:

- Restore `FD_PRESERVATION_MANIFEST.md` first.

TRIN 4:

- Restore and commit IDE bank:
  - `docs/IDE_BANK.md`

TRIN 5:

- Restore and commit governance docs:
  - `docs/MODULE_MAP.md`
  - `docs/CODEX_WORKFLOW.md`
  - `docs/DATA_POLICY.md`
  - `docs/IMPLEMENTATION_GATES.md`
  - `docs/PROJECT_RULES.md`
  - `docs/UI_UX_PRINCIPLES.md`
  - `docs/LABS_ANALYSIS_SCHEMA.md`
  - `docs/modules/restarbejde/MODULE_DEFINITION.md`

TRIN 6:

- Restore Solar docs after review:
  - `docs/integrations/FD_SOLAR.md`
  - `docs/DOC_INDEX.md` update if still needed
  - selected `API info/*` only after secret scan

TRIN 7:

- Restore Hager POC as a separate topic:
  - `backend/docs/integrations/solar/solar_hager_pdf_evidence_review_poc.md`
  - `backend/docs/integrations/solar/solar_hager_pdf_layout_extraction_poc.md`
  - `backend/docs/integrations/solar/solar_hager_verified_extraction_poc.md`
  - `backend/scripts/solar_hager_pdf_evidence_review_poc.py`

TRIN 8:

- Restore Labs only on a separate Labs branch:
  - `backend/src/modules/labs/*`
  - `backend/src/ui/portal-labs.html`
  - `docs/labs/*`
  - `migrations/0023_labs_v0_1.sql`

TRIN 9:

- Review and selectively restore dirty worktree changes.
- Avoid restoring `schema.sql` without matching migration/context.
- Avoid restoring backend config/routes without understanding related docs and env changes.

TRIN 10:

- Review `.gitignore` additions from:
  - `5c104ec`
  - `ec4526c`
- Apply only safe ignore patterns.

## 11. Command Evidence

Commands used for this manifest were read-only:

```text
git status --short
git cherry -v origin/main HEAD
git diff --name-status
git diff --stat
git ls-files --others --exclude-standard
git show --stat --oneline --summary <unique commit>
git diff --name-status ee70dce 1847d71
git diff --stat ee70dce 1847d71
```

No merge, rebase, commit, push, force push, branch creation, or branch deletion was performed as part of the analysis used to create this manifest.

