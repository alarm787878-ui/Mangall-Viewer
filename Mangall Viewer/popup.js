const openButton = document.getElementById("open_btn");
const DCINSIDE_URL_PATTERN = /^https?:\/\/([^.]+\.)?dcinside\.(com|co\.kr)\//i;

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

openButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id || !isDcinsideUrl(tab.url)) {
    window.close();
    return;
  }

  try {
    await ensureViewerInjected(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "DCMV_OPEN" });
  } catch (_) {
    void chrome.runtime.lastError;
  } finally {
    window.close();
  }
});
