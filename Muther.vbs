' Muther board launcher: no console window at any point.
' Double-click this, or use the Muther shortcut on the desktop.
Dim shell, here
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
shell.CurrentDirectory = here
shell.Run "pythonw.exe """ & here & "board.py""", 0, False
