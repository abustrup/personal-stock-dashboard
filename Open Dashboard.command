#!/bin/bash
# Double-click this file in Finder to open the Personal Stock Dashboard.
# No commands to type. It refreshes prices, then opens the dashboard in your browser.

# Run from this file's own folder, wherever it lives.
cd "$(dirname "$0")" || exit 1

# Finder launches with a minimal PATH; add the usual Node install locations.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

echo "── Personal Stock Dashboard ─────────────────────────────"

if ! command -v npm >/dev/null 2>&1; then
  echo
  echo "Node.js was not found. Install it once from https://nodejs.org"
  echo "then double-click this file again."
  echo
  read -r -p "Press Return to close..."
  exit 1
fi

# Install dependencies the first time only.
if [ ! -d node_modules ]; then
  echo "First run: installing dependencies (one-time, ~1 min)..."
  npm install || { echo "Install failed."; read -r -p "Press Return to close..."; exit 1; }
fi

# Pull fresh prices (skips quietly if you are offline).
echo "Fetching the latest market prices..."
npm run refresh || echo "(Could not refresh prices — showing the last saved data.)"

echo "Opening the dashboard in your browser. Leave this window open while you use it."
echo "Close this window (or press Ctrl-C) when you are done."
echo "─────────────────────────────────────────────────────────"

# Starts the server and opens the browser automatically.
npm start
