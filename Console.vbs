' Console: local server, then the default browser. No pywebview, no Chrome flags.
Dim shell, here, port
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
shell.CurrentDirectory = here
shell.Run "pythonw.exe """ & here & "window.py""", 0, False
WScript.Sleep 2500
shell.Run "http://127.0.0.1:8123/", 1, False
