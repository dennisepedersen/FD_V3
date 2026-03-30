$ErrorActionPreference = 'Stop'

$base = 'https://fielddeskai.onrender.com'
$rootHost = 'fielddesk.dk'
$tenantHost = 'fd-test-onb.fielddesk.dk'
$adminEmail = 'onboarding+fd-test-onb@fielddesk.local'
$password = 'test1234'

function ShortBody {
  param([string]$s)
  if ([string]::IsNullOrWhiteSpace($s)) { return '' }
  $one = ($s -replace "`r|`n", ' ')
  if ($one.Length -gt 220) { return $one.Substring(0, 220) }
  return $one
}

function StepOut {
  param([string]$step, [int]$status, [string]$body)
  Write-Output "step=$step"
  Write-Output "status=$status"
  Write-Output ("body=" + (ShortBody $body))
}

function InvokeStep {
  param(
    [string]$step,
    [string]$method,
    [string]$url,
    [hashtable]$headers,
    [string]$body
  )

  try {
    if ($body) {
      $resp = Invoke-WebRequest -UseBasicParsing -Method $method -Uri $url -Headers $headers -ContentType 'application/json' -Body $body
    } else {
      $resp = Invoke-WebRequest -UseBasicParsing -Method $method -Uri $url -Headers $headers
    }
    StepOut -step $step -status ([int]$resp.StatusCode) -body $resp.Content
    return @{ ok = $true; content = $resp.Content }
  } catch {
    if ($_.Exception.Response) {
      $resp = $_.Exception.Response
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $raw = $reader.ReadToEnd()
      StepOut -step $step -status ([int]$resp.StatusCode) -body $raw
    } else {
      StepOut -step $step -status -1 -body $_.Exception.Message
    }
    Write-Output 'final_result=FAIL'
    exit 0
  }
}

$globalHeaders = @{
  Host = $rootHost
  'x-global-admin-key' = 'local_admin_key'
  'x-global-admin-id' = 'global-admin-1'
}

$body1 = @{
  email = $adminEmail
  company_name = 'FD Test Onboarding Flow'
  desired_slug = 'fd-test-onb'
  admin_name = 'Dennis Test Admin'
  allow_skip_ek = $true
  invitation_note = 'production smoke test'
  expires_in_hours = 24
} | ConvertTo-Json -Compress

$r1 = InvokeStep -step '1_create_invitation' -method 'POST' -url "$base/v1/invitations" -headers $globalHeaders -body $body1
$j1 = $r1.content | ConvertFrom-Json
$invitationToken = $j1.invitation_token
if (-not $invitationToken) { $invitationToken = $j1.token }
if (-not $invitationToken -and $j1.invitation) { $invitationToken = $j1.invitation.token }
if (-not $invitationToken -and $j1.data) { $invitationToken = $j1.data.invitation_token }
if (-not $invitationToken) {
  StepOut -step '1_create_invitation' -status 500 -body 'missing invitation token in response'
  Write-Output 'final_result=FAIL'
  exit 0
}

$body2 = @{ token = $invitationToken } | ConvertTo-Json -Compress
$r2 = InvokeStep -step '2_accept_invitation' -method 'POST' -url "$base/v1/invitations/accept" -headers @{ Host = $rootHost } -body $body2
$j2 = $r2.content | ConvertFrom-Json
$onboardingToken = $j2.onboarding_token
if (-not $onboardingToken) { $onboardingToken = $j2.token }
if (-not $onboardingToken -and $j2.session) { $onboardingToken = $j2.session.onboarding_token }
if (-not $onboardingToken -and $j2.data) { $onboardingToken = $j2.data.onboarding_token }
if (-not $onboardingToken) {
  StepOut -step '2_accept_invitation' -status 500 -body 'missing onboarding token in response'
  Write-Output 'final_result=FAIL'
  exit 0
}

$onboardingHeaders = @{
  Host = $rootHost
  Authorization = "Bearer $onboardingToken"
}

