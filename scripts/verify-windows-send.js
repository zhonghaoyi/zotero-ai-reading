const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "zotero-ai-reading.js"), "utf8");
const url = "https://chatgpt.com/";
const attachment = { id: 42 };
const selected = { item: {}, attachment, pdfPath: "C:\\文献\\one.pdf" };

function setup(preferences) {
  const events = [];
  const context = { URL, Zotero: { launchURL: (page) => events.push(["launch", page]) } };
  vm.runInNewContext(source, context);
  const sut = context.ZoteroAIReading;
  Object.assign(sut, {
    getAIURL: () => url,
    getSelectedPDF: async () => selected,
    getBoolPref: name => preferences[name],
    getTransferMode: () => "file",
    buildPrompt: async () => "Read this PDF",
    preparePDFUploadPath: value => value,
    copyPDFFileToClipboardAsync: file => events.push(["clipboard", file]),
    scheduleAutoPaste: (page, payload) => events.push(["schedule", page, payload.pdfPath]),
    log: () => {},
    showError: (_, error) => { throw error; }
  });
  return { context, sut, events };
}

async function checkMenu() {
  for (const autoPaste of [true, false]) {
    const { sut, events } = setup({ openAIPage: true, autoPaste });
    await sut.runFromWindow({});
    assert.deepEqual(events, [
      ["launch", url],
      autoPaste ? ["schedule", url, selected.pdfPath] : ["clipboard", selected.pdfPath]
    ]);
  }
  const manualPage = setup({ openAIPage: false, autoPaste: true });
  manualPage.sut.scheduleAutoPaste = (page, options) => {
    assert.equal(options.useCurrentConversation, true);
    manualPage.events.push(["current-tab", page]);
  };
  await manualPage.sut.runFromWindow({});
  assert.deepEqual(manualPage.events, [["current-tab", url]]);
  const { context, sut, events } = setup({ openInReaderPane: true, openAIPage: true, autoPaste: true });
  const reader = { itemID: attachment.id, _item: attachment };
  context.Zotero.Reader = {
    _readers: [{ itemID: 7 }],
    async open(id) {
      assert.equal(id, attachment.id);
      return undefined; // Zotero is restoring an unloaded PDF tab
    }
  };
  context.Zotero.Promise = { delay: async () => context.Zotero.Reader._readers.push(reader) };
  sut.getPDFForReader = async target => { assert.equal(target, reader); return selected; };
  sut.openAIInReaderPane = async target => { assert.equal(target, reader); return { opened: true }; };
  sut.rememberReaderPanePastePayload = () => {};
  sut.scheduleReaderPanePasteWhenEditorReady = (target, payload) => {
    assert.equal(target, reader);
    events.push(["reader", payload.pdfPath]);
  };
  await sut.runFromWindow({});
  assert.deepEqual(events, [["reader", selected.pdfPath]]);
}

function checkExternalRoute() {
  const { sut, events } = setup({});
  sut.isWindows = () => true;
  sut.pastePDFIntoWindowsChatGPT = () => events.push("windows-file");
  sut.pasteWithOptions = () => events.push("existing-route");
  for (const [page, mode] of [[url, "file"], ["https://chat.openai.com", "file"],
    ["https://chatgpt.com.example.org", "file"], [url, "text"]]) {
    sut.pasteIntoBrowser(page, { transferMode: mode });
  }
  sut.isWindows = () => false;
  sut.pasteIntoBrowser(url, { transferMode: "file" });
  assert.deepEqual(events, ["windows-file", "windows-file", "existing-route", "existing-route", "existing-route"]);
}

checkMenu().then(checkExternalRoute).then(() => console.log("Windows Send PDF checks passed"))
  .catch(error => { console.error(error); process.exitCode = 1; });
