'use strict';

const rules = [
  { id: 'S1_PRIVATE_KEY', regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i },
  { id: 'S2_RENDER_API_KEY', regex: /\brnd_[A-Za-z0-9_-]{20,}\b/ },
  { id: 'S3_RESEND_API_KEY', regex: /\bre_[A-Za-z0-9_-]{20,}\b/ },
  { id: 'S4_POSTGRES_URI', regex: /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/i },
  { id: 'S5_SECRET_ASSIGNMENT', regex: /\b(?:DATABASE_URL|JWT_SECRET|PORTAL_JWT_SECRET|INVITATION_JWT_SECRET|MAIL_API_KEY|POSTMARK_API_KEY|RESEND_API_KEY|RENDER_API_KEY|PGPASSWORD|DB_PASSWORD|DATABASE_PASSWORD|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN)\s*[:=]\s*["']?([^"'\s#<>]+)/i },
];

const placeholderPattern = /^(?:<[^>]+>|\$\{?[A-Z0-9_]+\}?|your[-_].*|example|dummy|redacted|changeme|placeholder|null|undefined|false|true)$/i;

function shouldSkipFinding({ file, line, rule, match }) {
  const normalized = file.replace(/\\/g, '/');
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return true;
  if (/\.env\.example$|README_LOCAL_RUN\.md$|SECRET_HANDLING_RULES\.md$|MAIL_PROVIDER_VERIFICATION\.md$|RENDER_VERIFICATION\.md$/i.test(normalized)) return true;

  const value = match && match[1] ? String(match[1]).trim().replace(/["',;]+$/g, '') : '';
  if (value) {
    if (placeholderPattern.test(value)) return true;
    if (value.includes('process.env') || value.includes('${') || value.startsWith('$env:')) return true;
    if (/^[A-Za-z_$][A-Za-z0-9_$]*,?$/.test(value)) return true;
    if (/^(localhost|127\.0\.0\.1)/i.test(value)) return true;
  }

  if (rule.id === 'S4_POSTGRES_URI' && /localhost|127\.0\.0\.1|example|placeholder|<secret>/i.test(line)) return true;
  return false;
}

module.exports = {
  rules,
  shouldSkipFinding,
};
