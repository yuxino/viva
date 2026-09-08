# Viva 2.0.8

This patch protects drafts while files are opening, saving, and restoring.

## What changed

- Preserve edits made while another folder is still opening, and save the latest text when editing and saving happen together.
- Keep Undo changes protected while an earlier save is still writing. Closing a tab, switching folders, and quitting continue to check those unsaved changes.
- Prevent delayed file reads and session restoration from reopening closed tabs or invalidating a current save. Keep newer folder refresh results when an older scan finishes later.
- Keep newer text and line-ending changes visibly unsaved when Save As finishes.
- Cancel a pending history replacement if its original workspace, document, or draft changes.
- Discard delayed clipboard actions in custom text menus when the text, selection, or editing target has changed.

## 中文说明

本次更新修复打开、保存和恢复文档时的草稿保护问题。

- 切换文件夹尚未完成时继续输入，新增内容会被保留；连续编辑和保存时使用最新文本。
- 较早的保存仍在写入时，撤销产生的改动继续受保护，关闭标签、切换文件夹和退出前会检查这些未保存内容。
- 延迟返回的文件读取和会话恢复不会重新打开已关闭的标签，或干扰当前保存；较早的目录扫描不会覆盖较新的刷新结果。
- 另存为期间新增的文本和换行格式变化，会正确显示为未保存。
- 历史版本替换的工作区、文档或草稿发生变化时，撤销原来的替换确认。
- 自定义文字菜单等待剪贴板期间，如果文本、选区或编辑目标变化，会丢弃过期操作。

## Downloads and updates / 下载与更新

macOS Apple Silicon: DMG for manual installation and a signed app archive for
the updater. Windows x64: NSIS installer with a detached updater signature.
`latest.json` covers both update targets; `SHA256SUMS.txt` lists the checksums.

Viva 2.0.7 users can check **Appearance and background → Software Update**.
Users of 2.0.6 or earlier need to install this release manually once.

macOS Apple Silicon 提供 DMG 和已签名的应用更新归档；Windows x64 提供 NSIS
安装程序及更新签名。2.0.7 用户可在“外观与背景 → 软件更新”中检查更新；
2.0.6 及更早版本需要先手动安装此版本。

macOS builds use ad-hoc signing and are not Apple-notarized. Use the normal
system-supported manual Open flow when required. Windows device interaction
and a cross-version installed-app update have not been manually verified for
this release.

macOS 构建使用临时签名，未经 Apple 公证；如系统要求，请使用正常的手动打开流程。
本次未进行 Windows 设备交互或已安装应用跨版本更新的手动验收。
