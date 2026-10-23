@echo off
rem Console light board (tkinter, ~25 MB). No lingering shell either.
cd /d "%~dp0"
start "" pythonw "%~dp0board.py"
