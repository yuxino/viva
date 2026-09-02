# ADR-0008 — Ship signed, user-confirmed updates

- Status: Accepted
- Date: 2026-09-02

## Context

Opening GitHub Releases can help a user recover from a failed update, but it is
not an application updater. A trustworthy in-app path needs a fixed feed,
platform-specific packages, a long-lived signing trust root, honest progress,
and platform-correct installation behavior.

## Decision

Viva uses the official Tauri 2 updater and process plugins. The native updater
reads only `https://github.com/yuxino/viva/releases/latest/download/latest.json`
and trusts the public key embedded in Tauri configuration. The corresponding
encrypted private key is kept outside Git and supplied to release CI through
GitHub Actions secrets.

The check is user-triggered. An available update shows version and notes before
download. Progress is determinate only when the response provides a total. The
updater plugin verifies the signature before installation; any failure stops the
flow and offers retry, without an unsigned fallback. GitHub Releases is shown
only as recovery after an error.

macOS and Linux show a restart action only after installation finishes, and
relaunch only on the user's click. Windows uses Tauri's passive NSIS mode; the
application explains that it will exit while the installer finishes and reopens
Viva.

Tag CI keeps the GitHub Release draft until both platforms, `latest.json`,
detached signatures, cryptographic verification, version/URL/architecture
checks, uniqueness, and SHA-256 generation succeed. Publication is followed by
a public-access check.

## Consequences

Viva 2.0.6 is a bootstrap: installations of 2.0.5 and earlier must replace the
app manually once because they do not contain this updater or public key. A full
native upgrade can be accepted only when a later signed version exists. Losing
the private key or its password would prevent trusted future updates, so the
encrypted local recovery copy and Keychain credential must be backed up
together.
