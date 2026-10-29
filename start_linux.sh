#!/usr/bin/env bash
set -e

# Change to the directory of this script
cd "$(dirname "$0")"

echo "========================================================"
echo "              STL Painter - Launcher"
echo "========================================================"

# Check for Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is not installed or not in your PATH."
    echo "Please install Node.js (v18 or higher, LTS recommended):"
    echo "  Ubuntu/Debian: sudo apt install nodejs npm"
    echo "  Fedora:        sudo dnf install nodejs npm"
    echo "  Arch:          sudo pacman -S nodejs npm"
    echo "  Or visit:      https://nodejs.org/"
    echo ""
    exit 1
fi

# Check for npm
if ! command -v npm >/dev/null 2>&1; then
    echo "[ERROR] npm is not installed or not in your PATH."
    echo "Please install npm to manage dependencies."
    echo ""
    exit 1
fi

# Auto-install dependencies on first run
if [ ! -d "node_modules" ]; then
    echo "[INFO] First run detected. Installing dependencies via npm..."
    npm install
    echo "[INFO] Installation complete!"
    echo ""
fi

echo "[INFO] Starting STL Painter local dev server..."
echo "The app will open automatically in your default browser."
echo "Press Ctrl+C to stop the server when done."
echo "========================================================"
echo ""

npm run dev -- --open

