param([ValidateSet('Register','Restore')][string]$Mode,[string]$Manifest,[string]$State)
$ErrorActionPreference='Stop'
$paths=@('HKCU:\Software\Google\Chrome\NativeMessagingHosts\org.yara.research','HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\org.yara.research')
if($Mode -eq 'Register') {
 if(Test-Path -LiteralPath $State){throw 'Refusing to overwrite registry rollback state.'}
 $resolved=(Resolve-Path -LiteralPath $Manifest).Path
 $records=@($paths | ForEach-Object {
  $exists=Test-Path -LiteralPath $_
  $value=if($exists){(Get-Item -LiteralPath $_).GetValue('')}else{$null}
  [PSCustomObject]@{path=$_;existed=$exists;value=$value;testManifest=$resolved}
 })
 $records | ConvertTo-Json | Set-Content -LiteralPath $State -Encoding utf8
 foreach($record in $records){New-Item -Path $record.path -Force | Out-Null;Set-Item -LiteralPath $record.path -Value $resolved}
} else {
 $records=Get-Content -LiteralPath $State -Raw | ConvertFrom-Json
 foreach($record in $records){
  if(-not(Test-Path -LiteralPath $record.path)){continue}
  if((Get-Item -LiteralPath $record.path).GetValue('') -ne $record.testManifest){throw 'Registration changed externally; preserved without overwriting it.'}
  if($record.existed){
   if($null -eq $record.value){Remove-ItemProperty -LiteralPath $record.path -Name '(default)' -ErrorAction SilentlyContinue}
   else{Set-Item -LiteralPath $record.path -Value $record.value}
  } else {Remove-Item -LiteralPath $record.path}
 }
}
