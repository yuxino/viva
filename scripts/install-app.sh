#!/usr/bin/env bash

set -euo pipefail

: "${VIVA_SIGNING_IDENTITY:?Set VIVA_SIGNING_IDENTITY to a stable code-signing identity.}"

VIVA_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIVA_BUNDLE_PATH="$VIVA_PROJECT_ROOT/src-tauri/target/release/bundle/macos/Viva.app"
VIVA_INSTALL_PATH="/Applications/Viva.app"
VIVA_STAGE_PATH="/Applications/.Viva.install-$$.app"
VIVA_BACKUP_PATH="${HOME:?}/.Trash/Viva.previous-$(date +%Y%m%d-%H%M%S)-$$.app"
VIVA_FAILED_PATH="${HOME:?}/.Trash/Viva.failed-$(date +%Y%m%d-%H%M%S)-$$.app"
VIVA_BACKED_UP=0
VIVA_NEW_APP_INSTALLED=0
VIVA_INSTALL_COMMITTED=0
VIVA_STAGE_OWNED=0

viva_rollback_install() {
  local exit_status=$?
  trap - EXIT HUP INT TERM

  if [[ "$VIVA_INSTALL_COMMITTED" -eq 0 ]]; then
    if [[ "$VIVA_NEW_APP_INSTALLED" -eq 1 && -e "$VIVA_INSTALL_PATH" ]]; then
      if ! mv "$VIVA_INSTALL_PATH" "$VIVA_FAILED_PATH"; then
        echo "Could not move the failed Viva installation to $VIVA_FAILED_PATH" >&2
      fi
    fi
    if [[ "$VIVA_BACKED_UP" -eq 1 && -e "$VIVA_BACKUP_PATH" && ! -e "$VIVA_INSTALL_PATH" ]]; then
      if ! mv "$VIVA_BACKUP_PATH" "$VIVA_INSTALL_PATH"; then
        echo "Could not restore the previous Viva installation from $VIVA_BACKUP_PATH" >&2
      fi
    fi
    if [[ "$VIVA_STAGE_OWNED" -eq 1 && -e "$VIVA_STAGE_PATH" ]]; then
      /bin/rm -rf -- "$VIVA_STAGE_PATH"
    fi
  fi

  exit "$exit_status"
}

trap viva_rollback_install EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

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

VIVA_STAGE_OWNED=1
/usr/bin/ditto "$VIVA_BUNDLE_PATH" "$VIVA_STAGE_PATH"
codesign --verify --deep --strict --verbose=2 "$VIVA_STAGE_PATH"

if [[ -e "$VIVA_INSTALL_PATH" ]]; then
  VIVA_BACKED_UP=1
  mv "$VIVA_INSTALL_PATH" "$VIVA_BACKUP_PATH"
fi

VIVA_NEW_APP_INSTALLED=1
mv "$VIVA_STAGE_PATH" "$VIVA_INSTALL_PATH"
VIVA_STAGE_OWNED=0

codesign --verify --deep --strict --verbose=2 "$VIVA_INSTALL_PATH"
VIVA_INSTALL_COMMITTED=1
echo "Installed $VIVA_INSTALL_PATH"
if [[ "$VIVA_BACKED_UP" -eq 1 ]]; then
  echo "Previous app moved to $VIVA_BACKUP_PATH"
fi
