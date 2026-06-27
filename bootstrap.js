/* global Zotero, Services */

var ZoteroAIReading;

function log(message) {
  try {
    Zotero.debug("Zotero AI Reading: " + message);
  }
  catch (_) {}
}

function install() {}

async function startup({ id, version, rootURI }) {
  log("Starting");

  await Zotero.initializationPromise;

  Services.scriptloader.loadSubScript(rootURI + "zotero-ai-reading.js");
  ZoteroAIReading.init({ id, version, rootURI });

  try {
    Zotero.PreferencePanes.register({
      pluginID: id,
      src: rootURI + "preferences.xhtml",
      label: "Zotero AI Reading"
    });
  }
  catch (error) {
    ZoteroAIReading.log("PreferencePanes.register failed: " + error);
  }

  ZoteroAIReading.registerMenu();
  ZoteroAIReading.registerReaderPanel();
}

function onMainWindowLoad({ window }) {
  if (ZoteroAIReading?._usedMenuManager === false) {
    ZoteroAIReading.addToWindow(window);
  }
}

function onMainWindowUnload({ window }) {
  if (ZoteroAIReading?._usedMenuManager === false) {
    ZoteroAIReading.removeFromWindow(window);
  }
}

function shutdown() {
  log("Shutting down");
  ZoteroAIReading?.unregisterMenu();
  ZoteroAIReading?.unregisterReaderPanel();
  try {
    if (Zotero.ZoteroAIReading === ZoteroAIReading) {
      delete Zotero.ZoteroAIReading;
    }
  }
  catch (_) {}
  ZoteroAIReading = undefined;
}

function uninstall() {}
