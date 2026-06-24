@echo off
title Juile
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo  Creating virtual environment ^(first run only^)...
  python -m venv .venv
)
call ".venv\Scripts\activate.bat"

echo  Installing / updating dependencies...
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r requirements.txt

echo.
echo  Launching Juile...
echo.
python -m server.main

pause
