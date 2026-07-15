const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "zotero-ai-reading.js"), "utf8");
const context = { Map, URL };
vm.createContext(context);
vm.runInContext(source, context, { filename: "zotero-ai-reading.js" });

const frameScript = context.ZoteroAIReading.getReaderPanePDFDOMUploadFrameScript("request", "reply");
new Function(frameScript);
const textInsertFrameScript =
  context.ZoteroAIReading.getReaderPaneTextInsertFrameScript("text-request", "text-reply");
new Function(textInsertFrameScript);
const editorReadyFrameScript =
  context.ZoteroAIReading.getReaderPaneEditorReadyFrameScript("ready-request", "ready-reply");
new Function(editorReadyFrameScript);
const editorFocusFrameScript =
  context.ZoteroAIReading.getClaudeEditorFocusFrameScript("focus-request", "focus-reply", 12);
new Function(editorFocusFrameScript);
const attachmentProbeFrameScript =
  context.ZoteroAIReading.getReaderPanePDFAttachmentProbeFrameScript("probe-request", "probe-reply");
new Function(attachmentProbeFrameScript);
const conversationStateFrameScript =
  context.ZoteroAIReading.getReaderPaneConversationStateFrameScript("state-request", "state-reply");
new Function(conversationStateFrameScript);

function readFrameFunction(name, sandbox = {}) {
  const pattern = new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}");
  const match = frameScript.match(pattern);
  assert(match, "Expected generated frame function: " + name);
  return vm.runInNewContext("(" + match[0] + ")", sandbox);
}

const getFileName = readFrameFunction("getFileName");
assert.strictEqual(getFileName("C:\\Zotero\\storage\\ABCD1234\\paper.pdf"), "paper.pdf");
assert.strictEqual(getFileName("/Users/me/Zotero/paper.pdf"), "paper.pdf");

const acceptsPDF = readFrameFunction("acceptsPDF");
const input = (accept) => ({ getAttribute: () => accept });
assert.strictEqual(acceptsPDF(input("image/png,image/jpeg")), false);
assert.strictEqual(acceptsPDF(input("image/*,.pdf,application/pdf")), true);
assert.strictEqual(acceptsPDF(input("")), true);

const chatGPTPreparation = readFrameFunction(
  "getUploadPreparationState",
  { content: { location: { hostname: "chatgpt.com" } } }
)();
assert.strictEqual(chatGPTPreparation.allowUIClick, true);
assert.strictEqual(chatGPTPreparation.explicitOnly, false);
assert.strictEqual(chatGPTPreparation.attemptsLeft, 10);
assert.strictEqual(chatGPTPreparation.retryDelay, 200);

const claudePreparation = readFrameFunction(
  "getUploadPreparationState",
  { content: { location: { hostname: "claude.ai" } } }
)();
assert.strictEqual(claudePreparation.allowUIClick, false);
assert.strictEqual(claudePreparation.explicitOnly, true);
assert.strictEqual(claudePreparation.attemptsLeft, 0);

const deepSeekPreparation = readFrameFunction(
  "getUploadPreparationState",
  { content: { location: { hostname: "chat.deepseek.com" } } }
)();
assert.strictEqual(deepSeekPreparation.site, "deepseek");
assert.strictEqual(deepSeekPreparation.allowUIClick, true);
assert.strictEqual(deepSeekPreparation.explicitOnly, false);
assert.strictEqual(deepSeekPreparation.attemptsLeft, 16);

const geminiPreparation = readFrameFunction(
  "getUploadPreparationState",
  { content: { location: { hostname: "gemini.google.com" } } }
)();
assert.strictEqual(geminiPreparation.site, "gemini");
assert.strictEqual(geminiPreparation.allowUIClick, true);
assert.strictEqual(geminiPreparation.explicitOnly, true);
assert.strictEqual(geminiPreparation.attemptsLeft, 16);

const lookalikePreparation = readFrameFunction(
  "getUploadPreparationState",
  { content: { location: { hostname: "gemini.google.com.evil.test" } } }
)();
assert.strictEqual(lookalikePreparation.allowUIClick, false);

