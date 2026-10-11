BEGIN;

WITH target_tenant AS (
  SELECT id FROM tenant WHERE slug = 'hoyrup-clemmensen'
),
rules(pay_code, counts_as_valid_hours, label) AS (
  VALUES
    ('9000', true, 'Barsel/foraeldreorlov'),
    ('1195', true, 'Ferie'),
    ('9315', true, 'Ferie (timer) Funk. lignende'),
    ('9200', true, 'SH-penge m/maximum'),
    ('9300', true, 'SH-penge m/maximum. Funk. lignende'),
    ('9320', true, 'SH-penge m/maximum. Funk. lignende'),
    ('1199', true, 'Ufakturerbar timer'),
    ('9022', true, 'Sygdom uden loen'),
    ('9070', false, 'Stedtillaeg 1 - Kalundborg'),
    ('1244', false, 'Formandstillaeg')
)
INSERT INTO time_control_pay_code_rule (tenant_id, pay_code, counts_as_valid_hours, label)
SELECT target_tenant.id, rules.pay_code, rules.counts_as_valid_hours, rules.label
FROM target_tenant CROSS JOIN rules
ON CONFLICT (tenant_id, pay_code) DO UPDATE SET
  counts_as_valid_hours = EXCLUDED.counts_as_valid_hours,
  label = EXCLUDED.label;

COMMIT;
