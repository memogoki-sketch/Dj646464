' Startet den Server ohne sichtbares Fenster.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = folder
' 0 = Fenster verstecken, False = nicht auf Ende warten
sh.Run "cmd /c node server.js >> server.log 2>&1", 0, False
