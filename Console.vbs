' Console: local server in a chrome-less app window (the stable path).
Dim shell, here
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
shell.CurrentDirectory = here
shell.Run "pythonw.exe """ & here & "window.py"" --open --fullscreen", 0, False
