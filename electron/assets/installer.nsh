!macro customCheckAppRunning
  DetailPrint "Closing running Eidos processes before install/uninstall..."
  nsExec::ExecToLog 'taskkill /IM "Eidos.exe" /T /F'
  Sleep 1000
!macroend
