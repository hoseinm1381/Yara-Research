param([ValidateSet('check','test','build','dev','fmt')][string]$Action='dev')
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$projectRoot=$PWD.Path
if(Test-Path '.tooling/cargo/bin/cargo.exe') {
 $env:CARGO_HOME=Join-Path $projectRoot '.tooling/cargo'
 $env:RUSTUP_HOME=Join-Path $projectRoot '.tooling/rustup'
 $env:PATH="$env:CARGO_HOME\bin;$env:PATH"
}
# Import only compiler-related environment variables; do not print the machine environment.
$vcvars='C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
if(Test-Path $vcvars) {
 $compilerEnv = & cmd.exe /d /s /c "`"$vcvars`" >nul && set"
 foreach($line in $compilerEnv) {if($line -match '^(PATH|LIB|LIBPATH|INCLUDE|WindowsSdkDir|WindowsSDKVersion|VCToolsInstallDir|VCINSTALLDIR)=(.*)$'){[Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process')}}
}
switch($Action) {
 'check' { & cargo check --manifest-path src-tauri/Cargo.toml }
 'test' { & cargo test --manifest-path src-tauri/Cargo.toml }
 'fmt' { & cargo fmt --manifest-path src-tauri/Cargo.toml -- --check }
 'build' {
  & npm.cmd run build:extension
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  & cargo build --manifest-path src-tauri/Cargo.toml --release --bin yara-native-host
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  New-Item -ItemType Directory -Force src-tauri/binaries | Out-Null
  Copy-Item -LiteralPath src-tauri/target/release/yara-native-host.exe -Destination src-tauri/binaries/yara-native-host-x86_64-pc-windows-msvc.exe
  & npm.cmd run package
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  & pwsh -NoProfile -File scripts/package-release.ps1
 }
 'dev' { & npm.cmd run desktop }
}
exit $LASTEXITCODE
