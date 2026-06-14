# Render Service Truths For Codex

Status: verified ops fact
Date: 2026-06-12
Scope: operational Render service identity and deployment checks

## VERIFIED

| Field | Verified value |
| --- | --- |
| Service | `FielddeskAI` |
| Service ID | `srv-d6h0h8fgi27c73a99jgg` |
| Repository | `FD_V3` |
| Branch | `main` |
| Auto deploy | yes |
| Pull request previews | no |
| Health endpoint | `/health` |

- `RENDER_API_KEY` exists in the local/operator environment used for Render API access.
- The Render service id is not necessarily set in the local environment yet.

## USE

- Use service id `srv-d6h0h8fgi27c73a99jgg` directly for Render deploy-status, service detail, log, and one-off job checks.
- Use `/health` as the first runtime verification endpoint after deploy/status checks.
- If a local tool requires `FIELD_DESK_RENDER_SERVICE_ID`, use the verified service id above or configure it through approved local/ops secret handling.
- If the service id is missing from the environment, Codex may use the Render API to verify the known id rather than discovering all services first.

## DO NOT USE

- Do not deploy, restart, change environment variables, or alter Render production configuration without explicit approval.
- Do not commit, echo, or log `RENDER_API_KEY`.
- Do not list all Render services as the first step when `srv-d6h0h8fgi27c73a99jgg` is already the known target.
- Do not assume pull request preview environments exist; previews are verified disabled.
- Do not assume a local `FIELD_DESK_RENDER_SERVICE_ID` value exists unless the environment has been checked.

## OPEN QUESTIONS

- Whether Fielddesk should keep a separate staging service before enabling larger sync or write-back workflows.
- Whether pull request previews should remain disabled or be enabled later under explicit preview-data governance.
- Whether `FIELD_DESK_RENDER_SERVICE_ID=srv-d6h0h8fgi27c73a99jgg` should be formalized in approved local/ops config.
- Where the canonical production operations runbook should live once deployment governance is formalized.

## FUTURE POSSIBILITY

- Add a formal `docs/DEPLOYMENT.md` or broader deployment governance doc.
- Add a read-only Render status check that reports service identity, branch, deploy status, and health endpoint without changing deploy state.
