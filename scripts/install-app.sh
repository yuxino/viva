#!/usr/bin/env bash

set -euo pipefail

: "${VIVA_SIGNING_IDENTITY:?Set VIVA_SIGNING_IDENTITY to a stable code-signing identity.}"

VIVA_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIVA_BUNDLE_PATH="$VIVA_PROJECT_ROOT/src-tauri/target/release/bundle/macos/Viva.app"
VIVA_INSTALL_PATH="/Applications/Viva.app"
VIVA_STAGE_PATH="/Applications/.Viva.install-$$.app"
VIVA_BACKUP_PATH="${HOME:?}/.Trash/Viva.previous-$(date +%Y%m%d-%H%M%S)-$$.app"

if ! security find-identity -v -p codesigning | grep -F "\"$VIVA_SIGNING_IDENTITY\"" >/dev/null; then
  echo "No valid code-signing identity named '$VIVA_SIGNING_IDENTITY' was found." >&2
  exit 1
fi

if [[ -e "$VIVA_STAGE_PATH" ]]; then
  echo "Refusing to overwrite the existing install stage: $VIVA_STAGE_PATH" >&2
  exit 1
fi

cd "$VIVA_PROJECT_ROOT"
pnpm tauri build --bundles app

codesign \
  --force \
  --deep \
  --options runtime \
  --timestamp=none \
  --sign "$VIVA_SIGNING_IDENTITY" \
  "$VIVA_BUNDLE_PATH"
codesign --verify --deep --strict --verbose=2 "$VIVA_BUNDLE_PATH"

/usr/bin/ditto "$VIVA_BUNDLE_PATH" "$VIVA_STAGE_PATH"
codesign --verify --deep --strict --verbose=2 "$VIVA_STAGE_PATH"

VIVA_BACKED_UP=0
if [[ -e "$VIVA_INSTALL_PATH" ]]; then
  mv "$VIVA_INSTALL_PATH" "$VIVA_BACKUP_PATH"
  VIVA_BACKED_UP=1
fi

if ! mv "$VIVA_STAGE_PATH" "$VIVA_INSTALL_PATH"; then
  if [[ "$VIVA_BACKED_UP" -eq 1 ]]; then
    mv "$VIVA_BACKUP_PATH" "$VIVA_INSTALL_PATH"
  fi
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "$VIVA_INSTALL_PATH"
echo "Installed $VIVA_INSTALL_PATH"
if [[ "$VIVA_BACKED_UP" -eq 1 ]]; then
  echo "Previous app moved to $VIVA_BACKUP_PATH"
fi
