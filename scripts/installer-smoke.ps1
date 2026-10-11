# Run on Windows only, when this product is not already installed.
param([ValidateSet('install','uninstall')][string]$Mode='install', [string]$Installation='')
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outRoot=Join-Path $taskRoot 'output\desktop-smoke-030'
New-Item -ItemType Directory -Path $outRoot -Force | Out-Null
if ($Mode -eq 'install') {
  foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall')) {
    if (Test-Path -LiteralPath $key) {
      $existing=Get-ChildItem -LiteralPath $key | ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } | Where-Object { $_.DisplayName -like '知衡*' }
      if ($existing) { throw 'A Zhiheng installation already exists. Use a clean Windows test account; no existing installation was modified.' }
    }
  }
  foreach ($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))) {
    if (Test-Path -LiteralPath (Join-Path $folder '知衡.lnk')) { throw 'A Zhiheng shortcut already exists; use a clean Windows test account.' }
  }
  $Installation=Join-Path $outRoot ('installed-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
  $version=(Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
  $executable=Join-Path $taskRoot "release\Zhiheng-Setup-$version-x64.exe"
  $process=Start-Process -FilePath $executable -ArgumentList "/S /currentuser /D=$Installation" -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(55000)) { throw 'Installer timeout; retain process for inspection.' }
  if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $Installation '知衡.exe'))) { throw 'Installer did not complete successfully.' }
  [PSCustomObject]@{ok=$true;mode='install';exitCode=$process.ExitCode;path=$Installation;version=$version} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outRoot 'installer-check.json') -Encoding utf8
  Get-Content -LiteralPath (Join-Path $outRoot 'installer-check.json')
} else {
  $Installation=[IO.Path]::GetFullPath($Installation)
  $record=Get-Content -LiteralPath (Join-Path $outRoot 'installer-check.json') -Raw | ConvertFrom-Json
  if ($Installation -ne $record.path -or -not $Installation.StartsWith($outRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Uninstall target must match this test installation within the workspace.' }
  $uninstaller=Join-Path $Installation 'Uninstall 知衡.exe'
  # Default uninstaller preserves application data. No delete-app-data option is used.
  $process=Start-Process -FilePath $uninstaller -ArgumentList '/S /currentuser' -WindowStyle Hidden -PassThru
  $process.WaitForExit(5000) | Out-Null
  $deadline=(Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline -and (Test-Path -LiteralPath (Join-Path $Installation '知衡.exe'))) { Start-Sleep -Milliseconds 250 }
  if (Test-Path -LiteralPath (Join-Path $Installation '知衡.exe')) { throw 'Uninstaller did not remove the test executable.' }
  [PSCustomObject]@{ok=$true;mode='uninstall';path=$Installation;applicationDataDeleteRequested=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outRoot 'uninstaller-check.json') -Encoding utf8
  Get-Content -LiteralPath (Join-Path $outRoot 'uninstaller-check.json')
}
