# Viva 2.0.6

Viva 2.0.6 is the signed in-app updater bootstrap release.

## What changed

- Add a manual Software Update section with current-version and update-available states.
- Show release notes before download and real byte/percentage progress without inventing a total size.
- Verify every updater package with Viva's Tauri updater public key before installation; failed verification stops and remains retryable.
- On macOS, wait for an explicit **Restart and finish update** action after installation.
- On Windows, explain that Viva closes while the passive NSIS installer finishes and reopens the app.
- Keep GitHub Releases as an error-recovery link instead of the primary update path.

## One-time bootstrap

Viva 2.0.5 and earlier cannot update themselves because they do not contain the
signed updater. Download and install 2.0.6 manually once. Future signed releases
can then be installed from **Appearance and background → Software Update**.

## Integrity and distribution

Release CI builds macOS arm64 and Windows x64 artifacts, publishes detached
updater signatures and `latest.json`, cryptographically verifies each referenced
bundle, and includes `SHA256SUMS.txt`. The macOS build is not Apple-notarized and
uses ad-hoc code signing, so it may require the ordinary Finder **Open**
confirmation on first launch.

Automated macOS and Windows checks and packaging are release gates. Because this
is the first updater-enabled version, an installed 2.0.6 → later-version native
upgrade cannot yet be demonstrated by this release alone.
