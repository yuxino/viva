## English

# Viva 2.0.7

This patch fixes Markdown rendering and workspace search bounds, reduces desktop
bundle size, and includes the missing permission for Software Update checks.

## What changed

- Keep heading anchors unique when repeated headings meet numbered names, and preserve anchors that would otherwise be removed by HTML sanitization.
- Render task checkboxes only in actual list items; keep ordinary `[x]` prose, headings, quotes, and continuation paragraphs intact.
- Count invalid UTF-8 files toward the workspace search read limit, preventing malformed files from bypassing the I/O budget.
- Remove duplicate renderer styles and enable thin LTO while retaining the existing runtime optimization level. A controlled local macOS arm64 build comparison reduced the executable by 16.33% and app file bytes by 14.23%; release download sizes depend on platform and packaging.
- Fix the app-version permission needed to start Software Update checks.
- Refresh the Windows installer artwork and add centered bilingual README demos with an official website link.

## Upgrading from 2.0.6 or earlier

Install 2.0.7 manually once from this release. Versions through 2.0.5 have no
updater, and 2.0.6 cannot complete the app-version read needed for its update
check. Version 2.0.7 fixes that permission. Future signed releases can be checked
from **Appearance and background → Software Update**.

## Downloads and integrity

macOS arm64: DMG for manual installation and a signed app tarball for the updater.
Windows x64: NSIS installer with a detached updater signature. `latest.json`
contains both update targets; `SHA256SUMS.txt` lists the asset checksums.

macOS builds use ad-hoc code signing and are not Apple-notarized. Use the normal
system-supported manual Open flow when required. Windows device interaction and
an installed 2.0.7-to-later-version upgrade are not claimed by this release.

---

## 中文

修复 Markdown 渲染、工作区搜索边界和软件更新所需权限，并缩小桌面程序体积。

- 重复标题与带编号标题同时出现时保持锚点唯一，并保留可能被 HTML 清理删除的锚点。
- 任务复选框只在真实列表项中渲染，普通 `[x]` 正文、标题、引用和续行段落保持原样。
- 无效 UTF-8 文件也计入工作区搜索读取上限，避免绕过 I/O 预算。
- 移除重复渲染样式，启用 thin LTO 并保留现有优化级别。同条件本地 macOS arm64 对比中，可执行文件减少 16.33%，应用文件字节减少 14.23%；实际下载体积随平台与打包方式变化。
- 修复启动更新检查所需的应用版本读取权限，更新 Windows 安装插画和居中的双语 README 演示及官网链接。

2.0.6 及更早版本需要手动安装 2.0.7 一次：2.0.5 及更早版本没有更新器，2.0.6 缺少版本读取权限。后续签名版本可在“外观与背景 → 软件更新”检查。

macOS arm64 提供手动安装 DMG 和签名更新 tarball；Windows x64 提供 NSIS 安装包及独立更新签名。`latest.json` 包含两个更新目标，`SHA256SUMS.txt` 列出校验值。

macOS 使用 ad-hoc 签名，未经 Apple 公证，必要时使用系统支持的手动打开流程。本版不宣称完成 Windows 设备交互或已安装 2.0.7 升级到后续版本的验收。