assert(frameScript.includes("composer[-_\\s]?plus"));
assert(frameScript.includes("upload from (?:computer|device)"));
assert(frameScript.includes('reason: "input-selected"'));
assert(frameScript.includes('site: "deepseek"'));
assert(frameScript.includes('site: "gemini"'));
assert(frameScript.includes("function collectOpenRoots"));
assert(frameScript.includes("composed: true"));
assert(frameScript.includes('state.site === "gemini"'));
assert(frameScript.includes("state.menuOpened"));
assert(frameScript.includes('state.site === "gemini" && isGeminiUploadOpener(element)'));
assert(frameScript.includes("if (!candidates.length)"));
assert(frameScript.includes("all[-_\\s]?tools"));
assert(textInsertFrameScript.includes("function isEditorEnabled"));
assert(textInsertFrameScript.includes('reason: stable ? "verified-stable" : "text-not-retained"'));
assert(textInsertFrameScript.includes("}, 800)"));
assert(editorFocusFrameScript.includes("function sendFocusResult"));
assert(editorFocusFrameScript.includes("hasEditorFocus(editor)"));
assert(attachmentProbeFrameScript.includes("function collectOpenRoots"));
assert(attachmentProbeFrameScript.includes("Number.isFinite(requestedAttempts)"));
assert(conversationStateFrameScript.includes("function querySelectorAllDeep"));
assert(conversationStateFrameScript.includes("function isEditorEnabled"));
assert(source.includes("prompt paste skipped to avoid text-only state"));
assert(source.includes("!options.readerPaneLoadedFresh"));
assert(source.includes("Math.ceil(effectiveTimeoutMs / 250) - 1"));

function verifyAttachmentProbeAttemptBudget() {
  let listener = null;
  let reply = null;
  let scheduledPolls = 0;
  const sandbox = {
    content: {
      document: {
        querySelectorAll() {
          return [];
        }
      },
      getComputedStyle() {
        return { display: "block", visibility: "visible", opacity: "1" };
      },
      setTimeout(callback) {
        scheduledPolls++;
        callback();
      }
    },
    addMessageListener(name, callback) {
      assert.strictEqual(name, "probe-request");
      listener = callback;
    },
    removeMessageListener() {},
    sendAsyncMessage(name, data) {
      assert.strictEqual(name, "probe-reply");
      reply = data;
    }
  };
  vm.runInNewContext(attachmentProbeFrameScript, sandbox);
  assert(listener, "Attachment probe listener should be registered");
  listener({ data: { fileName: "paper.pdf", attempts: 2 } });
  assert.strictEqual(scheduledPolls, 2);
  assert.strictEqual(reply.attached, false);
}

verifyAttachmentProbeAttemptBudget();

function verifyGeminiTwoStageUpload() {
  let menuOpen = false;
  let fileInputReady = false;
  let listener = null;
  let reply = null;
  const events = [];
  let documentFixture = null;

  function makeElement({
    tag = "DIV",
    role = "",
    ariaLabel = "",
    text = "",
    className = "",
    type = "",
    accept = "",
    rect,
    onClick = null
  }) {
    const attributes = { role, "aria-label": ariaLabel, type, accept };
    const element = {
      tagName: tag,
      role,
      className,
      id: "",
      innerText: text,
      textContent: text,
      isContentEditable: false,
      disabled: false,
      files: [],
      parentElement: null,
      ownerDocument: null,
      tabIndex: 0,
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
      },
      hasAttribute(name) {
        return Boolean(attributes[name]);
      },
      getBoundingClientRect() {
        return rect;
      },
      getRootNode() {
        return documentFixture;
      },
      querySelectorAll() {
        return [];
      },
      contains(candidate) {
        return candidate === element;
      },
      scrollIntoView() {},
      dispatchEvent() {
        return true;
      },
      focus() {
        documentFixture.activeElement = element;
      },
      click() {
        if (onClick) onClick();
      }
    };
    return element;
  }

  const editor = makeElement({
    tag: "TEXTAREA",
    className: "chat-input",
    rect: { left: 200, right: 800, top: 500, bottom: 610, width: 600, height: 110 }
  });
  const opener = makeElement({
    tag: "BUTTON",
    ariaLabel: "上传和工具",
    className: "upload-tools-button",
    rect: { left: 210, right: 250, top: 555, bottom: 595, width: 40, height: 40 },
    onClick: () => {
      events.push("opener");
      menuOpen = true;
    }
  });
  const localOption = makeElement({
    role: "menuitem",
    text: "Upload file",
    className: "menu-option",
    rect: { left: 210, right: 390, top: 430, bottom: 470, width: 180, height: 40 },
    onClick: () => {
      events.push("local-option");
      fileInputReady = true;
    }
  });
  const fileInput = makeElement({
    tag: "INPUT",
    type: "file",
    accept: "application/pdf",
    className: "upload-file-input",
    rect: { left: 0, right: 1, top: 0, bottom: 1, width: 1, height: 1 }
  });
  fileInput.mozSetFileNameArray = (paths) => {
    events.push("file-selected");
    fileInput.files = [{ name: String(paths[0]).split(/[\\/]/).pop() }];
  };

  documentFixture = {
    activeElement: null,
    body: null,
    documentElement: null,
    querySelectorAll(selector) {
      const controls = [editor, opener].concat(menuOpen ? [localOption] : []).concat(fileInputReady ? [fileInput] : []);
      if (selector === "*") return controls;
      if (selector === "textarea") return [editor];
      if (selector === "input[type='file']") return fileInputReady ? [fileInput] : [];
      if (selector.includes("button") || selector.includes("[aria-label]") || selector.includes("[role='menuitem']")) {
        return [opener].concat(menuOpen ? [localOption] : []);
      }
      return [];
    }
  };
  documentFixture.body = documentFixture;
  documentFixture.documentElement = documentFixture;
  for (const element of [editor, opener, localOption, fileInput]) {
    element.ownerDocument = documentFixture;
  }

  const sandbox = {
    Components: {
      classes: {
        "@mozilla.org/file/local;1": {
          createInstance: () => ({ initWithPath() {} })
        }
      },
      interfaces: { nsIFile: {} }
    },
    content: {
      document: documentFixture,
      location: { hostname: "gemini.google.com" },
      innerHeight: 900,
      innerWidth: 1200,
      getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
      setTimeout: (callback) => callback(),
      Event: class {},
      MouseEvent: class {},
      File: { createFromNsIFile: () => ({ name: "paper.pdf" }) },
      getSelection: () => ({ removeAllRanges() {}, addRange() {} })
    },
    addMessageListener(name, callback) {
      assert.strictEqual(name, "request");
      listener = callback;
    },
    removeMessageListener() {},
    sendAsyncMessage(name, data) {
      assert.strictEqual(name, "reply");
      reply = data;
    }
  };

  vm.runInNewContext(frameScript, sandbox);
  assert(listener, "Gemini upload frame listener should be registered");
  listener({ data: { pdfPath: "C:\\Zotero\\paper.pdf" } });
  assert.deepStrictEqual(events, ["opener", "local-option", "file-selected"], JSON.stringify(reply));
  assert.strictEqual(reply.ok, true);
  assert.strictEqual(reply.reason, "input-selected");
  assert.strictEqual(reply.inputCount, 1);
}

