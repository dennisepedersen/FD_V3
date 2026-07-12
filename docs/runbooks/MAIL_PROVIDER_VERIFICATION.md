# Mail Provider Verification Runbook

Status: current runbook
Scope: verifying Fielddesk invitation mail behavior without leaking secrets or sending accidental mail.

## Providers

The mail service is provider-agnostic and supports disabled mode plus configured providers such as Resend and Postmark.

Relevant environment variables:

- `MAIL_PROVIDER`
- `MAIL_FROM`
- `MAIL_REPLY_TO`
- `MAIL_API_KEY` or provider-specific key
- `MAIL_STREAM` when the provider uses it
- `TENANT_INVITE_BASE_URL`

Never print API keys or raw invitation tokens.

## Disabled Mode

`MAIL_PROVIDER=disabled` must fail clearly. It must not report a fake successful send.

## Template Verification Without Sending Mail

Render the pure helper with dummy data:

- subject is `Opret din Fielddesk-adgang`
- HTML contains tenant-origin logo URL
- logo URL has no token or query token
- `alt="Fielddesk"` exists
- CTA exists
- text/plain fallback exists
- Danish text renders correctly

Redact any invite URL before pasting output. Use `token=<redacted>`.

## Controlled Real Mail Test

Only run after explicit approval and with one controlled test user/email.

Verify:

- exactly one invitation is sent
- API response does not include raw token, token hash, or accept URL
- provider status is queued/sent/delivered as available
- mailbox receives the mail
- accept link opens the correct tenant host
- token cannot be reused after setup

## Partial Failure

If provider send fails, the invitation flow should preserve the created user and show a clear partial-failure message. Store failures without logging or returning raw token values.