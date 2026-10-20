@echo off
setlocal EnableExtensions
rem One-time ChordCue setup. Installs Python 3.12 and ffmpeg with winget if
rem they're missing (after asking), then creates .venv with the analysis
rem libraries from requirements.txt.
cd /d "%~dp0"
title ChordCue setup
echo.
echo  ChordCue setup
echo  --------------
echo  This downloads up to 3 GB once. Leave this window open until it says "Setup finished".
echo.

set "LINKS=%LOCALAPPDATA%\Microsoft\WinGet\Links"
set "PY312=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"

rem ---------------------------------------------------------------- Python 3.12
call :find_python
if not defined PYEXE (
  echo  Python 3.12 is not installed.
  call :offer_install Python.Python.3.12 "Python 3.12" "--scope user" || goto :need_python
  call :find_python
)
if not defined PYEXE goto :need_python
echo  [ok] Python: %PYEXE%

rem ---------------------------------------------------------------- ffmpeg
call :find_ffmpeg
if not defined FFMPEG_OK (
  echo  ffmpeg is not installed.
  call :offer_install Gyan.FFmpeg "ffmpeg" "" || goto :need_ffmpeg
  call :find_ffmpeg
)
if not defined FFMPEG_OK goto :need_ffmpeg
echo  [ok] ffmpeg found
echo.

rem ---------------------------------------------------------------- packages
if not exist .venv\Scripts\python.exe (
  echo  Creating the Python environment in .venv ...
  "%PYEXE%" -m venv .venv || goto :fail
)
rem The CUDA build is only worth its 2.5 GB with an NVIDIA graphics card.
set "TORCH_INDEX=https://download.pytorch.org/whl/cpu"
where nvidia-smi >nul 2>nul && set "TORCH_INDEX=https://download.pytorch.org/whl/cu128"
echo  Installing PyTorch from %TORCH_INDEX% (the biggest download) ...
.venv\Scripts\python -m pip install --upgrade pip --quiet --disable-pip-version-check
.venv\Scripts\python -m pip install torch==2.11.0 torchaudio==2.11.0 --index-url %TORCH_INDEX% || goto :fail
echo  Installing the other requirements ...
.venv\Scripts\python -m pip install -r requirements.txt --disable-pip-version-check || goto :fail
echo  Downloading the chord model ...
.venv\Scripts\python -c "from chordcue import pipeline; pipeline.ensure_models()" || goto :fail

echo.
echo  Setup finished.
echo  Next: double-click start-server.bat, then add the extension to your browser.
echo.
pause
exit /b 0

rem ================================================================ helpers

:find_python
set "PYEXE="
for /f "delims=" %%i in ('py -3.12 -c "import sys; print(sys.executable)" 2^>nul') do set "PYEXE=%%i"
if not defined PYEXE if exist "%PY312%" set "PYEXE=%PY312%"
if not defined PYEXE (
  for /f "delims=" %%i in ('python -c "import sys; print(sys.executable if sys.version_info[:2] == (3, 12) else '')" 2^>nul') do set "PYEXE=%%i"
)
exit /b 0

:find_ffmpeg
set "FFMPEG_OK="
where ffmpeg >nul 2>nul && set "FFMPEG_OK=1"
if not defined FFMPEG_OK if exist "%LINKS%\ffmpeg.exe" (
  rem Installed by winget, but this window's PATH predates it.
  set "PATH=%LINKS%;%PATH%"
  set "FFMPEG_OK=1"
)
exit /b 0

:offer_install
rem %1 = winget package id, %2 = name to show, %3 = extra winget options
where winget >nul 2>nul || (
  echo  winget, the Windows installer, isn't available here, so %~2 can't be installed automatically.
  exit /b 1
)
set "ANSWER="
set /p "ANSWER= Install %~2 now? [Y/N] "
if /i not "%ANSWER%"=="Y" exit /b 1
winget install -e --id %~1 %~3 --accept-package-agreements --accept-source-agreements
exit /b 0

:need_python
echo.
echo  ChordCue needs Python 3.12. Install it from https://www.python.org/downloads/
echo  (tick "Add python.exe to PATH" in the installer), then double-click setup.bat again.
pause
exit /b 1

:need_ffmpeg
echo.
echo  ChordCue needs ffmpeg. Install it from https://ffmpeg.org/download.html
echo  (or run: winget install Gyan.FFmpeg), then double-click setup.bat again.
pause
exit /b 1

:fail
echo.
echo  Setup failed; see the messages above. Running setup.bat again usually picks up where it stopped.
pause
exit /b 1