verifyGeminiTwoStageUpload();

async function verifyChatGPTAttachmentGateBeforePrompt() {
  const sut = context.ZoteroAIReading;
  const names = [
    "waitForReaderPaneEditorReady",
    "isReaderPanePDFAlreadyAttached",
    "uploadPDFFileIntoReaderPaneByDOM",
    "waitForReaderPanePDFAttachment",
    "pasteTextIntoReaderPaneEditorOrClipboard",
    "pasteTextClipboardIntoReaderPane"
  ];
  const original = Object.fromEntries(names.map((name) => [name, sut[name]]));
  const events = [];
  try {
    sut.waitForReaderPaneEditorReady = async () => true;
    sut.isReaderPanePDFAlreadyAttached = async () => false;
    sut.uploadPDFFileIntoReaderPaneByDOM = async () => {
      events.push("input-selected");
      return { ok: true, reason: "input-selected" };
    };
    sut.waitForReaderPanePDFAttachment = async () => {
      events.push("attachment-confirmed");
      return true;
    };
    sut.pasteTextIntoReaderPaneEditorOrClipboard = () => {
      events.push("prompt-direct");
      return true;
    };
    sut.pasteTextClipboardIntoReaderPane = () => {
      events.push("prompt-clipboard");
      return true;
    };
    await sut.pasteIntoSpecialReaderPane({}, {
      aiURL: "https://chatgpt.com/",
      pdfPath: "C:\\Zotero\\paper.pdf",
      prompt: "Read this PDF",
      readerPaneLoadedFresh: true,
      transferMode: "file"
    });
    assert.deepStrictEqual(events, ["input-selected", "attachment-confirmed", "prompt-direct"]);
  }
  finally {
    Object.assign(sut, original);
  }
}

async function verifyLegacySiteRoute(aiURL) {
  const sut = context.ZoteroAIReading;
  const originalLegacyPaste = sut.pasteIntoLegacyReaderPane;
  const originalDOMUpload = sut.uploadPDFFileIntoReaderPaneByDOM;
  const events = [];
  try {
    sut.pasteIntoLegacyReaderPane = async () => {
      events.push("legacy-route");
      return true;
    };
    sut.uploadPDFFileIntoReaderPaneByDOM = async () => {
      events.push("current-gpt-uploader");
      return true;
    };
    const handled = await sut.pasteIntoSpecialReaderPane({}, {
      aiURL,
      pdfPath: "C:\\Zotero\\paper.pdf",
      prompt: "Read this PDF",
      transferMode: "file"
    });
    assert.strictEqual(handled, true);
    assert.deepStrictEqual(events, ["legacy-route"]);
  }
  finally {
    sut.pasteIntoLegacyReaderPane = originalLegacyPaste;
    sut.uploadPDFFileIntoReaderPaneByDOM = originalDOMUpload;
  }
}

