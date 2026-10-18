#!/bin/sh
# Installs (or updates) the latest Quire for macOS into /Applications.
#
#   curl -fsSL https://raw.githubusercontent.com/sgwork004-max/quire/main/scripts/install.sh | sh
#
# Quire isn't signed with an Apple Developer ID. Apps downloaded by a browser
# get a "can't be opened" warning for that reason; this installer downloads
# with curl and opens Quire directly, so there's nothing to click through.
set -eu

REPO="sgwork004-max/quire"

if [ "$(uname)" != "Darwin" ]; then
  echo "This installer is for macOS. For Windows, get the installer from https://github.com/$REPO/releases/latest"
  exit 1
fi

echo "Finding the latest Quire…"
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*\.app\.tar\.gz"' \
  | head -n 1 \
  | sed 's/.*"\(https[^"]*\)"/\1/')
if [ -z "$URL" ]; then
  echo "Couldn't find a Quire release for macOS."
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading…"
curl -fL --progress-bar "$URL" -o "$TMP/Quire.app.tar.gz"
tar -xzf "$TMP/Quire.app.tar.gz" -C "$TMP"

# Quit a running copy and wait for it to exit before replacing it.
osascript -e 'quit app "Quire"' >/dev/null 2>&1 || true
for _ in 1 2 3 4 5 6 7 8 9 10; do
  pgrep -f "/Applications/Quire.app/Contents/MacOS/" >/dev/null 2>&1 || break
  sleep 0.5
done
rm -rf /Applications/Quire.app
mv "$TMP/Quire.app" /Applications/Quire.app
xattr -dr com.apple.quarantine /Applications/Quire.app 2>/dev/null || true

echo "Quire is installed in Applications. Opening it…"
sleep 1
open /Applications/Quire.app || echo "Open Quire from your Applications folder."
