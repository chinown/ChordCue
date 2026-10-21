@echo off
rem Started by the browser (native messaging) when the ChordCue panel needs
rem the server. Runs hidden; see chordcue/native_host.py.
cd /d "%~dp0.."
".venv\Scripts\python.exe" -m chordcue.native_host %*
