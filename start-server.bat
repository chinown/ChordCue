@echo off
rem Runs the ChordCue analysis server on http://127.0.0.1:8765
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (echo Run setup.bat first. & pause & exit /b 1)
title ChordCue server
rem ffmpeg installed by winget lives here; this window's PATH may predate it.
set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
echo.
echo  ChordCue server. Keep this window open while you play music
echo  (you can minimize it). Close it to stop ChordCue.
echo.
.venv\Scripts\python -m chordcue.server %*
pause
