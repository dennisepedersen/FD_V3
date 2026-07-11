param(
  [switch]$StagedOnly,
  [switch]$AllFiles
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$argsList = @()
if ($AllFiles) {
  $argsList += '--all'
} elseif ($StagedOnly) {
  $argsList += '--staged'
} else {
  $argsList += '--staged'
}

node scripts/check-secrets.js @argsList
exit $LASTEXITCODE