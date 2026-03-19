const MENU_ID = "dc-manga-viewer-open";
const DCINSIDE_URL_PATTERN = /^https?:\/\/([^.]+\.)?dcinside\.(com|co\.kr)\//i;

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "만갤 뷰어",
      contexts: ["page", "image"],
      documentUrlPatterns: [
        "*://*.dcinside.com/*",
        "*://*.dcinside.co.kr/*"
      ]
    });
  });
}

function isDcinsideUrl(url) {
  return typeof url === "string" && DCINSIDE_URL_PATTERN.test(url);
}

async function ensureViewerInjected(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["style.css"]
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
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
  if (info.menuItemId !== MENU_ID) return;
  if (!tab?.id) return;
  if (!isDcinsideUrl(tab.url)) return;

  openViewerInTab(tab.id, info.srcUrl || "").catch(() => {
    void chrome.runtime.lastError;
  });
});
