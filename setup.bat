@echo off
rem One-time setup: a Python virtual environment with CUDA PyTorch and the
rem analysis libraries. Needs Python 3.12 and ffmpeg on PATH.
cd /d "%~dp0"
where ffmpeg >nul 2>nul || (echo ffmpeg was not found on PATH. Install it first: winget install Gyan.FFmpeg & pause & exit /b 1)
if not exist .venv\Scripts\python.exe (
  py -3.12 -m venv .venv || python -m venv .venv || (echo Could not create a virtual environment. & pause & exit /b 1)
)
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install torch==2.11.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu128 || goto :fail
.venv\Scripts\python -m pip install -r requirements.txt || goto :fail
echo.
echo Setup finished. Start the server with start-server.bat
pause
exit /b 0
:fail
echo Setup failed; see the messages above.
pause
exit /b 1
