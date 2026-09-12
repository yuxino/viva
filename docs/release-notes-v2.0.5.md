## English

# Viva 2.0.5

## Maintenance

- Strip unused symbol tables from release binaries to reduce installer size without removing application resources.
- Keep the editor behavior and focused Windows CRLF, capability-bound rename, quit-protection, and installer regression coverage unchanged from 2.0.4.

## Downloads

- macOS Apple Silicon: DMG
- Windows x64: current-user NSIS installer
- SHA-256 checksums are provided for both installers.

The macOS DMG is locally development-signed, but not notarized. On first launch, approve Viva through macOS Privacy & Security if Gatekeeper blocks it.

Windows packaging is CI-verified. Installed-app CRLF, secure rename, and uninstall acceptance require a Windows desktop run with the exact release installer.

---

## 中文

- 从正式程序移除未使用符号表以缩小安装包，不移除应用资源。
- 保持 2.0.4 的编辑器行为，以及 Windows CRLF、受能力权限约束的重命名、退出保护和安装器回归覆盖。

### 下载与验证

macOS Apple 芯片提供 DMG，Windows x64 提供按当前用户安装的 NSIS，两个安装包均附 SHA-256 校验值。

macOS DMG 使用本地开发签名，未经公证。若 Gatekeeper 拦截首次打开，请在系统隐私与安全性中允许。Windows 打包已由 CI 验证；已安装应用的 CRLF、安全重命名和卸载验收仍需使用对应正式安装包在 Windows 桌面验证。
