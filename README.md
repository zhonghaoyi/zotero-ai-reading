# Zotero AI Reading

<p align="right">
  <strong>中文</strong> | <a href="README.en.md">English</a>
</p>

Zotero AI Reading 是一个 Zotero 7+ 插件，用来把当前选中文献的 PDF 和预设提示词发送到网页 AI。它面向论文阅读场景：Zotero 负责管理文献和 PDF，网页 AI 作为外部阅读助手。

## 截图

<p align="center">
  <img src="image/Picture%201.png" alt="Zotero AI Reading context menu" width="820">
  <br>
  <sub>Zotero 右键菜单中的 Send PDF to Web AI</sub>
</p>

<p align="center">
  <img src="image/Picture%202.png" alt="Zotero AI Reading preferences" width="440">
  <br>
  <sub>插件偏好设置：选择网页 AI、传输模式和提示词</sub>
</p>

<p align="center">
  <img src="image/Picture%203.png" alt="Reader pane Web AI workflow" width="620">
  <br>
  <sub>Zotero 阅读器右侧 Web AI 面板</sub>
</p>

<p align="center">
  <img src="image/Picture%204.png" alt="External Web AI workflow" width="760">
  <br>
  <sub>外部网页 AI 打开与粘贴流程</sub>
</p>

<p align="center">
  <img src="image/Picture%205.png" alt="PDF and prompt transfer workflow" width="700">
  <br>
  <sub>PDF 文件和提示词传输模式</sub>
</p>

## 功能

- 在 Zotero 条目右键菜单中加入 **Send PDF to Web AI**。
- 自动找到当前选中文献的本地 PDF 附件。
- 根据固定提示和用户追加提示生成完整提示词。
- 支持 `{title}`、`{authors}`、`{pdfText}` 等占位符。
- 自动复制生成的提示词到剪贴板。
- 支持 ChatGPT、Claude、Grok、Gemini、ChatGLM、DeepSeek 和自定义 URL。
- Google Drive 模式会为 Google Drive for desktop 下的 PDF 生成可访问链接。
- PDF 文件模式会把本地 PDF 放到 Windows/macOS 剪贴板，并可先粘贴 PDF、再粘贴提示词。
- 支持向配置好的 http/https 网页 AI 自动粘贴。
- 支持在 Zotero 阅读器右侧打开 Web AI 面板，进行左右分栏阅读。
- 会按 PDF 和 AI 服务记录右侧面板变化后的会话 URL，再次打开时可继续历史对话。
- 右侧面板已有历史对话时，点击外部打开只打开该历史对话，不会重复自动粘贴 PDF 或提示词。
- 支持 Google Drive 链接、PDF 文件、PDF 文本三种传输模式。
- 提供 Zotero 偏好设置面板，用来配置网页 AI、传输模式、最大文本长度和追加提示词。

## 隐私

插件设置保存在本机 Zotero 偏好设置中。插件不包含 API key，也不会调用私有后端服务。PDF 内容只会通过用户选择的模式传输：Google Drive 链接、本地 PDF 文件剪贴板粘贴，或 Zotero 已索引的 PDF 文本剪贴板粘贴。

## 重要限制

Zotero 桌面插件无法稳定地直接控制任意跨域网页 AI 的输入框或文件上传控件。这些网页运行在浏览器自身的安全模型中，DOM 也经常变化。本插件主要自动化 Zotero 侧流程：查找 PDF、准备 PDF 上下文和提示词、复制到剪贴板、打开配置好的网页 AI。

PDF 文件模式依赖目标网页 AI 是否接受粘贴文件。如果需要跨服务稳定的零点击上传，通常需要配合浏览器扩展或本地自动化助手。

## 安装

在 Windows 上从源码构建 XPI：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-xpi.ps1
```

如果使用类 Unix shell，也可以运行：

```bash
sh scripts/build-xpi.sh
```

生成文件位于：

```text
dist/zotero-ai-reading-0.4.131.xpi
```

然后在 Zotero 中安装：

```text
Tools -> Add-ons -> Install Add-on From File...
```

## 开发安装

可以通过 Zotero 的 extension proxy 从源码加载插件。先在 Zotero profile 的 `extensions` 目录中创建一个文件，文件名为插件 ID：

```text
zoteroaireading@zhonghaoyi.dev
```

文件内容写入本项目目录的绝对路径。完成后重启 Zotero。

## 提示词占位符

提示词模板支持：

- `{title}`
- `{authors}`
- `{year}`
- `{date}`
- `{doi}`
- `{abstractNote}`
- `{itemKey}`
- `{libraryID}`
- `{gdriveLink}`
- `{gdriveViewLink}`
- `{pdfText}`

如果没有显式写入 `{pdfText}`，并且当前传输模式包含 PDF 文本，插件会自动把文本摘录附加到提示词后面。

## PDF 文件模式

PDF 文件模式是一个独立传输模式。开启自动粘贴时，插件会先粘贴本地 PDF 文件，再粘贴固定 PDF 文件提示词和用户追加提示词。关闭自动粘贴时，PDF 文件会保留在剪贴板中，用户可以手动粘贴。

## 许可证

MIT
