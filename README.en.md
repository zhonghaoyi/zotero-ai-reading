# Zotero AI Reading

<p align="right">
  <a href="README.md">中文</a> | <strong>English</strong>
</p>

Zotero AI Reading is a Zotero 7+ plugin that sends the selected item's PDF and a saved prompt to a configurable web AI workflow. It is built for paper-reading workflows where Zotero remains the source of truth and web AI tools act as external reading assistants.

## Screenshots

<p align="center">
  <img src="image/Picture%201.png" alt="Zotero AI Reading context menu" width="820">
  <br>
  <sub>Send PDF to Web AI in the Zotero context menu</sub>
</p>

<p align="center">
  <img src="image/Picture%202.png" alt="Zotero AI Reading preferences" width="440">
  <br>
  <sub>Preferences for web AI, transfer mode, and prompts</sub>
</p>

<p align="center">
  <img src="image/Picture%203.png" alt="Reader pane Web AI workflow" width="620">
  <br>
  <sub>Web AI in the right-side Zotero reader pane</sub>
</p>

<p align="center">
  <img src="image/Picture%204.png" alt="External Web AI workflow" width="760">
  <br>
  <sub>Opening and pasting into an external web AI page</sub>
</p>

<p align="center">
  <img src="image/Picture%205.png" alt="PDF and prompt transfer workflow" width="700">
  <br>
  <sub>PDF file and prompt transfer workflow</sub>
</p>

## Features

- Adds **Send PDF to Web AI** to the Zotero item context menu.
- Finds the selected item's local PDF attachment.
- Builds a full prompt from a fixed mode-specific section and an optional saved extra prompt.
- Supports placeholders such as `{title}`, `{authors}`, and `{pdfText}`.
- Copies the generated prompt to the clipboard.
- Supports ChatGPT, Claude, Grok, Gemini, ChatGLM, DeepSeek, and custom URLs.
- In Google Drive mode, creates a human-viewable Google Drive URL for PDFs stored under Google Drive for desktop.
- In PDF file mode, places the local PDF file on the macOS clipboard and can paste the file before the prompt.
- Can auto-paste into configured http/https web AI pages.
- Can open the configured web AI in a right-side Zotero reader pane for side-by-side reading.
- Remembers changed right-pane conversation URLs per PDF and AI service, so reopening the pane can continue the existing conversation.
- When a saved right-pane conversation is opened externally, it opens that conversation without auto-pasting the PDF or prompt again.
- Supports Google Drive link mode, PDF file mode, and PDF text mode.
- Adds a Zotero preferences pane for the web AI preset/custom URL, transfer mode, maximum text length, and optional extra prompt.

## Privacy

The plugin stores its settings in Zotero preferences on the local machine. It does not contain API keys and does not call a private backend service. PDF content is transferred only through the mode selected by the user: Google Drive link, local PDF file clipboard paste, or Zotero-indexed PDF text clipboard paste.

## Important Limitation

Desktop Zotero plugins cannot reliably type into or upload files directly inside arbitrary cross-origin web AI pages. Those pages run in the browser's own security model and their DOMs change frequently. This plugin automates the Zotero-side workflow: it finds the PDF, prepares the PDF context and prompt, copies content to the clipboard, and opens the configured web AI page.

PDF file mode depends on the target web AI page accepting pasted files. For reliable zero-click browser upload across services, use this plugin together with a browser extension or local automation helper.

## Install

Download the current XPI from GitHub:

[zotero-ai-reading-0.4.122.xpi](https://raw.githubusercontent.com/zhonghaoyi/zotero-ai-reading/main/dist/zotero-ai-reading-0.4.122.xpi)

Make sure the downloaded file is the `.xpi` file, not GitHub's `Source code` archive, a repository HTML page, or a file automatically unzipped by the browser. Zotero can only install the XPI; selecting a source zip or the wrong downloaded file may show `it may be incompatible with this version of Zotero`.

Then install it from Zotero:

```text
Tools -> Add-ons -> Install Add-on From File...
```

You can also build the XPI locally:

```bash
sh scripts/build-xpi.sh
```

The generated file is:

```text
dist/zotero-ai-reading-0.4.122.xpi
```

## Development Install

You can also load the plugin from source by creating an extension proxy file in your Zotero profile `extensions` directory. The file name should match the plugin ID:

```text
zoteroaireading@zhonghaoyi.dev
```

The file contents should be the absolute path to this project directory. Restart Zotero after creating the proxy file.

## Prompt Placeholders

The prompt template supports:

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

If `{pdfText}` is omitted and the transfer mode includes PDF text, the plugin appends the text excerpt automatically.

## PDF File Mode

PDF file mode is an independent transfer mode. With auto-paste enabled, the plugin pastes the selected local PDF file first, then pastes the fixed PDF-file prompt plus your saved extra prompt. With auto-paste disabled, the PDF file is left on the clipboard for manual paste.

## License

MIT
