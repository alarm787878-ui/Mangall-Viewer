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
  alwaysShowComments: true,
  showCornerPageCounter: false
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

async function openViewerInTab(tabId, targetImageUrl = "", providedUrl = null) {
  let url = providedUrl;
  
  if (!url) {
    try {
      const tab = await chrome.tabs.get(tabId);
      url = tab?.url || "";
    } catch (_) {
      void chrome.runtime.lastError;
      url = "";
    }
  }

  if (!url) return;
  
  const adapter = getCurrentAdapter(url);
  if (!adapter) return;

  await ensureViewerInjected(tabId, adapter);

  await chrome.tabs.sendMessage(tabId, {
    type: "DCMV_OPEN",
    targetImageUrl,
    source: "toolbar"
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

  const url = tab.url || "";
  const adapter = getCurrentAdapter(url);
  if (!adapter || info.menuItemId !== adapter.menuId) return;

  openViewerInTab(tab.id, info.srcUrl || "", url).catch(() => {
    void chrome.runtime.lastError;
  });
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;

  const url = tab.url || "";
  const adapter = getCurrentAdapter(url);
  if (!adapter) return;

  // 비동기 작업(await)이 시작되기 전에 즉시 executeScript를 쏘아서
  // 웹페이지 컨텍스트에 5초짜리 "사용자 활성화(User Activation)"를 충전합니다.
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      // No-op: 이 코드가 실행되면서 웹페이지의 navigator.userActivation.isActive가 true가 됩니다.
      window.__dcmvActivationCharged = Date.now();
    }
  }).catch(() => {});

  openViewerInTab(tab.id, "", url).catch(() => {
    void chrome.runtime.lastError;
  });
});

