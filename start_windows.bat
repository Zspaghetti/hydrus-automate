@echo off
setlocal

REM --- Configuration ---
set PYTHON_EXE=python
set VENV_DIR=venv
set REQUIREMENTS_FILE=requirements.txt
set APP_SCRIPT=%~dp0py\app.py

REM --- Check if venv directory exists ---
if not exist "%VENV_DIR%\Scripts\activate.bat" (
    echo Virtual environment not found. Creating %VENV_DIR%...
    "%PYTHON_EXE%" -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo Failed to create virtual environment. Please check your Python installation.
        pause
        exit /b 1
    )
    echo Virtual environment created.
)

REM --- Activate virtual environment ---
echo Activating virtual environment...
call "%VENV_DIR%\Scripts\activate.bat"
if errorlevel 1 (
    echo Failed to activate virtual environment.
    pause
    exit /b 1
)

REM --- Install/Update requirements ---
if exist "%REQUIREMENTS_FILE%" (
    echo Installing/Updating requirements from %REQUIREMENTS_FILE%...
    pip install -r "%REQUIREMENTS_FILE%"
    if errorlevel 1 (
        echo Failed to install requirements.
        pause
        REM Deactivate before exiting if activation was successful
        call "%VENV_DIR%\Scripts\deactivate.bat"
        exit /b 1
    )
) else (
    echo %REQUIREMENTS_FILE% not found. Skipping requirements installation.
)

REM --- Launch the Python application ---
echo Launching %APP_SCRIPT%...
"%PYTHON_EXE%" "%APP_SCRIPT%"

REM --- Deactivate virtual environment when app closes (optional, good practice) ---
echo Application closed. Deactivating virtual environment...
call "%VENV_DIR%\Scripts\deactivate.bat"

endlocal
echo Script finished.
REM pause