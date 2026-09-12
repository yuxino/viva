## English

# Viva 2.0.3

## Maintenance

- Remove the extra macOS Dock icon plate introduced when the Windows icon was made circular.
- Remove unused internal helpers without changing editor, workspace, language, or background behavior.
- Keep the Windows NSIS artifact pipeline on the supported Node.js 24 runtime.

## Downloads

- macOS Apple Silicon: DMG
- Windows x64: current-user NSIS installer
- SHA-256 checksums are provided for both installers.

The macOS DMG is locally development-signed, but not notarized. On first launch, approve Viva through macOS Privacy & Security if Gatekeeper blocks it.

Windows packaging is CI-verified. Installed-app CRLF, secure rename, and uninstall acceptance still require testing on a Windows desktop.

---

## 中文

- 移除 Windows 图标圆形化时引入的多余 macOS Dock 图标底板。
- 清理无用内部辅助函数，不改变编辑器、工作区、语言或背景行为。
- Windows NSIS 流程保持使用受支持的 Node.js 24。

### 下载与验证

macOS Apple 芯片提供 DMG，Windows x64 提供按当前用户安装的 NSIS，两个安装包均附 SHA-256 校验值。

macOS DMG 使用本地开发签名，未经公证。若 Gatekeeper 拦截首次打开，请在系统隐私与安全性中允许。Windows 打包已由 CI 验证；已安装应用的 CRLF、安全重命名和卸载验收仍需使用对应正式安装包在 Windows 桌面验证。
