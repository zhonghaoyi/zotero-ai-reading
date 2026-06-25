# Zotero AI Reading

Zotero AI Reading is a Zotero 7+ plugin that sends the selected item's PDF and
a saved prompt to a configurable web AI workflow. It is built for paper reading
workflows where Zotero remains the source of truth and web AI tools are used as
external reading assistants.

## Screenshots

<p>
  <img src="image/Picture%201.png" alt="Zotero AI Reading context menu" width="720">
</p>
<p>
  <img src="image/Picture%202.png" alt="Zotero AI Reading preferences" width="720">
</p>
<p>
  <img src="image/Picture%203.png" alt="Reader pane Web AI workflow" width="720">
</p>
<p>
  <img src="image/Picture%204.png" alt="External Web AI workflow" width="720">
</p>
<p>
  <img src="image/Picture%205.png" alt="PDF and prompt transfer workflow" width="720">
</p>

What it does:

- Adds **Send PDF to Web AI** to the Zotero item context menu.
- Finds the selected item's local PDF attachment.
- Builds a prompt from a fixed mode-specific section and an optional saved
  extra prompt.
- Replaces placeholders such as `{title}`, `{authors}`, and `{pdfText}`.
- Copies the generated prompt to the clipboard.
- Opens the selected web AI preset, such as ChatGPT, Claude, Grok, Gemini,
  ChatGLM, DeepSeek, or a custom URL.
- In Google Drive mode, adds the human-viewable Google Drive URL for PDFs stored
  under Google Drive for desktop.
- In PDF file mode, places the local PDF file on the macOS clipboard and can
  paste the file before the prompt.
- Can auto-paste the prepared prompt into any configured http/https web AI page.
- Can open the configured web AI in a right-side reader pane for side-by-side
  reading when the experimental reader-pane option is enabled.
- Remembers the changed right-pane conversation URL per PDF and AI service, so
  reopening the pane continues the existing conversation unless the user starts
  a new upload.
- When a saved right-pane conversation is opened externally, it opens that
  conversation without auto-pasting the PDF or prompt again.
- Supports Google Drive link mode, PDF file mode, and PDF text mode.
- Adds a Zotero preferences pane for the web AI preset/custom URL, transfer
  mode, maximum text length, and optional extra prompt.

## Privacy

The plugin stores its settings in Zotero preferences on the local machine. It
does not contain API keys and does not call a private backend service. PDF
content is transferred only through the mode the user selects: Google Drive link,
local PDF file clipboard paste, or Zotero-indexed PDF text clipboard paste.

## Important limitation

Desktop Zotero plugins cannot reliably type into or upload files directly inside
arbitrary cross-origin web AI pages. Those pages run in the user's browser with
their own security model and changing DOMs. This plugin automates the Zotero
side: it finds the PDF, prepares the prompt/PDF context, copies the prompt or
PDF file, and opens the configured web AI page.

PDF file mode depends on the target web AI page accepting pasted files. For
true reliable zero-click browser upload across services, this plugin should be
paired with a browser extension or local automation helper.

## Install

Download the current XPI from this repository:

```text
dist/zotero-ai-reading-0.4.115.xpi
```

Then install it from Zotero:

```text
Tools -> Add-ons -> Install Add-on From File...
```

You can also build the XPI locally:

```bash
sh scripts/build-xpi.sh
```

## Development install

You can also load the plugin from source by creating an extension proxy file in
your Zotero profile `extensions` directory. The file name should match the plugin
ID:

```text
zoteroaireading@zhonghaoyi.dev
```

The file contents should be the absolute path to this project directory.

Restart Zotero after creating the proxy file.

## Prompt placeholders

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

If `{pdfText}` is omitted and the transfer mode includes PDF text, the plugin
appends the text excerpt automatically.

## PDF file mode

PDF file mode is an independent transfer mode. With auto-paste enabled, the
plugin pastes the selected local PDF file first, then pastes the fixed PDF-file
prompt plus your saved extra prompt. With auto-paste disabled, the PDF file is
left on the clipboard for manual paste.

## License

MIT
