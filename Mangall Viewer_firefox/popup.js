const openButton = document.getElementById("open_btn");
const POPUP_BUTTON_LABEL = "만갤 뷰어";
const browserApi = globalThis.__dcmvBrowserApi;

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

async function syncPopupLabel() {
  openButton.textContent = POPUP_BUTTON_LABEL;
}

async function openViewerInTab(tabId) {
  await ensureViewerInjected(tabId);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await browserApi.sendMessage(tabId, { type: "DCMV_OPEN" });

    await browserApi.sleep(120);
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

openButton.addEventListener("click", async () => {
  const tab = await browserApi.queryActiveTab();

  const adapter = getCurrentAdapter(tab?.url);
  if (!tab?.id || !adapter) {
    window.close();
    return;
  }

  try {
    openButton.textContent = POPUP_BUTTON_LABEL;
    await openViewerInTab(tab.id);
  } catch (_) {
  } finally {
    window.close();
  }
});

syncPopupLabel().catch(() => {
  openButton.textContent = POPUP_BUTTON_LABEL;
});