async function verifyLegacyPasteSequence(domUploadSucceeds) {
  const sut = context.ZoteroAIReading;
  const names = [
    "waitForReaderPaneEditorReady",
    "isReaderPanePDFAlreadyAttached",
    "uploadPDFFileIntoReaderPaneByDOM",
    "pastePDFFileClipboardIntoReaderPaneAndWait",
    "pastePromptAfterLegacyReaderPanePDFAttachment",
    "pasteTextClipboardIntoLegacyReaderPane"
  ];
  const original = Object.fromEntries(names.map((name) => [name, sut[name]]));
  const events = [];
  try {
    sut.waitForReaderPaneEditorReady = async (_reader, timeout, attempts) => {
      assert.strictEqual(timeout, 2500);
      assert.strictEqual(attempts, 10);
      events.push("editor-ready");
      return true;
    };
    sut.isReaderPanePDFAlreadyAttached = async (_reader, _path, timeout) => {
      assert.strictEqual(timeout, 900);
      events.push("duplicate-check");
      return false;
    };
    sut.uploadPDFFileIntoReaderPaneByDOM = async (_reader, _path, returnDetails, unusedFourthArg) => {
      assert.strictEqual(returnDetails, undefined);
      assert.strictEqual(unusedFourthArg, undefined);
      events.push("site-dom-upload");
      return domUploadSucceeds;
    };
    sut.pastePDFFileClipboardIntoReaderPaneAndWait = async () => {
      events.push("clipboard-file-fallback");
      return true;
    };
    sut.pastePromptAfterLegacyReaderPanePDFAttachment = (_reader, _path, pastePrompt, timeout, minDelay) => {
      assert.strictEqual(timeout, 2500);
      assert.strictEqual(minDelay, 6000);
      events.push("attachment-wait");
      pastePrompt();
    };
    sut.pasteTextClipboardIntoLegacyReaderPane = (_reader, prompt, delay) => {
      assert.strictEqual(prompt, "Read this PDF");
      assert.strictEqual(delay, 300);
      events.push("legacy-prompt");
      return true;
    };

    const handled = await sut.pasteIntoLegacyReaderPane({}, {
      aiURL: "https://claude.ai/new",
      pdfPath: "C:\\Zotero\\paper.pdf",
      prompt: "Read this PDF",
      transferMode: "file"
    });
    assert.strictEqual(handled, true);
    assert.deepStrictEqual(
      events,
      ["editor-ready", "duplicate-check", "site-dom-upload"]
        .concat(domUploadSucceeds ? [] : ["clipboard-file-fallback"])
        .concat(["attachment-wait", "legacy-prompt"])
    );
  }
  finally {
    Object.assign(sut, original);
  }
}

async function verifyPromptPastesAfterAttachmentProbeMiss() {
  const sut = context.ZoteroAIReading;
  const originalWait = sut.waitForReaderPanePDFAttachment;
  const originalSchedule = sut.schedulePasteTimer;
  const originalLog = sut.log;
  let pasted = false;
  let scheduledDelay = -1;
  try {
    sut.waitForReaderPanePDFAttachment = async () => false;
    sut.log = () => {};
    let scheduled;
    const scheduledPromise = new Promise((resolve) => {
      scheduled = resolve;
    });
    sut.schedulePasteTimer = (callback, delay) => {
      scheduledDelay = delay;
      callback();
      scheduled();
    };
    sut.pastePromptAfterLegacyReaderPanePDFAttachment({}, "paper.pdf", () => {
      pasted = true;
    }, 2500, 6000);
    await scheduledPromise;
    assert.strictEqual(pasted, true);
    assert(scheduledDelay > 5900 && scheduledDelay <= 6000);
  }
  finally {
    sut.waitForReaderPanePDFAttachment = originalWait;
    sut.schedulePasteTimer = originalSchedule;
    sut.log = originalLog;
  }
}

