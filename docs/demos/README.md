# viva expanded interface demonstration

This replaces the earlier three-to-four-scene, 2x demo with **12 recorded scenes** from the actual production frontend at `f026142b7d53d5a41831872b40aef735fa66c246`.

**Pacing:** every source action interval is played at **10x**, followed by a **0.8-second result hold**. The final clip lasts 22.47 seconds; it is not a uniformly accelerated full video. The GIF and MP4 share the same timing. The fast-forward and sample-data labels remain visible.

**Scope:** Markdown UI · in-memory sample files · no native file access. The browser harness substitutes native API boundaries with original local examples; this is not native macOS/Windows end-to-end validation. No user credentials, personal files, live provider output or upstream comic content are included. Satori question composition is shown without submitting an AI request; no answer is fabricated.

## Scenes

1. 01 / Open a Markdown workspace / 打开文件夹，开始一份笔记
2. 02 / Edit the Markdown source / 源码里写下一个新想法
3. 03 / Split editor and preview / 边写边看，源码与排版并排
4. 04 / Full-page preview / 只看排版后的页面
5. 05 / Live editing view / 切回 Live，继续在页面上写
6. 06 / Document outline / 目录自动跟随文档结构
7. 07 / Work across multiple tabs / 另一份文档，留在另一个标签
8. 08 / Find in the current document / 在当前文档里查找关键词
9. 09 / Focus mode / 进入专注模式，暂时收起其他东西
10. 10 / Appearance controls / 外观与背景，在这里调整
11. 11 / Dark appearance / 也提供深色工作区
12. 12 / Return to the document / 回到浅色，接着写

## Files

`preview.gif` is the inline README preview; `demo.mp4` is the complete silent H.264 video. `poster.png` is an actual recorded result frame. `provenance.json` records source, pacing, scene boundaries and media hashes.

The reproducible documentation-only recorder is `yuxino/kiri/docs/demos/capture/expanded.py`. It is not loaded by the applications. The shipped application code, versions, signing and update workflows remain unchanged.
