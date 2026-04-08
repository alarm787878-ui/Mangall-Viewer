const openButton = document.getElementById("open_btn");
const POPUP_BUTTON_LABEL = "만갤 뷰어";

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

async function syncPopupLabel() {
  openButton.textContent = POPUP_BUTTON_LABEL;
}

openButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  const adapter = getCurrentAdapter(tab?.url);
  if (!tab?.id || !adapter) {
    window.close();
    return;
  }

  try {
    openButton.textContent = POPUP_BUTTON_LABEL;
    await ensureViewerInjected(tab.id, adapter);
    await chrome.tabs.sendMessage(tab.id, { type: "DCMV_OPEN" });
  } catch (_) {
    void chrome.runtime.lastError;
  } finally {
    window.close();
  }
});

syncPopupLabel().catch(() => {
  openButton.textContent = POPUP_BUTTON_LABEL;
});
