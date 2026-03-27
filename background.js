importScripts(
  "site-registry.js",
  "sites/arca-live.js",
  "sites/blogspot.js",
  "sites/fc2.js",
  "sites/dcinside.js",
  "sites/kone.js"
);

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

async function ensureViewerInjected(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["style.css"]
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "site-registry.js",
      "sites/arca-live.js",
      "sites/blogspot.js",
      "sites/fc2.js",
      "sites/dcinside.js",
      "sites/kone.js",
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
  await ensureViewerInjected(tabId);

  await chrome.tabs.sendMessage(tabId, {
    type: "DCMV_OPEN",
    targetImageUrl
  });
}

chrome.runtime.onInstalled.addListener(() => {
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
