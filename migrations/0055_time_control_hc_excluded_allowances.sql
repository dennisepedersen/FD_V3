BEGIN;

WITH target_tenant AS (
  SELECT id FROM tenant WHERE slug = 'hoyrup-clemmensen'
),
rules(pay_code, counts_as_valid_hours, label) AS (
  VALUES
    ('9043', false, 'Formandstillaeg 4'),
    ('9076', false, 'Funktionstillaeg')
)
INSERT INTO time_control_pay_code_rule (tenant_id, pay_code, counts_as_valid_hours, label)
SELECT target_tenant.id, rules.pay_code, rules.counts_as_valid_hours, rules.label
FROM target_tenant CROSS JOIN rules
ON CONFLICT (tenant_id, pay_code) DO UPDATE SET
  counts_as_valid_hours = EXCLUDED.counts_as_valid_hours,
  label = EXCLUDED.label
WHERE time_control_pay_code_rule.counts_as_valid_hours IS DISTINCT FROM EXCLUDED.counts_as_valid_hours
   OR time_control_pay_code_rule.label IS DISTINCT FROM EXCLUDED.label;

COMMIT;
