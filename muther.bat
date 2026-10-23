@echo off
setlocal
cd /d "%~dp0"

rem Start the board without a console. If it dies, the exit code is nonzero and we
rem re-run it in this window so the traceback is readable instead of vanishing.
pythonw board.py %*
if not errorlevel 1 goto :done

echo.
echo ============================================================
echo  Muther failed to start. Re-running with a console:
echo ============================================================
echo.
python board.py %*
echo.
echo Exit code: %errorlevel%
echo The same traceback is in board-error.log
pause
:done
endlocal
