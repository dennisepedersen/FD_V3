BEGIN;

INSERT INTO email_template (
  template_key,
  locale,
  version,
  subject_template,
  html_template,
  text_template,
  allowed_variables_json
)
VALUES
  (
    'absence_request.approved.employee',
    'da-DK',
    1,
    'Din fravaersanmodning er godkendt',
    '<p>Hej {{employee_name}}</p><p>Din fravaersanmodning om {{absence_type}} fra {{start_date}} til {{end_date}} er godkendt af {{manager_name}}.</p><p><a href="{{action_url}}">Aabn Fielddesk</a></p><p>{{tenant_name}}</p>',
    'Hej {{employee_name}}\n\nDin fravaersanmodning om {{absence_type}} fra {{start_date}} til {{end_date}} er godkendt af {{manager_name}}.\n\nAabn Fielddesk: {{action_url}}\n\n{{tenant_name}}',
    '["employee_name","manager_name","absence_type","start_date","end_date","start_time","end_time","action_url","tenant_name"]'::jsonb
  ),
  (
    'absence_request.rejected.employee',
    'da-DK',
    1,
    'Din fravaersanmodning er afvist',
    '<p>Hej {{employee_name}}</p><p>Din fravaersanmodning om {{absence_type}} fra {{start_date}} til {{end_date}} er afvist af {{manager_name}}.</p><p>Begrundelse: {{decision_reason}}</p><p><a href="{{action_url}}">Aabn Fielddesk</a></p><p>{{tenant_name}}</p>',
    'Hej {{employee_name}}\n\nDin fravaersanmodning om {{absence_type}} fra {{start_date}} til {{end_date}} er afvist af {{manager_name}}.\n\nBegrundelse: {{decision_reason}}\n\nAabn Fielddesk: {{action_url}}\n\n{{tenant_name}}',
    '["employee_name","manager_name","absence_type","start_date","end_date","start_time","end_time","decision_reason","action_url","tenant_name"]'::jsonb
  )
ON CONFLICT DO NOTHING;

COMMIT;
