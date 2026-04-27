@echo off
:: ============================================================
::  Canadian Cladding Profile Generator — Windows Launcher
::  Double-click this file to start the application.
:: ============================================================

title Canadian Cladding Profile Generator

:: Change to the directory containing this script
cd /d "%~dp0"

echo.
echo  ============================================================
echo   Canadian Cladding Profile Generator
echo   Starting application...
echo  ============================================================
echo.

:: Check for Python
where python >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Python not found in PATH.
    echo  Please install Python 3.9+ from https://www.python.org
    echo.
    pause
    exit /b 1
)

:: Check for PyQt5
python -c "import PyQt5" >nul 2>&1
if errorlevel 1 (
    echo  PyQt5 not found. Installing dependencies...
    echo.
    pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo  ERROR: Failed to install dependencies.
        echo  Try running:  pip install -r requirements.txt
        pause
        exit /b 1
    )
    echo.
    echo  Dependencies installed successfully.
    echo.
)

:: Launch the application
python profile_generator.py

if errorlevel 1 (
    echo.
    echo  Application exited with an error.
    pause
)
