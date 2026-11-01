param([int]$NativeProcessId)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YaraWindowTest {
 [DllImport("user32.dll", CharSet=CharSet.Auto)]
 public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
'@
$nativeApp=Get-Process -Id $NativeProcessId
if($nativeApp.ProcessName -ne 'yara-research'){throw 'Close test can target only the Yara research test application.'}
$nativeApp.Refresh()
if($nativeApp.MainWindowHandle -eq [IntPtr]::Zero){throw 'Test application has no main window.'}
if(-not [YaraWindowTest]::PostMessage($nativeApp.MainWindowHandle,0x10,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Could not request native window close.'}
