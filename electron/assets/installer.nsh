!macro eidosCloseRunningProcesses
  DetailPrint "Closing running Eidos processes..."
  nsExec::ExecToLog 'taskkill /IM "Eidos.exe" /T /F'
  Sleep 1000
!macroend

!macro customCheckAppRunning
  !insertmacro eidosCloseRunningProcesses
!macroend

!macro eidosFallbackRemoveOldInstall ROOT_KEY
  DetailPrint "Old Eidos uninstaller failed; forcing cleanup before install..."
  !insertmacro eidosCloseRunningProcesses
  RMDir /r "$INSTDIR"
  DeleteRegKey ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}"
  ClearErrors
  StrCpy $R0 0
!macroend

!macro customUnInstallCheck
  ${if} ${Errors}
    !insertmacro eidosFallbackRemoveOldInstall SHELL_CONTEXT
  ${elseif} $R0 != 0
    !insertmacro eidosFallbackRemoveOldInstall SHELL_CONTEXT
  ${endif}
  ClearErrors
  StrCpy $R0 0
!macroend

!macro customUnInstallCheckCurrentUser
  ${if} ${Errors}
    !insertmacro eidosFallbackRemoveOldInstall HKEY_CURRENT_USER
  ${elseif} $R0 != 0
    !insertmacro eidosFallbackRemoveOldInstall HKEY_CURRENT_USER
  ${endif}
  ClearErrors
  StrCpy $R0 0
!macroend
