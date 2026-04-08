importScripts(
  "site-registry.js",
  "sites/arca-live.js",
  "sites/blogspot.js",
  "sites/fc2.js",
  "sites/dcinside.js",
  "sites/kone.js"
);

const DEFAULT_SETTINGS = {
  readingDirectionRTL: true,
  spreadEnabled: true,
  firstPageSingle: true,
  useWasd: true,
  autoFirstPageAdjust: false,
  showImageComments: false,
  alwaysShowComments: true
};

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    const adapters = globalThis.__dcmvSiteRegistry?.listSiteAdapters?.() || [];
    for (const adapter of adapters) {
      if (!adapter?.menuId || !Array.isArray(adapter.documentUrlPatterns)) {
        continue;
      }

      chrome.contextMenus.create({
        id: adapter.menuId,
        title: adapter.menuTitle || adapter.name || "DC Viewer",
        contexts: ["page", "image"],
        documentUrlPatterns: adapter.documentUrlPatterns
      });
    }
  });
}

function getCurrentAdapter(url) {
  return globalThis.__dcmvSiteRegistry?.getSiteAdapterForUrl?.(url) || null;
}

function getSiteScriptFiles(adapter) {
  if (!adapter?.id) return [];

  const files = [`sites/${adapter.id}.js`];
  if (adapter.id === "dcinside") {
    files.push("sites/dcinside-comments.js");
  }

  return files;
}

async function ensureViewerInjected(tabId, adapter) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["style.css"]
  });

  const siteScriptFiles = getSiteScriptFiles(adapter);
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "site-registry.js",
      ...siteScriptFiles,
      "viewer-common.js",
      "viewer-ui.js",
      "viewer-layout.js",
      "viewer-hud.js",
      "viewer-settings.js",
      "viewer-navigation.js",
      "viewer-page-loading.js",
      "content.js"
    ]
  });
}

async function openViewerInTab(tabId, targetImageUrl = "") {
  const tab = await chrome.tabs.get(tabId);
  const adapter = getCurrentAdapter(tab?.url);
  if (!adapter) return;

  await ensureViewerInjected(tabId, adapter);

  await chrome.tabs.sendMessage(tabId, {
    type: "DCMV_OPEN",
    targetImageUrl
  });
}

function ensureDefaultSettings() {
  chrome.storage?.local?.get(Object.keys(DEFAULT_SETTINGS), (result) => {
    const missingSettings = {};

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (result?.[key] === undefined) {
        missingSettings[key] = value;
      }
    }

    if (Object.keys(missingSettings).length) {
      chrome.storage.local.set(missingSettings);
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaultSettings();
  createContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;

  const adapter = getCurrentAdapter(tab.url);
  if (!adapter || info.menuItemId !== adapter.menuId) return;

  openViewerInTab(tab.id, info.srcUrl || "").catch(() => {
    void chrome.runtime.lastError;
  });
});
