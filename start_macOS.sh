#!/bin/bash

# --- Configuration ---
PYTHON_EXE="python3" 
VENV_DIR="venv"
REQUIREMENTS_FILE="requirements.txt"
APP_SCRIPT="py/app.py" 

# Function to clean up and exit
cleanup_and_exit() {
    echo "An error occurred. Exiting."
    # Check if we are in a virtual environment and try to deactivate
    if [ -n "$VIRTUAL_ENV" ]; then
        echo "Deactivating virtual environment..."
        deactivate
    fi
    exit 1
}

# Trap errors to call cleanup function
trap cleanup_and_exit ERR SIGINT SIGTERM

# --- Check if venv directory exists ---
if [ ! -d "$VENV_DIR/bin" ]; then
    echo "Virtual environment not found. Creating $VENV_DIR..."
    "$PYTHON_EXE" -m venv "$VENV_DIR"
    if [ $? -ne 0 ]; then
        echo "Failed to create virtual environment. Please check your Python installation."
        exit 1
    fi
    echo "Virtual environment created."
fi

# --- Activate virtual environment ---
echo "Activating virtual environment..."
source "$VENV_DIR/bin/activate"
if [ $? -ne 0 ]; then
    echo "Failed to activate virtual environment."
    exit 1
fi

# --- Install/Update requirements ---
if [ -f "$REQUIREMENTS_FILE" ]; then
    echo "Installing/Updating requirements from $REQUIREMENTS_FILE..."
    pip install -r "$REQUIREMENTS_FILE"
    if [ $? -ne 0 ]; then
        echo "Failed to install requirements."
        cleanup_and_exit # This will also attempt to deactivate
    fi
else
    echo "$REQUIREMENTS_FILE not found. Skipping requirements installation."
fi

# --- Launch the Python application ---
echo "Launching $APP_SCRIPT..."
"$PYTHON_EXE" "$APP_SCRIPT"

# --- Deactivate virtual environment when app closes (automatic on script exit if source'd) ---
echo "Application closed. Deactivating virtual environment..."
deactivate

echo "Script finished."
exit 0