# Signed in-app updater design

## Decision

Viva will use Tauri 2's official updater and process plugins. The application
will read one fixed HTTPS `latest.json` endpoint from the latest GitHub Release,
and Tauri will compare versions, download the platform-specific bundle, verify
its updater signature, and install it. The frontend cannot supply another feed,
public key, download URL, or unsigned fallback.

The existing Appearance workspace remains the settings surface. A compact
Software Update section owns a single-flight state machine: idle, checking,
current, available, downloading, installing, restart-ready, and error. An
available update shows its version and release notes before download. Download
events report received bytes and an exact percentage only when the server gives
a positive total; otherwise the progress indicator remains indeterminate. An
error retains a retry action and exposes the fixed GitHub Releases page only as
recovery.

## Platform behavior

On macOS and Linux, `download()` is followed by `install()`. Only after both
resolve does Viva show **Restart and finish update**; `relaunch()` runs only from
that explicit button. On Windows, the install call launches the passive NSIS
installer and exits Viva as required by Tauri, so the UI warns before the user
starts installation and never promises a post-install in-app restart state.

Repeated actions are disabled while work is active. Status uses `aria-live`,
the progress element has a localized accessible label, and the section retains
ordinary document focus unless the user tabs or clicks into it.

## Signing and release boundary

The repository contains only the updater public key. The encrypted private key
is stored outside the repository and copied to GitHub Actions secrets together
with its password. Tag builds create native installers, updater bundles,
detached `.sig` files, and one `latest.json` containing unique target entries.
The Release stays draft until a final job checks version, HTTPS URLs, tag paths,
platform/architecture coverage, signatures, asset uniqueness, public download
responses, and SHA-256 values, then publishes it.

The first release with this code is a bootstrap release: Viva 2.0.5 and earlier
cannot discover it in-app and must be installed manually once. Only a later
signed release can prove the complete installed-version-to-new-version path.

## Verification

Pure and component tests cover state transitions, known and unknown content
length, network and signature-shaped errors, retry, and explicit relaunch.
Repository checks cover both frontends and Rust, while release validation covers
the generated metadata and assets. Native evidence is reported separately from
tests, packaging, CI, and publication.
