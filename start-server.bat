@echo off
rem Runs the ChordCue analysis server on http://127.0.0.1:8765
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (echo Run setup.bat first. & pause & exit /b 1)
title ChordCue server
.venv\Scripts\python -m chordcue.server %*
pause
