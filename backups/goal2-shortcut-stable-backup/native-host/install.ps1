param([Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId)
$ErrorActionPreference = 'Stop'
$helperPath = Join-Path $PSScriptRoot 'bin\Release\net10.0-windows\publish\WebFigmaHelper.exe'
if (-not (Test-Path -LiteralPath $helperPath)) { throw 'Build the native helper first.' }
$manifestPath = Join-Path $PSScriptRoot 'com.webfigma.helper.json'
@{name='com.webfigma.helper';description='Web Figma local paste helper';path=$helperPath;type='stdio';allowed_origins=@("chrome-extension://$ExtensionId/")} | ConvertTo-Json | ForEach-Object { [System.IO.File]::WriteAllText($manifestPath, $_, (New-Object System.Text.UTF8Encoding($false))) }
foreach ($browser in @('Google\Chrome','Microsoft\Edge','Aside','Aside\Aside')) {
  $key = "HKCU:\Software\$browser\NativeMessagingHosts\com.webfigma.helper"
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $manifestPath
}
Write-Host 'Native helper registered for the current user.'
