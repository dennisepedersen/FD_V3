BEGIN;

-- Correct only shipped system templates. Existing outbox/report bodies and
-- tenant overrides are deliberately retained with their original content.
WITH previous AS (
  UPDATE email_template
  SET is_active = false
  WHERE tenant_id IS NULL AND locale = 'da-DK' AND version = 1 AND is_active = true
    AND template_key IN ('time_control.missing_hours.employee',
      'time_control.friday_manager_summary', 'time_control.internal_error')
  RETURNING template_key, locale, subject_template, html_template, text_template, allowed_variables_json
), corrected AS (
  SELECT template_key, locale, subject_template,
    replace(replace(replace(replace(replace(replace(html_template,
      'Bemaerk', 'Bemærk'), 'tillaeg', 'tillæg'), 'taeller', 'tæller'),
      'sygdomsloenarter', 'sygdomslønarter'), 'vaere', 'være'), 'Aarsag', 'Årsag') AS html_template,
    replace(replace(replace(replace(replace(replace(replace(text_template,
      'Bemaerk', 'Bemærk'), 'tillaeg', 'tillæg'), 'taeller', 'tæller'),
      'sygdomsloenarter', 'sygdomslønarter'), 'vaere', 'være'), 'Aarsag', 'Årsag'),
      chr(92) || 'n', chr(10)) AS text_template,
    allowed_variables_json
  FROM previous
)
INSERT INTO email_template (tenant_id, template_key, locale, version, is_active,
  subject_template, html_template, text_template, allowed_variables_json)
SELECT NULL, template_key, locale, 2, true,
  subject_template, html_template, text_template, allowed_variables_json
FROM corrected;

COMMIT;
