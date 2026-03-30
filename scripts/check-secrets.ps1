param(
  [switch]$StagedOnly,
  [switch]$AllFiles
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$excludePathRegex = '\\(\.git|node_modules|audit(?: \(read only\))?)\\'
$fileNameAllowList = @(
  '.env.example',
  'README_LOCAL_RUN.md'
)

$rules = @(
  @{ Id = 'R1_POSTGRES_URI'; Regex = '(?i)postgres(?:ql)?://[^\s\"\'']+'; CaseSensitive = $false },
  @{ Id = 'R2_DATABASE_URL_ASSIGNMENT'; Regex = '(?i)\bDATABASE_URL\s*=\s*\S+'; CaseSensitive = $false },
  @{ Id = 'R3_PASSWORD_ASSIGNMENT'; Regex = '(?<!\$)\b(PGPASSWORD|DB_PASSWORD|DATABASE_PASSWORD|PASSWORD)\s*=\s*\S+'; CaseSensitive = $true },
  @{ Id = 'R4_RENDER_DB_CONTEXT'; Regex = '(?i)render\.com.*(postgres|database|password|uri|connection|DATABASE_URL)|(?:postgres|database|password|uri|connection|DATABASE_URL).*render\.com'; CaseSensitive = $false }
)

function ToRelativePath {
  param([string]$Path)

  $root = (Resolve-Path $repoRoot).Path.TrimEnd('\\')
  $full = (Resolve-Path $Path).Path
  if ($full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $full.Substring($root.Length).TrimStart('\\')
  }
  return $Path
}

function ShouldSkipMatch {
  param(
    [string]$Path,
    [string]$Line,
    [string]$RuleId
  )

  $name = [System.IO.Path]::GetFileName($Path)

  # Allow documented placeholders in env examples and local run docs.
  if ($fileNameAllowList -contains $name) {
    return $true
  }

  # Allow localhost postgres examples anywhere.
  if ($RuleId -eq 'R1_POSTGRES_URI' -and $Line -match '(?i)localhost|127\.0\.0\.1') {
    return $true
  }

  # Allow commented lines in docs/config.
  if ($Line -match '^\s*#') {
    return $true
  }

  return $false
}

function GetFilesToScan {
  param([switch]$ScanAll)

  if (-not $ScanAll) {
    $staged = git diff --cached --name-only --diff-filter=ACMR
    if (-not $staged) { return @() }
    $files = @()
    foreach ($p in $staged) {
      if (-not (Test-Path $p -PathType Leaf)) { continue }
      $full = (Resolve-Path $p).Path
      if ($full -match $excludePathRegex) { continue }
      $files += $full
    }
    return $files
  }

  return Get-ChildItem -Recurse -File | Where-Object {
    $_.FullName -notmatch $excludePathRegex
  } | ForEach-Object { $_.FullName }
}

# Default behavior is staged-only to support pre-commit safety checks.
# Use -AllFiles for a full repository sweep.
$scanAll = $false
if ($AllFiles) { $scanAll = $true }
if ($StagedOnly) { $scanAll = $false }

$files = GetFilesToScan -ScanAll:$scanAll
if (-not $files -or $files.Count -eq 0) {
  Write-Output 'secret-check: no files to scan'
  exit 0
}

$findings = @()
foreach ($file in $files) {
  $lineNo = 0
  Get-Content $file | ForEach-Object {
    $lineNo++
    $line = $_
    foreach ($rule in $rules) {
      $isMatch = $false
      if ($rule.CaseSensitive) {
        $isMatch = $line -cmatch $rule.Regex
      } else {
        $isMatch = $line -match $rule.Regex
      }

      if ($isMatch) {
        if (ShouldSkipMatch -Path $file -Line $line -RuleId $rule.Id) {
          continue
        }
        $rel = ToRelativePath -Path $file
        $findings += [PSCustomObject]@{
          Rule = $rule.Id
          File = $rel
          Line = $lineNo
        }
      }
    }
  }
}

if ($findings.Count -gt 0) {
  Write-Output 'secret-check: potential secret patterns detected (content masked)'
  $findings | Sort-Object File, Line, Rule | ForEach-Object {
    Write-Output ("- " + $_.Rule + " at " + $_.File + ":" + $_.Line + " [REDACTED]")
  }
  Write-Output 'secret-check: FAIL'
  exit 1
}

Write-Output 'secret-check: PASS'
exit 0
