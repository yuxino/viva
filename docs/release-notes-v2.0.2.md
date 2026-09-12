## English

# Viva 2.0.2

## Fixed

- Preserve consistent CRLF line endings when Windows documents are edited, saved, copied with Save As, or restored from local history.
- Normalize mixed line endings and lone carriage returns to LF instead of writing a mixed document back to disk.
- Calculate document revisions, hashes, and size limits from the exact bytes persisted on disk.
- Keep line-ending-only changes dirty, including when another edit lands while a save is still completing.

## Windows packaging

- Build a current-user NSIS installer with the verified Viva product name and icon resources.
- Treat the CI artifact as a release candidate until its exact installer bytes pass an installed-app CRLF round-trip on Windows.

---

## 中文

### 修复

- Windows 文档在编辑、保存、另存为和恢复本地历史后保持一致的 CRLF 换行。
- 混合换行及单独回车统一为 LF，避免再次写入混合格式。
- 版本、哈希和大小限制均按实际落盘字节计算。
- 仅换行变化也保持未保存状态，包括保存尚未完成时继续编辑的情况。

### Windows 打包

生成具有已验证 Viva 名称和图标的当前用户 NSIS 安装器。CI 产物仍为候选包，需用相同安装器字节在 Windows 完成已安装应用的 CRLF 保存与读取往返验收。
