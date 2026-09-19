$ErrorActionPreference = "Stop"

$Source = $PSScriptRoot
$Base = if ($env:AIDE_INSTALL_DIR) { $env:AIDE_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "AIDE" }
$InstallDir = Join-Path $Base "app"
$BinDir = Join-Path $Base "bin"

$BundledNode = Join-Path $Source "runtime\node\node.exe"
if (-not (Test-Path $BundledNode) -and -not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 22+ is required. Use the Full package to bundle Node." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git is required." }

if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
Copy-Item (Join-Path $Source "*") $InstallDir -Recurse -Force

$Launcher = Join-Path $BinDir "aide.cmd"
$InstalledNode = Join-Path $InstallDir "runtime\node\node.exe"
$NodeCommand = if (Test-Path $InstalledNode) { $InstalledNode } else { "node" }
Set-Content -Path $Launcher -Encoding Ascii -Value "@echo off`r`n`"$NodeCommand`" `"$InstallDir\bin\aide.mjs`" %*`r`n"

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$Parts = @($UserPath -split ";" | Where-Object { $_ })
if ($Parts -notcontains $BinDir) {
  [Environment]::SetEnvironmentVariable("Path", (($Parts + $BinDir) -join ";"), "User")
  Write-Host "Added $BinDir to the user PATH. Open a new terminal before using 'aide'."
}

Write-Host "AIDE installed to $InstallDir"
Write-Host "Run: aide C:\path\to\your\project"
