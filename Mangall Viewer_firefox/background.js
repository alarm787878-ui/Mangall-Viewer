const browserApi = globalThis.__dcmvBrowserApi;
const openedTabs = new Map();

function markTabOpened(tabId, details = {}) {
  if (!tabId) return;
  openedTabs.set(tabId, {
    at: Date.now(),
    ...details
  });
}

function consumeTabOpened(tabId, requestStartedAt) {
  const opened = openedTabs.get(tabId);
  if (!opened) return false;
  if (opened.at < requestStartedAt) return false;

  openedTabs.delete(tabId);
  return true;
}

function createContextMenu() {
  browserApi.removeAllContextMenus().catch(() => undefined).then(async () => {
    const adapters = globalThis.__dcmvSiteRegistry?.listSiteAdapters?.() || [];
    for (const adapter of adapters) {
      if (!adapter?.menuId || !Array.isArray(adapter.documentUrlPatterns)) {
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
        // 브라우저별 컨텍스트 메뉴 정책 차이로 실패해도 나머지 메뉴 등록은 계속한다.
      }
    }
  });
}

function getCurrentAdapter(url) {
  return globalThis.__dcmvSiteRegistry?.getSiteAdapterForUrl?.(url) || null;
}

async function ensureViewerInjected(tabId) {
  await browserApi.insertCss(tabId, ["style.css"]);

  await browserApi.executeScript(tabId, [
    "browser-api.js",
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
  ]);
}

async function openViewerInTab(tabId, targetImageUrl = "") {
  const startedAt = Date.now();
  openedTabs.delete(tabId);
  await ensureViewerInjected(tabId);

  const message = {
    type: "DCMV_OPEN",
    targetImageUrl
  };

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await browserApi.sendMessage(tabId, message);

    await browserApi.sleep(120);
    if (consumeTabOpened(tabId, startedAt)) {
      return;
    }

    const overlayResults = await browserApi.executeFunction(
      tabId,
      () => !!document.getElementById("dcmv-overlay")
    );
    const hasOverlay = Array.isArray(overlayResults)
      ? overlayResults.some((entry) => entry?.result === true)
      : false;

    if (hasOverlay) {
      return;
    }
  }
}

browserApi.addRuntimeInstalledListener(() => {
  createContextMenu();
});

browserApi.addRuntimeStartupListener(() => {
  createContextMenu();
});

browserApi.raw?.runtime?.onMessage?.addListener((message, sender) => {
  if (message?.type !== "DCMV_OPENED") return;

  const tabId = sender?.tab?.id;
  if (!tabId) return;

  markTabOpened(tabId, {
    instanceId: message.instanceId || "",
    url: message.url || ""
  });
});

browserApi.addContextMenuClickListener((info, tab) => {
  if (!tab?.id) return;

  const adapter = getCurrentAdapter(tab.url);
  if (!adapter || info.menuItemId !== adapter.menuId) return;

  openViewerInTab(tab.id, info.srcUrl || "").catch(() => undefined);
});

createContextMenu();
