#!/usr/bin/env bash
# Juile launcher for Linux / Arch. Mirrors Juile.bat.
set -e
cd "$(dirname "$0")"

if [ ! -x ".venv/bin/python" ]; then
  echo "Creating virtual environment (first run only)..."
  python3 -m venv .venv
fi
source .venv/bin/activate

echo "Installing / updating dependencies..."
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r requirements.txt

echo "Launching Juile..."
python -m server.main
