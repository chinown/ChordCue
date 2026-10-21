@echo off
setlocal EnableExtensions
rem ChordCue installer: the only file a new user needs to download.
rem It fetches ChordCue from GitHub into %USERPROFILE%\ChordCue, runs
rem setup.bat (Python, ffmpeg and packages, and registers ChordCue so the
rem extension can start it), then opens a page that walks through adding the
rem extension. Nothing runs at startup: ChordCue starts when you click its icon.
rem Run it again later to update; your settings and analyzed songs are kept.
rem
rem For testing: CHORDCUE_HOME (install folder), CHORDCUE_ZIP_URL (source),
rem CHORDCUE_UNATTENDED=1 (no prompts), CHORDCUE_NO_LAUNCH=1 (don't open the page).
title ChordCue installer
if not defined CHORDCUE_HOME set "CHORDCUE_HOME=%USERPROFILE%\ChordCue"
if not defined CHORDCUE_ZIP_URL set "CHORDCUE_ZIP_URL=https://github.com/chinown/ChordCue/archive/refs/heads/main.zip"
set "DEST=%CHORDCUE_HOME%"
set "WORK=%TEMP%\chordcue-install-%RANDOM%%RANDOM%"

echo.
echo  ChordCue installer
echo  ------------------
echo  ChordCue shows live chords for the song you're playing in your browser.
echo.
echo  This will:
echo    1. Download ChordCue into  %DEST%
echo    2. Install what it needs: Python and ffmpeg if missing (it asks first)
echo       and up to 3 GB of music-analysis libraries
echo    3. Open a page that shows how to add ChordCue to your browser
echo.
echo  It takes about 15 minutes, mostly downloading.
echo.
if not defined CHORDCUE_UNATTENDED (
  set /p "GO= Press Enter to start, or close this window to cancel. "
)

where curl >nul 2>nul || goto :old_windows
where tar >nul 2>nul || goto :old_windows

rem ---------------------------------------------------------------- download
echo.
echo  [1/3] Downloading ChordCue ...
mkdir "%WORK%" 2>nul
curl -fsSL --retry 3 -o "%WORK%\chordcue.zip" "%CHORDCUE_ZIP_URL%" || goto :download_failed
tar -xf "%WORK%\chordcue.zip" -C "%WORK%" || goto :download_failed
set "SRC="
for /d %%d in ("%WORK%\ChordCue-*") do set "SRC=%%d"
if not defined SRC goto :download_failed
if not exist "%DEST%" mkdir "%DEST%" || goto :fail
rem Copies new and updated files only; .venv, models and your songs stay.
robocopy "%SRC%" "%DEST%" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :fail
rmdir /s /q "%WORK%" 2>nul
echo        Done: %DEST%

rem ---------------------------------------------------------------- setup
echo.
echo  [2/3] Installing what ChordCue needs ...
call "%DEST%\setup.bat" --no-pause || goto :setup_failed

if defined CHORDCUE_NO_LAUNCH goto :finished

rem ---------------------------------------------------------------- last step
echo.
echo  [3/3] Opening the last step in your browser ...
start "" "%DEST%\docs\setup-guide.html"

:finished
echo.
echo  ============================================================
echo   ChordCue is installed.
echo.
echo   Last step: add the extension to your browser. The page that
echo   just opened shows how (it's also in %DEST%\docs\setup-guide.html).
echo.
echo   From then on, just click its icon in your browser: ChordCue
echo   starts by itself and stops a few minutes after you close it.
echo  ============================================================
echo.
if not defined CHORDCUE_UNATTENDED pause
exit /b 0

rem ================================================================ errors

:old_windows
echo.
echo  This version of Windows is missing curl or tar (both come with Windows 10 from 2018 on).
echo  Please update Windows, or download ChordCue by hand from https://github.com/chinown/ChordCue
goto :stop

:download_failed
echo.
echo  Couldn't download ChordCue. Check your internet connection and run this installer again.
goto :stop

:setup_failed
echo.
echo  Setup didn't finish; see the messages above. Running this installer again
echo  picks up where it stopped.
goto :stop

:fail
echo.
echo  Something went wrong writing to %DEST%. Run this installer again, or ask for help at
echo  https://github.com/chinown/ChordCue/issues
goto :stop

:stop
if exist "%WORK%" rmdir /s /q "%WORK%" 2>nul
echo.
if not defined CHORDCUE_UNATTENDED pause
exit /b 1