$body3 = @{
  company_name = 'FD Test Onboarding Flow'
  desired_slug = 'fd-test-onb'
  admin_name = 'Dennis Test Admin'
  admin_email = $adminEmail
} | ConvertTo-Json -Compress
$null = InvokeStep -step '3_basic_info' -method 'POST' -url "$base/v1/onboarding/basic-info" -headers $onboardingHeaders -body $body3

$body4 = @{ accepted = $true; terms_version = 'v1' } | ConvertTo-Json -Compress
$null = InvokeStep -step '4_terms' -method 'POST' -url "$base/v1/onboarding/terms" -headers $onboardingHeaders -body $body4

$body5 = @{ skipped = $true } | ConvertTo-Json -Compress
$null = InvokeStep -step '5_ek_integration_skipped' -method 'POST' -url "$base/v1/onboarding/ek-integration" -headers $onboardingHeaders -body $body5

$body6 = @{ endpoints = @('/api/v4.0/projects', '/api/v4.0/worksheets') } | ConvertTo-Json -Compress
$null = InvokeStep -step '6_endpoint_selection' -method 'POST' -url "$base/v1/onboarding/endpoint-selection" -headers $onboardingHeaders -body $body6

$null = InvokeStep -step '7_review' -method 'GET' -url "$base/v1/onboarding/review" -headers $onboardingHeaders -body $null

$body8 = @{
  admin_email = $adminEmail
  admin_name = 'Dennis Test Admin'
  password = $password
} | ConvertTo-Json -Compress
$null = InvokeStep -step '8_complete' -method 'POST' -url "$base/v1/onboarding/complete" -headers $onboardingHeaders -body $body8

# DATABASE_URL must be set in your environment before running this script.
# Never hardcode credentials here. Set it via: $env:FD_DB_URL = '...'
$conn = $env:FD_DB_URL
if (-not $conn) {
  Write-Error "FD_DB_URL environment variable is not set. Set it to the Render PostgreSQL connection string before running this script."
  Write-Output 'final_result=FAIL'
  exit 1
}
$sql = "WITH t AS (SELECT id FROM tenant WHERE slug='fd-test-onb' LIMIT 1), d AS (SELECT 1 FROM tenant_domain td JOIN t ON td.tenant_id=t.id WHERE td.domain='fd-test-onb.fielddesk.dk' LIMIT 1), u AS (SELECT 1 FROM tenant_user tu JOIN t ON tu.tenant_id=t.id WHERE lower(tu.email)=lower('onboarding+fd-test-onb@fielddesk.local') LIMIT 1) SELECT (CASE WHEN EXISTS(SELECT 1 FROM t) THEN 'tenant=ok' ELSE 'tenant=missing' END) || ';' || (CASE WHEN EXISTS(SELECT 1 FROM d) THEN 'domain=ok' ELSE 'domain=missing' END) || ';' || (CASE WHEN EXISTS(SELECT 1 FROM u) THEN 'user=ok' ELSE 'user=missing' END);"
$dbOut = psql "$conn" -t -A -c $sql 2>&1
if ($LASTEXITCODE -ne 0) {
  StepOut -step '9_verify_db_records' -status 500 -body (($dbOut | Out-String).Trim())
  Write-Output 'final_result=FAIL'
  exit 0
}
$dbSummary = ($dbOut | Out-String).Trim()
StepOut -step '9_verify_db_records' -status 200 -body $dbSummary
if ($dbSummary -notmatch 'tenant=ok;domain=ok;user=ok') {
  Write-Output 'final_result=FAIL'
  exit 0
}

$body10 = @{ email = $adminEmail; password = $password } | ConvertTo-Json -Compress
$null = InvokeStep -step '10_tenant_login' -method 'POST' -url "$base/v1/auth/login" -headers @{ Host = $tenantHost } -body $body10

Write-Output 'final_result=PASS'
