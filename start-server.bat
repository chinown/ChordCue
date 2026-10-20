@echo off
rem Runs the ChordLane analysis server on http://127.0.0.1:8765
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (echo Run setup.bat first. & pause & exit /b 1)
title ChordLane server
.venv\Scripts\python -m chordlane.server %*
pause
