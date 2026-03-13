const MENU_ID = "dc-manga-viewer-open";

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "만화 보기",
      contexts: ["page"],
      documentUrlPatterns: [
        "*://*.dcinside.com/*",
        "*://*.dcinside.co.kr/*"
      ]
    });
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

  chrome.tabs.sendMessage(tab.id, { type: "DCMV_OPEN" }, () => {
    void chrome.runtime.lastError;
  });
});
