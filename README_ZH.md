<p align="center">
  <img src="public/art/viva-character-logo.jpg" width="144" height="144" alt="Viva 少女 Logo">
</p>

<h1 align="center">Viva</h1>

<p align="center">一个安静、完全本地的 Markdown 工作台。</p>

<p align="center">
  <a href="README.md">English</a> · 简体中文
</p>

<p align="center">
  <img src="docs/images/viva-live-editor.png" width="1080" alt="Viva 石墨深色主题下的即时编辑器">
</p>

Viva 把文件树、Markdown 源文和排版预览放在同一个专注的桌面工作区里。
文件始终是普通、可迁移的本地文件。

## 已实现

- 打开文件夹，以递归文件树浏览 Markdown，并支持完整键盘操作。
- 真正的多标签编辑；也可以用 `Shift+Command+N` / `Shift+Ctrl+N` 打开一个
  独立编辑器窗口，处理另一个文件夹。
- 在排版后的 Live 文档里直接写：点一下某个内容块，只编辑它对应的准确
  Markdown，其余页面保持渲染；Source、Split、Preview 与无干扰 Focus 模式
  都能用快捷键切换。
- 搜索整个工作区，并跳到匹配结果的准确行。
- 实时文档大纲，源文与预览位置互相对应。
- 原子保存、外部修改冲突检测，以及未保存关闭确认。
- 多个 Viva 窗口之间会协调文档写入与历史记录；并发保存会显示冲突，不会
  静默互相覆盖。
- 窗口、菜单、快捷键、Dock、注销与重启都经过原生防丢稿保护，不会绕过未保存确认。
- 查看有上限的本地文件历史，对比保存版本，并把旧版载入为待保存草稿。
- 安全预览 Markdown 与 MDX，不执行文档代码；在正文里显示通过校验的本地图片，
  并可在 Viva 图片查看器里缩放、拖动。
- 输入时自然续写列表、任务清单、引用和缩进；用系统快捷键包裹粗体、斜体
  与行内代码。
- 完整界面与 Viva 自有的原生菜单支持 English / 简体中文，默认跟随系统。
- 重启后恢复主窗口、工作区、标签、视图和侧栏状态。
- 跟随系统外观，也可选择浅色或石墨深色主题。
- 可使用内置 Viva 插画或一张私有本地图作为写作背景，并调整透明度、模糊、
  填充和位置。

## 本地优先

Viva 没有账户、统计、上传和后台网络服务。Rust 核心只接受所选文件夹内的
受支持文本文件；它会拒绝路径穿越和符号链接逃逸，限制文件与搜索规模，并且
不会静默覆盖被其他应用修改过的文档。

保存版本位于 Viva 的系统应用数据目录，不会污染工作区。每个文档最多保留
100 版，全局约 256 MiB；相同内容自动去重。载入旧版只会成为未保存草稿，
不会直接覆盖文件。自定义背景图会在本机缩放、压缩并存入内嵌浏览器数据库，
不会上传。

最大 10 MiB 的文档仍可完整编辑、保存。为了让输入始终顺畅，实时预览与大纲最多
渲染 512 KiB 或 5,000 行；历史预览最多 256 KiB 或 2,000 行，差异对比每侧最多
128 KiB 或 800 行。Viva 会明确标出这些显示边界，不会截断文件本身。

Markdown 与 MDX 一律按不可信内容处理：禁用原始 HTML，净化渲染结果；MDX 的
import、export、表达式与 JSX 只显示为惰性源码，不会执行。远程图片和嵌入图片
不会加载；相对路径的 JPEG、PNG、GIF 与静态 WebP 必须先通过 Rust 核心校验，
Viva 才会创建临时的本地查看地址。只有在你主动点击网页链接时，Viva 才会交给
系统默认浏览器打开。

## 架构

- Tauri 2.11 与 Rust：受限的本地文件边界和原生菜单。
- React 19、TypeScript 6 与 Vite 8：桌面界面。
- 所有 UI 原语和 SVG 图标都在仓库的 `src/components` 中。
- 仅使用 `markdown-it` 与 DOMPurify 解析、净化文档内容。
- Rust 提供有上限的本地历史；行级差异不依赖第三方组件。
- 独立编辑器窗口之间使用跨进程文件锁。
- IndexedDB 仅保存一张可选背景图，localStorage 只保存小型外观设置。

新窗口有意采用互相隔离的编辑器进程。它们共享语言与外观偏好，但不共享实时
标签或未保存草稿；磁盘版本检查与跨进程锁是窗口之间的协调边界。

旧 Electron 11 版本仍保留在 Git 历史中。当前版本是完整重建，不再依赖过去的
`@viva-ui` 组件包。

## 开发

需要 Node.js 24、pnpm 11、当前稳定版 Rust，以及对应平台的
[Tauri 前置环境](https://v2.tauri.app/start/prerequisites/)。打包后的 macOS
应用需要 macOS 12.3 或更高版本。

```bash
pnpm install
pnpm tauri dev
```

运行完整本地检查：

```bash
pnpm test
pnpm build
pnpm check:size
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git diff --check
```

使用 `pnpm tauri build` 生成桌面包。仓库已包含检查 macOS 和 Windows 源码构建
的 GitHub Actions 任务；代码签名与公证属于独立的正式发布步骤。

在 macOS 安装到稳定路径时，请指定一个持久签名身份：

```bash
VIVA_SIGNING_IDENTITY="你的代码签名身份" ./scripts/install-app.sh
```

脚本不会退回临时签名；如果 `/Applications/Viva.app` 已存在，会先把旧版本移到
废纸篓，再安装经过签名校验的新版本。

## 许可证

MIT
