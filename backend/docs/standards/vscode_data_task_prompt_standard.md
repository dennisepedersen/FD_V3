# VS Code Data Task Prompt Standard

Status: verified
Purpose: standard prompt skeleton for future Fielddesk data tasks

## Required Prompt Blocks

1. Goal
- Describe target flow/table/query and expected outcome.

2. Non-Negotiable Constraints
- No guessing
- No tenant isolation weakening
- No auth changes unless explicitly approved
- No schema changes unless explicitly approved

3. Evidence Sources
- Exact files to read
- Exact tables/migrations to verify
- Exact endpoints/payloads to inspect

4. Work Phases
- Phase 0: read + map current truth
- Phase 1: docs/contracts update
- Phase 2: targeted code/data fixes
- Phase 3: validation + report

5. Output Requirements
- changed files list
- created files list
- migrations/index changes
- reviewed endpoints/queries
- unresolved unclear semantics
- manual actions section if required

## Mandatory Output Labels

- verified
- observed
- hypothesis
- unclear
- MANUEL HANDLING KRAEVET
