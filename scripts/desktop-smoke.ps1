param(
  [ValidateSet('portable','unpacked','installed')][string]$Kind = 'portable',
  [string]$Database = '',
  [string]$InstalledExecutable = '',
  [string]$Report = ''
)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$runRoot = Join-Path $taskRoot ('output\desktop-smoke\' + $Kind + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path (Join-Path $runRoot 'profile\workspace') -Force | Out-Null
if ($Database) {
  Copy-Item -LiteralPath ([IO.Path]::GetFullPath($Database)) -Destination (Join-Path $runRoot 'profile\workspace\zhiheng.sqlite')
}
$executable = switch ($Kind) {
  'portable' { Join-Path $taskRoot "release\Zhiheng-Portable-$version-x64.exe" }
  'unpacked' { Join-Path $taskRoot 'release\win-unpacked\知衡.exe' }
  'installed' { [IO.Path]::GetFullPath($InstalledExecutable) }
}
if ($Report) {
  $Report = [IO.Path]::GetFullPath($Report)
  if (-not (Test-Path -LiteralPath $Report -PathType Leaf)) { throw 'The requested report file does not exist.' }
}
$env:ZHIHENG_DATA_DIR = Join-Path $runRoot 'profile'
$env:ZHIHENG_SMOKE = Join-Path $runRoot 'window.png'
Remove-Item Env:ZHIHENG_SMOKE_REPORT -ErrorAction SilentlyContinue
if ($Report) { $env:ZHIHENG_SMOKE_REPORT = $Report }
try {
  $process = Start-Process -FilePath $executable -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddSeconds(55)
  while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath ($env:ZHIHENG_SMOKE + '.json')) -and -not (Test-Path -LiteralPath ($env:ZHIHENG_SMOKE + '.error.txt'))) { Start-Sleep -Milliseconds 250 }
  if (Test-Path -LiteralPath ($env:ZHIHENG_SMOKE + '.error.txt')) { throw (Get-Content -LiteralPath ($env:ZHIHENG_SMOKE + '.error.txt') -Raw) }
  $result = Get-Content -LiteralPath ($env:ZHIHENG_SMOKE + '.json') -Raw | ConvertFrom-Json
  if (-not $result.ok) { throw 'Desktop smoke failed' }
  if ($Database -and -not $result.workspaceReady.examLoaded) { throw 'Restored exam was not loaded' }
  $process.WaitForExit(5000) | Out-Null
  [PSCustomObject]@{ok=$true;kind=$Kind;restored=[bool]$Database;result=$result;output=$runRoot} | ConvertTo-Json -Depth 6
} finally {
  Remove-Item Env:ZHIHENG_DATA_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:ZHIHENG_SMOKE -ErrorAction SilentlyContinue
  Remove-Item Env:ZHIHENG_SMOKE_REPORT -ErrorAction SilentlyContinue
}
