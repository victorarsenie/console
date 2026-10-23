@echo off
rem Console theatre (WebView2). `start` returns at once, so no shell lingers.
cd /d "%~dp0"
start "" pythonw "%~dp0app.py"
