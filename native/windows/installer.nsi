Unicode true
RequestExecutionLevel user
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!ifndef VERSION
  !error "VERSION is required"
!endif
!ifndef SOURCE_EXE
  !error "SOURCE_EXE is required"
!endif
!ifndef OUTPUT_DIR
  !error "OUTPUT_DIR is required"
!endif
!ifndef REPOSITORY_ROOT
  !error "REPOSITORY_ROOT is required"
!endif

!define APP_NAME "大狗桌宠"
!define APP_EXE "dagou-pet.exe"
!define APP_REGISTRY_KEY "Software\Seb1900\DagouPet"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\bc780249-420c-5c11-acac-c3642d232a28"

Name "${APP_NAME}"
Caption "${APP_NAME} ${VERSION}"
OutFile "${OUTPUT_DIR}\Dagou-Desktop-Pet-Setup-${VERSION}-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\大狗桌宠"
InstallDirRegKey HKCU "${APP_REGISTRY_KEY}" "InstallDir"
Icon "${REPOSITORY_ROOT}\assets\branding\app-icon.ico"
UninstallIcon "${REPOSITORY_ROOT}\assets\branding\app-icon.ico"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=2052 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=2052 "CompanyName" "Seb1900"
VIAddVersionKey /LANG=2052 "FileDescription" "${APP_NAME} 安装程序"
VIAddVersionKey /LANG=2052 "LegalCopyright" "Copyright (c) 2026 Seb1900"

!define MUI_ABORTWARNING
!define MUI_ICON "${REPOSITORY_ROOT}\assets\branding\app-icon.ico"
!define MUI_UNICON "${REPOSITORY_ROOT}\assets\branding\app-icon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "运行 ${APP_NAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${REPOSITORY_ROOT}\LICENSE.md"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Var LegacyUninstall
Var LegacyDisplayIcon
Var InstallSize

Function .onInit
  SetShellVarContext current
!ifdef TEST_BUILD
  Return
!endif
  ${GetParameters} $0
  ${GetOptions} $0 "/NOLEGACY" $1
  IfErrors checkLegacy skipLegacy

checkLegacy:
  ReadRegStr $LegacyDisplayIcon HKCU "${UNINSTALL_KEY}" "DisplayIcon"
  StrCmp $LegacyDisplayIcon "" runLegacy
  StrCpy $LegacyDisplayIcon $LegacyDisplayIcon -2
  ${GetParent} "$LegacyDisplayIcon" $2
  StrCmp $2 "" runLegacy
  StrCpy $INSTDIR $2

runLegacy:
  ReadRegStr $LegacyUninstall HKCU "${UNINSTALL_KEY}" "QuietUninstallString"
  StrCmp $LegacyUninstall "" skipLegacy
  ExecWait '$LegacyUninstall' $3

skipLegacy:
FunctionEnd

Section "大狗桌宠" MainSection
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File "/oname=${APP_EXE}" "${SOURCE_EXE}"

  SetOutPath "$INSTDIR\legal"
  File "${REPOSITORY_ROOT}\LICENSE.md"
  File "${REPOSITORY_ROOT}\NOTICE.md"
  File "${REPOSITORY_ROOT}\PRIVACY.md"
  File "${REPOSITORY_ROOT}\THIRD_PARTY_NOTICES.md"
  File "${REPOSITORY_ROOT}\assets\ASSET_PROVENANCE.md"

  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
!ifndef TEST_BUILD
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"

  WriteRegStr HKCU "${APP_REGISTRY_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME} ${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Seb1900"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "https://github.com/Seb1900/dagou-pet"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLUpdateInfo" "https://github.com/Seb1900/dagou-pet/releases"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $InstallSize $0 $1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $InstallSize
!endif
SectionEnd

Section "Uninstall"
  SetShellVarContext current
!ifndef TEST_BUILD
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"
!endif
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\legal\LICENSE.md"
  Delete "$INSTDIR\legal\NOTICE.md"
  Delete "$INSTDIR\legal\PRIVACY.md"
  Delete "$INSTDIR\legal\THIRD_PARTY_NOTICES.md"
  Delete "$INSTDIR\legal\ASSET_PROVENANCE.md"
  RMDir "$INSTDIR\legal"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
!ifndef TEST_BUILD
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "${APP_REGISTRY_KEY}"
!endif
SectionEnd
