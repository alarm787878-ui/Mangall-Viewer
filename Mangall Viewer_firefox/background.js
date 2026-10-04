// Firefox는 manifest의 background.scripts로 같은 파일들을 먼저 불러오므로
// 서비스 워커(크롬)에서만 importScripts를 호출한다.
if (typeof importScripts === "function") {
  importScripts(
    "site-registry.js",
    "sites/universal-site-settings.js",
    "sites/arca-live.js",
    "sites/blogspot.js",
    "sites/fc2.js",
    "sites/dcinside.js",
    "sites/kone.js"
  );
}

const DEFAULT_SETTINGS = {
  readingDirectionRTL: true,
  spreadEnabled: true,
  firstPageSingle: true,
  useWasd: true,
  autoFirstPageAdjust: false,
  autoSplitLongImages: false,
  showImageComments: false,
  alwaysShowComments: true,
  showCornerPageCounter: false,
  fullscreenShortcut: "f",
  spreadShortcut: "",
  resetPairingShortcut: "r"
};
const INITIAL_HUD_GUIDE_STORAGE_KEY = "shouldShowInitialHudGuide";
const LONG_IMAGE_SPLIT_HINT_PENDING_STORAGE_KEY = "longImageSplitHintPending";
const OPTIONS_MENU_ID = "dcmv-open-options";

async function syncSiteRegistry() {
  const universalSettings = globalThis.__dcmvModules?.universalSiteSettings;
  if (universalSettings?.loadAndRegisterCustomAdapters) {
    await universalSettings.loadAndRegisterCustomAdapters();
  }
}

async function syncSiteRegistryAndMenus() {
  await syncSiteRegistry();
  createContextMenu();
}

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    // Firefox 툴바 아이콘 우클릭 메뉴에는 옵션 바로가기가 없어서 직접 추가한다.
    try {
      chrome.contextMenus.create({
        id: OPTIONS_MENU_ID,
        title: "만갤 뷰어 설정 열기",
        contexts: ["action"]
      });
    } catch (_) {
      void chrome.runtime.lastError;
    }

    const adapters = globalThis.__dcmvSiteRegistry?.listSiteAdapters?.() || [];
    for (const adapter of adapters) {
      if (!adapter?.menuId || !Array.isArray(adapter.documentUrlPatterns)) {
        continue;
      }

      if (!adapter.documentUrlPatterns.length) {
        continue;
      }

      try {
        chrome.contextMenus.create({
          id: adapter.menuId,
          title: adapter.menuTitle || adapter.name || "DC Viewer",
          contexts: ["page", "image"],
          documentUrlPatterns: adapter.documentUrlPatterns
        });
      } catch (_) {
        void chrome.runtime.lastError;
      }
    }
  });
}

function getCurrentAdapter(url) {
  return globalThis.__dcmvSiteRegistry?.getSiteAdapterForUrl?.(url) || null;
}

function getSiteScriptFiles(adapter) {
  if (!adapter?.id) return [];
  if (String(adapter.id).startsWith("custom_")) return [];

  const files = [`sites/${adapter.id}.js`];
  if (adapter.id === "dcinside") {
    files.push("sites/dcinside-comments.js");
    files.push("sites/dcinside-long-image-split.js");
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
      "sites/universal-site-settings.js",
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
  await syncSiteRegistry();

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

function parseVersion(version) {
  return String(version || "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

function shouldOpenChangelog(previousVersion, currentVersion) {
  const [prevMajor, prevMinor] = parseVersion(previousVersion);
  const [currentMajor, currentMinor] = parseVersion(currentVersion);
  return prevMajor !== currentMajor || prevMinor !== currentMinor;
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

chrome.runtime.onInstalled.addListener(async (details) => {
  ensureDefaultSettings();
  if (details?.reason === "install") {
    chrome.storage?.local?.set({
      [INITIAL_HUD_GUIDE_STORAGE_KEY]: true,
      [LONG_IMAGE_SPLIT_HINT_PENDING_STORAGE_KEY]: true
    });
  }
  await syncSiteRegistry();
  createContextMenu();

  if (
    details?.reason === "update" &&
    shouldOpenChangelog(details.previousVersion, chrome.runtime.getManifest().version)
  ) {
    chrome.tabs.create({
      url: chrome.runtime.getURL("extension-settings.html#update-info")
    });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await syncSiteRegistry();
  createContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info?.menuItemId === OPTIONS_MENU_ID) {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (!tab?.id) return;

  const url = tab.url || "";
  syncSiteRegistry()
    .then(() => {
      const adapter = getCurrentAdapter(url);
      if (!adapter || info.menuItemId !== adapter.menuId) return;
      return openViewerInTab(tab.id, info.srcUrl || "", url);
    })
    .catch(() => {
      void chrome.runtime.lastError;
    });
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;

  openViewerInTab(tab.id, "", tab.url || "").catch(() => {
    void chrome.runtime.lastError;
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return undefined;

  if (message.type === "DCMV_RELOAD_CUSTOM_SITES") {
    syncSiteRegistryAndMenus()
      .then(() => sendResponse({ success: true }))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error || "")
        })
      );
    return true;
  }

  if (message.type === "DCMV_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return undefined;
  }

  return undefined;
});
