# Secret Handling Rules

## Core rules
- Never hardcode credentials, tokens, API keys, or connection strings in repository files.
- Always use environment variables for secrets.
- Test scripts must only read secrets from environment variables.
- Do not print secret values in logs, script output, or errors.

## If a secret is leaked
1. Rotate the secret at the provider immediately.
2. Update runtime environment variables.
3. Redeploy services.
4. Verify runtime health and authentication flows.
5. Review repository history and decide whether history rewrite is required.

## Before commit checklist
- Run `powershell -ExecutionPolicy Bypass -File scripts/check-secrets.ps1` (staged files).
- Optionally run `powershell -ExecutionPolicy Bypass -File scripts/check-secrets.ps1 -AllFiles` for a full sweep.
- Ensure no `.env` or local secret files are staged.
- Ensure docs and scripts contain placeholders, not real values.
- Verify smoke scripts rely on environment variables only.

## Optional local hook setup
To enforce checks before each commit:

```bash
git config core.hooksPath .githooks
```

This activates `.githooks/pre-commit`, which runs the secret checker on staged files.
