param([string]$ExtensionId = 'icenlgengacpdghfhoamfodcagohilfl')
$ErrorActionPreference = 'Stop'

$candidates = @(
  (Join-Path $PSScriptRoot 'WebFigmaHelper.exe'),
  (Join-Path $PSScriptRoot 'standalone\WebFigmaHelper.exe'),
  (Join-Path $PSScriptRoot 'publish\WebFigmaHelper.exe'),
  (Join-Path $PSScriptRoot 'bin\Release\standalone-publish\WebFigmaHelper.exe'),
  (Join-Path $PSScriptRoot 'bin\Release\net10.0-windows\publish\WebFigmaHelper.exe'),
  (Join-Path $PSScriptRoot 'bin\Release\net10.0-windows\WebFigmaHelper.exe')
)

$helperPath = $null
foreach ($c in $candidates) {
  if (Test-Path -LiteralPath $c) {
    $helperPath = (Resolve-Path $c).Path
    break
  }
}

if (-not $helperPath) { throw '未找到 WebFigmaHelper.exe 执行文件，请确认安装包是否完整解压。' }

$manifestPath = Join-Path $PSScriptRoot 'com.webfigma.helper.json'

$origins = @(
  "chrome-extension://icenlgengacpdghfhoamfodcagohilfl/",
  "chrome-extension://kibgoidckblnppejfjpjmiobcodkiajo/"
)
if ($ExtensionId) {
  $cleanId = $ExtensionId.Trim()
  $target = "chrome-extension://$cleanId/"
  if ($origins -notcontains $target) {
    $origins += $target
  }
}

@{
  name = 'com.webfigma.helper'
  description = 'Web Figma local paste helper'
  path = $helperPath
  type = 'stdio'
  allowed_origins = $origins
} | ConvertTo-Json | ForEach-Object { [System.IO.File]::WriteAllText($manifestPath, $_, (New-Object System.Text.UTF8Encoding($false))) }

foreach ($browser in @('Google\Chrome','Microsoft\Edge','Aside','Aside\Aside')) {
  $key = "HKCU:\Software\$browser\NativeMessagingHosts\com.webfigma.helper"
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $manifestPath
}

Write-Host "✅ 拾页本地助手已成功注册到系统！" -ForegroundColor Green
Write-Host "注册路径: $helperPath"
Write-Host "已授权扩展 ID 列表:"
foreach ($orig in $origins) {
  Write-Host "  - $orig"
}
