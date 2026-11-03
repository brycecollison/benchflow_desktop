; Inno Setup script for the Benchflow desktop app. Run it through packaging/build.ps1, which
; passes /DVersion and /DAppDir (the onedir output). Building it by hand:
;
;   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" /DVersion=1.0.0 packaging\setup.iss
;
; Per-user install (PrivilegesRequired=lowest): no admin rights, installs into
; %LOCALAPPDATA%\Programs\Benchflow, and each Windows account gets its own notebook - which is
; what app/paths.py assumes (state in %LOCALAPPDATA%\Benchflow, one instance per user). A
; machine-wide install would put nothing in Program Files that the app cares about, and would
; cost the IT helpdesk an admin ticket per laptop for no benefit.
;
; Uninstalling removes the program only. The notebook, uploads and logs are left in
; %LOCALAPPDATA%\Benchflow on purpose - see the message at the end of [Code].

#define MyAppName "Benchflow"
#ifndef Version
  #define Version "1.0.0"
#endif
#ifndef AppDir
  #define AppDir "..\dist\Benchflow"
#endif

[Setup]
; AppId is stable forever: it is how a newer setup exe recognises an existing install and
; replaces it instead of installing a second copy alongside it. Never change it.
AppId={{7C1E4A93-5F2D-4C6B-8F0A-3B9D1E7A2C55}
AppName={#MyAppName}
AppVersion={#Version}
AppVerName={#MyAppName} {#Version}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
DisableWelcomePage=no
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\Benchflow.exe
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist\installer
OutputBaseFilename=Benchflow-{#Version}-Setup
SetupIconFile=icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#AppDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\Benchflow.exe"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\Benchflow.exe"

[Run]
Filename: "{app}\Benchflow.exe"; Description: "Start {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Intentionally empty. Everything the app writes (benchflow.db, uploads/, logs/, history/) is in
; %LOCALAPPDATA%\Benchflow, not in {app}, so uninstalling never touches anyone's notebook.

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{localappdata}\Benchflow');
    MsgBox(
      'Benchflow has been removed. Your notebook, uploads and logs were left alone in:' + #13#10#13#10 +
      '    ' + DataDir + #13#10#13#10 +
      'Delete that folder only if you are sure you no longer need the notebook (and it has been ' +
      'backed up). A newer version will pick the notebook up where it is.',
      mbInformation, MB_OK);
  end;
end;
