' Console: no console window at any point. Prefer this over the .bat files.
Dim shell, here
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
shell.CurrentDirectory = here
shell.Run "pythonw.exe """ & here & "app.py""", 0, False
