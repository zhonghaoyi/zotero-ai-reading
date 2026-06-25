/* global Zotero, Services, Cc, Ci */

var ZoteroAIReading = {
  id: null,
  version: null,
  rootURI: null,
  initialized: false,
  windowStates: new Map(),
  pasteTimers: [],
  readerPanePastePayloads: new Map(),
  lastReaderPaneReader: null,
  _menuID: "zotero-ai-reading-menu",
  _usedMenuManager: false,
  MENU_LABEL: "Send PDF to Web AI",
  HTML_NS: "http://www.w3.org/1999/xhtml",
  XUL_NS: "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
  READER_PANE_ID: "zotero-ai-reading-reader-pane",
  READER_BUTTON_ID: "zotero-ai-reading-reader-button",

  PREF_PREFIX: "extensions.zotero-ai-reading.",
  AI_PRESET_URLS: {
    chatgpt: "https://chatgpt.com",
    claude: "https://claude.ai",
    grok: "https://grok.com",
    gemini: "https://gemini.google.com/app",
    chatglm: "https://chatglm.cn",
    deepseek: "https://chat.deepseek.com"
  },
  DEFAULTS: {
    aiURL: "https://chatgpt.com",
    aiPreset: "chatgpt",
    transferMode: "file",
    openAIPage: true,
    openInReaderPane: false,
    readerPaneWidth: 520,
    autoPaste: true,
    pasteDelayMs: 2500,
    maxTextChars: 120000,
    readerConversationURLs: "{}",
    linkPrompt: "请以这个 Google Drive PDF 链接作为主要来源：\n\n{gdriveLink}",
    filePrompt: "请以我刚上传的 PDF 文件作为主要来源。",
    prompt: "请以我刚上传的 PDF 文件作为主要来源。",
    extraPrompt: ""
  },

  init({ id, version, rootURI }) {
    if (this.initialized) {
      return;
    }
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    this.initialized = true;
    Zotero.ZoteroAIReading = this;
    this.applyPreferenceMigrations();
  },

  applyPreferenceMigrations() {
    try {
      let pref = this.PREF_PREFIX + "pasteDelayMs";
      if (Number(Zotero.Prefs.get(pref, true)) === 4500) {
        Zotero.Prefs.set(pref, 2500, true);
      }

      let transferModePref = this.PREF_PREFIX + "transferMode";
      let transferMode = String(Zotero.Prefs.get(transferModePref, true) || "");
      if (transferMode === "hybrid") {
        Zotero.Prefs.set(transferModePref, "text", true);
      }
      else if (transferMode === "public-url") {
        Zotero.Prefs.set(transferModePref, "file", true);
      }
      else if (transferMode && transferMode !== "gdrive" && transferMode !== "file" && transferMode !== "text") {
        Zotero.Prefs.set(transferModePref, "gdrive", true);
      }

      let aiPresetMigratedPref = this.PREF_PREFIX + "aiPresetMigrated";
      if (!Zotero.Prefs.get(aiPresetMigratedPref, true)) {
        let aiURL = String(Zotero.Prefs.get(this.PREF_PREFIX + "aiURL", true) || this.DEFAULTS.aiURL);
        Zotero.Prefs.set(this.PREF_PREFIX + "aiPreset", this.getPresetForAIURL(aiURL), true);
        Zotero.Prefs.set(aiPresetMigratedPref, true, true);
      }

      let aiPresetPref = this.PREF_PREFIX + "aiPreset";
      let aiPreset = String(Zotero.Prefs.get(aiPresetPref, true) || "");
      let configuredAIURL = String(Zotero.Prefs.get(this.PREF_PREFIX + "aiURL", true) || "");
      if (aiPreset === "qwen" || this.isRetiredQwenURL(configuredAIURL)) {
        Zotero.Prefs.set(aiPresetPref, this.DEFAULTS.aiPreset, true);
        Zotero.Prefs.set(this.PREF_PREFIX + "aiURL", this.DEFAULTS.aiURL, true);
      }
      else if (aiPreset && aiPreset !== "custom" && !this.AI_PRESET_URLS[aiPreset]) {
        Zotero.Prefs.set(aiPresetPref, "custom", true);
      }

      let promptPref = this.PREF_PREFIX + "prompt";
      let prompt = String(Zotero.Prefs.get(promptPref, true) || "");
      let extraPromptPref = this.PREF_PREFIX + "extraPrompt";
      let extraPrompt = String(Zotero.Prefs.get(extraPromptPref, true) || "");

      if (extraPrompt && (this.isOldDefaultPrompt(extraPrompt) || this.isFixedLinkPrompt(extraPrompt))) {
        Zotero.Prefs.set(extraPromptPref, "", true);
      }
      else if (!extraPrompt && prompt && !this.isOldDefaultPrompt(prompt) && !this.isFixedLinkPrompt(prompt)) {
        Zotero.Prefs.set(extraPromptPref, prompt, true);
      }

      if (!prompt || this.isOldDefaultPrompt(prompt) || !this.isFixedLinkPrompt(prompt)) {
        Zotero.Prefs.set(promptPref, this.DEFAULTS.prompt, true);
      }
    }
    catch (error) {
      this.log("applyPreferenceMigrations failed: " + (error.stack || error.message || String(error)));
    }
  },

  isOldDefaultPrompt(prompt) {
    let normalizedPrompt = this.normalizePromptForMatch(prompt);
    return [
      "Use this Google Drive PDF download URL as the primary source:",
      "Human-viewable Drive URL:",
      "Use this Google Drive PDF URL as the primary source:",
      "Use this local Google Drive PDF path as the primary source:",
      "Use the Google Drive PDF link as the primary source:",
      "You are helping me read a research paper. Please answer in Chinese.",
      "论文元数据：\n标题：{title}\n作者：{authors}\n年份：{year}\nDOI：{doi}",
      "请完成以下任务：\n1. 总结论文的核心问题、方法和主要贡献。",
      "总结论文的核心问题、方法和主要贡献",
      "按步骤提取论文的关键pipeline",
      "列出重要假设、局限性和可能失败的情况",
      "说明这篇论文可能如何帮助我的研究方向",
      "给出一组我继续精读PDF时需要核对的问题"
    ].some((marker) => normalizedPrompt.includes(this.normalizePromptForMatch(marker)));
  },

  normalizePromptForMatch(text) {
    return String(text || "")
      .replace(/\s+/g, "")
      .replace(/[：:]/g, ":")
      .toLowerCase();
  },

  isFixedLinkPrompt(prompt) {
    let normalizedPrompt = this.normalizePromptForMatch(prompt);
    let normalizedLinkPrompt = this.normalizePromptForMatch(this.DEFAULTS.linkPrompt);
    return (
      normalizedPrompt === normalizedLinkPrompt ||
      (
        normalizedPrompt.includes(this.normalizePromptForMatch("请以这个 Google Drive PDF 链接作为主要来源")) &&
        (
          normalizedPrompt.includes("{gdrivelink}") ||
          normalizedPrompt.includes("drive.google.com/file/d/")
        ) &&
        !this.isOldDefaultPrompt(prompt)
      )
    );
  },

  getExtraPromptTemplate() {
    let template = this.getPref("extraPrompt") || "";
    if (this.isOldDefaultPrompt(template) || this.isFixedLinkPrompt(template)) {
      Zotero.Prefs.set(this.PREF_PREFIX + "extraPrompt", "", true);
      return "";
    }
    let sanitized = this.stripDriveLinkPromptSections(template).trim();
    if (sanitized !== String(template || "").trim()) {
      Zotero.Prefs.set(this.PREF_PREFIX + "extraPrompt", sanitized, true);
    }
    return sanitized;
  },

  stripDriveLinkPromptSections(text) {
    let value = String(text || "");
    value = value.replace(
      /(?:^|\n)\s*请以这个\s*Google\s*Drive\s*PDF\s*链接作为主要来源[：:]\s*(?:\n\s*)*(?:https?:\/\/drive\.google\.com\/file\/d\/[^\s]+\/view[^\s]*|\{gdriveLink\}|\{gdriveViewLink\})?\s*(?=\n|$)/gi,
      "\n"
    );
    value = value.replace(/(?:^|\n)\s*https?:\/\/drive\.google\.com\/file\/d\/[^\s]+\/view[^\s]*\s*(?=\n|$)/gi, "\n");
    return value.replace(/\n{3,}/g, "\n\n").trim();
  },

  log(message) {
    Zotero.debug("Zotero AI Reading: " + message);
  },

  registerMenu() {
    if (Zotero.MenuManager && typeof Zotero.MenuManager.registerMenu === "function") {
      try {
        Zotero.MenuManager.registerMenu({
          menuID: this._menuID,
          pluginID: this.id,
          target: "main/library/item",
          menus: [
            {
              menuType: "menuitem",
              label: this.MENU_LABEL,
              icon: this.rootURI + "icons/icon.png",
              onShowing: (_event, context) => {
                try {
                  if (context?.menuElem) {
                    context.menuElem.setAttribute("label", this.MENU_LABEL);
                    this.applyMenuIcon(context.menuElem);
                  }
                }
                catch (_) {}
              },
              onCommand: () => this.runFromWindow(this.getActiveWindow())
            }
          ]
        });
        this._usedMenuManager = true;
        this.log("Menu registered via MenuManager");
        return;
      }
      catch (error) {
        this.log("MenuManager.registerMenu failed: " + error);
      }
    }

    this._usedMenuManager = false;
    this.addToAllWindows();
  },

  unregisterMenu() {
    try {
      if (this._usedMenuManager && Zotero.MenuManager?.unregisterMenu) {
        Zotero.MenuManager.unregisterMenu(this._menuID);
      }
      else {
        this.removeFromAllWindows();
      }
    }
    catch (error) {
      this.log("unregisterMenu failed: " + error);
    }
    this.clearPasteTimers();
  },

  registerReaderPanel() {
    try {
      if (Zotero.Reader && typeof Zotero.Reader.registerEventListener === "function") {
        Zotero.Reader.registerEventListener(
          "renderToolbar",
          (event) => {
            this.injectReaderToolbarButton(event.reader);
          },
          this.id
        );
      }

      for (let reader of this.getOpenReaders()) {
        this.injectReaderToolbarButton(reader);
      }
      this.log("Reader panel integration registered");
    }
    catch (error) {
      this.log("registerReaderPanel failed: " + (error.stack || error.message || String(error)));
    }
  },

  unregisterReaderPanel() {
    try {
      for (let reader of this.getOpenReaders()) {
        let doc = reader?._iframeWindow?.document;
        if (doc) {
          doc.getElementById(this.READER_BUTTON_ID)?.remove();
          doc.getElementById(this.READER_PANE_ID)?.remove();
          this.setReaderPaneOpen(doc, null, false);
        }
        this.closeReaderAIPane(reader);
      }
    }
    catch (error) {
      this.log("unregisterReaderPanel failed: " + (error.stack || error.message || String(error)));
    }
  },

  applyMenuIcon(menuitem) {
    if (!menuitem) {
      return;
    }
    try {
      let existingClass = menuitem.getAttribute("class") || "";
      if (!existingClass.includes("menuitem-iconic")) {
        menuitem.setAttribute("class", (existingClass + " menuitem-iconic").trim());
      }
      menuitem.setAttribute("image", this.rootURI + "icons/icon.png");
      menuitem.style.listStyleImage = "url(" + this.rootURI + "icons/icon.png)";
    }
    catch (error) {
      this.log("applyMenuIcon failed: " + (error.stack || error.message || String(error)));
    }
  },

  async injectReaderToolbarButton(reader) {
    try {
      if (!reader || reader.type !== "pdf") {
        return;
      }
      try {
        await reader._initPromise;
      }
      catch (_) {}

      let doc = reader._iframeWindow?.document;
      if (!doc) {
        return;
      }
      this.injectReaderPaneStyle(doc);

      let toolbar =
        doc.querySelector(".toolbar .end .custom-sections") ||
        doc.querySelector(".toolbar .end");
      if (!toolbar) {
        return;
      }

      let existingButton = doc.getElementById(this.READER_BUTTON_ID);
      if (existingButton) {
        if (existingButton.parentNode !== toolbar) {
          toolbar.appendChild(existingButton);
        }
        return;
      }

      let button = doc.createElementNS(this.HTML_NS, "button");
      button.id = this.READER_BUTTON_ID;
      button.setAttribute("type", "button");
      button.setAttribute("title", "Send PDF to Web AI");
      button.setAttribute("aria-label", "Send PDF to Web AI");
      button.className = "zai-reader-toolbar-button";
      button.textContent = "AI";
      button.addEventListener("click", () => this.runFromReader(reader));
      toolbar.appendChild(button);
    }
    catch (error) {
      this.log("injectReaderToolbarButton failed: " + (error.stack || error.message || String(error)));
    }
  },

  resetPromptUI(doc) {
    try {
      Zotero.Prefs.set(this.PREF_PREFIX + "prompt", this.DEFAULTS.prompt, true);
      Zotero.Prefs.set(this.PREF_PREFIX + "extraPrompt", "", true);
      doc?.getElementById?.("zai-extra-prompt")?.setAttribute("value", "");
      if (doc?.getElementById?.("zai-extra-prompt")) {
        doc.getElementById("zai-extra-prompt").value = "";
      }
    }
    catch (error) {
      this.log("resetPromptUI failed: " + (error.stack || error.message || String(error)));
    }
  },

  addToAllWindows() {
    for (let win of Zotero.getMainWindows()) {
      if (win.ZoteroPane) {
        this.addToWindow(win);
      }
    }
  },

  addToWindow(window) {
    if (this.windowStates.has(window)) {
      return;
    }

    let doc = window.document;
    let state = {
      addedIDs: [],
      listeners: []
    };

    this.addItemContextMenu(window, doc, state);
    this.addToolsMenu(window, doc, state);
    this.windowStates.set(window, state);
  },

  addItemContextMenu(window, doc, state) {
    let popup =
      doc.getElementById("zotero-itemmenu") ||
      doc.getElementById("zotero-itemmenu-popup");
    if (!popup || doc.getElementById("zotero-ai-reading-item-menu")) {
      return;
    }

    let separator = doc.createXULElement("menuseparator");
    separator.id = "zotero-ai-reading-item-separator";

    let menuitem = doc.createXULElement("menuitem");
    menuitem.id = "zotero-ai-reading-item-menu";
    menuitem.setAttribute("label", this.MENU_LABEL);
    this.applyMenuIcon(menuitem);
    menuitem.addEventListener("command", () => this.runFromWindow(window));

    let onPopupShowing = () => {
      menuitem.disabled = !this.hasUsableSelection(window);
    };
    popup.addEventListener("popupshowing", onPopupShowing);

    popup.appendChild(separator);
    popup.appendChild(menuitem);
    state.addedIDs.push(separator.id, menuitem.id);
    state.listeners.push({ target: popup, type: "popupshowing", listener: onPopupShowing });
  },

  addToolsMenu(window, doc, state) {
    let popup = doc.getElementById("menu_ToolsPopup");
    if (!popup || doc.getElementById("zotero-ai-reading-tools-menu")) {
      return;
    }

    let menuitem = doc.createXULElement("menuitem");
    menuitem.id = "zotero-ai-reading-tools-menu";
    menuitem.setAttribute("label", "Send Selected PDF to Web AI");
    this.applyMenuIcon(menuitem);
    menuitem.addEventListener("command", () => this.runFromWindow(window));

    popup.appendChild(menuitem);
    state.addedIDs.push(menuitem.id);
  },

  removeFromWindow(window) {
    let state = this.windowStates.get(window);
    if (!state) {
      return;
    }

    for (let { target, type, listener } of state.listeners) {
      target.removeEventListener(type, listener);
    }

    let doc = window.document;
    for (let id of state.addedIDs) {
      doc.getElementById(id)?.remove();
    }

    this.windowStates.delete(window);
  },

  removeFromAllWindows() {
    for (let win of Zotero.getMainWindows()) {
      if (win.ZoteroPane) {
        this.removeFromWindow(win);
      }
    }
  },

  hasUsableSelection(window) {
    let items = this.getSelectedItems(window);
    return items.length === 1 && !items[0].isNote();
  },

  getSelectedItems(window) {
    let pane = window?.ZoteroPane || Zotero.getActiveZoteroPane();
    return pane?.getSelectedItems() || [];
  },

  getActiveWindow() {
    try {
      return Zotero.getActiveZoteroPane()?.document?.defaultView || Zotero.getMainWindows()[0] || null;
    }
    catch (_) {
      return Zotero.getMainWindows()[0] || null;
    }
  },

  async runFromWindow(window) {
    try {
      let aiURL = this.getAIURL();
      let { item, attachment, pdfPath } = await this.getSelectedPDF(window);
      let shouldOpenAIPage = this.getBoolPref("openAIPage");
      if (shouldOpenAIPage) {
        Zotero.launchURL(aiURL);
      }

      let prompt = await this.buildPrompt(item, attachment, pdfPath);
      let transferMode = this.getTransferMode();
      let uploadPDFPath = transferMode === "file" ? this.preparePDFUploadPath(pdfPath, attachment) : pdfPath;

      if (this.getBoolPref("autoPaste") && this.isAutoPasteTarget(aiURL)) {
        this.scheduleAutoPaste(aiURL, { pdfPath: uploadPDFPath, prompt, transferMode });
      }
      else if (transferMode === "file") {
        this.copyPDFFileToClipboardAsync(uploadPDFPath);
      }
      else {
        this.copyToClipboard(prompt);
      }

    }
    catch (error) {
      this.log(error.stack || error.message || String(error));
      this.showError(window, error);
    }
  },

  async runFromReader(reader, options = {}) {
    try {
      this.clearPasteTimers();
      let selected = await this.getPDFForReader(reader);
      let prompt = await this.buildPrompt(selected.item, selected.attachment, selected.pdfPath);
      let aiURL = this.getAIURL();
      let transferMode = this.getTransferMode();
      let uploadPDFPath = transferMode === "file" ? this.preparePDFUploadPath(selected.pdfPath, selected.attachment) : selected.pdfPath;
      let openedInReaderPane = false;
      let readerPaneResult = null;

      if (this.getBoolPref("openAIPage")) {
        if (this.getBoolPref("openInReaderPane")) {
          readerPaneResult = await this.openAIInReaderPane(reader, aiURL, {
            forceNewConversation: Boolean(options.forceNewConversation)
          });
          openedInReaderPane = Boolean(readerPaneResult?.opened || readerPaneResult === true);
        }
        if (!openedInReaderPane) {
          Zotero.launchURL(aiURL);
        }
      }

      let resumedReaderConversation =
        openedInReaderPane &&
        readerPaneResult?.resumed &&
        !options.forceNewConversation;
      // Restoring a saved conversation should only reopen it. "重新上传" is the
      // explicit path that starts fresh and sends the PDF/prompt again.
      let pasteIntoResumedReaderConversation = false;

      if (!resumedReaderConversation || pasteIntoResumedReaderConversation) {
        if (transferMode === "file") {
          this.copyPDFFileToClipboard(uploadPDFPath);
        }
        else {
          this.copyToClipboard(prompt);
        }
        if (openedInReaderPane) {
          this.rememberReaderPanePastePayload(reader, {
            pdfPath: uploadPDFPath,
            prompt,
            transferMode,
            aiURL
          });
        }
      }
      else if (openedInReaderPane) {
        this.clearReaderPanePastePayload(reader, aiURL);
      }

      if (this.getBoolPref("autoPaste") && this.isAutoPasteTarget(aiURL)) {
        if (openedInReaderPane) {
          if (!resumedReaderConversation || pasteIntoResumedReaderConversation) {
            let pastePayload = {
              pdfPath: uploadPDFPath,
              prompt,
              transferMode,
              aiURL,
              forceNewConversation: Boolean(options.forceNewConversation),
              readerPaneLoadedFresh: Boolean(readerPaneResult?.loadedFresh)
            };
            if (this.isChatGLMURL(aiURL)) {
              this.scheduleReaderPanePasteWhenEditorReady(reader, pastePayload);
            }
            else {
              this.scheduleReaderPanePaste(reader, pastePayload);
            }
          }
        }
        else {
          this.scheduleAutoPaste(aiURL, { pdfPath: uploadPDFPath, prompt, transferMode });
        }
      }
    }
    catch (error) {
      this.log("runFromReader failed: " + (error.stack || error.message || String(error)));
      this.showError(reader?._window || this.getActiveWindow(), error);
    }
  },

  async getPDFForReader(reader) {
    let attachment = reader?._item;
    if (!this.isPDF(attachment)) {
      throw new Error("The active reader does not expose a PDF attachment.");
    }
    let item = attachment.parentItem || attachment;
    let pdfPath = await this.getAttachmentPath(attachment);
    if (!pdfPath) {
      throw new Error("The PDF attachment does not have a local file path.");
    }
    return { item, attachment, pdfPath };
  },

  async getSelectedPDF(window) {
    let items = this.getSelectedItems(window);
    if (items.length !== 1) {
      throw new Error("Select exactly one Zotero item or one PDF attachment.");
    }

    let selected = items[0];
    let item = selected;
    let attachment = null;

    if (this.isPDF(selected)) {
      attachment = selected;
      item = selected.parentItem || selected;
    }
    else {
      item = selected.isRegularItem() ? selected : selected.parentItem;
      if (!item || !item.isRegularItem()) {
        throw new Error("Select a regular Zotero item or a PDF attachment.");
      }
      attachment = await this.findPDFAttachment(item);
    }

    if (!attachment) {
      throw new Error("No PDF attachment was found for the selected item.");
    }

    let pdfPath = await this.getAttachmentPath(attachment);
    if (!pdfPath) {
      throw new Error("The PDF attachment does not have a local file path.");
    }

    return { item, attachment, pdfPath };
  },

  async findPDFAttachment(item) {
    let attachments = Zotero.Items.get(item.getAttachments());
    let pdfs = attachments.filter((attachment) => this.isPDF(attachment));

    for (let attachment of pdfs) {
      if (await this.getAttachmentPath(attachment)) {
        return attachment;
      }
    }

    return pdfs[0] || null;
  },

  isPDF(item) {
    if (!item || !item.isAttachment?.()) {
      return false;
    }

    if (typeof item.isPDFAttachment === "function" && item.isPDFAttachment()) {
      return true;
    }

    if (item.attachmentContentType === "application/pdf") {
      return true;
    }

    let title = this.safeField(item, "title");
    return /\.pdf$/i.test(title);
  },

  async getAttachmentPath(attachment) {
    try {
      if (typeof attachment.getFilePathAsync === "function") {
        return (await attachment.getFilePathAsync()) || "";
      }
      if (typeof attachment.getFilePath === "function") {
        return attachment.getFilePath() || "";
      }
      return attachment.attachmentPath || "";
    }
    catch (error) {
      this.log(error.stack || error.message || String(error));
      return "";
    }
  },

  async buildPrompt(item, attachment, pdfPath) {
    let transferMode = this.getTransferMode();
    let maxTextChars = this.getIntPref("maxTextChars");
    let pdfText = "";
    let extraTemplate = this.getExtraPromptTemplate();
    let gdriveLink = "";
    let gdriveViewLink = "";

    if (transferMode === "text") {
      pdfText = await this.getAttachmentText(attachment, maxTextChars);
    }
    else if (transferMode === "gdrive") {
      let googleDriveLinks = await this.getGoogleDriveLinks(pdfPath);
      gdriveLink = googleDriveLinks.viewURL || "";
      gdriveViewLink = gdriveLink;
    }

    let data = {
      ...this.getItemMetadata(item),
      pdfPath: "",
      gdriveLink,
      gdriveViewLink,
      pdfText
    };

    let prompt = "";
    if (transferMode === "gdrive") {
      prompt = this.renderTemplate(this.DEFAULTS.linkPrompt, data);
    }
    else if (transferMode === "file") {
      prompt = this.renderTemplate(this.DEFAULTS.filePrompt, data);
    }
    let extraPrompt = this.renderTemplate(extraTemplate, data).trim();
    if (transferMode === "text") {
      extraPrompt = this.stripDriveLinkPromptSections(extraPrompt);
    }
    if (extraPrompt) {
      prompt = prompt ? prompt + "\n\n" + extraPrompt : extraPrompt;
    }

    if (transferMode === "text" && !extraTemplate.includes("{pdfText}")) {
      prompt = prompt ? prompt + "\n\nPDF text excerpt:\n" + pdfText : "PDF text excerpt:\n" + pdfText;
    }

    if (!pdfText && transferMode === "text") {
      prompt +=
        "\n\n[Zotero AI Reading note: Zotero did not return indexed full text for this PDF. " +
        "Switch back to Google Drive link mode or check Zotero's PDF text indexing.]";
    }

    return prompt;
  },

  getOpenReaders() {
    try {
      return Array.from(Zotero.Reader?._readers || []).filter(Boolean);
    }
    catch (_) {
      return [];
    }
  },

  findReaderForAttachment(attachment) {
    let readers = this.getOpenReaders();
    let exact = readers.find((reader) => {
      try {
        return reader?._item?.id === attachment?.id;
      }
      catch (_) {
        return false;
      }
    });
    if (exact) {
      return exact;
    }
    return readers.length === 1 ? readers[0] : null;
  },

  async openAIInReaderPaneForAttachment(attachment, aiURL, options = {}) {
    let reader = this.findReaderForAttachment(attachment);
    if (!reader) {
      return false;
    }
    let result = await this.openAIInReaderPane(reader, aiURL, options);
    return Boolean(result?.opened || result === true);
  },

  async openAIInReaderPane(reader, aiURL, options = {}) {
    try {
      if (!reader || reader.type !== "pdf") {
        return false;
      }
      try {
        await reader._initPromise;
      }
      catch (_) {}
      let rw = reader._iframeWindow;
      let doc = reader._window?.document || reader._iframe?.ownerDocument;
      if (!doc || !rw?.document || !/^https?:\/\//i.test(String(aiURL || ""))) {
        return false;
      }

      let contentAnchor = this.captureReaderContentAnchor(reader);
      this.resetLegacyReaderPaneLayout(rw.document);
      this.injectReaderChromePaneStyle(doc);
      let container = this.ensureReaderChromeWrapper(reader);
      if (!container) {
        return false;
      }

      let pane = container.querySelector(".zai-reader-ai-pane");
      if (!pane) {
        pane = this.createReaderAIPane(doc, reader);
        container.appendChild(this.createReaderPaneSplitter(doc, reader));
        container.appendChild(pane);
      }
      else {
        this.ensureReaderPaneSplitter(doc, reader, container, pane);
      }
      let paneWidth = this.getReaderPaneWidth();
      this.applyReaderPaneWidth(pane, paneWidth);
      this.scheduleReaderContentAnchorRestore(reader, contentAnchor);

      let savedConversationURL = this.getSavedReaderConversationURL(reader, aiURL);
      let forceUserNewConversation = Boolean(options.forceNewConversation);
      if (forceUserNewConversation) {
        this.clearSavedReaderConversationURL(reader, aiURL);
        savedConversationURL = "";
      }
      let forceFreshConversation =
        forceUserNewConversation ||
        (!savedConversationURL && this.shouldStartFreshReaderConversation(aiURL));
      let targetURL = forceFreshConversation
        ? aiURL
        : (savedConversationURL || aiURL);
      let resumed = !forceFreshConversation && !this.isSameURL(targetURL, aiURL);
      pane.setAttribute("data-zai-ai-base-url", aiURL);
      pane.setAttribute("data-zai-ai-target-url", targetURL);
      pane.setAttribute("data-zai-ai-resumed", resumed ? "true" : "false");

      let webView = this.getReaderPaneWebView(pane);
      let loadedFresh = false;
      if (webView) {
        loadedFresh = this.loadReaderWebView(webView, targetURL, {
          forceReload: forceUserNewConversation || (this.isChatGLMURL(aiURL) && forceFreshConversation)
        });
      }

      this.lastReaderPaneReader = reader;
      pane.removeAttribute("hidden");
      doc.getElementById(this.getReaderSplitterID(reader))?.removeAttribute("hidden");
      reader._window?.setTimeout(() => this.focusReaderPaneFrame(reader), 800);
      return { opened: true, resumed, targetURL, loadedFresh };
    }
    catch (error) {
      this.log("openAIInReaderPane failed: " + (error.stack || error.message || String(error)));
      return false;
    }
  },

  getReaderStableID(reader) {
    return String(reader?.tabID || reader?.itemID || reader?._item?.id || "window")
      .replace(/[^A-Za-z0-9_-]/g, "-");
  },

  getReaderWrapperID(reader) {
    return this.READER_PANE_ID + "-wrap-" + this.getReaderStableID(reader);
  },

  getReaderPaneID(reader) {
    return this.READER_PANE_ID + "-" + this.getReaderStableID(reader);
  },

  getReaderSplitterID(reader) {
    return this.READER_PANE_ID + "-splitter-" + this.getReaderStableID(reader);
  },

  getReaderChromeWrapper(reader) {
    let iframe = reader?._iframe;
    let doc = reader?._window?.document || iframe?.ownerDocument;
    if (!doc) {
      return null;
    }
    let pane = doc.getElementById(this.getReaderPaneID(reader));
    if (pane?.parentNode) {
      return pane.parentNode;
    }
    let container = doc.querySelector?.('[data-zai-reader-container="' + this.getReaderStableID(reader) + '"]');
    if (container) {
      return container;
    }
    let wrapper = iframe?.parentNode;
    if (wrapper?.classList?.contains("zai-reader-chrome-wrap")) {
      return wrapper;
    }
    return null;
  },

  ensureReaderChromeWrapper(reader) {
    try {
      let iframe = reader?._iframe;
      let doc = reader?._window?.document || iframe?.ownerDocument;
      if (!iframe || !doc) {
        return null;
      }

      this.restoreLegacyMovedReader(reader);

      this.restoreReaderViewportFromReader(reader);

      let readerBox = doc.getElementById("zotero-reader");
      let primary = readerBox?.contains?.(iframe) ? readerBox : iframe;
      this.restoreReaderViewportElement(primary);

      let container = iframe.parentNode;
      if (readerBox?.contains?.(iframe) && readerBox.parentNode) {
        container = readerBox.parentNode;
      }
      if (!container) {
        return null;
      }

      let existingPane = doc.getElementById(this.getReaderPaneID(reader));
      if (existingPane && existingPane.parentNode !== container) {
        existingPane.remove();
      }

      if (!container.hasAttribute("data-zai-original-orient")) {
        container.setAttribute(
          "data-zai-original-orient",
          container.hasAttribute("orient") ? container.getAttribute("orient") : "__none__"
        );
      }
      if (!container.id) {
        container.id = this.getReaderWrapperID(reader);
      }
      container.setAttribute("data-zai-reader-container", this.getReaderStableID(reader));
      container.setAttribute("orient", "horizontal");
      container.classList.add("zai-reader-ai-layout");
      readerBox?.setAttribute?.("flex", "1");
      iframe.setAttribute("flex", "1");
      return container;
    }
    catch (error) {
      this.log("ensureReaderChromeWrapper failed: " + (error.stack || error.message || String(error)));
      return null;
    }
  },

  restoreLegacyMovedReader(reader) {
    try {
      let iframe = reader?._iframe;
      let wrapper = iframe?.parentNode;
      if (!wrapper?.classList?.contains("zai-reader-chrome-wrap")) {
        return;
      }
      wrapper.querySelector?.(".zai-reader-ai-pane")?.remove();
      let parent = wrapper.parentNode;
      if (!parent) {
        return;
      }
      parent.insertBefore(iframe, wrapper);
      wrapper.remove();
      iframe.setAttribute("flex", "1");
    }
    catch (error) {
      this.log("restoreLegacyMovedReader failed: " + (error.stack || error.message || String(error)));
    }
  },

  restoreReaderChromeWrapper(reader) {
    try {
      this.restoreLegacyMovedReader(reader);
      let container = this.getReaderChromeWrapper(reader);
      if (!container) {
        return;
      }
      if (container.querySelector(".zai-reader-ai-pane")) {
        return;
      }
      container.classList.remove("zai-reader-ai-layout");
      container.removeAttribute("data-zai-reader-container");
      container.style.removeProperty("--zai-reader-ai-pane-width");
      this.restoreReaderViewport(container);
      this.restoreReaderContainerOrient(container);
    }
    catch (error) {
      this.log("restoreReaderChromeWrapper failed: " + (error.stack || error.message || String(error)));
    }
  },

  restoreReaderViewport(container) {
    try {
      let viewport = null;
      for (let child of Array.from(container?.children || [])) {
        if (child.classList?.contains("zai-reader-ai-viewport")) {
          viewport = child;
          break;
        }
      }
      if (!viewport) {
        viewport = container?.querySelector?.(".zai-reader-ai-viewport");
      }
      if (!viewport) {
        return;
      }
      let primary = viewport.firstElementChild;
      if (primary) {
        container.insertBefore(primary, viewport);
      }
      viewport.remove();
    }
    catch (error) {
      this.log("restoreReaderViewport failed: " + (error.stack || error.message || String(error)));
    }
  },

  restoreReaderViewportFromReader(reader) {
    try {
      let iframe = reader?._iframe;
      this.restoreReaderViewportElement(iframe);
    }
    catch (error) {
      this.log("restoreReaderViewportFromReader failed: " + (error.stack || error.message || String(error)));
    }
  },

  restoreReaderViewportElement(primary) {
    try {
      let viewport = primary?.parentNode;
      if (!viewport?.classList?.contains("zai-reader-ai-viewport")) {
        return;
      }
      let container = viewport.parentNode;
      if (!container) {
        return;
      }
      container.insertBefore(primary, viewport);
      viewport.remove();
      primary.setAttribute?.("flex", "1");
    }
    catch (error) {
      this.log("restoreReaderViewportElement failed: " + (error.stack || error.message || String(error)));
    }
  },

  restoreReaderContainerOrient(container) {
    try {
      if (!container) {
        return;
      }
      let originalOrient = container.getAttribute("data-zai-original-orient");
      if (originalOrient) {
        if (originalOrient === "__none__") {
          container.removeAttribute("orient");
        }
        else {
          container.setAttribute("orient", originalOrient);
        }
        container.removeAttribute("data-zai-original-orient");
      }
    }
    catch (error) {
      this.log("restoreReaderContainerOrient failed: " + (error.stack || error.message || String(error)));
    }
  },

  closeReaderAIPane(reader) {
    try {
      let contentAnchor = this.captureReaderContentAnchor(reader);
      let wrapper = this.getReaderChromeWrapper(reader);
      let pane = wrapper?.querySelector?.(".zai-reader-ai-pane");
      if (!pane) {
        pane = (reader?._window?.document || reader?._iframe?.ownerDocument)?.getElementById?.(this.getReaderPaneID(reader));
      }
      if (pane) {
        let webView = this.getReaderPaneWebView(pane);
        if (webView) {
          this.saveCurrentReaderConversationURL(reader, pane, webView);
          webView.setAttribute("src", "about:blank");
        }
        pane.remove();
      }
      (reader?._window?.document || reader?._iframe?.ownerDocument)
        ?.getElementById?.(this.getReaderSplitterID(reader))
        ?.remove();
      this.restoreReaderChromeWrapper(reader);
      this.scheduleReaderContentAnchorRestore(reader, contentAnchor);
    }
    catch (error) {
      this.log("closeReaderAIPane failed: " + (error.stack || error.message || String(error)));
    }
  },

  clampReaderPaneWidth(width) {
    let value = Number(width);
    if (!Number.isFinite(value)) {
      value = this.DEFAULTS.readerPaneWidth;
    }
    return Math.max(320, Math.min(900, Math.round(value)));
  },

  getReaderPaneWidth() {
    return this.clampReaderPaneWidth(this.getIntPref("readerPaneWidth"));
  },

  applyReaderPaneWidth(pane, width) {
    if (!pane) {
      return;
    }
    let value = this.clampReaderPaneWidth(width);
    pane.setAttribute("width", String(value));
    pane.style.setProperty("width", value + "px", "important");
    pane.style.setProperty("flex", "0 0 " + value + "px", "important");
    pane.parentNode?.style?.setProperty("--zai-reader-ai-pane-width", value + "px");
  },

  ensureReaderPaneSplitter(doc, reader, container, pane) {
    let splitterID = this.getReaderSplitterID(reader);
    let splitter = doc.getElementById(splitterID);
    if (!splitter) {
      splitter = this.createReaderPaneSplitter(doc, reader);
    }
    if (splitter.parentNode !== container || splitter.nextSibling !== pane) {
      container.insertBefore(splitter, pane);
    }
    return splitter;
  },

  createReaderPaneSplitter(doc, reader) {
    let splitter = doc.createXULElement("box");
    splitter.id = this.getReaderSplitterID(reader);
    splitter.setAttribute("class", "zai-reader-ai-splitter");
    splitter.setAttribute("tooltiptext", "拖动调整 Web AI 宽度");
    splitter.addEventListener("mousedown", (event) => this.startReaderPaneResize(event, reader));
    return splitter;
  },

  startReaderPaneResize(event, reader) {
    try {
      if (event.button !== 0) {
        return;
      }
      let doc = reader?._window?.document || reader?._iframe?.ownerDocument;
      let pane = doc?.getElementById?.(this.getReaderPaneID(reader));
      if (!doc || !pane) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      let win = doc.defaultView;
      let startX = event.screenX;
      let startWidth = pane.getBoundingClientRect?.().width || this.getReaderPaneWidth();
      let latestWidth = startWidth;
      let contentAnchor = this.captureReaderContentAnchor(reader);
      doc.documentElement.classList.add("zai-reader-ai-resizing");

      let onMove = (moveEvent) => {
        latestWidth = this.clampReaderPaneWidth(startWidth + startX - moveEvent.screenX);
        this.applyReaderPaneWidth(pane, latestWidth);
        this.restoreReaderContentAnchor(reader, contentAnchor);
      };
      let onUp = () => {
        try {
          doc.documentElement.classList.remove("zai-reader-ai-resizing");
          Zotero.Prefs.set(this.PREF_PREFIX + "readerPaneWidth", this.clampReaderPaneWidth(latestWidth), true);
          this.scheduleReaderContentAnchorRestore(reader, contentAnchor);
        }
        finally {
          win.removeEventListener("mousemove", onMove, true);
          win.removeEventListener("mouseup", onUp, true);
        }
      };

      win.addEventListener("mousemove", onMove, true);
      win.addEventListener("mouseup", onUp, true);
    }
    catch (error) {
      this.log("startReaderPaneResize failed: " + (error.stack || error.message || String(error)));
    }
  },

  createReaderAIPane(doc, reader) {
    let makeXUL = (tag, className) => {
      let el = doc.createXULElement(tag);
      if (className) {
        el.setAttribute("class", className);
      }
      return el;
    };
    let makeHTML = (tag, className, text) => {
      let el = doc.createElementNS(this.HTML_NS, tag);
      if (className) {
        el.setAttribute("class", className);
      }
      if (text !== undefined) {
        el.textContent = text;
      }
      return el;
    };

    let pane = makeXUL("vbox", "zai-reader-ai-pane");
    pane.id = this.getReaderPaneID(reader);
    pane.setAttribute("data-zai-reader-pane", "true");
    this.applyReaderPaneWidth(pane, this.getReaderPaneWidth());

    let header = makeXUL("hbox", "zai-reader-ai-header");
    header.setAttribute("align", "center");
    let left = makeXUL("hbox", "zai-reader-ai-title");
    left.setAttribute("align", "center");
    let badge = makeHTML("span", "zai-reader-ai-badge", "AI");
    let text = makeHTML("span", "", "Web AI");
    left.appendChild(badge);
    left.appendChild(text);

    let spacer = makeXUL("spacer", "");
    spacer.setAttribute("flex", "1");

    let actions = makeXUL("hbox", "zai-reader-ai-actions");
    actions.setAttribute("align", "center");
    let restart = makeXUL("button", "");
    restart.setAttribute("label", "重新上传");
    restart.setAttribute("tooltiptext", "新开对话并重新上传当前 PDF");
    restart.addEventListener("click", () => {
      this.runFromReader(reader, { forceNewConversation: true });
    });

    let paste = makeXUL("button", "");
    paste.setAttribute("label", "粘贴");
    paste.addEventListener("click", () => {
      this.pasteIntoReaderPane(reader, this.getReaderPanePastePayload(reader));
    });

    let external = makeXUL("button", "");
    external.setAttribute("label", "外部打开");
    external.addEventListener("click", () => {
      let frame = this.getReaderPaneWebView(pane);
      let baseURL = pane?.getAttribute?.("data-zai-ai-base-url") || this.getAIURL();
      let src = this.getWebViewCurrentURL(frame) || frame?.getAttribute("src") || baseURL;
      let opensSavedConversation = this.isSaveableConversationURL(src, baseURL);
      if (frame) {
        this.saveCurrentReaderConversationURL(reader, pane, frame);
      }
      Zotero.launchURL(src);
      let payload = this.getReaderPanePastePayload(reader);
      if (!opensSavedConversation && payload && this.getBoolPref("autoPaste") && this.isAutoPasteTarget(src)) {
        this.scheduleAutoPaste(src, Object.assign({}, payload, { aiURL: src, delayMs: 0 }));
      }
    });

    let close = makeXUL("button", "");
    close.setAttribute("label", "×");
    close.setAttribute("tooltiptext", "关闭");
    close.addEventListener("click", () => {
      this.closeReaderAIPane(reader);
      reader?._iframe?.focus?.();
    });

    actions.appendChild(restart);
    actions.appendChild(paste);
    actions.appendChild(external);
    actions.appendChild(close);
    header.appendChild(left);
    header.appendChild(spacer);
    header.appendChild(actions);

    let frame = this.createReaderWebView(doc);

    pane.appendChild(header);
    pane.appendChild(frame);
    return pane;
  },

  createReaderWebView(doc) {
    try {
      let browser = doc.createXULElement
        ? doc.createXULElement("browser")
        : doc.createElementNS(this.XUL_NS, "browser");
      browser.setAttribute("class", "zai-reader-ai-browser");
      browser.setAttribute("type", "content");
      browser.setAttribute("remote", "true");
      browser.setAttribute("maychangeremoteness", "true");
      browser.setAttribute("disableglobalhistory", "true");
      browser.setAttribute("src", "about:blank");
      browser.setAttribute("flex", "1");
      return browser;
    }
    catch (error) {
      this.log("createReaderWebView browser fallback: " + (error.stack || error.message || String(error)));
      let frame = doc.createElementNS(this.HTML_NS, "iframe");
      frame.setAttribute("class", "zai-reader-ai-frame");
      frame.setAttribute("allow", "clipboard-read; clipboard-write; fullscreen; camera; microphone");
      frame.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
      return frame;
    }
  },

  getReaderPaneWebView(pane) {
    return pane?.querySelector?.(".zai-reader-ai-browser, .zai-reader-ai-frame") || null;
  },

  loadReaderWebView(webView, aiURL, options = {}) {
    try {
      if (!options.forceReload && webView.getAttribute("src") === aiURL) {
        return false;
      }
      if (options.forceReload) {
        try {
          webView.setAttribute("src", "about:blank");
        }
        catch (_) {}
      }
      webView.setAttribute("src", aiURL);
      if (typeof webView.loadURI === "function") {
        try {
          let principal = Services.scriptSecurityManager?.getSystemPrincipal?.();
          if (principal) {
            webView.loadURI(aiURL, { triggeringPrincipal: principal });
          }
          else {
            webView.loadURI(aiURL);
          }
        }
        catch (error) {
          this.log("loadReaderWebView loadURI fallback: " + (error.stack || error.message || String(error)));
        }
      }
      return true;
    }
    catch (error) {
      this.log("loadReaderWebView failed: " + (error.stack || error.message || String(error)));
      return false;
    }
  },

  saveCurrentReaderConversationURL(reader, pane, webView) {
    try {
      let baseURL = pane?.getAttribute?.("data-zai-ai-base-url") || this.getAIURL();
      let currentURL = this.getWebViewCurrentURL(webView);
      this.saveReaderConversationURL(reader, baseURL, currentURL);
    }
    catch (error) {
      this.log("saveCurrentReaderConversationURL failed: " + (error.stack || error.message || String(error)));
    }
  },

  getWebViewCurrentURL(webView) {
    let candidates = [];
    try {
      candidates.push(webView?.currentURI?.spec);
    }
    catch (_) {}
    try {
      candidates.push(webView?.webNavigation?.currentURI?.spec);
    }
    catch (_) {}
    try {
      candidates.push(webView?.browsingContext?.currentURI?.spec);
    }
    catch (_) {}
    try {
      candidates.push(webView?.contentWindow?.location?.href);
    }
    catch (_) {}
    try {
      candidates.push(webView?.getAttribute?.("src"));
    }
    catch (_) {}

    return candidates.find((url) => /^https?:\/\//i.test(String(url || ""))) || "";
  },

  getSavedReaderConversationURL(reader, aiURL) {
    let key = this.getReaderConversationKey(reader, aiURL);
    if (!key) {
      return "";
    }
    let url = this.getReaderConversationURLs()[key] || "";
    return this.isSaveableConversationURL(url, aiURL) ? url : "";
  },

  saveReaderConversationURL(reader, aiURL, conversationURL) {
    let key = this.getReaderConversationKey(reader, aiURL);
    if (!key || !this.isSaveableConversationURL(conversationURL, aiURL)) {
      return false;
    }
    let urls = this.getReaderConversationURLs();
    urls[key] = String(conversationURL || "");
    this.setReaderConversationURLs(urls);
    return true;
  },

  clearSavedReaderConversationURL(reader, aiURL) {
    let key = this.getReaderConversationKey(reader, aiURL);
    if (!key) {
      return;
    }
    let urls = this.getReaderConversationURLs();
    if (Object.prototype.hasOwnProperty.call(urls, key)) {
      delete urls[key];
      this.setReaderConversationURLs(urls);
    }
  },

  getReaderConversationKey(reader, aiURL) {
    let origin = this.getURLOrigin(aiURL);
    let attachment = reader?._item;
    let itemID = attachment?.key || attachment?.id || this.getReaderStableID(reader);
    let libraryID = attachment?.libraryID || attachment?.library?.libraryID || "";
    if (!origin || !itemID) {
      return "";
    }
    return [libraryID, itemID, origin].join("|");
  },

  getReaderConversationURLs() {
    try {
      let raw = String(this.getPref("readerConversationURLs") || "{}");
      let parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    catch (_) {
      return {};
    }
  },

  setReaderConversationURLs(urls) {
    try {
      Zotero.Prefs.set(this.PREF_PREFIX + "readerConversationURLs", JSON.stringify(urls || {}), true);
    }
    catch (error) {
      this.log("setReaderConversationURLs failed: " + (error.stack || error.message || String(error)));
    }
  },

  rememberReaderPanePastePayload(reader, payload = {}) {
    let key = this.getReaderConversationKey(reader, payload.aiURL || this.getAIURL());
    if (!key || !payload.prompt) {
      return;
    }
    this.readerPanePastePayloads.set(key, {
      pdfPath: payload.pdfPath || "",
      prompt: payload.prompt || "",
      transferMode: payload.transferMode || this.getTransferMode(),
      aiURL: payload.aiURL || this.getAIURL()
    });
  },

  getReaderPanePastePayload(reader, aiURL = "") {
    let key = this.getReaderConversationKey(reader, aiURL || this.getAIURL());
    return (key && this.readerPanePastePayloads.get(key)) || null;
  },

  clearReaderPanePastePayload(reader, aiURL = "") {
    let key = this.getReaderConversationKey(reader, aiURL || this.getAIURL());
    if (key) {
      this.readerPanePastePayloads.delete(key);
    }
  },

  getURLOrigin(url) {
    try {
      return new URL(String(url || "")).origin;
    }
    catch (_) {
      return "";
    }
  },

  isSameURL(a, b) {
    try {
      let first = new URL(String(a || ""));
      let second = new URL(String(b || ""));
      first.hash = "";
      second.hash = "";
      return first.href.replace(/\/$/, "") === second.href.replace(/\/$/, "");
    }
    catch (_) {
      return String(a || "") === String(b || "");
    }
  },

  isValidSavedConversationURL(url, aiURL) {
    try {
      let current = new URL(String(url || ""));
      let base = new URL(String(aiURL || ""));
      return /^https?:$/i.test(current.protocol) && current.origin === base.origin;
    }
    catch (_) {
      return false;
    }
  },

  isSaveableConversationURL(url, aiURL) {
    if (!this.isValidSavedConversationURL(url, aiURL) || this.isSameURL(url, aiURL)) {
      return false;
    }
    try {
      let current = new URL(String(url || ""));
      let path = current.pathname.replace(/\/+$/, "") || "/";
      if (path === "/" || path === "/new" || this.isChatGLMNonConversationURL(current, aiURL)) {
        return false;
      }
      return true;
    }
    catch (_) {
      return false;
    }
  },

  setReaderPaneOpen(doc, pane, open) {
    try {
      if (!doc?.documentElement) {
        return;
      }
      if (!open) {
        doc.documentElement.classList.remove("zotero-ai-reading-pane-open");
        doc.documentElement.style.removeProperty("--zai-reader-ai-pane-width");
        this.applyReaderPaneInlineLayout(doc, "", false);
        return;
      }
      let width = pane?.getBoundingClientRect?.().width || 520;
      let widthValue = Math.ceil(width) + "px";
      doc.documentElement.style.setProperty("--zai-reader-ai-pane-width", widthValue);
      doc.documentElement.classList.add("zotero-ai-reading-pane-open");
      this.applyReaderPaneInlineLayout(doc, widthValue, true);
    }
    catch (error) {
      this.log("setReaderPaneOpen failed: " + (error.stack || error.message || String(error)));
    }
  },

  applyReaderPaneInlineLayout(doc, widthValue, open) {
    try {
      let ids = ["outerContainer", "mainContainer", "toolbarContainer"];
      for (let id of ids) {
        let element = doc.getElementById(id);
        if (!element) {
          continue;
        }
        if (open) {
          element.style.setProperty("right", widthValue, "important");
        }
        else {
          element.style.removeProperty("right");
        }
      }
      if (doc.body) {
        if (open) {
          doc.body.style.setProperty("padding-right", widthValue, "important");
          doc.body.style.setProperty("box-sizing", "border-box", "important");
        }
        else {
          doc.body.style.removeProperty("padding-right");
          doc.body.style.removeProperty("box-sizing");
        }
      }
    }
    catch (error) {
      this.log("applyReaderPaneInlineLayout failed: " + (error.stack || error.message || String(error)));
    }
  },

  resetLegacyReaderPaneLayout(doc) {
    try {
      if (!doc) {
        return;
      }
      doc.getElementById(this.READER_PANE_ID)?.remove();
      this.setReaderPaneOpen(doc, null, false);
      doc.documentElement?.classList?.remove("zotero-ai-reading-pane-open");
      doc.documentElement?.style?.removeProperty("--zai-reader-ai-pane-width");
      for (let id of ["outerContainer", "mainContainer", "toolbarContainer", "viewerContainer"]) {
        doc.getElementById(id)?.style?.removeProperty("right");
      }
      if (doc.body) {
        doc.body.style.removeProperty("padding-right");
        doc.body.style.removeProperty("box-sizing");
      }
    }
    catch (error) {
      this.log("resetLegacyReaderPaneLayout failed: " + (error.stack || error.message || String(error)));
    }
  },

  scheduleReaderContentAnchorRestore(reader, anchor) {
    try {
      this.resetReaderOuterHorizontalScroll(reader);
      if (!anchor) {
        return;
      }
      this.restoreReaderContentAnchor(reader, anchor);
      let win = reader?._window || reader?._iframeWindow;
      if (!win?.setTimeout) {
        return;
      }
      for (let delay of [50, 150, 350, 800, 1600]) {
        win.setTimeout(() => this.restoreReaderContentAnchor(reader, anchor), delay);
      }
    }
    catch (error) {
      this.log("scheduleReaderContentAnchorRestore failed: " + (error.stack || error.message || String(error)));
    }
  },

  captureReaderContentAnchor(reader) {
    try {
      for (let doc of this.getReaderPDFDocuments(reader)) {
        let element = this.findReaderPDFAnchorElement(doc);
        if (!element) {
          continue;
        }
        let rect = this.getElementGlobalRect(element);
        return {
          pageNumber: element.getAttribute?.("data-page-number") || "",
          left: rect.left,
          element,
          viewerContainer: doc.getElementById("viewerContainer")
        };
      }
    }
    catch (error) {
      this.log("captureReaderContentAnchor failed: " + (error.stack || error.message || String(error)));
    }
    return null;
  },

  restoreReaderContentAnchor(reader, anchor) {
    try {
      this.resetReaderOuterHorizontalScroll(reader);
      if (!anchor) {
        return;
      }
      let element = anchor.element;
      if (!element?.isConnected) {
        element = this.findReaderPDFAnchorElementForAnchor(reader, anchor);
      }
      if (!element) {
        return;
      }
      let viewerContainer =
        anchor.viewerContainer?.isConnected ? anchor.viewerContainer : element.ownerDocument?.getElementById?.("viewerContainer");
      if (!viewerContainer) {
        return;
      }

      let rect = this.getElementGlobalRect(element);
      let delta = rect.left - anchor.left;
      if (Math.abs(delta) < 0.5) {
        return;
      }
      let maxScrollLeft = Math.max(0, viewerContainer.scrollWidth - viewerContainer.clientWidth);
      let nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, viewerContainer.scrollLeft + delta));
      viewerContainer.scrollLeft = nextScrollLeft;
    }
    catch (error) {
      this.log("restoreReaderContentAnchor failed: " + (error.stack || error.message || String(error)));
    }
  },

  resetReaderOuterHorizontalScroll(reader) {
    try {
      let docs = [
        reader?._iframeWindow?.document,
        reader?._window?.document,
        reader?._iframe?.ownerDocument
      ].filter(Boolean);
      for (let doc of docs) {
        try {
          doc.defaultView?.scrollTo?.(0, doc.defaultView?.scrollY || 0);
        }
        catch (_) {}
        if (doc.documentElement) {
          doc.documentElement.scrollLeft = 0;
        }
        if (doc.body) {
          doc.body.scrollLeft = 0;
        }
      }
    }
    catch (error) {
      this.log("resetReaderOuterHorizontalScroll failed: " + (error.stack || error.message || String(error)));
    }
  },

  findReaderPDFAnchorElementForAnchor(reader, anchor) {
    for (let doc of this.getReaderPDFDocuments(reader)) {
      if (anchor.pageNumber) {
        let page = doc.querySelector?.('.page[data-page-number="' + anchor.pageNumber + '"]');
        if (page) {
          return page;
        }
      }
      let element = this.findReaderPDFAnchorElement(doc);
      if (element) {
        return element;
      }
    }
    return null;
  },

  findReaderPDFAnchorElement(doc) {
    try {
      let viewerContainer = doc.getElementById("viewerContainer");
      let pages = Array.from(doc.querySelectorAll?.(".page[data-page-number], .page") || []);
      if (pages.length) {
        let viewportRect = viewerContainer?.getBoundingClientRect?.() || { top: 0, bottom: doc.defaultView?.innerHeight || 0 };
        let targetY = viewportRect.top + Math.max(40, (viewportRect.bottom - viewportRect.top) * 0.25);
        let visible = pages
          .map((page) => ({ page, rect: page.getBoundingClientRect() }))
          .filter(({ rect }) => rect.bottom > viewportRect.top && rect.top < viewportRect.bottom);
        let candidate = visible.find(({ rect }) => rect.top <= targetY && rect.bottom >= targetY) || visible[0];
        if (candidate?.page) {
          return candidate.page;
        }
        return pages[0];
      }
      return doc.getElementById("viewer") || doc.querySelector?.(".pdfViewer") || null;
    }
    catch (_) {
      return null;
    }
  },

  getElementGlobalRect(element) {
    let rect = element.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    let win = element.ownerDocument?.defaultView;
    try {
      while (win?.frameElement) {
        let frameRect = win.frameElement.getBoundingClientRect();
        left += frameRect.left;
        top += frameRect.top;
        win = win.frameElement.ownerDocument?.defaultView;
      }
    }
    catch (_) {}
    return { left, top, width: rect.width, height: rect.height };
  },

  getReaderPDFDocuments(reader) {
    let docs = [];
    let addDoc = (doc) => {
      if (doc && !docs.includes(doc)) {
        docs.push(doc);
      }
    };

    try {
      addDoc(reader?._internalReader?._primaryView?._iframeWindow?.document);
      addDoc(reader?._internalReader?._primaryView?._iframeDocument);
    }
    catch (_) {}

    try {
      let outerDoc = reader?._iframeWindow?.document;
      for (let frame of Array.from(outerDoc?.querySelectorAll?.("iframe") || [])) {
        try {
          addDoc(frame.contentDocument);
        }
        catch (_) {}
      }
    }
    catch (_) {}

    return docs.filter((doc) => doc.getElementById?.("viewer") || doc.querySelector?.(".pdfViewer"));
  },

  injectReaderPaneStyle(doc) {
    try {
      let style = doc.getElementById("zotero-ai-reading-reader-style");
      if (!style) {
        style = doc.createElementNS(this.HTML_NS, "style");
        style.id = "zotero-ai-reading-reader-style";
        (doc.head || doc.documentElement).appendChild(style);
      }
      style.textContent = [
        "html,body{max-width:100%!important;overflow-x:hidden!important;}",
        "#toolbarContainer,.toolbar{max-width:100%!important;overflow-x:hidden!important;}",
        ".toolbar .end{min-width:0!important;}",
        ".zai-reader-toolbar-button{height:28px;min-width:34px;margin:0 3px;padding:0 8px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;line-height:1;border:1px solid var(--fill-quarternary,rgba(128,128,128,.35));border-radius:6px;background:var(--fill-quinary,rgba(128,128,128,.12));color:var(--fill-primary,currentColor);font-weight:700;font-size:12px;cursor:pointer;vertical-align:middle;}",
        ".zai-reader-toolbar-button:hover{background:var(--fill-quarternary,rgba(128,128,128,.20));}"
      ].join("\n");
    }
    catch (error) {
      this.log("injectReaderPaneStyle failed: " + (error.stack || error.message || String(error)));
    }
  },

  injectReaderChromePaneStyle(doc) {
    try {
      let style = doc.getElementById("zotero-ai-reading-reader-chrome-style");
      if (!style) {
        style = doc.createElementNS(this.HTML_NS, "style");
        style.id = "zotero-ai-reading-reader-chrome-style";
        (doc.head || doc.documentElement).appendChild(style);
      }
      style.textContent = [
        ".zai-reader-ai-layout{display:flex!important;flex-direction:row!important;min-width:0!important;min-height:0!important;overflow:hidden!important;}",
        ".zai-reader-ai-layout>.reader,.zai-reader-ai-layout>#zotero-reader{flex:1 1 auto!important;min-width:0!important;min-height:0!important;}",
        ".zai-reader-ai-splitter{flex:0 0 6px!important;width:6px!important;min-width:6px!important;cursor:ew-resize;background:var(--fill-quinary,rgba(128,128,128,.10));border-left:1px solid var(--fill-quarternary,rgba(128,128,128,.25));}",
        ".zai-reader-ai-splitter:hover,.zai-reader-ai-resizing .zai-reader-ai-splitter{background:var(--accent-blue,#2563eb);}",
        ".zai-reader-ai-resizing .reader,.zai-reader-ai-resizing .zai-reader-ai-browser{pointer-events:none!important;}",
        ".zai-reader-ai-pane{display:flex!important;flex-direction:column!important;flex:0 0 520px;width:520px;min-width:320px;max-width:900px;min-height:0;overflow:hidden;background:var(--material-sidepane,#fff);color:var(--fill-primary,#111);border-left:1px solid var(--fill-quarternary,rgba(128,128,128,.35));box-shadow:-8px 0 24px rgba(0,0,0,.16);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;}",
        ".zai-reader-ai-header{min-height:42px;padding:0 10px;border-bottom:1px solid var(--fill-quarternary,rgba(128,128,128,.25));}",
        ".zai-reader-ai-title{gap:8px;font-weight:650;font-size:13px;white-space:nowrap;}",
        ".zai-reader-ai-badge{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;background:#2563eb;color:#fff;font-size:11px;font-weight:800;}",
        ".zai-reader-ai-actions{gap:6px;}",
        ".zai-reader-ai-actions button{min-height:24px;font-size:12px;}",
        ".zai-reader-ai-frame,.zai-reader-ai-browser{width:100%;min-width:0;min-height:0;border:0;background:#fff;}",
        "@media (max-width:1100px){.zai-reader-ai-pane{min-width:300px;}}"
      ].join("\n");
    }
    catch (error) {
      this.log("injectReaderChromePaneStyle failed: " + (error.stack || error.message || String(error)));
    }
  },

  async getAttachmentText(attachment, maxTextChars) {
    let text = "";

    try {
      text = (await attachment.attachmentText) || "";
    }
    catch (error) {
      this.log(error.stack || error.message || String(error));
    }

    text = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length > maxTextChars) {
      text =
        text.slice(0, maxTextChars) +
        "\n\n[Text truncated by Zotero AI Reading at " +
        maxTextChars +
        " characters.]";
    }
    return text;
  },

  getItemMetadata(item) {
    return {
      title: this.safeField(item, "title"),
      authors: this.getCreatorString(item),
      year: this.safeField(item, "year") || this.extractYear(this.safeField(item, "date")),
      date: this.safeField(item, "date"),
      doi: this.safeField(item, "DOI"),
      abstractNote: this.safeField(item, "abstractNote"),
      itemKey: item.key || "",
      libraryID: item.libraryID ? String(item.libraryID) : ""
    };
  },

  safeField(item, field) {
    try {
      return item.getField(field) || "";
    }
    catch (_) {
      return "";
    }
  },

  getCreatorString(item) {
    try {
      return item
        .getCreators()
        .map((creator) => {
          let parts = [creator.firstName, creator.lastName].filter(Boolean);
          return parts.length ? parts.join(" ") : creator.name || "";
        })
        .filter(Boolean)
        .join(", ");
    }
    catch (_) {
      return "";
    }
  },

  extractYear(date) {
    let match = String(date || "").match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/);
    return match ? match[1] : "";
  },

  renderTemplate(template, data) {
    return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] || "" : match;
    });
  },

  async getGoogleDriveLinks(pdfPath) {
    try {
      let fileID =
        await this.getGoogleDriveFileIDFromXAttr(pdfPath) ||
        this.getGoogleDriveFileID(pdfPath);
      if (fileID) {
        let viewURL = "https://drive.google.com/file/d/" + encodeURIComponent(fileID) + "/view";
        return {
          downloadURL: viewURL,
          viewURL
        };
      }
      let searchURL = this.getGoogleDriveSearchLink(pdfPath);
      return {
        downloadURL: searchURL,
        viewURL: searchURL
      };
    }
    catch (error) {
      this.log("getGoogleDriveLinks failed: " + (error.stack || error.message || String(error)));
      return {
        downloadURL: "",
        viewURL: ""
      };
    }
  },

  async getGoogleDriveFileIDFromXAttr(pdfPath) {
    let outputFile = this.getTempFile("zotero-ai-reading-drive-id");
    try {
      let command =
        "/usr/bin/xattr -p " +
        this.shellQuote("com.google.drivefs.item-id#S") +
        " " +
        this.shellQuote(pdfPath) +
        " > " +
        this.shellQuote(outputFile.path) +
        " 2>/dev/null";
      this.runShellCommand(command);

      let value = (await Zotero.File.getContentsAsync(outputFile.path)).trim();
      return this.normalizeGoogleDriveID(value);
    }
    catch (error) {
      this.log("getGoogleDriveFileIDFromXAttr failed: " + (error.stack || error.message || String(error)));
      return "";
    }
    finally {
      try {
        if (outputFile.exists()) {
          outputFile.remove(false);
        }
      }
      catch (_) {}
    }
  },

  normalizeGoogleDriveID(value) {
    let text = String(value || "").trim();
    let match = text.match(/[A-Za-z0-9_-]{10,}/);
    return match ? match[0] : "";
  },

  getTempFile(prefix) {
    let dirService = Cc["@mozilla.org/file/directory_service;1"].getService(Ci.nsIProperties);
    let file = dirService.get("TmpD", Ci.nsIFile);
    let suffix = Date.now() + "-" + Math.floor(Math.random() * 1000000) + ".txt";
    file.append(prefix + "-" + suffix);
    return file;
  },

  runShellCommand(command) {
    let executable = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    executable.initWithPath("/bin/sh");
    let process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    process.init(executable);
    let args = ["-c", command];
    process.run(true, args, args.length);
  },

  shellQuote(value) {
    return "'" + String(value || "").replace(/'/g, "'\"'\"'") + "'";
  },

  getGoogleDriveSearchLink(pdfPath) {
    let fileName = this.getFileName(pdfPath);
    return "https://drive.google.com/drive/search?q=" + encodeURIComponent(fileName);
  },

  getGoogleDriveFileID(pdfPath) {
    let drivePath = this.parseGoogleDrivePath(pdfPath);
    if (!drivePath) {
      return "";
    }

    for (let dbFile of this.getDriveFSMetadataDBs()) {
      let fileID = this.lookupDriveFileID(dbFile, drivePath.parts);
      if (fileID) {
        return fileID;
      }
    }

    return "";
  },

  parseGoogleDrivePath(pdfPath) {
    let marker = "/Library/CloudStorage/";
    let index = String(pdfPath || "").indexOf(marker);
    if (index === -1) {
      return null;
    }

    let relative = pdfPath.slice(index + marker.length).split("/").filter(Boolean);
    if (!relative[0]?.startsWith("GoogleDrive-")) {
      return null;
    }

    let driveRoot = relative[1];
    if (driveRoot !== "My Drive" && driveRoot !== "我的云端硬盘") {
      return null;
    }

    let parts = relative.slice(2);
    return parts.length ? { parts } : null;
  },

  getDriveFSMetadataDBs() {
    let results = [];
    try {
      let dirService = Cc["@mozilla.org/file/directory_service;1"].getService(Ci.nsIProperties);
      let driveFS = dirService.get("Home", Ci.nsIFile);
      for (let part of ["Library", "Application Support", "Google", "DriveFS"]) {
        driveFS.append(part);
      }
      if (!driveFS.exists() || !driveFS.isDirectory()) {
        return results;
      }

      let entries = driveFS.directoryEntries;
      while (entries.hasMoreElements()) {
        let entry = entries.getNext().QueryInterface(Ci.nsIFile);
        if (!entry.isDirectory()) {
          continue;
        }
        let dbFile = entry.clone();
        dbFile.append("metadata_sqlite_db");
        if (dbFile.exists() && dbFile.isFile()) {
          results.push(dbFile);
        }
      }
    }
    catch (error) {
      this.log("getDriveFSMetadataDBs failed: " + (error.stack || error.message || String(error)));
    }
    return results;
  },

  lookupDriveFileID(dbFile, pathParts) {
    let db = null;
    try {
      let storage = Cc["@mozilla.org/storage/service;1"].getService(Ci.mozIStorageService);
      db = storage.openDatabase(dbFile);

      let parentID = this.getMyDriveStableID(db);
      if (!parentID) {
        return "";
      }

      let child = null;
      for (let i = 0; i < pathParts.length; i++) {
        let isLast = i === pathParts.length - 1;
        child = this.findDriveChild(db, parentID, pathParts[i], !isLast);
        if (!child) {
          return "";
        }
        if (!isLast && !child.isFolder) {
          return "";
        }
        parentID = child.stableID;
      }

      return child?.cloudID || "";
    }
    catch (error) {
      this.log("lookupDriveFileID failed: " + (error.stack || error.message || String(error)));
      return "";
    }
    finally {
      try {
        db?.close();
      }
      catch (_) {}
    }
  },

  getMyDriveStableID(db) {
    let sql =
      "SELECT stable_id FROM items " +
      "WHERE is_folder=1 AND local_title IN ('My Drive', '我的云端硬盘') " +
      "ORDER BY stable_id LIMIT 1";
    let stableID = this.querySingleStableID(db, sql, {});
    if (stableID) {
      return stableID;
    }

    sql =
      "SELECT i.stable_id FROM items i " +
      "LEFT JOIN stable_parents sp ON i.stable_id=sp.item_stable_id " +
      "WHERE i.is_folder=1 AND sp.parent_stable_id IS NULL " +
      "ORDER BY i.stable_id LIMIT 1";
    return this.querySingleStableID(db, sql, {});
  },

  querySingleStableID(db, sql, params) {
    let stmt = db.createStatement(sql);
    try {
      this.bindStatementParams(stmt, params);
      if (stmt.executeStep()) {
        return Number(stmt.getInt64(0));
      }
    }
    finally {
      stmt.finalize();
    }
    return 0;
  },

  findDriveChild(db, parentID, title, requireFolder) {
    let sql =
      "SELECT i.stable_id, i.id, i.local_title, i.is_folder FROM items i " +
      "JOIN stable_parents sp ON i.stable_id=sp.item_stable_id " +
      "WHERE sp.parent_stable_id=:parentID AND i.local_title=:title " +
      "AND i.trashed=0 AND i.is_tombstone=0 " +
      (requireFolder ? "AND i.is_folder=1 " : "") +
      "ORDER BY i.is_folder DESC, i.modified_date DESC LIMIT 5";
    let exact = this.queryDriveChildren(db, sql, { parentID, title });
    if (exact.length) {
      return exact[0];
    }

    sql =
      "SELECT i.stable_id, i.id, i.local_title, i.is_folder FROM items i " +
      "JOIN stable_parents sp ON i.stable_id=sp.item_stable_id " +
      "WHERE sp.parent_stable_id=:parentID AND i.trashed=0 AND i.is_tombstone=0 " +
      (requireFolder ? "AND i.is_folder=1 " : "") +
      "ORDER BY i.is_folder DESC, i.modified_date DESC";
    let normalizedTitle = title.normalize("NFC");
    return this.queryDriveChildren(db, sql, { parentID }).find((child) => {
      return child.title.normalize("NFC") === normalizedTitle;
    }) || null;
  },

  queryDriveChildren(db, sql, params) {
    let stmt = db.createStatement(sql);
    let rows = [];
    try {
      this.bindStatementParams(stmt, params);
      while (stmt.executeStep()) {
        rows.push({
          stableID: Number(stmt.getInt64(0)),
          cloudID: stmt.getString(1),
          title: stmt.getString(2),
          isFolder: Boolean(stmt.getInt32(3))
        });
      }
    }
    finally {
      stmt.finalize();
    }
    return rows;
  },

  bindStatementParams(stmt, params) {
    for (let [key, value] of Object.entries(params || {})) {
      stmt.params[key] = value;
    }
  },

  getFileName(path) {
    let parts = String(path || "").split("/");
    return parts[parts.length - 1] || String(path || "");
  },

  preparePDFUploadPath(pdfPath, attachment = null) {
    try {
      let source = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      source.initWithPath(String(pdfPath || ""));
      if (!source.exists() || !source.isFile()) {
        return pdfPath;
      }

      let tempDir = Services.dirsvc.get("TmpD", Ci.nsIFile);
      tempDir.append("zotero-ai-reading-uploads");
      if (!tempDir.exists()) {
        tempDir.create(Ci.nsIFile.DIRECTORY_TYPE, 0o700);
      }

      let stablePart = [
        attachment?.libraryID || attachment?.library?.libraryID || "",
        attachment?.key || attachment?.id || this.hashStringForFilename(pdfPath)
      ].join("-");
      stablePart = String(stablePart || "")
        .replace(/[^A-Za-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || this.hashStringForFilename(pdfPath);
      let safeName = "zotero-ai-reading-" + stablePart + ".pdf";

      let target = tempDir.clone();
      target.append(safeName);
      if (target.exists()) {
        try {
          if (
            target.isFile() &&
            target.fileSize === source.fileSize &&
            target.lastModifiedTime >= source.lastModifiedTime
          ) {
            return target.path;
          }
        }
        catch (_) {}
        try {
          target.remove(false);
        }
        catch (_) {}
      }
      if (this.createHardLink(source.path, target.path) && target.exists()) {
        return target.path;
      }
      if (this.copyFileToUploadPath(source, target) && target.exists()) {
        return target.path;
      }
      return source.path;
    }
    catch (error) {
      this.log("preparePDFUploadPath failed: " + (error.stack || error.message || String(error)));
      return pdfPath;
    }
  },

  createHardLink(sourcePath, targetPath) {
    try {
      let executable = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      executable.initWithPath("/bin/ln");
      let process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
      process.init(executable);
      let args = [String(sourcePath || ""), String(targetPath || "")];
      process.run(true, args, args.length);
      return process.exitValue === 0;
    }
    catch (error) {
      this.log("createHardLink failed: " + (error.stack || error.message || String(error)));
      return false;
    }
  },

  copyFileToUploadPath(source, target) {
    try {
      if (!source?.exists?.() || !source.isFile()) {
        return false;
      }
      let parent = target.parent;
      let leafName = target.leafName;
      source.copyTo(parent, leafName);
      if (!target.exists() || !target.isFile()) {
        return false;
      }
      try {
        target.lastModifiedTime = source.lastModifiedTime;
      }
      catch (_) {}
      return target.fileSize === source.fileSize;
    }
    catch (error) {
      this.log("copyFileToUploadPath failed: " + (error.stack || error.message || String(error)));
      return false;
    }
  },

  hashStringForFilename(value) {
    let hash = 0;
    let text = String(value || "");
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
  },

  isAutoPasteTarget(aiURL) {
    return /^https?:\/\//i.test(String(aiURL || ""));
  },

  scheduleAutoPaste(aiURL, options = {}) {
    let delay = Object.prototype.hasOwnProperty.call(options, "delayMs")
      ? Math.max(0, Number(options.delayMs) || 0)
      : Math.max(1000, this.getIntPref("pasteDelayMs"));
    let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    let callback = () => {
      try {
        this.pasteIntoBrowser(aiURL, options);
      }
      finally {
        this.pasteTimers = this.pasteTimers.filter((candidate) => candidate !== timer);
      }
    };
    timer.initWithCallback(callback, delay, Ci.nsITimer.TYPE_ONE_SHOT);
    this.pasteTimers.push(timer);
  },

  scheduleReaderPanePaste(reader, options = {}) {
    let delay = Math.max(1000, this.getIntPref("pasteDelayMs"));
    let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    let callback = () => {
      Promise.resolve().then(async () => {
        let targetReader = reader || this.lastReaderPaneReader;
        if (!(await this.pasteIntoSpecialReaderPane(targetReader, options))) {
          let aiURL = options.aiURL || this.getReaderPaneURL(targetReader) || this.getAIURL();
          await this.waitForReaderPaneEditorReady(targetReader);
          this.focusReaderPaneFrame(targetReader);
          this.focusClaudeEditorInReaderPane(targetReader);
          this.pasteWithOptions(aiURL, true, Object.assign({}, options, { readerPaneReader: targetReader }));
        }
      }).catch((error) => {
        this.log("scheduleReaderPanePaste failed: " + (error.stack || error.message || String(error)));
      }).finally(() => {
        this.pasteTimers = this.pasteTimers.filter((candidate) => candidate !== timer);
      });
    };
    timer.initWithCallback(callback, delay, Ci.nsITimer.TYPE_ONE_SHOT);
    this.pasteTimers.push(timer);
  },

  scheduleReaderPanePasteWhenEditorReady(reader, options = {}) {
    let targetReader = reader || this.lastReaderPaneReader;
    let startedAt = Date.now();
    let isChatGLM = this.isChatGLMURL(options.aiURL);
    let isFreshGLMPage = isChatGLM && (options.forceNewConversation || options.readerPaneLoadedFresh);
    let maxWaitMs = isChatGLM ? (isFreshGLMPage ? 30000 : 18000) : 15000;
    let pollDelayMs = isChatGLM ? 700 : 500;
    let readyTimeoutMs = isChatGLM ? 1800 : 900;
    let readyAttempts = isChatGLM ? 8 : 2;

    let tryPaste = () => {
      Promise.resolve(this.waitForReaderPaneEditorReady(targetReader, readyTimeoutMs, readyAttempts))
        .then((ready) => {
          if (ready) {
            this.pasteIntoReaderPane(targetReader, options);
            return;
          }
          if (Date.now() - startedAt >= maxWaitMs) {
            this.log("Reader pane editor did not report ready before paste timeout; attempting one final paste");
            this.pasteIntoReaderPane(targetReader, options);
            return;
          }
          this.schedulePasteTimer(tryPaste, pollDelayMs);
        })
        .catch((error) => {
          this.log("scheduleReaderPanePasteWhenEditorReady failed: " + (error.stack || error.message || String(error)));
          this.pasteIntoReaderPane(targetReader, options);
        });
    };

    this.schedulePasteTimer(tryPaste, isFreshGLMPage ? 600 : 300);
  },

  getReaderPaneFrameForReader(reader) {
    try {
      let container = this.getReaderChromeWrapper(reader);
      let pane = container?.querySelector?.(".zai-reader-ai-pane");
      if (!pane) {
        pane = (reader?._window?.document || reader?._iframe?.ownerDocument)?.getElementById?.(this.getReaderPaneID(reader));
      }
      return this.getReaderPaneWebView(pane);
    }
    catch (_) {
      return null;
    }
  },

  async pasteIntoReaderPane(reader, options = {}) {
    try {
      if (reader?._window?.focus) {
        reader._window.focus();
      }
      if (!(await this.pasteIntoSpecialReaderPane(reader, options))) {
        let aiURL = options.aiURL || this.getReaderPaneURL(reader) || this.getAIURL();
        await this.waitForReaderPaneEditorReady(reader);
        this.focusReaderPaneFrame(reader);
        this.focusClaudeEditorInReaderPane(reader);
        this.pasteWithOptions(aiURL, true, Object.assign({}, options, { readerPaneReader: reader }));
      }
    }
    catch (error) {
      this.log("pasteIntoReaderPane failed: " + (error.stack || error.message || String(error)));
    }
  },

  async pasteIntoSpecialReaderPane(reader, options = {}) {
    if (this.shouldUseChatGLMReaderPaneClipboard(reader, options)) {
      return this.pasteIntoChatGLMReaderPane(reader, options);
    }

    if (this.shouldUseGeminiReaderPanePaste(reader, options)) {
      return this.pasteIntoGeminiReaderPane(reader, options);
    }

    if (!this.shouldUseClaudeReaderPaneClipboard(reader, options)) {
      return false;
    }

    if (options.transferMode === "file" && options.pdfPath) {
      if (!this.pastePDFFileClipboardIntoClaudeReaderPane(reader, options.pdfPath)) {
        return false;
      }
      if (options.prompt) {
        this.pasteTextClipboardIntoClaudeReaderPane(reader, options.prompt, 2600);
      }
      return true;
    }

    return this.pasteTextClipboardIntoClaudeReaderPane(reader, options.prompt || "", 600);
  },

  async pasteIntoChatGLMReaderPane(reader, options = {}) {
    try {
      if (!options.prompt) {
        return false;
      }

      if (options.transferMode === "file" && options.pdfPath) {
        let uploaded =
          await this.uploadPDFFileIntoReaderPaneByDOM(reader, options.pdfPath) ||
          await this.pastePDFFileClipboardIntoFocusedReaderPane(reader, options.pdfPath);
        if (!uploaded) {
          this.log("ChatGLM PDF upload was not detected; prompt paste skipped to avoid text-only state");
          return true;
        }
        this.schedulePasteTimer(() => {
          Promise.resolve(this.insertTextIntoReaderPaneEditor(reader, options.prompt))
            .then(() => this.closeChatGLMTransientUI(reader))
            .catch((error) => {
              this.log("insert ChatGLM prompt failed: " + (error.stack || error.message || String(error)));
            });
        }, 2600);
        return true;
      }

      return this.insertTextIntoReaderPaneEditor(reader, options.prompt);
    }
    catch (error) {
      this.log("pasteIntoChatGLMReaderPane failed: " + (error.stack || error.message || String(error)));
      return false;
    }
  },

  pasteIntoGeminiReaderPane(reader, options = {}) {
    try {
      if (!options.prompt) {
        return false;
      }

      let aiURL = options.aiURL || this.getReaderPaneURL(reader) || this.getAIURL();
      let profile = this.getPasteProfile(aiURL, Object.assign({}, options, { readerPaneReader: reader }));

      if (options.transferMode === "file" && options.pdfPath) {
        if (!this.pastePDFFileClipboardIntoClaudeReaderPane(reader, options.pdfPath)) {
          return false;
        }
        this.pasteTextIntoReaderPaneEditorOrClipboard(reader, options.prompt, profile.promptPasteDelay || 6500);
        return true;
      }

      return this.pasteTextIntoReaderPaneEditorOrClipboard(reader, options.prompt, 600);
    }
    catch (error) {
      this.log("pasteIntoGeminiReaderPane failed: " + (error.stack || error.message || String(error)));
      return false;
    }
  },

  uploadPDFFileIntoReaderPaneByDOM(reader, pdfPath) {
    return new Promise((resolve) => {
      let settled = false;
      let done = (ok) => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          timeoutTimer?.cancel?.();
        }
        catch (_) {}
        try {
          messageManager?.removeMessageListener?.(replyName, onReply);
        }
        catch (_) {}
        resolve(Boolean(ok));
      };

      let frame = null;
      let messageManager = null;
      let replyName = "";
      let onReply = null;
      let timeoutTimer = null;

      try {
        frame = this.getReaderPaneFrameForReader(reader);
        messageManager = frame?.messageManager || frame?.frameLoader?.messageManager;
        if (!messageManager?.loadFrameScript || !messageManager?.sendAsyncMessage || !messageManager?.addMessageListener) {
          done(false);
          return;
        }

        let requestName = "ZoteroAIReading:UploadPDFByDOM:" + Date.now() + ":" + Math.random();
        replyName = requestName + ":Done";
        onReply = (message) => {
          done(Boolean(message?.data?.ok));
        };
        timeoutTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        timeoutTimer.initWithCallback(() => done(false), 22000, Ci.nsITimer.TYPE_ONE_SHOT);
        messageManager.addMessageListener(replyName, onReply);
        let scriptURL =
          "data:application/javascript;charset=utf-8," +
          encodeURIComponent(this.getReaderPanePDFDOMUploadFrameScript(requestName, replyName));
        messageManager.loadFrameScript(scriptURL, false);
        messageManager.sendAsyncMessage(requestName, {
          pdfPath: String(pdfPath || "")
        });
      }
      catch (error) {
        this.log("uploadPDFFileIntoReaderPaneByDOM failed: " + (error.stack || error.message || String(error)));
        done(false);
      }
    });
  },

  async pastePDFFileClipboardIntoFocusedReaderPane(reader, pdfPath) {
    try {
      this.copyPDFFileToClipboard(pdfPath);
      this.focusReaderPaneFrame(reader);
      await this.waitForReaderPaneEditorReady(reader, 2200, 8);
      this.focusReaderPaneFrame(reader);
      this.runAppleScript(this.getPasteAppleScript("", true), true);
      return await this.waitForReaderPanePDFAttachment(reader, pdfPath, 18000);
    }
    catch (error) {
      this.log("pastePDFFileClipboardIntoFocusedReaderPane failed: " + (error.stack || error.message || String(error)));
      return false;
    }
  },

  waitForReaderPanePDFAttachment(reader, pdfPath, timeoutMs = 18000) {
    return new Promise((resolve) => {
      let settled = false;
      let done = (ok) => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          timeoutTimer?.cancel?.();
        }
        catch (_) {}
        try {
          messageManager?.removeMessageListener?.(replyName, onReply);
        }
        catch (_) {}
        resolve(Boolean(ok));
      };

      let frame = null;
      let messageManager = null;
      let replyName = "";
      let onReply = null;
      let timeoutTimer = null;

      try {
        frame = this.getReaderPaneFrameForReader(reader);
        messageManager = frame?.messageManager || frame?.frameLoader?.messageManager;
        if (!messageManager?.loadFrameScript || !messageManager?.sendAsyncMessage || !messageManager?.addMessageListener) {
          done(false);
          return;
        }

        let requestName = "ZoteroAIReading:DetectPDFAttachment:" + Date.now() + ":" + Math.random();
        replyName = requestName + ":Done";
        onReply = (message) => {
          done(Boolean(message?.data?.attached));
        };
        timeoutTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        timeoutTimer.initWithCallback(() => done(false), Math.max(1000, Number(timeoutMs) || 18000), Ci.nsITimer.TYPE_ONE_SHOT);
        messageManager.addMessageListener(replyName, onReply);
        let scriptURL =
          "data:application/javascript;charset=utf-8," +
          encodeURIComponent(this.getReaderPanePDFAttachmentProbeFrameScript(requestName, replyName));
        messageManager.loadFrameScript(scriptURL, false);
        messageManager.sendAsyncMessage(requestName, {
          fileName: this.getFileName(pdfPath)
        });
      }
      catch (error) {
        this.log("waitForReaderPanePDFAttachment failed: " + (error.stack || error.message || String(error)));
        done(false);
      }
    });
  },

  pastePDFFileClipboardIntoClaudeReaderPane(reader, pdfPath) {
    try {
      this.copyPDFFileToClipboard(pdfPath);
      this.focusReaderPaneFrame(reader);
      this.focusClaudeEditorInReaderPane(reader);

      let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
      let callback = () => {
        try {
          this.focusReaderPaneFrame(reader);
          this.focusClaudeEditorInReaderPane(reader);
          this.runAppleScript(this.getPasteAppleScript("", true), true);
        }
        finally {
          this.pasteTimers = this.pasteTimers.filter((candidate) => candidate !== timer);
        }
      };
      timer.initWithCallback(callback, 600, Ci.nsITimer.TYPE_ONE_SHOT);
      this.pasteTimers.push(timer);
      return true;
    }
    catch (error) {
      this.log("pastePDFFileClipboardIntoClaudeReaderPane failed: " + (error.stack || error.message || String(error)));
      return false;
    }
  },

  pasteTextClipboardIntoClaudeReaderPane(reader, prompt, delay = 600) {
    try {
      if (!prompt) {
        return false;
      }

      this.focusReaderPaneFrame(reader);
      this.focusClaudeEditorInReaderPane(reader);

      let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
      let callback = () => {
        try {
          this.copyToClipboard(prompt);
          this.focusReaderPaneFrame(reader);
          this.focusClaudeEditorInReaderPane(reader);
          this.runAppleScript(this.getPasteAppleScript("", true), true);
        }
        finally {
          this.pasteTimers = this.pasteTimers.filter((candidate) => candidate !== timer);
        }
      };
      timer.initWithCallback(callback, Math.max(300, delay), Ci.nsITimer.TYPE_ONE_SHOT);
      this.pasteTimers.push(timer);
      return true;
    }
    catch (error) {
      this.log("pasteTextClipboardIntoClaudeReaderPane failed: " + (error.stack || error.message || String(error)));
      return false;
    }
  },

  pasteTextClipboardIntoReaderPane(reader, prompt, delay = 600) {
    try {
      if (!prompt) {
        return false;
      }

      let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
      let callback = () => {
        try {
          this.copyToClipboard(prompt);
          this.focusReaderPaneFrame(reader);
          this.focusClaudeEditorInReaderPane(reader);
          this.runAppleScript(this.getPasteAppleScript("", true), true);
        }
        finally {
          this.pasteTimers = this.pasteTimers.filter((candidate) => candidate !== timer);
        }
      };
      timer.initWithCallback(callback, Math.max(300, delay), Ci.nsITimer.TYPE_ONE_SHOT);
      this.pasteTimers.push(timer);
      return true;
    }
    catch (error) {
      this.log("pasteTextClipboardIntoReaderPane failed: " + (error.stack || error.message || String(error)));
      return false;
    }
  },

  pasteTextIntoReaderPaneEditorOrClipboard(reader, prompt, delay = 600) {
    try {
      if (!prompt) {
        return false;
      }

      this.schedulePasteTimer(() => {
        Promise.resolve()
          .then(() => {
            this.focusReaderPaneFrame(reader);
            this.focusClaudeEditorInReaderPane(reader);
            return this.insertTextIntoReaderPaneEditorWithRetry(reader, prompt, 3, 900);
          })
          .then((inserted) => {
            if (inserted) {
              return;
            }
            this.log("Reader pane direct text insert failed; falling back to clipboard paste");
            this.pasteTextClipboardIntoReaderPane(reader, prompt, 300);
          })
          .catch((error) => {
            this.log("pasteTextIntoReaderPaneEditorOrClipboard failed: " + (error.stack || error.message || String(error)));
            this.pasteTextClipboardIntoReaderPane(reader, prompt, 300);
          });
      }, Math.max(300, delay));
      return true;
    }
    catch (error) {
      this.log("pasteTextIntoReaderPaneEditorOrClipboard failed: " + (error.stack || error.message || String(error)));
      return false;
    }
  },

  shouldUseClaudeReaderPaneClipboard(reader, options = {}) {
    if (!options.prompt) {
      return false;
    }
    let aiURL = options.aiURL || this.getReaderPaneURL(reader) || this.getAIURL();
    return this.isClaudeURL(aiURL);
  },

  shouldUseGeminiReaderPanePaste(reader, options = {}) {
    void reader;
    void options;
    return false;
  },

  shouldUseChatGLMReaderPaneClipboard(reader, options = {}) {
    if (!options.prompt) {
      return false;
    }
    let aiURL = options.aiURL || this.getReaderPaneURL(reader) || this.getAIURL();
    return this.isChatGLMURL(aiURL);
  },

  insertTextIntoReaderPaneEditorWithRetry(reader, text, attempts = 3, retryDelay = 900) {
    return new Promise((resolve) => {
      let attemptIndex = 0;
      let tryInsert = () => {
        Promise.resolve(this.insertTextIntoReaderPaneEditor(reader, text))
          .then((ok) => {
            if (ok) {
              resolve(true);
              return;
            }
            if (attemptIndex + 1 >= Math.max(1, attempts)) {
              this.log("Reader pane text insert was not verified");
              resolve(false);
              return;
            }
            attemptIndex++;
            this.schedulePasteTimer(tryInsert, retryDelay);
          })
          .catch((error) => {
            this.log("insertTextIntoReaderPaneEditorWithRetry attempt failed: " + (error.stack || error.message || String(error)));
            if (attemptIndex + 1 >= Math.max(1, attempts)) {
              resolve(false);
              return;
            }
            attemptIndex++;
            this.schedulePasteTimer(tryInsert, retryDelay);
          });
      };
      tryInsert();
    });
  },

  insertTextIntoReaderPaneEditor(reader, text) {
    return new Promise((resolve) => {
      let settled = false;
      let done = (ok) => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          timeoutTimer?.cancel?.();
        }
        catch (_) {}
        try {
          messageManager?.removeMessageListener?.(replyName, onReply);
        }
        catch (_) {}
        resolve(Boolean(ok));
      };

      let frame = null;
      let messageManager = null;
      let replyName = "";
      let onReply = null;
      let timeoutTimer = null;

      try {
        frame = this.getReaderPaneFrameForReader(reader);
        messageManager = frame?.messageManager || frame?.frameLoader?.messageManager;
        if (!messageManager?.loadFrameScript || !messageManager?.sendAsyncMessage || !messageManager?.addMessageListener) {
          done(false);
          return;
        }

        let requestName = "ZoteroAIReading:InsertEditorText:" + Date.now() + ":" + Math.random();
        replyName = requestName + ":Done";
        onReply = (message) => {
          done(Boolean(message?.data?.ok));
        };
        timeoutTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        timeoutTimer.initWithCallback(() => done(false), 5000, Ci.nsITimer.TYPE_ONE_SHOT);
        messageManager.addMessageListener(replyName, onReply);
        let scriptURL =
          "data:application/javascript;charset=utf-8," +
          encodeURIComponent(this.getReaderPaneTextInsertFrameScript(requestName, replyName));
        messageManager.loadFrameScript(scriptURL, false);
        messageManager.sendAsyncMessage(requestName, { text: String(text || "") });
      }
      catch (error) {
        this.log("insertTextIntoReaderPaneEditor failed: " + (error.stack || error.message || String(error)));
        done(false);
      }
    });
  },

  closeChatGLMTransientUI(reader) {
    try {
      let frame = this.getReaderPaneFrameForReader(reader);
      let messageManager = frame?.messageManager || frame?.frameLoader?.messageManager;
      if (!messageManager?.loadFrameScript || !messageManager?.sendAsyncMessage) {
        return false;
      }

      let messageName = "ZoteroAIReading:CloseChatGLMTransientUI:" + Date.now() + ":" + Math.random();
      let scriptURL =
        "data:application/javascript;charset=utf-8," +
        encodeURIComponent(this.getChatGLMCloseTransientUIFrameScript(messageName));
      messageManager.loadFrameScript(scriptURL, false);
      messageManager.sendAsyncMessage(messageName, {});
      return true;
    }
    catch (error) {
      this.log("closeChatGLMTransientUI failed: " + (error.stack || error.message || String(error)));
      return false;
    }
  },

  shouldAutoPasteIntoResumedChatGLMReaderPane(reader) {
    return new Promise((resolve) => {
      let settled = false;
      let done = (shouldPaste) => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          timeoutTimer?.cancel?.();
        }
        catch (_) {}
        try {
          messageManager?.removeMessageListener?.(replyName, onReply);
        }
        catch (_) {}
        resolve(Boolean(shouldPaste));
      };

      let frame = null;
      let messageManager = null;
      let replyName = "";
      let onReply = null;
      let timeoutTimer = null;

      try {
        frame = this.getReaderPaneFrameForReader(reader);
        messageManager = frame?.messageManager || frame?.frameLoader?.messageManager;
        if (!messageManager?.loadFrameScript || !messageManager?.sendAsyncMessage || !messageManager?.addMessageListener) {
          done(false);
          return;
        }

        let requestName = "ZoteroAIReading:DetectConversationState:" + Date.now() + ":" + Math.random();
        replyName = requestName + ":Done";
        onReply = (message) => {
          let data = message?.data || {};
          done(Boolean(data.ready && !data.hasHistory));
        };
        timeoutTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        timeoutTimer.initWithCallback(() => done(false), 6000, Ci.nsITimer.TYPE_ONE_SHOT);
        messageManager.addMessageListener(replyName, onReply);
        let scriptURL =
          "data:application/javascript;charset=utf-8," +
          encodeURIComponent(this.getReaderPaneConversationStateFrameScript(requestName, replyName));
        messageManager.loadFrameScript(scriptURL, false);
        messageManager.sendAsyncMessage(requestName, {});
      }
      catch (error) {
        this.log("shouldAutoPasteIntoResumedChatGLMReaderPane failed: " + (error.stack || error.message || String(error)));
        done(false);
      }
    });
  },

  getReaderPaneURL(reader) {
    try {
      let frame = this.getReaderPaneFrameForReader(reader);
      return frame?.currentURI?.spec || frame?.getAttribute?.("src") || "";
    }
    catch (_) {
      return "";
    }
  },

  isClaudeURL(aiURL) {
    try {
      let host = new URL(String(aiURL || "")).hostname;
      return host === "claude.ai" || host.endsWith(".claude.ai");
    }
    catch (_) {
      return false;
    }
  },

  focusClaudeEditorInReaderPane(reader) {
    try {
      let frame = this.getReaderPaneFrameForReader(reader);
      let messageManager = frame?.messageManager || frame?.frameLoader?.messageManager;
      if (!messageManager?.loadFrameScript || !messageManager?.sendAsyncMessage) {
        return false;
      }

      let messageName = "ZoteroAIReading:FocusClaudeEditor:" + Date.now() + ":" + Math.random();
      let scriptURL =
        "data:application/javascript;charset=utf-8," +
        encodeURIComponent(this.getClaudeEditorFocusFrameScript(messageName));
      messageManager.loadFrameScript(scriptURL, false);
      messageManager.sendAsyncMessage(messageName, {});
      return true;
    }
    catch (error) {
      this.log("focusClaudeEditorInReaderPane failed: " + (error.stack || error.message || String(error)));
      return false;
    }
  },

  waitForReaderPaneEditorReady(reader, timeoutMs = 5000, attempts = 20) {
    return new Promise((resolve) => {
      let settled = false;
      let done = (ready) => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          timeoutTimer?.cancel?.();
        }
        catch (_) {}
        try {
          messageManager?.removeMessageListener?.(replyName, onReply);
        }
        catch (_) {}
        resolve(Boolean(ready));
      };

      let frame = null;
      let messageManager = null;
      let replyName = "";
      let onReply = null;
      let timeoutTimer = null;

      try {
        frame = this.getReaderPaneFrameForReader(reader);
        messageManager = frame?.messageManager || frame?.frameLoader?.messageManager;
        if (!messageManager?.loadFrameScript || !messageManager?.sendAsyncMessage || !messageManager?.addMessageListener) {
          done(false);
          return;
        }

        let requestName = "ZoteroAIReading:WaitEditor:" + Date.now() + ":" + Math.random();
        replyName = requestName + ":Ready";
        onReply = (message) => {
          done(Boolean(message?.data?.ready));
        };
        timeoutTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        timeoutTimer.initWithCallback(() => done(false), Math.max(300, Number(timeoutMs) || 5000), Ci.nsITimer.TYPE_ONE_SHOT);
        messageManager.addMessageListener(replyName, onReply);
        let scriptURL =
          "data:application/javascript;charset=utf-8," +
          encodeURIComponent(this.getReaderPaneEditorReadyFrameScript(requestName, replyName, attempts));
        messageManager.loadFrameScript(scriptURL, false);
        messageManager.sendAsyncMessage(requestName, {});
      }
      catch (error) {
        this.log("waitForReaderPaneEditorReady failed: " + (error.stack || error.message || String(error)));
        done(false);
      }
    });
  },

  getReaderPanePDFDOMUploadFrameScript(messageName, replyName) {
    return `
(function() {
  const messageName = ${JSON.stringify(messageName)};
  const replyName = ${JSON.stringify(replyName)};

  function normalize(value) {
    return String(value || "")
      .normalize("NFC")
      .replace(/\\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function getFileName(path) {
    const parts = String(path || "").split("/");
    return parts[parts.length - 1] || "document.pdf";
  }

  function isVisible(element) {
    if (!element || !element.getBoundingClientRect) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 5 || rect.height < 5) {
      return false;
    }
    const style = content.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function normalizeEditor(element) {
    if (!element) {
      return null;
    }
    const tag = String(element.tagName || "").toLowerCase();
    if (element.isContentEditable || tag === "textarea" || tag === "input") {
      return element;
    }
    return element.querySelector("textarea, input[type='text'], input:not([type]), [contenteditable], [role='textbox']");
  }

  function getEditorHint(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("data-testid"),
      element.id,
      element.className
    ].map((value) => String(value || "")).join(" ").toLowerCase();
  }

  function scoreEditor(element) {
    const rect = element.getBoundingClientRect();
    const hint = getEditorHint(element);
    const tag = String(element.tagName || "").toLowerCase();
    let score = rect.top;
    if (rect.top > content.innerHeight * 0.45) {
      score += 1000;
    }
    if (rect.width > Math.min(360, content.innerWidth * 0.35)) {
      score += 150;
    }
    if (tag === "textarea" || tag === "input") {
      score += 300;
    }
    if (element.isContentEditable) {
      score += 260;
    }
    if (String(element.getAttribute("role") || "").toLowerCase() === "textbox") {
      score += 220;
    }
    if (/chat|message|prompt|input|ask|textarea|editor|输入|发送|聊聊/.test(hint)) {
      score += 350;
    }
    if (/search|filter|model|上传/.test(hint)) {
      score -= 500;
    }
    return score;
  }

  function findEditor() {
    const selectors = [
      "[data-testid='chat-input']",
      "[data-testid*='chat-input']",
      "[data-testid*='input']",
      "[id*='input']",
      "[class*='input']",
      "[class*='editor']",
      "[class*='textarea']",
      "[aria-label*='Message']",
      "[aria-label*='message']",
      "[aria-label*='Ask']",
      "[aria-label*='ask']",
      "[aria-label*='输入']",
      "[placeholder]",
      "div.ProseMirror[contenteditable='true']",
      "div[role='textbox'][contenteditable='true']",
      "div[role='textbox']",
      "[role='textbox']",
      "[contenteditable]",
      "[contenteditable='true']",
      "textarea",
      "input[type='text']",
      "input:not([type])"
    ];
    const candidates = [];
    for (const selector of selectors) {
      try {
        for (const element of content.document.querySelectorAll(selector)) {
          const editor = normalizeEditor(element);
          if (editor && isVisible(editor)) {
            candidates.push(editor);
          }
        }
      }
      catch (_) {}
    }
    candidates.sort((a, b) => scoreEditor(b) - scoreEditor(a));
    return candidates[0] || null;
  }

	  function focusEditor(editor) {
	    if (!editor) {
	      return;
	    }
    try {
      editor.scrollIntoView({ block: "center", inline: "nearest" });
    }
    catch (_) {}
    try {
      editor.focus({ preventScroll: true });
    }
    catch (_) {
      try {
        editor.focus();
      }
      catch (_) {}
    }
    if (editor.isContentEditable) {
      try {
        const range = editor.ownerDocument.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = content.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
	      catch (_) {}
	    }
	  }

	  function getElementHint(element) {
	    return normalize([
	      element.getAttribute("aria-label"),
	      element.getAttribute("title"),
	      element.getAttribute("placeholder"),
	      element.getAttribute("data-testid"),
	      element.id,
	      element.className,
	      element.innerText || element.textContent
	    ].map((value) => String(value || "")).join(" "));
	  }

	  function dispatchClick(element) {
	    if (!element || !isVisible(element)) {
	      return false;
	    }
	    try {
	      element.scrollIntoView({ block: "center", inline: "nearest" });
	    }
	    catch (_) {}
	    const rect = element.getBoundingClientRect();
	    const eventOptions = {
	      bubbles: true,
	      cancelable: true,
	      composed: true,
	      view: content,
	      clientX: Math.round(rect.left + rect.width / 2),
	      clientY: Math.round(rect.top + rect.height / 2)
	    };
	    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
	      try {
	        element.dispatchEvent(new content.MouseEvent(type, eventOptions));
	      }
	      catch (_) {}
	    }
	    try {
	      element.click();
	    }
	    catch (_) {}
	    return true;
	  }

	  function interactiveAncestor(element) {
	    let current = element;
	    for (let i = 0; current && i < 5; i++) {
	      const tag = String(current.tagName || "").toLowerCase();
	      const role = String(current.getAttribute("role") || "").toLowerCase();
	      const hint = getElementHint(current);
	      if (
	        tag === "button" ||
	        role === "button" ||
	        current.onclick ||
	        current.tabIndex >= 0 ||
	        /button|btn|upload|attach|file|paperclip|附件|上传|文件/.test(hint)
	      ) {
	        return current;
	      }
	      current = current.parentElement;
	    }
	    return element;
	  }

	  function uniqueElements(elements) {
	    const seen = new Set();
	    const result = [];
	    for (const element of elements) {
	      if (!element || seen.has(element)) {
	        continue;
	      }
	      seen.add(element);
	      result.push(element);
	    }
	    return result;
	  }

	  function isForbiddenAttachmentCandidate(element) {
	    const hint = getElementHint(element);
	    return /agent|研究报告|ppt|数据分析|创意海报|网页应用|文档智读|联网模式|alltools|all[-_\s]?tools|tool|config|setting|设置|配置|更多|快速|模式/.test(hint);
	  }

	  function isExplicitAttachmentCandidate(element) {
	    return /attach|attachment|paperclip|upload|file|document|pdf|附件|上传|文件|本地|文档/.test(getElementHint(element));
	  }

	  function isBottomLeftEditorControl(element, editorRect) {
	    if (!editorRect || !isVisible(element) || isForbiddenAttachmentCandidate(element)) {
	      return false;
	    }
	    const rect = element.getBoundingClientRect();
	    const leftDistance = rect.left - editorRect.left;
	    if (rect.width < 12 || rect.height < 12 || rect.width > 74 || rect.height > 74) {
	      return false;
	    }
	    if (leftDistance < -12 || leftDistance > 118) {
	      return false;
	    }
	    if (rect.left > editorRect.left + Math.min(118, editorRect.width * 0.28)) {
	      return false;
	    }
	    if (rect.left > editorRect.right - 140) {
	      return false;
	    }
	    return rect.top >= editorRect.bottom - Math.max(86, editorRect.height * 0.75) && rect.bottom <= editorRect.bottom + 42;
	  }

	  function findAttachmentButton() {
	    const editor = findEditor();
	    const editorRect = editor && editor.getBoundingClientRect ? editor.getBoundingClientRect() : null;
	    if (!editorRect) {
	      return null;
	    }
	    const raw = [];
	    const selectors = [
	      "button",
	      "[role='button']",
	      "[aria-label]",
	      "[title]",
	      "[data-testid]",
	      "[class*='attach']",
	      "[class*='Attach']",
	      "[class*='upload']",
	      "[class*='Upload']",
	      "[class*='file']",
	      "[class*='File']",
	      "svg",
	      "path",
	      "img",
	      "i"
	    ];
	    for (const selector of selectors) {
	      try {
	        for (const element of content.document.querySelectorAll(selector)) {
	          raw.push(interactiveAncestor(element));
	        }
	      }
	      catch (_) {}
	    }
	    const candidates = uniqueElements(raw)
	      .filter((element) => isBottomLeftEditorControl(element, editorRect))
	      .map((element) => ({ element, rect: element.getBoundingClientRect(), explicit: isExplicitAttachmentCandidate(element) }));
	    candidates.sort((a, b) => {
	      if (a.explicit !== b.explicit) {
	        return a.explicit ? -1 : 1;
	      }
	      return a.rect.left - b.rect.left || a.rect.top - b.rect.top || (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height);
	    });
	    if (candidates[0]?.explicit) {
	      return candidates[0].element;
	    }
	    if (candidates.length >= 2) {
	      return candidates[0].element;
	    }
	    return null;
	  }

	  function findLocalFileOption() {
	    const candidates = [];
	    try {
	      for (const element of content.document.querySelectorAll("button, [role='button'], [aria-label], [title], div, span, li")) {
	        if (!isVisible(element)) {
	          continue;
	        }
	        const text = getElementHint(element);
	        if (!/(本地文件选择|本地文件|本地上传|上传文件|local file|upload file)/i.test(text)) {
	          continue;
	        }
	        const rect = element.getBoundingClientRect();
	        candidates.push({ element, area: rect.width * rect.height });
	      }
	    }
	    catch (_) {}
	    candidates.sort((a, b) => a.area - b.area);
	    return candidates[0]?.element || null;
	  }

	  function openChatGLMUploadUI() {
	    let opened = false;
	    const localOption = findLocalFileOption();
	    if (localOption) {
	      opened = dispatchClick(localOption) || opened;
	    }
	    else {
	      const attachButton = findAttachmentButton();
	      if (attachButton) {
	        opened = dispatchClick(attachButton) || opened;
	        content.setTimeout(() => {
	          const option = findLocalFileOption();
	          if (option) {
	            dispatchClick(option);
	          }
	        }, 120);
	      }
	    }
	    return opened;
	  }

	  function createNsFile(pdfPath) {
	    if (typeof Components === "undefined" || !pdfPath) {
	      return null;
	    }
    const file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
    file.initWithPath(pdfPath);
    return file;
  }

  function createDOMFile(pdfPath) {
    const nsFile = createNsFile(pdfPath);
    if (!nsFile) {
      return null;
    }
    try {
      if (content.File && typeof content.File.createFromNsIFile === "function") {
        return content.File.createFromNsIFile(nsFile);
      }
    }
    catch (_) {}
    try {
      if (typeof File !== "undefined" && typeof File.createFromNsIFile === "function") {
        return File.createFromNsIFile(nsFile);
      }
    }
    catch (_) {}
    return nsFile;
  }

  function dispatchInputEvents(input) {
    for (const type of ["input", "change"]) {
      try {
        input.dispatchEvent(new content.Event(type, { bubbles: true }));
      }
      catch (_) {}
    }
  }

  function setFileInput(input, pdfPath) {
    const nsFile = createNsFile(pdfPath);
    const domFile = createDOMFile(pdfPath);
    const targets = [input, input && input.wrappedJSObject].filter(Boolean);
    for (const target of targets) {
      try {
        if (typeof target.mozSetFileNameArray === "function") {
          target.mozSetFileNameArray([pdfPath], 1);
          dispatchInputEvents(input);
          return true;
        }
      }
      catch (_) {}
      try {
        if (typeof target.mozSetFileArray === "function") {
          target.mozSetFileArray([domFile || nsFile]);
          dispatchInputEvents(input);
          return true;
        }
      }
      catch (_) {
        try {
          if (typeof target.mozSetFileArray === "function") {
            target.mozSetFileArray([nsFile]);
            dispatchInputEvents(input);
            return true;
          }
        }
        catch (_) {}
      }
    }
    return false;
  }

  function scoreFileInput(input) {
    const accept = String(input.getAttribute("accept") || "").toLowerCase();
    const hint = [
      input.id,
      input.name,
      input.className,
      input.getAttribute("aria-label"),
      input.getAttribute("data-testid")
    ].map((value) => String(value || "")).join(" ").toLowerCase();
    let score = 0;
    if (/pdf|application\\/pdf|\\*/.test(accept)) {
      score += 200;
    }
    if (/file|upload|attach|document|pdf|上传|附件/.test(hint)) {
      score += 120;
    }
    if (!input.disabled) {
      score += 40;
    }
    return score;
  }

  function findFileInputs() {
    const inputs = Array.from(content.document.querySelectorAll("input[type='file']"))
      .filter((input) => !input.disabled);
    inputs.sort((a, b) => scoreFileInput(b) - scoreFileInput(a));
    return inputs;
  }

  function createDataTransfer(file) {
    if (!file || typeof content.DataTransfer !== "function") {
      return null;
    }
    try {
      const dt = new content.DataTransfer();
      dt.items.add(file);
      return dt;
    }
    catch (_) {
      return null;
    }
  }

  function dispatchWithDataTransfer(target, type, dataTransfer) {
    if (!target || !dataTransfer) {
      return false;
    }
    let event = null;
    try {
      if (type === "paste" && typeof content.ClipboardEvent === "function") {
        event = new content.ClipboardEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clipboardData: dataTransfer
        });
      }
    }
    catch (_) {
      event = null;
    }
    try {
      if (!event && /^drag|drop$/.test(type) && typeof content.DragEvent === "function") {
        event = new content.DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer
        });
      }
    }
    catch (_) {
      event = null;
    }
    try {
      if (!event) {
        event = new content.Event(type, { bubbles: true, cancelable: true, composed: true });
      }
      try {
        Object.defineProperty(event, "clipboardData", { value: dataTransfer });
      }
      catch (_) {}
      try {
        Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      }
      catch (_) {}
      target.dispatchEvent(event);
      return true;
    }
    catch (_) {
      return false;
    }
  }

  function dispatchFileDropAndPaste(pdfPath) {
    const file = createDOMFile(pdfPath);
    const dataTransfer = createDataTransfer(file);
    const editor = findEditor();
    const targets = [];
    if (editor) {
      targets.push(editor);
      let parent = editor.parentElement;
      for (let i = 0; parent && i < 4; i++) {
        targets.push(parent);
        parent = parent.parentElement;
      }
    }
    targets.push(content.document.activeElement, content.document.body, content.document.documentElement);
    let dispatched = false;
    for (const target of targets.filter(Boolean)) {
      focusEditor(editor);
      dispatched = dispatchWithDataTransfer(target, "paste", dataTransfer) || dispatched;
      dispatched = dispatchWithDataTransfer(target, "dragenter", dataTransfer) || dispatched;
      dispatched = dispatchWithDataTransfer(target, "dragover", dataTransfer) || dispatched;
      dispatched = dispatchWithDataTransfer(target, "drop", dataTransfer) || dispatched;
    }
    return dispatched;
  }

  function getVisibleText(element) {
    if (!element) {
      return "";
    }
    const pieces = [
      element.innerText || "",
      element.textContent || "",
      element.getAttribute && element.getAttribute("title"),
      element.getAttribute && element.getAttribute("aria-label"),
      element.getAttribute && element.getAttribute("data-filename"),
      element.getAttribute && element.getAttribute("data-file-name"),
      element.getAttribute && element.getAttribute("data-testid")
    ];
    return normalize(pieces.filter(Boolean).join(" "));
  }

  function buildNeedles(fileName) {
    const normalized = normalize(fileName);
    const withoutExt = normalized.replace(/\\.pdf$/i, "");
    const shortStem = withoutExt.replace(/[^\\p{L}\\p{N}]+/gu, " ").trim();
    const tokens = shortStem.split(" ").filter((token) => token.length >= 6 && !/^(zotero|reading|upload|file|document)$/i.test(token));
    const needles = [normalized];
    if (withoutExt && withoutExt !== normalized) {
      needles.push(withoutExt);
    }
    if (shortStem && shortStem.length >= 10) {
      needles.push(shortStem.slice(0, 32));
    }
    for (const token of tokens) {
      needles.push(token);
    }
    return needles.filter(Boolean);
  }

  function isAttachmentUploadSignalText(text) {
    return !/(failed|失败|不支持|unsupported|corrupt|损坏|error|错误|格式不支持|too large|exceed|exceeded|超出|过大)/i.test(text);
  }

  function matchesAttachmentText(text, needles) {
    const hasPdfContext = /\\.pdf\\b|pdf|uploaded|attached|file|document|附件|上传|文件|文档/.test(text);
    if (hasPdfContext && needles.some((needle) => needle.length >= 6 && text.includes(needle))) {
      return true;
    }
    if (needles.some((needle) => /^[a-z0-9_-]{8,}$/i.test(needle) && text.includes(needle))) {
      return true;
    }
    if (!hasPdfContext) {
      return false;
    }
    return needles.some((needle) => {
      if (needle.length < 12) {
        return false;
      }
      const prefix = needle.slice(0, Math.min(needle.length, 28));
      return prefix.length >= 12 && text.includes(prefix);
    });
  }

  function hasAttachment(fileName) {
    const needles = buildNeedles(fileName);
    const selectors = [
      "[class*='file']",
      "[class*='File']",
      "[class*='attach']",
      "[class*='Attach']",
      "[class*='upload']",
      "[class*='Upload']",
      "[class*='document']",
      "[class*='Document']",
      "[title]",
      "button",
      "span",
      "div"
    ];
    for (const selector of selectors) {
      try {
        for (const element of content.document.querySelectorAll(selector)) {
          if (!isVisible(element)) {
            continue;
          }
          const text = getVisibleText(element);
          if (!text) {
            continue;
          }
          if (matchesAttachmentText(text, needles) && isAttachmentUploadSignalText(text)) {
            return true;
          }
        }
      }
      catch (_) {}
    }
    return false;
  }

  function waitForAttachment(fileName, attemptsLeft, callback) {
    if (hasAttachment(fileName)) {
      callback(true);
      return true;
    }
    if (attemptsLeft > 0) {
      content.setTimeout(() => waitForAttachment(fileName, attemptsLeft - 1, callback), 250);
      return true;
    }
    callback(false);
    return false;
  }

	  function tryUpload(pdfPath, preparedUI) {
	    const fileName = getFileName(pdfPath);
	    const inputs = findFileInputs();
	    let attempted = false;
	    for (const input of inputs) {
	      attempted = setFileInput(input, pdfPath) || attempted;
      if (attempted) {
	        break;
	      }
	    }
	    if (!attempted && !preparedUI && openChatGLMUploadUI()) {
	      content.setTimeout(() => tryUpload(pdfPath, true), 350);
	      return;
	    }
	    if (!attempted) {
	      attempted = dispatchFileDropAndPaste(pdfPath);
	    }
	    if (!attempted) {
	      sendAsyncMessage(replyName, { ok: false, reason: "no-upload-path", inputCount: inputs.length });
      return;
    }
    waitForAttachment(fileName, 64, (attached) => {
      sendAsyncMessage(replyName, {
        ok: attached,
        reason: attached ? "attached" : "not-detected",
        inputCount: inputs.length
      });
    });
  }

	  function waitAndUpload(pdfPath, attemptsLeft) {
	    const editor = findEditor();
	    const inputs = findFileInputs();
	    if (editor || inputs.length) {
	      focusEditor(editor);
	      tryUpload(pdfPath, false);
	      return true;
	    }
    if (attemptsLeft > 0) {
      content.setTimeout(() => waitAndUpload(pdfPath, attemptsLeft - 1), 250);
      return true;
    }
    sendAsyncMessage(replyName, { ok: false, reason: "not-ready", inputCount: 0 });
    return false;
  }

  addMessageListener(messageName, function onMessage(message) {
    removeMessageListener(messageName, onMessage);
    waitAndUpload(String(message && message.data && message.data.pdfPath || ""), 16);
  });
})();
`;
  },

  getChatGLMCloseTransientUIFrameScript(messageName) {
    return `
(function() {
  const messageName = ${JSON.stringify(messageName)};

  function isVisible(element) {
    if (!element || !element.getBoundingClientRect) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 5 || rect.height < 5) {
      return false;
    }
    const style = content.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function normalizeEditor(element) {
    if (!element) {
      return null;
    }
    const tag = String(element.tagName || "").toLowerCase();
    if (element.isContentEditable || tag === "textarea" || tag === "input") {
      return element;
    }
    return element.querySelector("textarea, input[type='text'], input:not([type]), [contenteditable], [role='textbox']");
  }

  function findEditor() {
    const selectors = [
      "[data-testid='chat-input']",
      "[data-testid*='chat-input']",
      "[id*='input']",
      "[class*='input']",
      "[class*='editor']",
      "[aria-label*='输入']",
      "[placeholder]",
      "div.ProseMirror[contenteditable='true']",
      "div[role='textbox'][contenteditable='true']",
      "div[role='textbox']",
      "[role='textbox']",
      "[contenteditable]",
      "[contenteditable='true']",
      "textarea",
      "input[type='text']",
      "input:not([type])"
    ];
    const candidates = [];
    for (const selector of selectors) {
      try {
        for (const element of content.document.querySelectorAll(selector)) {
          const editor = normalizeEditor(element);
          if (editor && isVisible(editor)) {
            candidates.push(editor);
          }
        }
      }
      catch (_) {}
    }
    candidates.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    return candidates[0] || null;
  }

  function dispatchEscape(target) {
    if (!target) {
      return;
    }
    for (const type of ["keydown", "keyup"]) {
      try {
        target.dispatchEvent(new content.KeyboardEvent(type, {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true,
          composed: true
        }));
      }
      catch (_) {}
    }
  }

  function closeTransientUI() {
    const doc = content.document;
    for (const target of [doc.activeElement, doc.body, doc.documentElement].filter(Boolean)) {
      dispatchEscape(target);
    }
    const editor = findEditor();
    if (editor) {
      try {
        editor.focus({ preventScroll: true });
      }
      catch (_) {
        try {
          editor.focus();
        }
        catch (_) {}
      }
    }
  }

  addMessageListener(messageName, function onMessage() {
    removeMessageListener(messageName, onMessage);
    closeTransientUI();
    content.setTimeout(closeTransientUI, 120);
  });
})();
`;
  },

  getReaderPaneConversationStateFrameScript(messageName, replyName) {
    return `
(function() {
  const messageName = ${JSON.stringify(messageName)};
  const replyName = ${JSON.stringify(replyName)};

  function isVisible(element) {
    if (!element || !element.getBoundingClientRect) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) {
      return false;
    }
    const style = content.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function normalizeEditor(element) {
    if (!element) {
      return null;
    }
    const tag = String(element.tagName || "").toLowerCase();
    if (element.isContentEditable || tag === "textarea" || tag === "input") {
      return element;
    }
    return element.querySelector("textarea, input[type='text'], input:not([type]), [contenteditable], [role='textbox']");
  }

  function getEditorHint(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("data-testid"),
      element.id,
      element.className
    ].map((value) => String(value || "")).join(" ").toLowerCase();
  }

  function scoreEditor(element) {
    const rect = element.getBoundingClientRect();
    const hint = getEditorHint(element);
    const tag = String(element.tagName || "").toLowerCase();
    let score = rect.top;
    if (rect.top > content.innerHeight * 0.45) {
      score += 1000;
    }
    if (rect.width > Math.min(360, content.innerWidth * 0.35)) {
      score += 150;
    }
    if (tag === "textarea" || tag === "input") {
      score += 300;
    }
    if (element.isContentEditable) {
      score += 260;
    }
    if (String(element.getAttribute("role") || "").toLowerCase() === "textbox") {
      score += 220;
    }
    if (/chat|message|prompt|input|ask|textarea|editor|输入|发送|聊聊/.test(hint)) {
      score += 350;
    }
    if (/search|filter|model|upload|上传/.test(hint)) {
      score -= 500;
    }
    return score;
  }

  function findEditor() {
    const doc = content.document;
    const selectors = [
      "[data-testid='chat-input']",
      "[data-testid*='chat-input']",
      "[data-testid*='input']",
      "[id*='input']",
      "[class*='input']",
      "[class*='editor']",
      "[class*='textarea']",
      "[aria-label*='Message']",
      "[aria-label*='message']",
      "[aria-label*='Ask']",
      "[aria-label*='ask']",
      "[aria-label*='输入']",
      "[placeholder]",
      "div.ProseMirror[contenteditable='true']",
      "div[role='textbox'][contenteditable='true']",
      "div[role='textbox']",
      "[role='textbox']",
      "[contenteditable]",
      "[contenteditable='true']",
      "textarea",
      "input[type='text']",
      "input:not([type])"
    ];
    const candidates = [];
    for (const selector of selectors) {
      try {
        for (const element of doc.querySelectorAll(selector)) {
          const editor = normalizeEditor(element);
          if (editor && isVisible(editor)) {
            candidates.push(editor);
          }
        }
      }
      catch (_) {}
    }
    candidates.sort((a, b) => scoreEditor(b) - scoreEditor(a));
    return candidates[0] || null;
  }

  function isInsideChrome(element) {
    return Boolean(element.closest("nav, aside, header, footer, button, input, textarea, select, [role='button'], [role='navigation'], [class*='sidebar'], [class*='menu'], [class*='toolbar']"));
  }

  function normalizeText(text) {
    return String(text || "").replace(/\\s+/g, " ").trim();
  }

  function looksLikeHomeChrome(text) {
    return /今天.*新想法|和我聊聊天吧|内容由AI生成|用户协议|隐私政策|升级|快速|更多|Agent|研究报告|PPT制作|数据分析|GLM-/.test(text);
  }

  function looksLikeMessageElement(element, editorRect) {
    if (!isVisible(element) || isInsideChrome(element)) {
      return false;
    }
    if (editorRect && element.contains(content.document.elementFromPoint(editorRect.left + 5, editorRect.top + 5))) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (editorRect && rect.top >= editorRect.top - 8) {
      return false;
    }
    if (rect.width < Math.min(220, content.innerWidth * 0.22) || rect.height < 18) {
      return false;
    }
    const text = normalizeText(element.innerText || element.textContent || "");
    if (!text || looksLikeHomeChrome(text)) {
      return false;
    }
    if (/\\.pdf\\b/i.test(text) && text.length >= 10) {
      return true;
    }
    return text.length >= 45;
  }

  function hasHistoryMessages(editor) {
    const doc = content.document;
    const editorRect = editor && editor.getBoundingClientRect ? editor.getBoundingClientRect() : null;
    const selectors = [
      "[data-testid*='message']",
      "[class*='message']",
      "[class*='Message']",
      "[class*='conversation']",
      "[class*='Conversation']",
      "[class*='chat-item']",
      "[class*='chatItem']",
      "[class*='answer']",
      "[class*='Answer']",
      "[class*='question']",
      "[class*='Question']",
      "[class*='markdown']",
      "[class*='Markdown']",
      "[class*='prose']",
      "[role='article']",
      "main article",
      "main section",
      "main p"
    ];
    for (const selector of selectors) {
      try {
        for (const element of doc.querySelectorAll(selector)) {
          if (editor && (element === editor || element.contains(editor))) {
            continue;
          }
          if (looksLikeMessageElement(element, editorRect)) {
            return true;
          }
        }
      }
      catch (_) {}
    }
    return false;
  }

  function waitForState(attemptsLeft) {
    const editor = findEditor();
    if (editor) {
      sendAsyncMessage(replyName, {
        ready: true,
        hasHistory: hasHistoryMessages(editor)
      });
      return true;
    }
    if (attemptsLeft > 0) {
      content.setTimeout(() => waitForState(attemptsLeft - 1), 250);
      return true;
    }
    sendAsyncMessage(replyName, { ready: false, hasHistory: true });
    return false;
  }

  addMessageListener(messageName, function onMessage() {
    removeMessageListener(messageName, onMessage);
    waitForState(20);
  });
})();
`;
  },

  getReaderPanePDFAttachmentProbeFrameScript(messageName, replyName) {
    return `
(function() {
  const messageName = ${JSON.stringify(messageName)};
  const replyName = ${JSON.stringify(replyName)};

  function normalize(value) {
    return String(value || "")
      .normalize("NFC")
      .replace(/\\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isVisible(element) {
    if (!element || !element.getBoundingClientRect) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 5 || rect.height < 5) {
      return false;
    }
    const style = content.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function getVisibleText(element) {
    return normalize(element && (element.innerText || element.textContent || ""));
  }

  function buildNeedles(fileName) {
    const normalized = normalize(fileName);
    const withoutExt = normalized.replace(/\\.pdf$/i, "");
    const shortStem = withoutExt.replace(/[^\\p{L}\\p{N}]+/gu, " ").trim();
    const needles = [normalized];
    if (withoutExt && withoutExt !== normalized) {
      needles.push(withoutExt);
    }
    if (shortStem && shortStem.length >= 10) {
      needles.push(shortStem.slice(0, 32));
    }
    return needles.filter(Boolean);
  }

  function isAttachmentUploadSignalText(text) {
    return !/(failed|失败|不支持|unsupported|corrupt|损坏|error|错误|格式不支持)/i.test(text);
  }

  function hasAttachment(fileName) {
    const needles = buildNeedles(fileName);
    const selectors = [
      "[class*='file']",
      "[class*='File']",
      "[class*='attach']",
      "[class*='Attach']",
      "[class*='upload']",
      "[class*='Upload']",
      "[class*='document']",
      "[class*='Document']",
      "[title]",
      "button",
      "span",
      "div"
    ];
    for (const selector of selectors) {
      try {
        for (const element of content.document.querySelectorAll(selector)) {
          if (!isVisible(element)) {
            continue;
          }
          const text = getVisibleText(element);
          if (!text) {
            continue;
          }
          const matches = (
            (text.includes(".pdf") && needles.some((needle) => text.includes(needle.slice(0, Math.min(needle.length, 40))))) ||
            needles.some((needle) => needle.length >= 12 && text.includes(needle))
          );
          if (matches && isAttachmentUploadSignalText(text)) {
            return true;
          }
        }
      }
      catch (_) {}
    }
    return false;
  }

  function waitForAttachment(fileName, attemptsLeft) {
    if (hasAttachment(fileName)) {
      sendAsyncMessage(replyName, { attached: true });
      return;
    }
    if (attemptsLeft > 0) {
      content.setTimeout(() => waitForAttachment(fileName, attemptsLeft - 1), 250);
      return;
    }
    sendAsyncMessage(replyName, { attached: false });
  }

  addMessageListener(messageName, function onMessage(message) {
    removeMessageListener(messageName, onMessage);
    waitForAttachment(String(message && message.data && message.data.fileName || ""), 64);
  });
})();
`;
  },

  getReaderPaneTextInsertFrameScript(messageName, replyName) {
    return `
(function() {
  const messageName = ${JSON.stringify(messageName)};
  const replyName = ${JSON.stringify(replyName)};

  function isVisible(element) {
    if (!element || !element.getBoundingClientRect) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) {
      return false;
    }
    const style = content.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

	  function normalizeEditor(element) {
	    if (!element) {
	      return null;
	    }
	    const tag = String(element.tagName || "").toLowerCase();
	    if (element.isContentEditable || tag === "textarea" || tag === "input") {
	      return element;
	    }
	    return element.querySelector("textarea, input[type='text'], input:not([type]), [contenteditable], [role='textbox']");
	  }

	  function querySelectorAllDeep(root, selector) {
	    const results = [];
	    const visit = (node) => {
	      if (!node || !node.querySelectorAll) {
	        return;
	      }
	      try {
	        for (const element of node.querySelectorAll(selector)) {
	          results.push(element);
	        }
	      }
	      catch (_) {}
	      try {
	        for (const element of node.querySelectorAll("*")) {
	          if (element.shadowRoot) {
	            visit(element.shadowRoot);
	          }
	        }
	      }
	      catch (_) {}
	    };
	    visit(root);
	    return results;
	  }

  function getEditorHint(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("data-testid"),
      element.id,
      element.className
    ].map((value) => String(value || "")).join(" ").toLowerCase();
  }

  function scoreEditor(element) {
    const rect = element.getBoundingClientRect();
    const hint = getEditorHint(element);
    const tag = String(element.tagName || "").toLowerCase();
    let score = rect.top;
    if (rect.top > content.innerHeight * 0.45) {
      score += 1000;
    }
    if (rect.width > Math.min(360, content.innerWidth * 0.35)) {
      score += 150;
    }
    if (tag === "textarea" || tag === "input") {
      score += 300;
    }
    if (element.isContentEditable) {
      score += 260;
    }
    if (String(element.getAttribute("role") || "").toLowerCase() === "textbox") {
      score += 220;
    }
	    if (/chat|message|prompt|gemini|input|ask|textarea|editor|输入|发送|聊聊/.test(hint)) {
	      score += 350;
	    }
    if (/search|filter|model|upload|上传/.test(hint)) {
      score -= 500;
    }
    return score;
  }

  function findEditor() {
    const doc = content.document;
    const selectors = [
	      "[data-testid='chat-input']",
	      "[data-testid*='chat-input']",
	      "[data-testid*='input']",
	      "[data-test-id*='input']",
	      "[id*='input']",
	      "[class*='input']",
	      "[class*='editor']",
	      "[class*='textarea']",
	      "[class*='ql-editor']",
	      "[aria-label*='Message']",
	      "[aria-label*='message']",
	      "[aria-label*='Ask']",
	      "[aria-label*='ask']",
	      "[aria-label*='Prompt']",
	      "[aria-label*='prompt']",
	      "[aria-label*='Gemini']",
	      "[aria-label*='Enter']",
	      "[aria-label*='输入']",
	      "[placeholder]",
	      "rich-textarea [contenteditable='true']",
	      ".ql-editor[contenteditable='true']",
	      "div.ProseMirror[contenteditable='true']",
      "div[role='textbox'][contenteditable='true']",
      "div[role='textbox']",
      "[role='textbox']",
      "[contenteditable]",
      "[contenteditable='true']",
      "textarea",
      "input[type='text']",
      "input:not([type])"
    ];
	    const candidates = [];
	    for (const selector of selectors) {
	      try {
	        for (const element of querySelectorAllDeep(doc, selector)) {
	          const editor = normalizeEditor(element);
	          if (editor && isVisible(editor)) {
            candidates.push(editor);
          }
        }
      }
      catch (_) {}
    }
    candidates.sort((a, b) => scoreEditor(b) - scoreEditor(a));
    return candidates[0] || null;
  }

  function focusEditor(editor) {
    try {
      editor.scrollIntoView({ block: "center", inline: "nearest" });
    }
    catch (_) {}
    try {
      editor.focus({ preventScroll: true });
    }
    catch (_) {
      try {
        editor.focus();
      }
      catch (_) {}
    }
  }

  function dispatchTextEvents(editor, text) {
    try {
      editor.dispatchEvent(new content.InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text
      }));
    }
    catch (_) {}
    try {
      editor.dispatchEvent(new content.InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text
      }));
    }
    catch (_) {
      try {
        editor.dispatchEvent(new content.Event("input", { bubbles: true }));
      }
      catch (_) {}
    }
    try {
      editor.dispatchEvent(new content.Event("change", { bubbles: true }));
    }
    catch (_) {}
  }

  function setNativeInputValue(editor, text) {
    const tag = String(editor.tagName || "").toLowerCase();
    const prototype =
      tag === "textarea" ? content.HTMLTextAreaElement.prototype :
      tag === "input" ? content.HTMLInputElement.prototype :
      null;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(editor, text);
    }
    else {
      editor.value = text;
    }
  }

  function placeCaretAtEnd(editor) {
    try {
      const range = editor.ownerDocument.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = content.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    catch (_) {}
  }

  function insertText(editor, text) {
    focusEditor(editor);
    const tag = String(editor.tagName || "").toLowerCase();
    if (tag === "textarea" || tag === "input") {
      setNativeInputValue(editor, text);
      dispatchTextEvents(editor, text);
      return true;
    }

    placeCaretAtEnd(editor);
    try {
      editor.textContent = "";
      placeCaretAtEnd(editor);
    }
    catch (_) {}
    try {
      if (content.document.execCommand("insertText", false, text)) {
        dispatchTextEvents(editor, text);
        return true;
      }
    }
    catch (_) {}

    try {
      editor.textContent = text;
      placeCaretAtEnd(editor);
      dispatchTextEvents(editor, text);
      return true;
    }
    catch (_) {
      return false;
    }
  }

  function waitAndInsert(text, attemptsLeft) {
    const editor = findEditor();
    if (editor) {
      sendAsyncMessage(replyName, { ok: insertText(editor, text) });
      return true;
    }
    if (attemptsLeft > 0) {
      content.setTimeout(() => waitAndInsert(text, attemptsLeft - 1), 250);
      return true;
    }
    sendAsyncMessage(replyName, { ok: false });
    return false;
  }

  addMessageListener(messageName, function onMessage(message) {
    removeMessageListener(messageName, onMessage);
    waitAndInsert(String(message && message.data && message.data.text || ""), 20);
  });
})();
`;
  },

  getReaderPaneEditorReadyFrameScript(messageName, replyName, attempts = 20) {
    return `
(function() {
  const messageName = ${JSON.stringify(messageName)};
  const replyName = ${JSON.stringify(replyName)};
  const maxAttempts = ${Math.max(0, Number(attempts) || 20)};

  function isVisible(element) {
    if (!element || !element.getBoundingClientRect) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) {
      return false;
    }
    const style = content.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

	  function normalizeEditor(element) {
	    if (!element) {
	      return null;
	    }
	    if (element.isContentEditable || ["textarea", "input"].includes(String(element.tagName || "").toLowerCase())) {
	      return element;
	    }
	    return element.querySelector("textarea, input[type='text'], input:not([type]), [contenteditable], [role='textbox']");
	  }

	  function querySelectorAllDeep(root, selector) {
	    const results = [];
	    const visit = (node) => {
	      if (!node || !node.querySelectorAll) {
	        return;
	      }
	      try {
	        for (const element of node.querySelectorAll(selector)) {
	          results.push(element);
	        }
	      }
	      catch (_) {}
	      try {
	        for (const element of node.querySelectorAll("*")) {
	          if (element.shadowRoot) {
	            visit(element.shadowRoot);
	          }
	        }
	      }
	      catch (_) {}
	    };
	    visit(root);
	    return results;
	  }

  function getEditorHint(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("data-testid"),
      element.id,
      element.className
    ].map((value) => String(value || "")).join(" ").toLowerCase();
  }

  function scoreEditor(element) {
    const rect = element.getBoundingClientRect();
    const hint = getEditorHint(element);
    const tag = String(element.tagName || "").toLowerCase();
    let score = rect.top;
    if (rect.top > content.innerHeight * 0.45) {
      score += 1000;
    }
    if (rect.width > Math.min(360, content.innerWidth * 0.35)) {
      score += 150;
    }
    if (tag === "textarea" || tag === "input") {
      score += 300;
    }
    if (element.isContentEditable) {
      score += 260;
    }
    if (String(element.getAttribute("role") || "").toLowerCase() === "textbox") {
      score += 220;
    }
	    if (/chat|message|prompt|gemini|input|ask|textarea|editor|输入|发送/.test(hint)) {
	      score += 350;
	    }
    if (/search|filter|model|upload|上传/.test(hint)) {
      score -= 500;
    }
    return score;
  }

  function findEditor() {
    const doc = content.document;
    const selectors = [
	      "[data-testid='chat-input']",
	      "[data-testid*='chat-input']",
	      "[data-testid*='input']",
	      "[data-test-id*='input']",
	      "[id*='input']",
	      "[class*='input']",
	      "[class*='editor']",
	      "[class*='textarea']",
	      "[class*='ql-editor']",
	      "[aria-label*='Message']",
	      "[aria-label*='message']",
	      "[aria-label*='Ask']",
	      "[aria-label*='ask']",
	      "[aria-label*='Prompt']",
	      "[aria-label*='prompt']",
	      "[aria-label*='Gemini']",
	      "[aria-label*='Enter']",
	      "[aria-label*='输入']",
	      "[placeholder]",
	      "rich-textarea [contenteditable='true']",
	      ".ql-editor[contenteditable='true']",
	      "div.ProseMirror[contenteditable='true']",
      "div[role='textbox'][contenteditable='true']",
      "div[role='textbox']",
      "[role='textbox']",
      "[contenteditable]",
      "[contenteditable='true']",
      "textarea",
      "input[type='text']",
      "input:not([type])"
    ];
	    const candidates = [];
	    for (const selector of selectors) {
	      try {
	        for (const element of querySelectorAllDeep(doc, selector)) {
	          const editor = normalizeEditor(element);
	          if (editor && isVisible(editor)) {
            candidates.push(editor);
          }
        }
      }
      catch (_) {}
    }
    candidates.sort((a, b) => scoreEditor(b) - scoreEditor(a));
    return candidates[0] || null;
  }

  function focusEditor(editor) {
    try {
      editor.scrollIntoView({ block: "center", inline: "nearest" });
    }
    catch (_) {}
    try {
      editor.focus({ preventScroll: true });
    }
    catch (_) {
      try {
        editor.focus();
      }
      catch (_) {}
    }
    if (editor.isContentEditable) {
      try {
        const range = editor.ownerDocument.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = content.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      catch (_) {}
    }
  }

  function waitForEditor(attemptsLeft) {
    const editor = findEditor();
    if (editor) {
      focusEditor(editor);
      sendAsyncMessage(replyName, { ready: true });
      return true;
    }
    if (attemptsLeft > 0) {
      content.setTimeout(() => waitForEditor(attemptsLeft - 1), 250);
      return true;
    }
    sendAsyncMessage(replyName, { ready: false });
    return false;
  }

  addMessageListener(messageName, function onMessage() {
    removeMessageListener(messageName, onMessage);
    waitForEditor(maxAttempts);
  });
})();
`;
  },

  getClaudeEditorFocusFrameScript(messageName) {
    return `
(function() {
  const messageName = ${JSON.stringify(messageName)};

  function isVisible(element) {
    if (!element || !element.getBoundingClientRect) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) {
      return false;
    }
    const style = content.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function normalizeEditor(element) {
    if (!element) {
      return null;
    }
    if (element.isContentEditable || ["textarea", "input"].includes(String(element.tagName || "").toLowerCase())) {
      return element;
    }
    return element.querySelector("textarea, input[type='text'], input:not([type]), [contenteditable], [role='textbox']");
  }

  function getEditorHint(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("data-testid"),
      element.id,
      element.className
    ].map((value) => String(value || "")).join(" ").toLowerCase();
  }

  function scoreEditor(element) {
    const rect = element.getBoundingClientRect();
    const hint = getEditorHint(element);
    const tag = String(element.tagName || "").toLowerCase();
    let score = rect.top;
    if (rect.top > content.innerHeight * 0.45) {
      score += 1000;
    }
    if (rect.width > Math.min(360, content.innerWidth * 0.35)) {
      score += 150;
    }
    if (tag === "textarea" || tag === "input") {
      score += 300;
    }
    if (element.isContentEditable) {
      score += 260;
    }
    if (String(element.getAttribute("role") || "").toLowerCase() === "textbox") {
      score += 220;
    }
    if (/chat|message|prompt|input|ask|textarea|editor|输入|发送/.test(hint)) {
      score += 350;
    }
    if (/search|filter|model|upload|上传/.test(hint)) {
      score -= 500;
    }
    return score;
  }

  function findEditor() {
    const doc = content.document;
    const selectors = [
      "[data-testid='chat-input']",
      "[data-testid*='chat-input']",
      "[data-testid*='input']",
      "[id*='input']",
      "[class*='input']",
      "[class*='editor']",
      "[class*='textarea']",
      "[aria-label*='Message']",
      "[aria-label*='message']",
      "[aria-label*='Ask']",
      "[aria-label*='ask']",
      "[aria-label*='输入']",
      "[placeholder]",
      "div.ProseMirror[contenteditable='true']",
      "div[role='textbox'][contenteditable='true']",
      "div[role='textbox']",
      "[role='textbox']",
      "[contenteditable]",
      "[contenteditable='true']",
      "textarea",
      "input[type='text']",
      "input:not([type])"
    ];
    const candidates = [];
    for (const selector of selectors) {
      try {
        for (const element of doc.querySelectorAll(selector)) {
          const editor = normalizeEditor(element);
          if (editor && isVisible(editor)) {
            candidates.push(editor);
          }
        }
      }
      catch (_) {}
    }
    candidates.sort((a, b) => scoreEditor(b) - scoreEditor(a));
    return candidates[0] || null;
  }

  function focusEditor(attemptsLeft) {
    const editor = findEditor();
    if (editor) {
      try {
        editor.scrollIntoView({ block: "center", inline: "nearest" });
      }
      catch (_) {}
      try {
        editor.focus({ preventScroll: true });
      }
      catch (_) {
        try {
          editor.focus();
        }
        catch (_) {}
      }
      if (editor.isContentEditable) {
        try {
          const range = editor.ownerDocument.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          const selection = content.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        catch (_) {}
      }
      return true;
    }
    if (attemptsLeft > 0) {
      content.setTimeout(() => focusEditor(attemptsLeft - 1), 250);
      return true;
    }
    return false;
  }

  addMessageListener(messageName, function onMessage() {
    removeMessageListener(messageName, onMessage);
    focusEditor(12);
  });
})();
`;
  },

  focusReaderPaneFrame(targetReader) {
    let readers = targetReader ? [targetReader] : this.getOpenReaders();
    for (let reader of readers) {
      try {
        let container = this.getReaderChromeWrapper(reader);
        let pane = container?.querySelector?.(".zai-reader-ai-pane");
        if (!pane) {
          pane = (reader?._window?.document || reader?._iframe?.ownerDocument)?.getElementById?.(this.getReaderPaneID(reader));
        }
        if (!pane || pane.hidden || pane.getAttribute("hidden") === "true") {
          continue;
        }
        let frame = this.getReaderPaneWebView(pane);
        if (!frame) {
          continue;
        }
        try {
          frame.docShellIsActive = true;
        }
        catch (_) {}
        try {
          Services.focus?.setFocus?.(frame, Services.focus.FLAG_BYMOUSE);
        }
        catch (_) {}
        try {
          frame.ownerDocument?.commandDispatcher?.advanceFocusIntoSubtree?.(frame);
        }
        catch (_) {}
        try {
          frame.ownerGlobal?.focus?.();
        }
        catch (_) {}
        frame.focus();
        try {
          frame.contentWindow?.focus?.();
        }
        catch (_) {}
        return true;
      }
      catch (_) {}
    }
    return false;
  },

  clearPasteTimers() {
    for (let timer of this.pasteTimers) {
      try {
        timer.cancel();
      }
      catch (_) {}
    }
    this.pasteTimers = [];
  },

  pasteIntoBrowser(aiURL, options = {}) {
    try {
      this.pasteWithOptions(aiURL, false, options);
    }
    catch (error) {
      this.log("pasteIntoBrowser failed: " + (error.stack || error.message || String(error)));
    }
  },

  pasteWithOptions(aiURL, allowZotero, options = {}) {
    let profile = this.getPasteProfile(aiURL, options);
    let useAsyncExternalPaste = options.transferMode === "file" && !allowZotero && !options.readerPaneReader;
    let focusBeforePaste = () => {
      if (options.readerPaneReader) {
        this.focusReaderPaneFrame(options.readerPaneReader);
        this.focusClaudeEditorInReaderPane(options.readerPaneReader);
      }
    };
    let pasteNow = (wait = true, onComplete = null) => {
      focusBeforePaste();
      let script = this.getPasteAppleScript(aiURL, allowZotero);
      if (onComplete) {
        return this.runAppleScriptAsync(script, onComplete);
      }
      return this.runAppleScript(script, wait);
    };

    if (options.transferMode === "file" && options.pdfPath) {
      let fileAttempts = Math.max(1, Number(profile.filePasteAttempts) || 1);
      let retryDelay = Math.max(500, Number(profile.filePasteRetryDelay) || 1200);
      let fileDelay = Math.max(0, Number(profile.filePasteDelay) || 0);
      let promptDelay = Math.max(300, Number(profile.promptPasteDelay) || 1600);
      let afterFilePaste = (attempt, pasted) => {
        if (!pasted) {
          this.log("External PDF paste did not complete; prompt paste skipped to avoid text-only state");
          return;
        }
        if (attempt + 1 < fileAttempts) {
          this.schedulePasteTimer(() => pasteFile(attempt + 1), retryDelay);
          return;
        }

        let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        let callback = () => {
          try {
            if (options.prompt) {
              let pastePrompt = () => {
                if (options.readerPaneReader && this.isGeminiURL(aiURL)) {
                  this.pasteTextIntoReaderPaneEditorOrClipboard(options.readerPaneReader, options.prompt, 300);
                  return;
                }
                this.copyToClipboard(options.prompt);
                pasteNow(false);
              };
              if (options.readerPaneReader && options.pdfPath) {
                let isGeminiReaderPane = this.isGeminiURL(aiURL);
                let attachmentTimeout = isGeminiReaderPane ? 2000 : 18000;
                Promise.resolve(this.waitForReaderPanePDFAttachment(options.readerPaneReader, options.pdfPath, attachmentTimeout))
                  .then((attached) => {
                    if (attached || isGeminiReaderPane) {
                      pastePrompt();
                    }
                    else {
                      this.log("Reader pane PDF attachment was not detected; prompt paste skipped to avoid text-only state");
                    }
                  })
                  .catch((error) => {
                    this.log("Reader pane PDF attachment check failed: " + (error.stack || error.message || String(error)));
                  });
              }
              else {
                pastePrompt();
              }
            }
          }
          finally {
            this.pasteTimers = this.pasteTimers.filter((candidate) => candidate !== timer);
          }
        };
        timer.initWithCallback(callback, promptDelay, Ci.nsITimer.TYPE_ONE_SHOT);
        this.pasteTimers.push(timer);
      };

      let pasteFile = (attempt) => {
        if (useAsyncExternalPaste) {
          this.pastePDFFileIntoBrowserAsync(aiURL, options.pdfPath, (pasted) => afterFilePaste(attempt, pasted));
          return;
        }
        this.copyPDFFileToClipboard(options.pdfPath);
        afterFilePaste(attempt, pasteNow(true));
      };

      if (fileDelay > 0) {
        this.schedulePasteTimer(() => pasteFile(0), fileDelay);
      }
      else {
        pasteFile(0);
      }
      return;
    }
    pasteNow(false);
  },

  schedulePasteTimer(callback, delay) {
    let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    timer.initWithCallback(() => {
      try {
        callback();
      }
      finally {
        this.pasteTimers = this.pasteTimers.filter((candidate) => candidate !== timer);
      }
    }, Math.max(0, delay), Ci.nsITimer.TYPE_ONE_SHOT);
    this.pasteTimers.push(timer);
    return timer;
  },

  getPasteProfile(aiURL, options = {}) {
    let profile = {
      filePasteDelay: 0,
      filePasteAttempts: 1,
      filePasteRetryDelay: 1200,
      promptPasteDelay: 1600
    };

    if (this.isChatGLMURL(aiURL)) {
      profile.filePasteDelay = 1000;
      profile.promptPasteDelay = options.readerPaneReader ? 600 : 2600;
    }
    return profile;
  },

  isGeminiURL(aiURL) {
    try {
      let host = new URL(String(aiURL || "")).hostname;
      return host === "gemini.google.com" || host.endsWith(".gemini.google.com");
    }
    catch (_) {
      return false;
    }
  },

  isChatGLMURL(aiURL) {
    try {
      let host = new URL(String(aiURL || "")).hostname;
      return host === "chatglm.cn" || host.endsWith(".chatglm.cn");
    }
    catch (_) {
      return false;
    }
  },

  isChatGLMNonConversationURL(currentURL, aiURL) {
    if (!this.isChatGLMURL(aiURL)) {
      return false;
    }
    try {
      let current = currentURL instanceof URL ? currentURL : new URL(String(currentURL || ""));
      let path = current.pathname.replace(/\/+$/, "") || "/";
      if (this.hasChatGLMConversationMarker(current)) {
        return false;
      }
      if (path === "/" || path === "/new" || path === "/main") {
        return true;
      }
      if (/^\/main\/(?:alltoolsdetail|toolsdetail|agent|agents|explore|search|discover)(?:\/|$)/i.test(path)) {
        return true;
      }
      return false;
    }
    catch (_) {
      return false;
    }
  },

  hasChatGLMConversationMarker(url) {
    try {
      let current = url instanceof URL ? url : new URL(String(url || ""));
      let conversationKeys = [
        "cid",
        "conversationId",
        "conversation_id",
        "chatId",
        "chat_id",
        "sessionId",
        "session_id",
        "threadId",
        "thread_id"
      ];
      for (let key of conversationKeys) {
        let value = current.searchParams.get(key);
        if (value && String(value).trim().length >= 6) {
          return true;
        }
      }
      let hash = String(current.hash || "").replace(/^#/, "");
      if (/(?:cid|conversation|chat|session|thread)(?:=|\/)[A-Za-z0-9_-]{6,}/i.test(hash)) {
        return true;
      }
      return false;
    }
    catch (_) {
      return false;
    }
  },

  shouldStartFreshReaderConversation(aiURL) {
    return this.isChatGLMURL(aiURL);
  },

  isRetiredQwenURL(aiURL) {
    try {
      let host = new URL(String(aiURL || "")).hostname;
      return host === "chat.qwen.ai" || host.endsWith(".chat.qwen.ai");
    }
    catch (_) {
      return false;
    }
  },

  copyPDFFileToClipboard(pdfPath) {
    if (this.copyPDFFileToSystemClipboard(pdfPath)) {
      return;
    }
    this.copyPDFFileToZoteroClipboard(pdfPath);
  },

  copyPDFFileToClipboardAsync(pdfPath, onComplete = null) {
    this.copyPDFFileToSystemClipboardAsync(pdfPath, (ok) => {
      let copied = Boolean(ok);
      if (!copied) {
        try {
          this.copyPDFFileToZoteroClipboard(pdfPath);
          copied = true;
        }
        catch (error) {
          this.log("copyPDFFileToClipboardAsync fallback failed: " + (error.stack || error.message || String(error)));
        }
      }
      if (onComplete) {
        try {
          onComplete(copied);
        }
        catch (error) {
          this.log("copyPDFFileToClipboardAsync callback failed: " + (error.stack || error.message || String(error)));
        }
      }
    });
  },

  copyPDFFileToSystemClipboard(pdfPath) {
    try {
      return this.runAppleScript(this.getSetFileClipboardAppleScript(pdfPath), true);
    }
    catch (error) {
      this.log("copyPDFFileToSystemClipboard failed: " + (error.stack || error.message || String(error)));
      return false;
    }
  },

  copyPDFFileToSystemClipboardAsync(pdfPath, onComplete = null) {
    try {
      return this.runAppleScriptAsync(this.getSetFileClipboardAppleScript(pdfPath), onComplete);
    }
    catch (error) {
      this.log("copyPDFFileToSystemClipboardAsync failed: " + (error.stack || error.message || String(error)));
      if (onComplete) {
        try {
          onComplete(false);
        }
        catch (_) {}
      }
      return false;
    }
  },

  pastePDFFileIntoBrowserAsync(aiURL, pdfPath, onComplete = null) {
    try {
      return this.runAppleScriptAsync(
        this.getSetFileClipboardAppleScript(pdfPath).concat(this.getPasteAppleScript(aiURL, false)),
        onComplete
      );
    }
    catch (error) {
      this.log("pastePDFFileIntoBrowserAsync failed: " + (error.stack || error.message || String(error)));
      if (onComplete) {
        try {
          onComplete(false);
        }
        catch (_) {}
      }
      return false;
    }
  },

  copyPDFFileToZoteroClipboard(pdfPath) {
    let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(pdfPath);
    if (!file.exists()) {
      throw new Error("The PDF file does not exist: " + pdfPath);
    }

    let transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
    if (typeof transferable.init === "function") {
      transferable.init(null);
    }
    transferable.addDataFlavor("application/x-moz-file");
    try {
      transferable.setTransferData("application/x-moz-file", file);
    }
    catch (_) {
      transferable.setTransferData("application/x-moz-file", file, 0);
    }
    Services.clipboard.setData(transferable, null, Services.clipboard.kGlobalClipboard);
  },

  getSetFileClipboardAppleScript(pdfPath) {
    return [
      "use framework \"AppKit\"",
      "use scripting additions",
      "set pdfPath to " + this.appleScriptQuote(pdfPath),
      "set pdfURL to current application's NSURL's fileURLWithPath:pdfPath",
      "set pasteboard to current application's NSPasteboard's generalPasteboard()",
      "pasteboard's clearContents()",
      "if not (pasteboard's writeObjects:{pdfURL}) then error \"Could not place PDF file on clipboard\"",
      "set fileURLString to (pdfURL's absoluteString()) as text",
      "pasteboard's setString:fileURLString forType:(current application's NSPasteboardTypeFileURL)",
      "pasteboard's setString:fileURLString forType:\"public.file-url\"",
      "try",
      "pasteboard's setString:fileURLString forType:\"NSURLPboardType\"",
      "end try",
      "try",
      "pasteboard's setPropertyList:{pdfPath} forType:\"NSFilenamesPboardType\"",
      "end try"
    ];
  },

  getPasteAppleScript(aiURL, allowZotero) {
    void aiURL;
    if (allowZotero) {
      return [
        "tell application \"System Events\"",
        "keystroke \"v\" using command down",
        "end tell"
      ];
    }
    return [
      "tell application \"System Events\"",
      "set didPaste to false",
      "set browserNames to {\"Google Chrome\", \"Safari\", \"Microsoft Edge\", \"Brave Browser\", \"Arc\", \"Dia\", \"Firefox\", \"Orion\", \"ChatGPT\", \"ChatGPT Atlas\"}",
      "repeat with i from 1 to 80",
      "set frontApp to name of first application process whose frontmost is true",
      "if frontApp is not \"Zotero\" and frontApp is not \"osascript\" then",
      "if (browserNames contains frontApp) or i > 20 then",
      "delay 0.35",
      "keystroke \"v\" using command down",
      "set didPaste to true",
      "exit repeat",
      "end if",
      "end if",
      "delay 0.2",
      "end repeat",
      "if didPaste is false then error \"Target browser did not become frontmost\"",
      "end tell"
    ];
  },

  runAppleScript(lines, wait = false) {
    let executable = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    executable.initWithPath("/usr/bin/osascript");
    let process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    process.init(executable);

    let args = [];
    for (let line of lines) {
      args.push("-e", line);
    }
    process.run(Boolean(wait), args, args.length);
    if (wait) {
      return process.exitValue === 0;
    }
    return true;
  },

  runAppleScriptAsync(lines, onComplete = null) {
    try {
      let executable = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      executable.initWithPath("/usr/bin/osascript");
      let process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
      process.init(executable);

      let args = [];
      for (let line of lines) {
        args.push("-e", line);
      }
      let observer = {
        observe: () => {
          let ok = false;
          try {
            ok = process.exitValue === 0;
          }
          catch (_) {}
          if (onComplete) {
            try {
              onComplete(ok);
            }
            catch (error) {
              this.log("runAppleScriptAsync callback failed: " + (error.stack || error.message || String(error)));
            }
          }
        }
      };
      process.runAsync(args, args.length, observer, false);
      return true;
    }
    catch (error) {
      this.log("runAppleScriptAsync failed: " + (error.stack || error.message || String(error)));
      if (onComplete) {
        try {
          onComplete(false);
        }
        catch (_) {}
      }
      return false;
    }
  },

  copyToClipboard(text) {
    Cc["@mozilla.org/widget/clipboardhelper;1"]
      .getService(Ci.nsIClipboardHelper)
      .copyString(text);
  },

  appleScriptQuote(value) {
    return "\"" + String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
  },

  revealFile(path) {
    try {
      let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(path);
      if (!file.exists()) {
        throw new Error("File does not exist: " + path);
      }
      file.reveal();
      return true;
    }
    catch (error) {
      this.log("revealFile failed: " + (error.stack || error.message || String(error)));
    }

    try {
      let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(path);
      if (file.parent?.exists()) {
        file.parent.launch();
        return true;
      }
    }
    catch (error) {
      this.log("revealFile fallback failed: " + (error.stack || error.message || String(error)));
    }

    return false;
  },

  getPref(name) {
    let value = Zotero.Prefs.get(this.PREF_PREFIX + name, true);
    if (value === undefined || value === null || value === "") {
      return this.DEFAULTS[name];
    }
    return value;
  },

  getAIURL() {
    let preset = String(this.getPref("aiPreset") || this.DEFAULTS.aiPreset);
    if (preset !== "custom" && this.AI_PRESET_URLS[preset]) {
      return this.AI_PRESET_URLS[preset];
    }
    return String(this.getPref("aiURL") || this.DEFAULTS.aiURL).trim();
  },

  getPresetForAIURL(aiURL) {
    let candidate = null;
    try {
      candidate = new URL(String(aiURL || ""));
    }
    catch (_) {}

    for (let [preset, url] of Object.entries(this.AI_PRESET_URLS)) {
      if (this.isSameURL(aiURL, url)) {
        return preset;
      }
      if (candidate) {
        try {
          let presetURL = new URL(url);
          let path = candidate.pathname.replace(/\/+$/, "") || "/";
          if (candidate.origin === presetURL.origin && (path === "/" || path === "/new")) {
            return preset;
          }
        }
        catch (_) {}
      }
    }
    return "custom";
  },

  getTransferMode() {
    let mode = this.getPref("transferMode");
    if (mode === "hybrid") {
      Zotero.Prefs.set(this.PREF_PREFIX + "transferMode", "text", true);
      return "text";
    }
    if (mode === "public-url") {
      Zotero.Prefs.set(this.PREF_PREFIX + "transferMode", "file", true);
      return "file";
    }
    if (mode !== "gdrive" && mode !== "file" && mode !== "text") {
      Zotero.Prefs.set(this.PREF_PREFIX + "transferMode", "file", true);
      return "file";
    }
    return mode;
  },

  getBoolPref(name) {
    return Boolean(this.getPref(name));
  },

  getIntPref(name) {
    let value = Number.parseInt(this.getPref(name), 10);
    return Number.isFinite(value) && value > 0 ? value : this.DEFAULTS[name];
  },

  alert(window, title, message) {
    Services.prompt.alert(window, title, message);
  },

  showError(window, error) {
    try {
      let message = error?.message || String(error || "Unknown error");
      this.alert(window || this.getActiveWindow(), "Zotero AI Reading", message);
    }
    catch (_) {}
  }
};
