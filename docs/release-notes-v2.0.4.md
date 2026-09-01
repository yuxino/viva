# Viva 2.0.4

## Maintenance

- Remove an unused custom menu implementation and seven unreferenced icon components.
- Remove the unused JavaScript window-state package while retaining Viva's active native Rust window-state integration.
- Use Markdown It's bundled TypeScript declarations instead of a redundant external type package.
- Strip unused symbol tables from release binaries to reduce installer size without removing application resources.
- Retain the focused Windows CRLF, capability-bound rename, quit-protection, and installer regression coverage.

## Downloads

- macOS Apple Silicon: DMG
- Windows x64: current-user NSIS installer
- SHA-256 checksums are provided for both installers.

The macOS DMG is locally development-signed, but not notarized. On first launch, approve Viva through macOS Privacy & Security if Gatekeeper blocks it.

Windows packaging is CI-verified. Installed-app CRLF, secure rename, and uninstall acceptance require a Windows desktop run with the exact release installer.
