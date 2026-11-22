; Windows installer for the Flutter desktop app (planner desktop design,
; 2026-11-22). Built by .github/workflows/desktop.yml:
;
;   ISCC /DAppVersion=3.0.0 /DBuildDir=<bundle> /DIconFile=<ico> /DOutputDir=dist planner.iss
;
; Per-user, so it installs and updates without an administrator. Its names
; differ from the old Tauri app's ("Student Planner"), so both can be
; installed while people move their data over.
#ifndef AppVersion
  #error AppVersion is required
#endif

[Setup]
; Fixed for the life of the app: Windows ties upgrades and uninstall to it.
AppId={{1E41379D-EE7D-4EC3-964E-5E3B98DD729E}
AppName=Stutastic Planner
AppVersion={#AppVersion}
AppPublisher=DanPlace
AppPublisherURL=https://docs.planner.danplace.tech
DefaultDirName={localappdata}\Programs\Stutastic Planner
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=stutastic-planner-{#AppVersion}-windows-x64-setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\planner.exe
UninstallDisplayName=Stutastic Planner
; An in-app update runs this with /VERYSILENT after Planner has quit; close
; anything still holding the files rather than failing.
CloseApplications=force
RestartApplications=no
WizardStyle=modern
Compression=lzma2
SolidCompression=yes

[InstallDelete]
; Old Flutter assets must not outlive the version that shipped them.
Type: filesandordirs; Name: "{app}\data"

[Files]
Source: "{#BuildDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; The AppUserModelID and toast activator match the app's notification setup
; (app/lib/src/data/notification_gateway.dart); without them Windows won't
; deliver scheduled reminders to an unpackaged app.
Name: "{userprograms}\Stutastic Planner"; Filename: "{app}\planner.exe"; \
  AppUserModelID: "DanPlace.StudentPlanner"; \
  AppUserModelToastActivatorCLSID: "431A4CCF-AE5A-409B-9DD4-B2C41E3719DA"

[Run]
Filename: "{app}\planner.exe"; Description: "Open Stutastic Planner"; Flags: nowait postinstall skipifsilent
; After an in-app update (silent), start the new version.
Filename: "{app}\planner.exe"; Flags: nowait; Check: WizardSilent
