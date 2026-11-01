!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\org.yara.research" "" "$INSTDIR\native-host.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\org.yara.research" "" "$INSTDIR\native-host.json"
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  ReadRegStr $0 HKCU "Software\Google\Chrome\NativeMessagingHosts\org.yara.research" ""
  StrCmp $0 "$INSTDIR\native-host.json" 0 +2
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\org.yara.research"
  ReadRegStr $0 HKCU "Software\Microsoft\Edge\NativeMessagingHosts\org.yara.research" ""
  StrCmp $0 "$INSTDIR\native-host.json" 0 +2
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\org.yara.research"
!macroend