async function verifyModernPromptSkipsAfterAttachmentProbeMiss() {
  const sut = context.ZoteroAIReading;
  const originalWait = sut.waitForReaderPanePDFAttachment;
  const originalSchedule = sut.schedulePasteTimer;
  const originalLog = sut.log;
  let pasted = false;
  let scheduled = false;
  try {
    sut.waitForReaderPanePDFAttachment = async () => false;
    sut.schedulePasteTimer = () => {
      scheduled = true;
    };
    sut.log = () => {};
    sut.pastePromptAfterReaderPanePDFAttachment({}, "paper.pdf", () => {
      pasted = true;
    }, 2500, 6000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(pasted, false);
    assert.strictEqual(scheduled, false);
  }
  finally {
    sut.waitForReaderPanePDFAttachment = originalWait;
    sut.schedulePasteTimer = originalSchedule;
    sut.log = originalLog;
  }
}

function verifyLegacyClipboardTextSequence() {
  const sut = context.ZoteroAIReading;
  const names = [
    "focusReaderPaneFrame",
    "focusClaudeEditorInReaderPane",
    "copyToClipboard",
    "runPasteKeystroke"
  ];
  const original = Object.fromEntries(names.map((name) => [name, sut[name]]));
  const originalTimers = sut.pasteTimers;
  const originalCc = context.Cc;
  const originalCi = context.Ci;
  const events = [];
  let callback = null;
  let delay = -1;
  try {
    context.Cc = {
      "@mozilla.org/timer;1": {
        createInstance() {
          return {
            initWithCallback(next, nextDelay) {
              callback = next;
              delay = nextDelay;
            }
          };
        }
      }
    };
    context.Ci = { nsITimer: { TYPE_ONE_SHOT: 1 } };
    sut.pasteTimers = [];
    sut.focusReaderPaneFrame = () => events.push("frame-focus");
    sut.focusClaudeEditorInReaderPane = () => events.push("editor-focus");
    sut.copyToClipboard = (text) => events.push("copy:" + text);
    sut.runPasteKeystroke = (url, allowZotero, wait) => {
      assert.strictEqual(url, "");
      assert.strictEqual(allowZotero, true);
      assert.strictEqual(wait, true);
      events.push("ctrl-v");
      return true;
    };

    assert.strictEqual(sut.pasteTextClipboardIntoLegacyReaderPane({}, "Read this PDF", 100), true);
    assert.deepStrictEqual(events, ["frame-focus", "editor-focus"]);
    assert.strictEqual(delay, 300);
    assert.strictEqual(typeof callback, "function");
    callback();
    assert.deepStrictEqual(events, [
      "frame-focus",
      "editor-focus",
      "copy:Read this PDF",
      "frame-focus",
      "editor-focus",
      "ctrl-v"
    ]);
    assert.strictEqual(sut.pasteTimers.length, 0);
  }
  finally {
    Object.assign(sut, original);
    sut.pasteTimers = originalTimers;
    if (originalCc === undefined) {
      delete context.Cc;
    }
    else {
      context.Cc = originalCc;
    }
    if (originalCi === undefined) {
      delete context.Ci;
    }
    else {
      context.Ci = originalCi;
    }
  }
}

assert.strictEqual(context.ZoteroAIReading.shouldUseLegacyReaderPanePaste({}, {
  aiURL: "https://claude.ai/new",
  prompt: "x"
}), true);
assert.strictEqual(context.ZoteroAIReading.shouldUseLegacyReaderPanePaste({}, {
  aiURL: "https://chat.deepseek.com/",
  prompt: "x"
}), true);
assert.strictEqual(context.ZoteroAIReading.shouldUseLegacyReaderPanePaste({}, {
  aiURL: "https://gemini.google.com/app",
  prompt: "x"
}), true);
assert.strictEqual(context.ZoteroAIReading.shouldUseLegacyReaderPanePaste({}, {
  aiURL: "https://gemini.google.com.evil.test/",
  prompt: "x"
}), false);
assert.strictEqual(context.ZoteroAIReading.shouldUseLegacyReaderPanePaste({}, {
  aiURL: "https://chatgpt.com/",
  prompt: "x"
}), false);

Promise.resolve()
  .then(() => verifyChatGPTAttachmentGateBeforePrompt())
  .then(() => verifyLegacySiteRoute("https://claude.ai/new"))
  .then(() => verifyLegacySiteRoute("https://chat.deepseek.com/"))
  .then(() => verifyLegacySiteRoute("https://gemini.google.com/app"))
  .then(() => verifyLegacyPasteSequence(true))
  .then(() => verifyLegacyPasteSequence(false))
  .then(() => verifyPromptPastesAfterAttachmentProbeMiss())
  .then(() => verifyModernPromptSkipsAfterAttachmentProbeMiss())
  .then(() => verifyLegacyClipboardTextSequence())
  .then(() => console.log("Reader-pane PDF upload checks passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
