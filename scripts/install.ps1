# Installs (or updates) the latest Quire for Windows.
#
#   irm https://getquire.pages.dev/install.ps1 | iex
#
# Quire isn't signed with a paid Windows certificate. A browser download gets
# a SmartScreen warning for that reason; a file fetched by PowerShell isn't
# marked as downloaded from the internet, so the installer just runs.
# Served from https://getquire.pages.dev/install.ps1 (apps/site/deploy.sh copies it there).
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

Write-Host "Downloading Quire…"
$installer = Join-Path $env:TEMP "Quire-windows-setup.exe"
Invoke-WebRequest -UseBasicParsing "https://github.com/sgwork004-max/quire/releases/latest/download/Quire-windows-setup.exe" -OutFile $installer

# Close a running copy so it can be replaced.
Get-Process -Name "quire" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Installing…"
Start-Process -FilePath $installer -ArgumentList "/S" -Wait
Remove-Item $installer -ErrorAction SilentlyContinue

$exe = @("$env:LOCALAPPDATA\Quire", "$env:LOCALAPPDATA\Programs\Quire", "$env:ProgramFiles\Quire") |
  ForEach-Object { Get-ChildItem -Path $_ -Filter "quire.exe" -ErrorAction SilentlyContinue } |
  Select-Object -First 1

if ($exe) {
  Write-Host "Quire is installed. Opening it…"
  Start-Process $exe.FullName
} else {
  Write-Host "Quire is installed. Open it from the Start menu."
}
