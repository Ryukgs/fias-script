' Startet den Verify-Bot ohne sichtbares Fenster, Log in bot.log
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "cmd /c start.cmd >> bot.log 2>&1", 0, False
