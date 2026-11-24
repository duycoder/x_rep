# Install the disk saver once:  powershell -ExecutionPolicy Bypass -File native\cai-dat.ps1
# Registers it for Brave / Chrome / Edge (HKCU only, no admin needed).
param([string]$ExtensionId = "cembecdhkabbbhfeeihglhfijcjcpghc")
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js not found. Install it from https://nodejs.org and run again." }

$name = "com.xcs.saver"
$bat = Join-Path $here "xcs_saver.bat"
[IO.File]::WriteAllText($bat, "@echo off`r`n`"$node`" `"%~dp0xcs_saver.cjs`" %*`r`n")

$manifest = Join-Path $here "$name.json"
$json = @{
  name = $name
  description = "X Goi Y: save posts / replies to disk"
  path = $bat
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json
[IO.File]::WriteAllText($manifest, $json)  # UTF-8 without BOM

foreach ($k in @(
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$name",
    "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$name",
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$name")) {
  New-Item -Path $k -Force | Out-Null
  Set-Item -Path $k -Value $manifest
}
Write-Host "Installed $name for extension $ExtensionId (node: $node)"
