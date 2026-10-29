@echo off
setlocal
cd /d "%~dp0"

echo ========================================================
echo               STL Painter - Launcher
echo ========================================================

REM Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% equ 0 goto :node_found

echo [ERROR] Node.js is not installed or not in your PATH.
echo Please download and install Node.js LTS from:
echo   https://nodejs.org/
echo.
pause
exit /b 1

:node_found
REM Auto-install dependencies on first run
if exist "node_modules\" goto :deps_found

echo [INFO] First run detected. Installing dependencies via npm...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)
echo [INFO] Installation complete!
echo.

:deps_found
echo [INFO] Starting STL Painter local dev server...
echo The app will open automatically in your default browser.
echo Press Ctrl+C in this window to stop the server when done.
echo ========================================================
echo.

call npm run dev -- --open --host
pause
