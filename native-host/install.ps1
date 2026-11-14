param([string]$ExtensionId = 'icenlgengacpdghfhoamfodcagohilfl')
$ErrorActionPreference = 'Stop'

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  拾页 · PagePick 本地助手注册程序 (v0.4.2)" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# 1. 自动寻找 WebFigmaHelper.exe
$candidates = @(
  (Join-Path $PSScriptRoot 'WebFigmaHelper.exe'),
  (Join-Path $PSScriptRoot 'publish\WebFigmaHelper.exe'),
  (Join-Path $PSScriptRoot 'standalone\WebFigmaHelper.exe'),
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

if (-not $helperPath) {
  Write-Host "❌ 错误：未找到 WebFigmaHelper.exe 执行文件！" -ForegroundColor Red
  Write-Host "请确认安装包已完整解压，不要在压缩包内直接双击运行。" -ForegroundColor Yellow
  throw "未找到 WebFigmaHelper.exe"
}

# 2. 准备清单文件 com.webfigma.helper.json
$manifestPath = (Join-Path $PSScriptRoot 'com.webfigma.helper.json')

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

$manifestObj = @{
  name = 'com.webfigma.helper'
  description = 'Web Figma local paste helper'
  path = $helperPath
  type = 'stdio'
  allowed_origins = $origins
}
$jsonContent = $manifestObj | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($manifestPath, $jsonContent, (New-Object System.Text.UTF8Encoding($false)))

# 3. 注册到 Windows 常见所有 Chromium 浏览器路径
$browserList = @(
  'Google\Chrome',
  'Chromium',
  'Microsoft\Edge',
  'Aside',
  'Aside\Aside',
  'Aside Browser',
  'BraveSoftware\Brave-Browser',
  'Vivaldi',
  '360Chrome\Chrome'
)

$registeredCount = 0
foreach ($browser in $browserList) {
  try {
    $keyPath = "HKCU:\Software\$browser\NativeMessagingHosts\com.webfigma.helper"
    New-Item -Path $keyPath -Force | Out-Null
    Set-Item -Path $keyPath -Value $manifestPath
    $registeredCount++
  } catch {
  }
}

Write-Host ""
Write-Host "✅ 拾页本地助手已成功注册到系统！" -ForegroundColor Green
Write-Host "  - 核心执行程序: $helperPath" -ForegroundColor Gray
Write-Host "  - 清单配置路径: $manifestPath" -ForegroundColor Gray
Write-Host "  - 已配置浏览器分支数: $registeredCount" -ForegroundColor Gray
Write-Host "  - 已授权扩展 ID 白名单:" -ForegroundColor Gray
foreach ($orig in $origins) {
  Write-Host "      • $orig" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "✨ 校验通过！现在可以在浏览器和 Figma 中直接使用了。" -ForegroundColor Green
