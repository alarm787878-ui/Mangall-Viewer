const browserApi = globalThis.__dcmvBrowserApi;
const extensionApi = browserApi?.raw;
const DEFAULT_SETTINGS = {
  readingDirectionRTL: true,
  spreadEnabled: true,
  firstPageSingle: true,
  useWasd: true,
  autoFirstPageAdjust: false,
  showCornerPageCounter: false,
  fullscreenShortcut: "f",
  spreadShortcut: "",
  resetPairingShortcut: "r"
};
const INITIAL_HUD_GUIDE_STORAGE_KEY = "shouldShowInitialHudGuide";

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
  browserApi.removeAllContextMenus().catch(() => undefined).then(async () => {
    const adapters = globalThis.__dcmvSiteRegistry?.listSiteAdapters?.() || [];
    for (const adapter of adapters) {
      if (!adapter?.menuId || !Array.isArray(adapter.documentUrlPatterns)) {
        continue;
      }

      if (!adapter.documentUrlPatterns.length) {
        continue;
      }

      try {
        await browserApi.createContextMenu({
          id: adapter.menuId,
          title: adapter.menuTitle || adapter.name || "DC Viewer",
          contexts: ["page", "image"],
          documentUrlPatterns: adapter.documentUrlPatterns
        });
      } catch {
        // Firefox와 Chrome의 컨텍스트 메뉴 정책 차이로 실패해도 나머지 메뉴 등록은 계속한다.
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
  return [`sites/${adapter.id}.js`];
}

async function ensureViewerInjected(tabId, adapter) {
  await browserApi.insertCss(tabId, ["style.css"]);

  await browserApi.executeScript(tabId, [
    "browser-api.js",
    "site-registry.js",
    "sites/universal-site-settings.js",
    ...getSiteScriptFiles(adapter),
    "viewer-common.js",
    "viewer-ui.js",
    "viewer-layout.js",
    "viewer-hud.js",
    "viewer-settings.js",
    "viewer-navigation.js",
    "viewer-page-loading.js",
    "content.js"
  ]);
}

async function openViewerInTab(tabId, targetImageUrl = "", providedUrl = "") {
  await syncSiteRegistry();

  const url = providedUrl || "";
  if (!url) return;

  const adapter = getCurrentAdapter(url);
  if (!adapter) return;

  await ensureViewerInjected(tabId, adapter);
  await browserApi.sendMessage(tabId, {
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
  const storageArea = browserApi.getStorageArea();
  if (!storageArea) return;

  storageArea.get(Object.keys(DEFAULT_SETTINGS), (result = {}) => {
    const missingSettings = {};

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (result?.[key] === undefined) {
        missingSettings[key] = value;
      }
    }

    if (Object.keys(missingSettings).length) {
      storageArea.set(missingSettings);
    }
  });
}

browserApi.addRuntimeInstalledListener(async (details) => {
  ensureDefaultSettings();
  if (details?.reason === "install") {
    browserApi.getStorageArea()?.set({ [INITIAL_HUD_GUIDE_STORAGE_KEY]: true });
  }
  await syncSiteRegistryAndMenus();

  const currentVersion = extensionApi?.runtime?.getManifest?.().version || "";
  if (details?.reason === "update" && shouldOpenChangelog(details.previousVersion, currentVersion)) {
    const url = extensionApi?.runtime?.getURL?.("extension-settings.html#update-info");
    if (url) {
      extensionApi?.tabs?.create?.({ url });
    }
  }
});

browserApi.addRuntimeStartupListener(async () => {
  await syncSiteRegistryAndMenus();
});

browserApi.addContextMenuClickListener((info, tab) => {
  if (!tab?.id) return;

  const url = tab.url || "";
  syncSiteRegistry()
    .then(() => {
      const adapter = getCurrentAdapter(url);
      if (!adapter || info.menuItemId !== adapter.menuId) return;
      return openViewerInTab(tab.id, info.srcUrl || "", url);
    })
    .catch(() => undefined);
});

extensionApi?.action?.onClicked?.addListener((tab) => {
  if (!tab?.id) return;

  openViewerInTab(tab.id, "", tab.url || "").catch(() => undefined);
});

extensionApi?.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
  if (!message) return undefined;

  if (message.type === "DCMV_RELOAD_CUSTOM_SITES") {
    syncSiteRegistryAndMenus()
      .then(() => sendResponse?.({ success: true }))
      .catch((error) =>
        sendResponse?.({
          success: false,
          error: error instanceof Error ? error.message : String(error || "")
        })
      );
    return true;
  }

  if (message.type === "DCMV_OPEN_OPTIONS") {
    extensionApi?.runtime?.openOptionsPage?.();
    sendResponse?.({ success: true });
    return undefined;
  }

  return undefined;
});

syncSiteRegistryAndMenus().catch(() => undefined);
