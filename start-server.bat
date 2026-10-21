@echo off
rem Runs the ChordCue server on http://127.0.0.1:8765 in a visible window, which
rem is handy for watching what it does. Normally the browser starts ChordCue
rem when you click its icon: see chordcue/native_host.py.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (echo Run setup.bat first. & pause & exit /b 1)
title ChordCue server
rem ffmpeg installed by winget lives here; this window's PATH may predate it.
set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
echo.
echo  ChordCue server. Close this window to stop it.
echo.
.venv\Scripts\python -m chordcue.service %*
pause
