@echo off
rem Console in an Electron window (bundled Chromium): no browser chrome, one window.
cd /d "%~dp0electron"
start "" "%~dp0electron\node_modules\electron\dist\electron.exe" "%~dp0electron"
