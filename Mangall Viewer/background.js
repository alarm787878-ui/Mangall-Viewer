importScripts(
  "site-registry.js",
  "sites/universal-site-settings.js",
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
  autoSplitLongImages: false,
  showImageComments: false,
  alwaysShowComments: true,
  showCornerPageCounter: false,
  fullscreenShortcut: "f",
  spreadShortcut: "",
  resetPairingShortcut: "r"
};
// 업데이트 후 "업데이트 안내" 탭을 자동으로 열지 정하는 스위치.
// 평소에는 false로 두고, 꼭 알려야 하는 큰 업데이트 때만 잠깐 true로 바꿔서 배포한다.
// (true여도 앞자리 두 개가 바뀔 때만 열린다. 예: 1.6.x → 1.7.x)
const OPEN_CHANGELOG_ON_UPDATE = false;
const INITIAL_HUD_GUIDE_STORAGE_KEY = "shouldShowInitialHudGuide";
const LONG_IMAGE_SPLIT_HINT_PENDING_STORAGE_KEY = "longImageSplitHintPending";

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
    OPEN_CHANGELOG_ON_UPDATE &&
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

  // 비동기 작업(await)이 시작되기 전에 즉시 executeScript를 쏘아서
  // 웹페이지 컨텍스트에 5초짜리 "사용자 활성화(User Activation)"를 충전합니다.
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      // No-op: 이 코드가 실행되면서 웹페이지의 navigator.userActivation.isActive가 true가 됩니다.
      window.__dcmvActivationCharged = Date.now();
    }
  }).catch(() => {});

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

  // 뷰어 안내 말풍선의 바로가기 버튼: 설정 페이지의 특정 탭(예: update-info)을 새 탭으로 연다.
  if (message.type === "DCMV_OPEN_SETTINGS_TAB") {
    // 탭 이름은 영문 소문자·숫자·하이픈만 허용한다. (엉뚱한 주소가 붙지 않게)
    const tabName = /^[a-z0-9-]+$/.test(String(message.tab || "")) ? message.tab : "";
    chrome.tabs.create({
      url: chrome.runtime.getURL(`extension-settings.html${tabName ? `#${tabName}` : ""}`)
    });
    sendResponse({ success: true });
    return undefined;
  }

  return undefined;
});
