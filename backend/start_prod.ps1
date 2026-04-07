$env_file = "C:\Users\dep\Projekter\Fielddesk_V3\backend\.env.production"
Get-Content $env_file | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $kv = $_ -split '=', 2
  if ($kv.Length -eq 2) {
    [System.Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim(), [System.EnvironmentVariableTarget]::Process)
  }
}
Set-Location "C:\Users\dep\Projekter\Fielddesk_V3\backend"
node src/server.js
