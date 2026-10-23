@echo off
cd /d "%~dp0"
start "" pythonw "%~dp0window.py"
timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:8123/
