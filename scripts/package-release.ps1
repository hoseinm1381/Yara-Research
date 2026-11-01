$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$version=(Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
$config=Get-Content -LiteralPath src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
$extension=Get-Content -LiteralPath .tooling/extension-build/manifest.json -Raw | ConvertFrom-Json
if($config.version -ne $version -or $extension.version -ne $version){throw 'Desktop and extension versions must match before packaging.'}
$installer="Yara Research_${version}_x64-setup.exe"
$built=Join-Path 'src-tauri/target/release/bundle/nsis' $installer
if(-not(Test-Path -LiteralPath $built)){throw 'Build the NSIS installer first.'}
New-Item -ItemType Directory -Path release -Force | Out-Null
Copy-Item -LiteralPath $built -Destination (Join-Path release $installer)
$zip="Yara-browser-extension-${version}.zip"
Compress-Archive -Path .tooling/extension-build/* -DestinationPath (Join-Path release $zip) -Force
$artifacts=Get-ChildItem -LiteralPath release -File | Where-Object { $_.Extension -in @('.exe','.zip') } | Sort-Object Name
$sums=@($artifacts | ForEach-Object {"$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)"})
$sums | Set-Content -LiteralPath release/SHA256SUMS.txt -Encoding ascii
$record=[ordered]@{
 version=$version
 installer=$installer
 installerBytes=(Get-Item -LiteralPath (Join-Path release $installer)).Length
 installerSha256=(Get-FileHash -LiteralPath (Join-Path release $installer) -Algorithm SHA256).Hash.ToLower()
 extensionZip=$zip
 extensionSha256=(Get-FileHash -LiteralPath (Join-Path release $zip) -Algorithm SHA256).Hash.ToLower()
 extensionId=(Get-Content -LiteralPath extension/extension-id.txt -Raw).Trim()
 appSha256=(Get-FileHash -LiteralPath src-tauri/target/release/yara-research.exe -Algorithm SHA256).Hash.ToLower()
 hostSha256=(Get-FileHash -LiteralPath src-tauri/target/release/yara-native-host.exe -Algorithm SHA256).Hash.ToLower()
}
$evidence=Join-Path docs "evidence-v$version"
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
$record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'package.json') -Encoding utf8
$artifacts | Select-Object Name,Length
