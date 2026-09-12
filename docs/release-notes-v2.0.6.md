## English

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

---

## 中文

Viva 2.0.6 是签名应用内更新的首次迁移版本。

- 新增手动软件更新区域，显示当前版本和可用更新。
- 下载前展示说明，按真实字节和百分比显示进度，不虚构总大小。
- 安装前使用 Viva 的 Tauri updater 公钥验证每个包；失败时停止并允许重试。
- macOS 安装后等待用户明确点击“重启并完成更新”。Windows 提示 Viva 会关闭，由被动式 NSIS 安装器完成安装并重新打开。
- GitHub Releases 仅作为出错时的恢复入口。

2.0.5 及更早版本没有签名更新器，需要先手动安装 2.0.6 一次；本版原始说明将后续更新入口设为“外观与背景 → 软件更新”。

发布 CI 构建 macOS arm64 与 Windows x64 包，提供独立签名、`latest.json` 和 `SHA256SUMS.txt`，并验证所有引用包的签名。macOS 为 ad-hoc 签名且未经公证，首次打开可能需要 Finder 的正常确认。

双平台自动检查与打包是发布门槛；仅凭这个首个更新器版本，还无法演示已安装 2.0.6 到后续版本的原生升级。
