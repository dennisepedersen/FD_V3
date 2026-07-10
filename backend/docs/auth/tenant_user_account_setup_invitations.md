# Tenant user account setup invitations

Tenant Admin can issue one-time account setup links for tenant users that do not yet have an active login. The flow is tenant-host scoped and does not reuse the root/onboarding `tenant_invitation` table.

## Flow

- Tenant admin calls `POST /api/tenant/admin/users/:userId/invitations` from the resolved tenant host.
- Backend revokes any open `account_setup` token for the same tenant user, creates a new cryptographically random token, stores only the SHA-256 hash, and sets a 72 hour expiry.
- Mail is sent through `sendEmail({ to, subject, html, text, tenantId, template })`.
- The link points to `/accept-invite?token=...` on the tenant host.
- The public accept page validates the token without login, accepts a new password, marks the token used, revokes sibling account setup tokens, and activates `tenant_user.status = 'active'`.

## States

`tenant_user.login_status` is separate from the legacy login gate in `tenant_user.status`.

- `imported_no_login`: Imported or manually created person without an issued setup link.
- `pending_invite`: Token exists, but mail has not been sent successfully.
- `invited`: Mail provider accepted the message.
- `active`: Password was set through the accept flow and the user may log in.
- `disabled`: Suspended or deleted users.

Existing login still requires `tenant_user.status = 'active'` and a valid bcrypt password hash.

## Security

- Raw invitation tokens are never stored in the database.
- Tokens are random 32 byte `base64url` values and are looked up by SHA-256 hash.
- Tokens are scoped by `tenant_id`, `tenant_user_id`, and `purpose`.
- Resend revokes previous open account setup tokens before creating a replacement.
- Accept is one-time and expires after 72 hours.
- Public validation returns a generic invalid/expired result for unusable tokens.
- Active users are not silently reset by the account setup endpoint; password reset should use a separate `password_reset` purpose.
- Admin send/resend requires tenant host match, access token, and `tenant_admin:invite`.

## Mail infrastructure

Fielddesk should not run its own outbound mail server for this flow. Use a transactional provider such as Resend or Postmark and configure:

- `MAIL_PROVIDER=resend` or `MAIL_PROVIDER=postmark`
- `MAIL_FROM=Fielddesk <noreply@mail.fielddesk.dk>`
- `MAIL_REPLY_TO=support@fielddesk.dk` if replies should go somewhere monitored
- `MAIL_API_KEY` from the provider
- Optional `MAIL_STREAM` for Postmark message streams
- Optional `TENANT_INVITE_BASE_URL=https://{tenant}.fielddesk.dk` if generated links should not use the request host

Before production send, verify the sending domain with provider-supplied DNS records:

- SPF TXT record or provider include
- DKIM TXT/CNAME records
- DMARC TXT record for the organizational domain
- Any provider-specific return-path/bounce CNAME records

Inbound email is not required for the first account setup flow.

With `MAIL_PROVIDER=disabled` the backend fails clearly and stores `send_failed`; it must not pretend to send production mail.
