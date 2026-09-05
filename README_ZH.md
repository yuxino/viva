<p align="center">
  <img src="public/art/viva-character-logo-round.webp" width="136" height="136" alt="Viva 少女 Logo">
</p>

<h1 align="center">Viva</h1>

<p align="center">一个安静、本地优先的 Markdown 工作台。</p>

<p align="center">
  <a href="README.md">English</a> · 简体中文
</p>

Viva 把文件夹、Markdown 源文和排版后的页面放进同一个专注的桌面工作区。
文件始终留在你的电脑上，仍然是普通文件；不需要账户、同步服务或私有文档格式。

<!-- project-demo-v1 -->
## 演示

[![viva — 演示](docs/demos/preview.gif)](docs/demos/demo.mp4)

[完整视频（MP4）](docs/demos/demo.mp4) · [演示说明](docs/demos/README.md)

打开示例笔记、编辑 Markdown，以及 Source / Split / Live 切换。 真实前端录制，使用示例数据。文件由演示环境提供，不读写本机文件。
<!-- /project-demo-v1 -->

## 不离开页面，也能认真写作

Live 模式会在写作时保持整篇文档的排版。点一下段落即可原地编辑对应的 Markdown，
写完继续往下，不必在源码和预览之间反复切换。需要时，Source、Split、Preview
和 Focus 模式也随时可用。

## Viva 能做什么

- 打开任意文件夹，在真正的标签页和键盘友好的文件树里写作，也能安全地管理文件。
- 搜索整个工作区、浏览文档大纲，并找回以前保存过的版本。
- 在当前文档中查找和替换，并将粘贴的图片保存到本地 `assets/`，以相对路径引用。
- 内置 Dart、TypeScript 等常用语言的围栏代码语法高亮。
- 在编辑、另存为和恢复历史版本时，保留每篇文档原有的 LF 或 CRLF 换行格式。
- 在标签页、窗口和系统退出流程中清楚标记并保护未保存内容。
- 选择安静的浅色或石墨深色界面，也可以使用一张本地背景图。

## 默认留在本地

Viva 不上传文档、不做行为统计，也不需要账户。Markdown、历史版本、外观设置
和可选背景图都保存在本机；外部链接只有在你主动点击时才会打开。手动检查软件更新时，
Viva 会通过原生 HTTPS 请求访问固定的 GitHub Release 更新源，不会携带文档、设置或使用数据。

## 签名软件更新

Viva 2.0.6 首次加入由用户确认的应用内更新。打开**外观与背景 → 软件更新**，即可检查
固定更新源、阅读更新说明，再决定是否下载。每个更新包都必须由 Tauri 使用 Viva 内置公钥
验证通过后才能安装，不存在跳过签名的降级路径。

**首次启用：** Viva 2.0.5 及更早版本没有更新器，需要先从
[GitHub Releases](https://github.com/yuxino/viva/releases) 手动安装一次 2.0.6；此后的签名版本
才可以直接在 Viva 内完成更新。

<details>
<summary>开发</summary>

Viva 使用 Tauri、Rust、React 与 TypeScript 构建，支持 macOS 和 Windows。
开发需要 Node.js 24、pnpm 11、稳定版 Rust，以及对应平台的
[Tauri 前置环境](https://v2.tauri.app/start/prerequisites/)。

```bash
pnpm install
pnpm tauri dev
```

</details>

## 许可证

MIT
